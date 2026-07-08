"""Short-term (checkpointer) + long-term (store) memory wiring.

Prefers Postgres-backed persistence so conversation state and durable profile
memories survive restarts. Falls back to in-memory implementations if the
Postgres extras are unavailable or the DB is unreachable — the app still runs.
"""
from __future__ import annotations

from sqlalchemy.engine import make_url

from app.config import settings
from app.logging_config import get_logger

log = get_logger(__name__)


def _pool_conninfo(url: str) -> str:
    """Convert a SQLAlchemy Postgres URL to a libpq/psycopg URI.

    psycopg_pool expects a plain PostgreSQL conninfo/URI and doesn't understand
    SQLAlchemy driver suffixes like ``postgresql+psycopg://``.
    """
    parsed = make_url(url)
    if parsed.drivername.startswith("postgresql+"):
        parsed = parsed.set(drivername="postgresql")
    return parsed.render_as_string(hide_password=False)


class MemoryManager:
    def __init__(self) -> None:
        self.checkpointer = None
        self.store = None
        self._pool = None
        self._backend = "memory"

    @property
    def backend(self) -> str:
        return self._backend

    async def setup(self) -> None:
        if await self._try_postgres():
            self._backend = "postgres"
            log.info("Memory backend: Postgres (checkpointer + store)")
            return
        self._setup_memory()
        self._backend = "memory"
        log.info("Memory backend: in-memory (non-persistent)")

    async def _try_postgres(self) -> bool:
        try:
            from psycopg_pool import AsyncConnectionPool
            from psycopg.rows import dict_row
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from langgraph.store.postgres.aio import AsyncPostgresStore
        except Exception:
            log.warning("Postgres memory extras not installed; using in-memory")
            return False

        try:
            self._pool = AsyncConnectionPool(
                conninfo=_pool_conninfo(settings.database_url_sync),
                max_size=10,
                open=False,
                kwargs={"autocommit": True, "row_factory": dict_row},
            )
            await self._pool.open(wait=True, timeout=10)

            self.checkpointer = AsyncPostgresSaver(self._pool)
            await self.checkpointer.setup()

            self.store = AsyncPostgresStore(self._pool)
            await self.store.setup()
            return True
        except Exception:
            log.exception("Postgres memory init failed; falling back to in-memory")
            if self._pool is not None:
                try:
                    await self._pool.close()
                except Exception:
                    pass
                self._pool = None
            return False

    def _setup_memory(self) -> None:
        from langgraph.checkpoint.memory import MemorySaver
        from langgraph.store.memory import InMemoryStore

        self.checkpointer = MemorySaver()
        self.store = InMemoryStore()

    async def teardown(self) -> None:
        if self._pool is not None:
            try:
                await self._pool.close()
            except Exception:
                pass


def build_memory_tools():
    """langmem hot-path tools, namespaced per user. Empty list if unavailable."""
    try:
        from langmem import create_manage_memory_tool, create_search_memory_tool
    except Exception:
        log.info("langmem not available; long-term memory tools disabled")
        return []

    namespace = ("memories", "{user_id}")
    try:
        return [
            create_manage_memory_tool(namespace=namespace),
            create_search_memory_tool(namespace=namespace),
        ]
    except Exception:
        log.exception("Failed to build langmem tools")
        return []


memory_manager = MemoryManager()
