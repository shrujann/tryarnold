# Cloudflare Workers + D1 Telegram fitness coach

Telegram food-photo coach that runs entirely on **Cloudflare Workers** with
**D1** for durable data. No Docker / Postgres / LangMem stack.

## What it does

- Telegram webhook (text + food photos + portion confirmation buttons)
- GPT vision for meal macros (GPT-only; FatSecret not used on Workers Free)
- D1 persistence for users, meals, pending photos, message log
- Coach chat rehydrates context from recent D1 rows (not LangGraph memory)

## What it deliberately drops

- Docker / docker-compose / Postgres / Alembic
- LangChain / LangGraph / LangMem
- SQLAlchemy
- FatSecret client (Workers Free has no stable egress IP)
- APScheduler nudges and PDF reports

## Setup

1. Install Node + uv, then in this repo:

```bash
uv sync
```

2. Ensure `wrangler.toml` has your D1 `database_id`.

3. Apply migrations:

```bash
uv run pywrangler d1 migrations apply arnold --remote
```

4. Set secrets:

```bash
uv run pywrangler secret put TELEGRAM_BOT_TOKEN
uv run pywrangler secret put TELEGRAM_WEBHOOK_SECRET
uv run pywrangler secret put OPENAI_API_KEY
```

5. Put your public HTTPS base in `wrangler.toml` `[vars]`:

```toml
PUBLIC_BASE_URL = "https://tryarnold.<subdomain>.workers.dev"
```

6. Deploy:

```bash
uv run pywrangler deploy
```

7. Register webhook:

```bash
curl -X POST https://<your-worker-url>/admin/set-webhook
```

Health: `GET /healthz`

## Layout

```
src/entry.py          Workers entrypoint (raw fetch router)
src/app/worker_app.py D1 + OpenAI + Telegram business logic
src/app/channels/     Telegram httpx adapter
migrations/           D1 SQL migrations
wrangler.toml         Worker + D1 binding
pyproject.toml        Slim Workers dependencies (~2 MB gzip)
```

## Config

| Var | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token (secret) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook header verification (secret) |
| `OPENAI_API_KEY` | Chat + vision (secret) |
| `PUBLIC_BASE_URL` | HTTPS base for webhook registration |
| `OPENAI_MODEL` / `OPENAI_VISION_MODEL` | Defaults `gpt-4o` |

## Size note

Cloudflare Free Worker limit is **3 MB gzip**. Keep dependencies in
`pyproject.toml` minimal. Re-check with:

```bash
uv run pywrangler sync
python3 scripts/measure_worker_bundle.py
```
