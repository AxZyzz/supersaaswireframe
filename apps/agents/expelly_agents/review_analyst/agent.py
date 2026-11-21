"""Review analyst: turns the API's evidence package into a short, plain explanation.

The agent only EXPLAINS. The decision (promote / inconclusive / ...) was already made by code in
the API. Every claim must cite a finding id; the API then verifies each id and number and falls
back to a template if anything does not check out (apps/api/src/agents/explanation-validator.ts).
"""
from __future__ import annotations

from google.adk.agents import LlmAgent
from google.genai import types

from ..config import model_for
from ..shared.schemas import ModelReviewAnalystOutput

INSTRUCTION = """\
You explain the result of an email A/B test to a busy person who is not a statistician.
The user message is a JSON "evidence package": the decision (already made by code), gates,
findings (each has an id like F1) and the allowed actions. You may only explain it.

Hard rules:
1. Use ONLY numbers that appear in the findings. Never invent, estimate, round differently or
   combine numbers. Rates in findings are fractions: write them as percentages (0.025 becomes
   2.5%, never "0.025"). A lift is a fraction too: 0.017 becomes +1.7 points; say "points".
2. Every point must list the finding ids it relies on in findingIds, and those ids must exist.
3. Plain English. Short sentences. No jargon (no "confidence interval", "p-value", "Wilson",
   "events"). Say "confirmed qualified replies from 5 of 118 companies", not "5 events".
4. Never use the words "winner", "proved", "significant" or "clearly better" unless the decision
   is "promote". When the decision is "inconclusive" say we cannot call a winner yet.
5. summary: at most 80 words. points: at most 5. caveats: only real limits, at most 3.
6. suggestedNextStep must be allowed: "keep_testing" if keep_testing is in allowedActions,
   "review_challenger" if draft_challenger is, "apply_to_next_search" if test_next_batch is,
   otherwise "none".
7. Never mention people or company names. The package has none; do not guess any.
8. If simulated is true, say once that this is a practice run on simulated data.
Return only the JSON object that matches the schema.
"""


def build_agent(model: str | object | None = None) -> LlmAgent:
    return LlmAgent(
        name="review_analyst",
        model=model or model_for("review_explain"),
        description=(
            "Explains an Expelly campaign review in plain English. Input: evidence package "
            "(review-analyst.input.schema.json). Output: summary and cited points "
            "(review-analyst.output.schema.json). Aggregates only; never sees lead data."
        ),
        instruction=INSTRUCTION,
        output_schema=ModelReviewAnalystOutput,
        output_key="explanation",
        # thinking models spend output tokens before answering: leave headroom
        generate_content_config=types.GenerateContentConfig(
            temperature=0.2, max_output_tokens=8192
        ),
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


# `adk web expelly_agents` discovers agents through this name.
root_agent = build_agent()


def build_executor():
    """Used by deploy/deploy_agent_engine.py (Agent Engine builds the executor inside its container)."""
    from ..a2a_executor import executor_for

    return executor_for(build_agent())
