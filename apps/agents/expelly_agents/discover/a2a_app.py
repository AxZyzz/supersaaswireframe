"""Discover over A2A.

Local: uvicorn expelly_agents.discover.a2a_app:app --port 8103
Agent Card: http://localhost:8103/.well-known/agent-card.json
"""
from __future__ import annotations

import os

from google.adk.a2a.utils.agent_to_a2a import to_a2a

from ..observability import setup_tracing
from .agent import build_agent

setup_tracing()
HOST = os.environ.get("A2A_HOST", "localhost")
PORT = int(os.environ.get("DISCOVER_PORT", "8103"))
PROTOCOL = os.environ.get("A2A_PROTOCOL", "http")
app = to_a2a(build_agent(), host=HOST, port=PORT, protocol=PROTOCOL)
