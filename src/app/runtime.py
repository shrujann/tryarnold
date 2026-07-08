"""Runtime helpers for server vs Cloudflare Worker execution."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_worker_env_var: ContextVar[Any | None] = ContextVar("worker_env", default=None)


@contextmanager
def bind_worker_env(env: Any):
    """Bind the current Cloudflare Worker env for this request."""
    token = _worker_env_var.set(env)
    try:
        yield
    finally:
        _worker_env_var.reset(token)


def current_worker_env() -> Any | None:
    return _worker_env_var.get()
