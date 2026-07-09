# Cloudflare Workers + D1 fitness coach

Telegram and LINE food-photo coach on **Cloudflare Workers** with **D1** for
durable data. TypeScript + LangGraph agents via OpenRouter.

## What it does

- Telegram webhook (text + food photos + inline keyboard portion buttons)
- LINE Messaging API webhook (text + images + Flex postback buttons)
- Vision + coach chat via OpenRouter (LangGraph ReAct agent)
- D1 persistence for users, meals, pending photos, message log

## Setup

1. Install dependencies:

```bash
npm install
```

2. Ensure `wrangler.toml` has your D1 `database_id` and `PUBLIC_BASE_URL`.

3. Copy env template for local dev:

```bash
cp .env.example .dev.vars
# fill in secrets in .dev.vars (never commit this file)
```

4. Apply migrations:

```bash
npx wrangler d1 migrations apply arnold --local   # local dev
npx wrangler d1 migrations apply arnold --remote  # production
```

5. Set production secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ADMIN_SECRET
```

6. Deploy:

```bash
npm run deploy
```

7. Register webhooks (requires `ADMIN_SECRET` header):

```bash
curl -X POST https://<your-worker-url>/admin/set-webhook \
  -H "X-Admin-Secret: <ADMIN_SECRET>"

curl -X POST https://<your-worker-url>/admin/set-line-webhook \
  -H "X-Admin-Secret: <ADMIN_SECRET>"
```

Health: `GET /healthz` — check `telegram_enabled` and `line_enabled`.

## LINE Developers Console

1. Create a provider and **Messaging API channel** at
   [LINE Developers Console](https://developers.line.biz/console/).
2. Issue **Channel secret** and a long-lived **Channel access token**.
3. Enable **Use webhook** and set the URL to
   `{PUBLIC_BASE_URL}/line/webhook` (or call `/admin/set-line-webhook` after deploy).
4. Disable auto-reply and greeting messages in the console (avoids double replies).
5. Add the bot as a friend on your LINE account to test.

## Local dev

```bash
npm run dev
```

For Telegram/LINE webhooks locally, expose the dev server with a tunnel
(`wrangler dev --remote` or ngrok) and point webhooks at the tunnel URL.

## Tests

```bash
npm test
npm run typecheck
```

## Layout

```
src/index.ts           Worker entry (webhooks + admin routes)
src/channels/          Telegram + LINE adapters
src/handlers/          Dispatcher, commands, photo, confirmation
src/agents/            LangGraph coach + vision
src/db/                D1 queries
migrations/            D1 SQL migrations
wrangler.toml          Worker + D1 binding
```

## Config

| Var | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token (secret) |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook header (secret) |
| `LINE_CHANNEL_SECRET` | LINE webhook HMAC secret (secret) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token (secret) |
| `OPENROUTER_API_KEY` | Chat + vision (secret) |
| `PUBLIC_BASE_URL` | HTTPS base for webhook URLs |
| `ADMIN_SECRET` | Protects `/admin/*` routes (secret) |
| `OPENROUTER_MODEL` / `OPENROUTER_VISION_MODEL` | Defaults `openai/gpt-4o` |
