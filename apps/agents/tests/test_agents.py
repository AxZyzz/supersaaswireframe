"""The agents run end to end with a mocked model: the evidence goes in as JSON, the model's JSON
comes out, and the output matches the shared schema. No network."""
from __future__ import annotations

import json

import jsonschema

from expelly_agents.config import model_for
from expelly_agents.copywriter.agent import build_agent as build_copywriter
from expelly_agents.review_analyst.agent import INSTRUCTION, build_agent as build_analyst
from expelly_agents.runner import run_once
from expelly_agents.shared.schemas import (
    CopywriterOutput,
    ReviewAnalystOutput,
    load_schema,
)

from .conftest import fixture


async def test_review_analyst_returns_schema_valid_json(fake_llm):
    llm = fake_llm(fixture("review-analyst-output.valid"))
    agent = build_analyst(model=llm)
    text = await run_once(agent, json.dumps(fixture("review-analyst-input.valid")))
    out = json.loads(text)
    jsonschema.validate(out, load_schema("review-analyst.output"))
    assert ReviewAnalystOutput.model_validate(out).suggestedNextStep == "keep_testing"


async def test_review_analyst_sees_the_evidence_and_the_rules(fake_llm):
    llm = fake_llm(fixture("review-analyst-output.valid"))
    evidence = fixture("review-analyst-input.valid")
    await run_once(build_analyst(model=llm), json.dumps(evidence))
    req = llm.seen[0]
    sent = json.dumps(
        [c.model_dump(mode="json") for c in req.contents], default=str
    )
    # the findings go in; the instruction carries the no-invention rules
    assert "F3" in sent and "0.0174" in sent
    assert "Use ONLY numbers that appear in the findings" in str(
        req.config.system_instruction
    )
    assert "winner" in INSTRUCTION and "promote" in INSTRUCTION


async def test_copywriter_returns_exactly_three_candidates(fake_llm):
    llm = fake_llm(fixture("copywriter-output.valid"))
    text = await run_once(
        build_copywriter(model=llm), json.dumps(fixture("copywriter-input.valid"))
    )
    out = json.loads(text)
    jsonschema.validate(out, load_schema("copywriter.output"))
    assert len(CopywriterOutput.model_validate(out).candidates) == 3


async def test_copywriter_is_given_no_lead_data(fake_llm):
    llm = fake_llm(fixture("copywriter-output.valid"))
    payload = fixture("copywriter-input.valid")
    await run_once(build_copywriter(model=llm), json.dumps(payload))
    sent = json.dumps(
        [c.model_dump(mode="json") for c in llm.seen[0].contents], default=str
    )
    assert "@" not in sent  # no email address in what the model sees


def test_models_follow_the_task_catalogue(monkeypatch):
    for var in (
        "REVIEW_ANALYST_MODEL",
        "COPYWRITER_MODEL",
        "GEMINI_MODEL_BALANCED",
        "GEMINI_MODEL_POWERFUL",
    ):
        monkeypatch.delenv(var, raising=False)
    assert model_for("review_explain") == "gemini-3.5-flash-lite"
    monkeypatch.setenv("GEMINI_MODEL_BALANCED", "bal-x")
    monkeypatch.setenv("GEMINI_MODEL_POWERFUL", "pow-x")
    assert model_for("review_explain") == "bal-x"  # review_explain = balanced
    assert model_for("challenger_draft") == "pow-x"  # challenger_draft = powerful
    monkeypatch.setenv("COPYWRITER_MODEL", "  ")  # blank = default, not an empty name
    assert model_for("challenger_draft") == "pow-x"
    monkeypatch.setenv("REVIEW_ANALYST_MODEL", "override")
    assert model_for("review_explain") == "override"
