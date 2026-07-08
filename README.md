# Telegram-First AI Fitness Coach (LangGraph MVP)

A friend-like AI fitness coach you text on **Telegram**. It discovers your goals
through conversation, logs meals from **text or food photos** (macro estimation
via a vision model), tracks workouts and body metrics, remembers context
long-term, and **proactively checks in** ("did you eat breakfast?", "hit the
gym today?"). It can generate and send **PDF reports**.

The messaging layer is abstracted so **iMessage** (via a relay) or **WhatsApp**
can be added later without touching the agent, scheduler, or tools.

> Telegram is the dev channel because its Bot API is free and — crucially —
> allows unrestricted proactive outbound messages (the hard part of this
> product). See the plan for the iMessage/WhatsApp roadmap.

## Architecture

```
Telegram ──webhook──▶ FastAPI ──▶ Channel adapter ──▶ Orchestrator
                                                        │
                     ┌──────────────────────────────────┤
                     ▼                                    ▼
             LangGraph coach agent                 Vision (food photo → macros)
             (tools + memory)                             │
                     │                                    ▼
                     ▼                              Postgres (users, meals,
     Checkpointer + long-term Store  ◀── same DB ──▶ workouts, metrics, msgs)
                     ▲
        APScheduler proactive nudges (breakfast/lunch/dinner/gym/re-engage)
```

- **Agent**: `create_react_agent` (LangGraph) with a coach persona, logging
  tools, and langmem long-term memory. One thread per user.
- **Identity/auth**: the Telegram `user_id` is the identity (implicit signup on
  first message). Trust is established by verifying the webhook **secret token**.
- **Images**: never stored as bytes — we keep the Telegram `file_id` +
  `file_unique_id` + metadata and re-fetch on demand.
- **Graceful degradation**: with no `OPENAI_API_KEY`, the app still boots,
  greets users, runs slash-commands, and serves reports (AI replies disabled).

## Project layout

```
app/
  main.py            FastAPI app: webhook, lifecycle, health/admin
  config.py          Settings (pydantic-settings)
  orchestrator.py    Inbound flow: identify → vision → agent → reply
  channels/          MessagingChannel interface + Telegram adapter
  agent/             LangGraph agent, tools, prompts, memory, context
  vision/            Food photo/description → MacroEstimate
  services/          users, logging, progress aggregation
  scheduler/         APScheduler proactive nudges
  reports/           PDF report generation (matplotlib + reportlab)
  db/                SQLAlchemy engine + ORM models
  schemas/           Pydantic models (LLM/validation boundary)
alembic/             Migrations
scripts/set_webhook.py
```

## Quick start (Docker)

1. Create your env file and fill it in:

```bash
cp .env.example .env
# set TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_WEBHOOK_SECRET,
# and optionally OPENAI_API_KEY
```

2. Start Postgres + the app:

```bash
docker-compose up --build
```

3. Expose your local server so Telegram can reach it (dev), e.g. with ngrok:

```bash
ngrok http 8000
# set PUBLIC_BASE_URL in .env to the https URL, then:
python -m scripts.set_webhook
```

4. Text your bot on Telegram. Try: "I want to lose 5kg", send a food photo, or
   `/progress`, `/report`, `/week`, `/pause`, `/resume`, `/help`.

## Quick start (local, no Docker)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Bring up Postgres however you like, then set DATABASE_URL* in .env
alembic upgrade head            # required before starting the app
uvicorn app.main:app --reload
```

Health check: `GET http://localhost:8000/healthz`.

## Configuration

See `.env.example`. Key settings:

| Var | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Verifies inbound webhooks are from Telegram |
| `PUBLIC_BASE_URL` | Public HTTPS base URL for the webhook |
| `DATABASE_URL` / `DATABASE_URL_SYNC` | Async (app) / sync (Alembic, memory), both using the `psycopg` v3 driver |
| `OPENAI_API_KEY` | Enables the coach agent + photo macros |
| `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` | Verified macro lookup after GPT identifies foods |
| `NUDGE_POLL_MINUTES` / `NUDGE_MIN_GAP_HOURS` | Proactive nudge cadence |

## Notes & roadmap

- **Accuracy**: GPT-4o identifies foods from photos/text; when FatSecret
  credentials are set, macros are looked up in the verified US food database.
  The agent asks a clarifying question when confidence is low.
- **Privacy**: health-data consent is captured during onboarding
  (`users.consent_health_data`); users can `/pause` proactive messages.
- **Next**: durable image storage (Cloudflare R2/S3) for a web dashboard,
  streaks/milestones, retention (at-risk) detection, referral loop, and
  iMessage/WhatsApp channel adapters.
```
