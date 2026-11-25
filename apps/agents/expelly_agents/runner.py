"""Run an ADK agent once, in-process, and return its final JSON text. Used by tests, the deploy
smoke test and local experiments."""
from __future__ import annotations

import uuid

from google.adk.agents import BaseAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

APP_NAME = "expelly_agents"


async def run_once(agent: BaseAgent, user_text: str) -> str:
    sessions = InMemorySessionService()
    user_id, session_id = "api", str(uuid.uuid4())
    await sessions.create_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    runner = Runner(agent=agent, app_name=APP_NAME, session_service=sessions)
    message = types.Content(role="user", parts=[types.Part(text=user_text)])
    final = ""
    async for event in runner.run_async(
        user_id=user_id, session_id=session_id, new_message=message
    ):
        if event.is_final_response() and event.content and event.content.parts:
            final = "".join(p.text or "" for p in event.content.parts)
    return final
