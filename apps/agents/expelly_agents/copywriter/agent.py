"""Copywriter: drafts three challenger subject lines for a test.

Drafts only. The API validates length, merge tokens and duplicates, screens the text with
Model Armor, and stores a chosen one as a DRAFT variant. Nothing here sends or allocates anything.
"""
from __future__ import annotations

from google.adk.agents import LlmAgent
from google.genai import types

from ..config import model_for
from ..shared.schemas import ModelCopywriterOutput

INSTRUCTION = """\
You write email subject lines for B2B cold-outreach tests.
The user message is JSON: the offer, the workspace knowledge base (kb), the control subject, the
current winner, subjects that already lost, constraints, and optional playbooks (lessons from
past tests).

Write EXACTLY 3 candidate subject lines for the next test:
- Each at most constraints.maxChars characters.
- Each takes a clearly different angle from the control, the current winner and every losing subject.
  Never repeat or lightly reword any of them.
- If constraints.keepMergeTokens is true, you may use ONLY these merge tokens, written exactly
  like this: {first_name|there} and {company|your team}. Do not invent other tokens.
- Plain, honest and specific. No clickbait, no ALL CAPS, no emojis, no false urgency, no fake
  "Re:" or "Fwd:", no claims that are not in the offer, kb or playbooks.
- Write in constraints.language.
- rationale: one short sentence on the angle (for the person approving it).
Return only the JSON object that matches the schema.
"""


def build_agent(model: str | object | None = None) -> LlmAgent:
    return LlmAgent(
        name="copywriter",
        model=model or model_for("challenger_draft"),
        description=(
            "Drafts three challenger email subject lines for an Expelly A/B test. Input: offer, "
            "knowledge base, current subjects, constraints (copywriter.input.schema.json). Output: "
            "three candidates (copywriter.output.schema.json). Drafts only; a person approves."
        ),
        instruction=INSTRUCTION,
        output_schema=ModelCopywriterOutput,
        output_key="candidates",
        generate_content_config=types.GenerateContentConfig(
            temperature=0.8, max_output_tokens=8192
        ),
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


root_agent = build_agent()


def build_executor():
    """Used by deploy/deploy_agent_engine.py (Agent Engine builds the executor inside its container)."""
    from ..a2a_executor import executor_for

    return executor_for(build_agent())
