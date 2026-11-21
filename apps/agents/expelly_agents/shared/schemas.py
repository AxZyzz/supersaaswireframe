"""Pydantic mirrors of the JSON Schemas in packages/shared/src/agents/*.schema.json.

The JSON Schema files are the source of truth (the NestJS API validates against them too).
tests/test_contracts.py checks that these models accept and reject the same fixture files
as the schemas do, so the two cannot drift apart silently.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# <repo>/apps/agents/expelly_agents/shared/schemas.py -> <repo>/packages/shared/src/agents
SCHEMA_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "shared" / "src" / "agents"
)

FINDING_ID = r"^F[0-9]+$"
FindingId = Annotated[str, StringConstraints(pattern=FINDING_ID)]
NextStep = Literal["keep_testing", "review_challenger", "apply_to_next_search", "none"]


def load_schema(name: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── Review analyst ──────────────────────────────────────────────────────
class Gate(_Strict):
    id: str
    passed: bool
    reason: str


class Finding(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(pattern=FINDING_ID)
    kind: Literal["rate", "lift", "gate", "guardrail", "sample_plan", "diagnostic"]


class Arm(_Strict):
    variantId: str
    label: str
    isControl: bool
    assigned: int = Field(ge=0)
    qualifiedVerified: int = Field(ge=0)
    qualifiedRate: float | None


class AllowedAction(_Strict):
    type: Literal["keep_testing", "pause_variant", "draft_challenger", "test_next_batch"]
    label: str | None = None


class ReviewAnalystInput(_Strict):
    reviewId: str = Field(min_length=1)
    revision: int = Field(ge=1)
    simulated: bool
    decision: Literal["keep_collecting", "guardrail_breach", "promote", "inconclusive"]
    minLiftPp: float
    gates: list[Gate]
    findings: list[Finding] = Field(min_length=1)
    arms: list[Arm] = Field(min_length=1)
    allowedActions: list[AllowedAction]
    slices: list[dict[str, Any]] | None = None


class Point(_Strict):
    text: str = Field(min_length=1, max_length=500)
    findingIds: list[FindingId] = Field(min_length=1)


class ReviewAnalystOutput(_Strict):
    summary: str = Field(min_length=1, max_length=700)
    points: list[Point] = Field(min_length=1, max_length=5)
    caveats: list[str] = Field(max_length=5)
    suggestedNextStep: NextStep


# ── Copywriter ──────────────────────────────────────────────────────────
class Offer(_Strict):
    name: str
    description: str | None = None


class SubjectRef(_Strict):
    subject: str = Field(min_length=1)


class Constraints(_Strict):
    maxChars: int = Field(ge=10, le=200)
    keepMergeTokens: bool
    language: str


class CopywriterInput(_Strict):
    offer: Offer
    kb: str
    control: SubjectRef
    currentWinner: SubjectRef | None = None
    losingSubjects: list[str]
    constraints: Constraints
    playbooks: list[str]


class Candidate(_Strict):
    subject: str = Field(min_length=1, max_length=200)
    rationale: str = Field(max_length=300)


class CopywriterOutput(_Strict):
    candidates: list[Candidate] = Field(min_length=3, max_length=3)


# ── Model-facing output schemas ─────────────────────────────────────────
# Gemini's structured-output schema rejects `additionalProperties` and string `pattern`s, which
# the strict models above produce. These lenient twins are what ADK sends to the model as
# `response_schema`; the answer is still checked against the strict JSON Schemas (API validator,
# tests/test_contracts.py), so a model that wanders off the contract is caught there.
class ModelPoint(BaseModel):
    text: str = Field(description="One plain sentence, at most 40 words.")
    findingIds: list[str] = Field(
        min_length=1, description="Ids like F1 of the findings this sentence relies on."
    )


class ModelReviewAnalystOutput(BaseModel):
    summary: str = Field(description="At most 80 words.")
    points: list[ModelPoint] = Field(min_length=1, max_length=5)
    caveats: list[str] = Field(max_length=5)
    suggestedNextStep: NextStep


class ModelCandidate(BaseModel):
    subject: str
    rationale: str = Field(description="One short sentence.")


class ModelCopywriterOutput(BaseModel):
    candidates: list[ModelCandidate] = Field(min_length=3, max_length=3)
