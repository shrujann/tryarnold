---
name: TDEE onboarding flow
overview: Add a structured 7-step chat onboarding (units, gender, age, weight, height, activity, fitness goal) that computes TDEE via Mifflin-St Jeor, persists profile + macro targets to D1, gates the app until complete, and feeds goal-aware context into /progress, the coach agent, and tools.
todos:
  - id: migration-0006
    content: Add migrations/0006_user_profile_onboarding.sql with profile + onboarding_step columns
    status: pending
  - id: tdee-units
    content: Implement src/services/tdee.ts and src/services/units.ts with full unit parsing
    status: pending
  - id: onboarding-handler
    content: Build onboarding state machine in src/handlers/onboarding.ts + src/services/onboarding.ts (onboard:* callbacks)
    status: pending
  - id: db-users
    content: "Extend src/db/users.ts: UserRow, completeOnboarding, getDailyProgress"
    status: pending
  - id: dispatcher-gate
    content: Gate dispatcher until onboarded; update /start, add /setup in commands.ts
    status: pending
  - id: goal-aware-surfaces
    content: Update context.ts, /progress, get-progress tool, coach system prompt
    status: pending
  - id: tests
    content: Add tests/tdee.test.ts, tests/units.test.ts, tests/onboarding.test.ts; update existing tests
    status: pending
isProject: false
---

# TDEE Onboarding and Goal-Aware Coaching

## Problem (from grill)

`[users](src/db/users.ts)` already has `target_calories`, `target_*_g`, `goal_summary`, and `onboarded` from the original schema, but nothing writes or reads them. `[/progress](src/handlers/commands.ts)` shows totals without a target. `[buildRecentContext](src/services/context.ts)` only prints `goal=not set`. This plan closes that gap with a **standardized, channel-agnostic onboarding state machine** (same pattern as meal confirmation: buttons + text steps).

## Architecture

```mermaid
flowchart TD
    msg[InboundMessage] --> dispatch[dispatcher.processMessage]
    dispatch --> check{user.onboarded?}
    check -->|no| onboard[handlers/onboarding.ts]
    check -->|yes| normal[commands / photo / coach]
    onboard --> steps[7 steps + callbacks]
    steps --> tdee[services/tdee.ts]
    tdee --> save[db/users.ts saveProfile]
    save --> done[onboarded=1 + targets set]
    normal --> context[services/context.ts]
    context --> coach[agents/coach.ts]
    context --> progress[/progress + get_progress tool]
```



## 1. D1 migration — profile columns

Add `[migrations/0006_user_profile_onboarding.sql](migrations/0006_user_profile_onboarding.sql)`:


| Column            | Type    | Purpose                                                       |
| ----------------- | ------- | ------------------------------------------------------------- |
| `gender`          | TEXT    | `male` / `female` / `other`                                   |
| `age`             | INTEGER | years                                                         |
| `weight_kg`       | REAL    | canonical storage (convert from lbs at input)                 |
| `height_cm`       | REAL    | canonical storage (convert from ft/in at input)               |
| `unit_preference` | TEXT    | `metric` / `imperial` (display + re-onboard)                  |
| `activity_level`  | TEXT    | `sedentary` / `light` / `moderate` / `active` / `very_active` |
| `fitness_goal`    | TEXT    | `lose` / `maintain` / `gain`                                  |
| `bmr`             | REAL    | computed BMR (kcal/day)                                       |
| `tdee`            | REAL    | BMR × activity multiplier                                     |
| `onboarding_step` | TEXT    | current step key; NULL when complete                          |


Reuse existing columns on completion:

- `target_calories`, `target_protein_g`, `target_carbs_g`, `target_fat_g`
- `goal_summary` (human-readable, e.g. `"lose weight"`)
- `onboarded = 1`, `consent_health_data = 1`

No new tables — one draft state per user on the `users` row (same simplicity as `pending_meals`).

## 2. TDEE engine — pure service

New `[src/services/tdee.ts](src/services/tdee.ts)` (unit-testable, no I/O):

**BMR — Mifflin-St Jeor** (weight kg, height cm, age years):

- Male: `10×W + 6.25×H − 5×A + 5`
- Female: `10×W + 6.25×H − 5×A − 161`
- Other: average of male and female formulas

**Activity multipliers** (user chose 6th step):


| Level       | Multiplier |
| ----------- | ---------- |
| sedentary   | 1.2        |
| light       | 1.375      |
| moderate    | 1.55       |
| active      | 1.725      |
| very_active | 1.9        |


**TDEE** = `round(BMR × multiplier)`

**Calorie target from fitness goal**:

- `lose`: TDEE − 500 (floor: 1500 male / 1200 female / 1350 other)
- `maintain`: TDEE
- `gain`: TDEE + 300

**Macro targets** (simple, defensible defaults):

- Protein: `2.0 g/kg` (gain), `1.8 g/kg` (lose), `1.6 g/kg` (maintain)
- Fat: 25% of target calories
- Carbs: remainder

New `[src/services/units.ts](src/services/units.ts)` for parsing/normalizing:

- Weight: `68`, `68kg`, `150 lbs`, `150lb`
- Height metric: `175`, `175cm`
- Height imperial: `5'10`, `5 ft 10`, `70 in`
- Store always as kg/cm internally; display back in user's `unit_preference`

## 3. Onboarding state machine

