"""Manually (re)register or delete the Telegram webhook.

Usage:
    python -m scripts.set_webhook          # set to PUBLIC_BASE_URL + path
    python -m scripts.set_webhook --delete # remove webhook
    python -m scripts.set_webhook --info   # show current webhook info
"""
from __future__ import annotations

import argparse
import asyncio

from app.channels.telegram import TelegramChannel
from app.config import settings


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delete", action="store_true")
    parser.add_argument("--info", action="store_true")
    args = parser.parse_args()

    channel = TelegramChannel()
    if not channel.enabled:
        raise SystemExit("TELEGRAM_BOT_TOKEN is not set")

    await channel.initialize()
    try:
        if args.info:
            info = await channel.bot.get_webhook_info()
            print(info)
        elif args.delete:
            ok = await channel.delete_webhook()
            print(f"Deleted webhook: {ok}")
        else:
            ok = await channel.set_webhook()
            print(f"Set webhook to {settings.webhook_url}: {ok}")
    finally:
        await channel.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
