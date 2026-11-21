"""The A2A executor Agent Engine needs: ADK's own executor around a Runner for our agent."""
from __future__ import annotations

from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.agents import BaseAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

from .runner import APP_NAME


def executor_for(agent: BaseAgent) -> A2aAgentExecutor:
    runner = Runner(
        agent=agent, app_name=APP_NAME, session_service=InMemorySessionService()
    )
    return A2aAgentExecutor(runner=runner)
