"""Runtime helpers for Cloudflare Worker execution."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_worker_env_var: ContextVar[Any | None] = ContextVar("worker_env", default=None)
# ContextVar alone is unreliable across waitUntil in Python Workers.
_worker_env_global: Any | None = None


@contextmanager
def bind_worker_env(env: Any):
    """Bind the current Cloudflare Worker env for this request / background task."""
    global _worker_env_global
    token = _worker_env_var.set(env)
    previous = _worker_env_global
    _worker_env_global = env
    try:
        yield
    finally:
        _worker_env_var.reset(token)
        _worker_env_global = previous


def current_worker_env() -> Any | None:
    return _worker_env_var.get() or _worker_env_global
