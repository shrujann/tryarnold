"""LangGraph coach agent: a ReAct agent with logging tools + long-term memory.

One thread per user (``thread_id = user-<id>``) gives short-term conversational
memory via the checkpointer; langmem tools + the store give durable memory.
"""
from __future__ import annotations

from contextvars import ContextVar

from app.agent.memory import build_memory_tools, memory_manager
from app.agent.prompts import build_system_prompt
from app.agent.tools import all_tools
from app.config import settings
from app.logging_config import get_logger

log = get_logger(__name__)

# Per-request dynamic context injected into the system prompt.
_user_context_var: ContextVar[str] = ContextVar("user_context", default="")

_agent = None
_build_attempted = False


def _prompt(state):
    from langchain_core.messages import SystemMessage

    ctx = _user_context_var.get()
    return [SystemMessage(content=build_system_prompt(ctx))] + state["messages"]


def build_agent():
    """Construct the agent once. Returns None if AI is disabled/unavailable."""
    global _agent, _build_attempted
    if _agent is not None or _build_attempted:
        return _agent
    _build_attempted = True

    if not settings.ai_enabled:
        log.warning("OPENAI_API_KEY not set; coach agent disabled (fallback mode)")
        return None

    try:
        from langchain_openai import ChatOpenAI
        from langgraph.prebuilt import create_react_agent

        model = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0.4,
        )
        tools = all_tools() + build_memory_tools()
        _agent = create_react_agent(
            model,
            tools,
            prompt=_prompt,
            checkpointer=memory_manager.checkpointer,
            store=memory_manager.store,
        )
        log.info("Coach agent built with %d tools", len(tools))
    except Exception:
        log.exception("Failed to build coach agent; running in fallback mode")
        _agent = None
    return _agent


async def run_agent(user_id: int, user_context: str, user_message: str) -> str | None:
    """Run one turn. Returns the assistant text, or None if AI unavailable."""
    agent = build_agent()
    if agent is None:
        return None

    from langchain_core.messages import HumanMessage

    token = _user_context_var.set(user_context)
    try:
        config = {
            "configurable": {
                "user_id": str(user_id),
                "thread_id": f"user-{user_id}",
            }
        }
        result = await agent.ainvoke(
            {"messages": [HumanMessage(content=user_message)]}, config=config
        )
        messages = result.get("messages", [])
        if not messages:
            return None
        last = messages[-1]
        content = getattr(last, "content", None)
        if isinstance(content, list):  # some providers return content parts
            content = " ".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        return content or None
    except Exception:
        log.exception("Agent run failed")
        return None
    finally:
        _user_context_var.reset(token)
