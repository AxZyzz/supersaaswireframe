"""Test helpers. No test here calls a real model or the network."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from expelly_agents.shared.schemas import SCHEMA_DIR

FIXTURES = SCHEMA_DIR / "fixtures"


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


class FakeLlm(BaseLlm):
    """A model that returns a fixed answer and remembers what it was asked."""

    model: str = "fake-model"
    reply: str = "{}"
    seen: list[LlmRequest] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.seen.append(llm_request)
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=self.reply)])
        )


@pytest.fixture
def fake_llm():
    def make(reply: dict[str, Any] | str) -> FakeLlm:
        text = reply if isinstance(reply, str) else json.dumps(reply)
        return FakeLlm(reply=text, seen=[])

    return make
