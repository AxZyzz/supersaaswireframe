"""LOCAL DEMO ONLY: the REAL Discover coordinator with a scripted model, served over A2A on :8103.

No Gemini and no key. The planner, finder and verifier answers are fixed (two example sites); everything
else is the real code path: the agent calls the API's `fetch_company_pages` tool endpoint, checks the
quotes against the pages it got back, and answers with the typed `discover.output` JSON.

Run the API with DISCOVER_DRIVER=agent, DISCOVER_AGENT_URL=http://localhost:8103, NODE_ENV=development
and AGENT_TOOLS_DEV_SECRET=<secret>, then start this with:

    DISCOVER_TOOLS_URL=http://localhost:4000 DISCOVER_TOOLS_AUTH=none DISCOVER_TOOLS_DEV_SECRET=<secret> \
      python scripts/serve_discover_demo.py
"""
from __future__ import annotations

import json
import os
from typing import AsyncGenerator

import uvicorn
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from expelly_agents.discover.agent import build_agent

QUOTE = "This domain is for use in documentation examples without needing permission"


class Scripted(BaseLlm):
    model: str = "scripted-demo"
    reply: str = "{}"
    is_verifier: bool = False

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        if not self.is_verifier:
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=self.reply)]))
            return
        domain = ""
        for c in llm_request.contents:
            for p in c.parts or []:
                if p.text and '"company"' in p.text:
                    domain = json.loads(p.text)["company"]["domain"]
        called = any(p.function_response for c in llm_request.contents for p in (c.parts or []))
        if not called:
            call = types.FunctionCall(name="fetch_company_pages", args={"domain": domain})
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(function_call=call)]))
            return
        answer = {
            "isRealBusinessSite": True,
            "companyName": f"{domain} (demo)",
            "summary": "A documentation example site, used here to show the agent path.",
            "industry": "unknown",
            "facts": [{"fact": "Documentation example domain", "quote": QUOTE, "url": f"https://{domain}/"}],
            "scores": {"icp": 12, "opportunity": 8, "timing": 0, "commercial": 5},
        }
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=json.dumps(answer))]))


plan = {
    "icp": {"summary": "Demo: documentation example sites", "industries": ["demo"], "regions": [], "buyerRoles": []},
    "searchIdeas": [],
    "candidateCount": 3,
}
found = {
    "candidates": [
        {"name": "Example Domain", "domain": "example.com", "why": "demo"},
        {"name": "Example Org", "domain": "example.org", "why": "demo"},
    ]
}

agent = build_agent(
    planner_model=Scripted(reply=json.dumps(plan)),
    finder_model=Scripted(reply=json.dumps(found)),
    verifier_model=Scripted(is_verifier=True),
)
PORT = int(os.environ.get("DISCOVER_PORT", "8103"))
app = to_a2a(agent, host="localhost", port=PORT, protocol="http")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
