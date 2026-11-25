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


# ── Discover (T10) ──────────────────────────────────────────────────────
DiscoverMode = Literal["baseline", "targeted"]
DiscoverFactor = Literal["city", "industry", "trigger", "size_band", "country", "region"]
TriggerType = Literal["hiring", "expansion", "funding", "product_launch"]


class DOffer(_Strict):
    id: str = Field(min_length=1)
    name: str
    description: str | None = None


class DSeller(_Strict):
    description: str | None = None
    offer: str | None = None
    audience: str | None = None
    painPoints: str | None = None


class DFilter(_Strict):
    factor: DiscoverFactor
    value: str = Field(min_length=1)


class DPreference(_Strict):
    id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    filter: DFilter


class DPlaybook(_Strict):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=500)
    validTo: str = Field(min_length=1)


class DiscoverInput(_Strict):
    runId: str = Field(min_length=1)
    orgId: str = Field(min_length=1)
    offer: DOffer
    seller: DSeller | None = None
    goal: str = Field(min_length=3, max_length=2000)
    icp: dict[str, Any] | None = None
    targetCount: int = Field(ge=1, le=50)
    mode: DiscoverMode
    preference: DPreference | None = None
    excludeCompanyKeys: list[str] = Field(max_length=2000)
    playbooks: list[DPlaybook] = Field(default_factory=list, max_length=5)


class DEvidence(_Strict):
    fact: str | None = None
    quote: str
    url: str


class DAttributes(_Strict):
    city: str | None = None
    region: str | None = None
    country: str | None = None
    location: str | None = None
    industry: str | None = None
    size_band: str | None = None


class DTrigger(_Strict):
    type: TriggerType
    quote: str
    url: str


class DEmailSeen(_Strict):
    email: str
    url: str


class DOpportunity(_Strict):
    hypothesis: str | None = None
    service: str | None = None
    discoveryQuestion: str | None = None


class DScores(_Strict):
    icp: int
    opportunity: int
    timing: int
    commercial: int


class DiscoverCandidate(_Strict):
    name: str = Field(min_length=1)
    domain: str = Field(min_length=3)
    companyKey: str
    isRealBusinessSite: bool | None = None
    summary: str | None = None
    evidence: list[DEvidence]
    attributes: DAttributes
    triggers: list[DTrigger]
    emailsSeen: list[DEmailSeen]
    opportunity: DOpportunity | None = None
    unknowns: list[str] | None = None
    scores: DScores | None = None
    matchedPreference: bool


class DiscoverStats(_Strict):
    proposed: int = Field(ge=0)
    fetched: int = Field(ge=0)
    verified: int = Field(ge=0)
    droppedUnverified: int = Field(ge=0)
    droppedSafety: int = Field(ge=0)
    preferenceId: str | None = None
    preferenceRevision: int | None = Field(default=None, ge=1)


class DiscoverOutput(_Strict):
    runId: str = Field(min_length=1)
    mode: DiscoverMode
    candidates: list[DiscoverCandidate] = Field(max_length=100)
    stats: DiscoverStats


# What each LLM step of the Discover agent returns (internal to the agent, not part of the A2A contract).
class PlanIcp(BaseModel):
    model_config = ConfigDict(extra="ignore")
    summary: str = ""
    industries: list[str] = []
    regions: list[str] = []
    buyerRoles: list[str] = []


class PlannerOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    icp: PlanIcp
    searchIdeas: list[str] = []
    candidateCount: int = 0


class FoundCompany(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    domain: str
    why: str = ""


class FinderOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    candidates: list[FoundCompany] = []


class VerifiedFact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    fact: str = ""
    quote: str
    url: str


class VerifierOutput(BaseModel):
    """One company, read from its own pages. Every quote must be copied exactly from a page."""

    model_config = ConfigDict(extra="ignore")
    isRealBusinessSite: bool = False
    companyName: str = ""
    summary: str = ""
    industry: str | None = None
    city: str | None = None
    region: str | None = None
    country: str | None = None
    location: str | None = None
    sizeBand: str | None = None
    triggers: list[DTrigger] = []
    facts: list[VerifiedFact] = []
    emails: list[DEmailSeen] = []
    opportunity: DOpportunity | None = None
    unknowns: list[str] = []
    scores: DScores | None = None