New `[src/handlers/onboarding.ts](src/handlers/onboarding.ts)` + `[src/services/onboarding.ts](src/services/onboarding.ts)` for step definitions and `normalizeOnboardAction()` (prefix `onboard:`, parallel to `meal:` in `[pending-meal.ts](src/services/pending-meal.ts)`).

### Step sequence


| Step       | Input type | Example prompt                                                 |
| ---------- | ---------- | -------------------------------------------------------------- |
| `unit`     | Buttons    | "Which units do you prefer?" → Metric / Imperial               |
| `gender`   | Buttons    | Male / Female / Prefer not to say                              |
| `age`      | Text       | "How old are you?" (validate 13–100)                           |
| `weight`   | Text       | "Current weight?" (hint: kg or lbs based on unit)              |
| `height`   | Text       | "Height?" (cm or ft/in based on unit)                          |
| `activity` | Buttons    | Sedentary … Very active (short labels + one-line descriptions) |
| `goal`     | Buttons    | Lose weight / Maintain / Gain muscle                           |


**Completion message** (no emoji, matches bot tone):

```
your plan:
- goal: lose weight
- daily target: 1,850 kcal (TDEE ~2,350)
- macros: P148g C185g F62g

send a food photo or text what you ate to start logging.
```

### Callback contract

- Telegram inline keyboard + LINE Flex footer (reuse `[sendTextWithKeyboard](src/channels/telegram.ts)` / `[buildFlexFooterContents](src/channels/line.ts)`)
- Data tokens: `onboard:unit_metric`, `onboard:gender_female`, `onboard:activity_moderate`, `onboard:goal_lose`, etc.

### Commands

- `/start` on **new** user → begin onboarding (replace static `[WELCOME](src/handlers/commands.ts)`)
- `/setup` → reset `onboarding_step = 'unit'`, `onboarded = 0`, restart flow (any user)
- `/help` unchanged except note about `/setup` to update profile

## 4. Dispatcher integration — gate until onboarded

Update `[src/handlers/dispatcher.ts](src/handlers/dispatcher.ts)` **after** `getOrCreateUser`, **before** commands/photo/coach:

```ts
if (!user.onboarded) {
  await handleOnboarding(env, db, channel, msg, user);
  return;
}
```

Behavior while onboarding:

- Text → validate current step or advance
- Callback `onboard:*` → advance via buttons
- Photo → reply: "finish setup first — …" (don't run vision; saves API cost)
- Slash commands except `/setup` and `/help` → short redirect to complete onboarding

`isFollow` / `/start` → `startOnboarding()` (step `unit`).

## 5. DB layer updates

Extend `[src/db/users.ts](src/db/users.ts)`:

- Expand `UserRow` with new profile fields
- `updateOnboardingStep(db, userId, step, partial?)` 
- `completeOnboarding(db, userId, profile + targets)` — single transaction-style sequence of `dbRun` calls
- `getProfileSummary(user)` helper for display strings
- `getDailyProgress(db, user)` → `{ totals, targets, remaining }` shared by `/progress` and tools

## 6. Wire goals into agent + commands


| Surface                                                                | Change                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `[src/services/context.ts](src/services/context.ts)`                   | Add profile block: gender, age, weight, goal, TDEE, targets, **remaining kcal/macros today** |
| `[src/handlers/commands.ts](src/handlers/commands.ts)`                 | `/progress` → `today: 1,200 / 1,850 kcal (650 left), P80/148g C…`                            |
| `[src/agents/tools/get-progress.ts](src/agents/tools/get-progress.ts)` | Return targets + remaining, not just totals                                                  |
| `[src/agents/coach.ts](src/agents/coach.ts)`                           | System prompt: "User has a calorie target; coach relative to remaining budget"               |
| `[src/handlers/photo.ts](src/handlers/photo.ts)`                       | Optional: after estimate prompt, append `(~X kcal — Y left today)` if onboarded              |


## 7. Tests


| File                                                      | Coverage                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `[tests/tdee.test.ts](tests/tdee.test.ts)`                | BMR/TDEE/macro math, gender floors, activity multipliers                          |
| `[tests/units.test.ts](tests/units.test.ts)`              | kg/lbs and cm/ft-in parsing edge cases                                            |
| `[tests/onboarding.test.ts](tests/onboarding.test.ts)`    | Step transitions, invalid age/weight, callback parsing, completion writes targets |
| Update `[tests/users.test.ts](tests/users.test.ts)`       | New insert defaults (`onboarded=0`, `onboarding_step='unit'`)                     |
| Update `[tests/d1.test.ts](tests/d1.test.ts)` or add mock | `/progress` with targets                                                          |


## 8. Deploy checklist

1. Apply migration: `npx wrangler d1 migrations apply arnold --remote`
2. Existing users have `onboarded=0` → will hit onboarding on next message (acceptable; mention in release note)
3. Optional follow-up (out of scope): one-time broadcast "run /setup to get your calorie target"

## Out of scope (later grill items)

- Web dashboard / charts
- Reminders and nudges (DB columns exist, no scheduler yet)
- Voice onboarding
- FatSecret / database fallback for accuracy
- Paid tier / photo limits

## Key design decisions (locked)

- **6th onboarding step**: activity level (user confirmed)
- **Units**: metric + imperial with canonical kg/cm storage (user confirmed)
- **Onboarding UX**: structured steps with buttons where possible, free text for age/weight/height (not LLM-driven — predictable, cheap, works offline from OpenRouter)
- **Gate**: no photo logging or coach chat until `onboarded=1`

