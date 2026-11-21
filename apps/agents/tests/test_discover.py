"""The Discover multi-agent runs end to end with a mocked model and a fake page fetcher: the planner
and finder answer from fixtures, the verifier really calls the fetch tool, and the assembler keeps only
what the served pages back up. No network, no real model."""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

import jsonschema

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from expelly_agents.config import model_for
from expelly_agents.discover.agent import (
    build_agent,
    claims_match,
    company_key,
    parse_json,
    quote_on_pages,
    word_on_pages,
)
from expelly_agents.runner import run_once
from expelly_agents.shared.schemas import (
    DiscoverInput,
    DiscoverOutput,
    VerifierOutput,
    load_schema,
)

from .conftest import FakeLlm, fixture

SUNRISE_TEXT = (
    "Sunrise Clinic. Our clinic is open six days a week in Pune. We are opening a second branch "
    "in Baner this spring. Contact: hello@sunrise-clinic.example"
)


class ToolCallingLlm(BaseLlm):
    """A verifier model: first asks for the page tool, then answers from `replies[domain]`."""

    model: str = "fake-verifier"
    replies: dict[str, str] = {}

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        domain = _domain_of(llm_request)
        answered = any(
            p.function_response for c in llm_request.contents for p in (c.parts or [])
        )
        if not answered:
            yield LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part(
                            function_call=types.FunctionCall(
                                name="fetch_company_pages", args={"domain": domain}
                            )
                        )
                    ],
                )
            )
            return
        yield LlmResponse(
            content=types.Content(
                role="model", parts=[types.Part(text=self.replies.get(domain, "{}"))]
            )
        )


def _domain_of(req: LlmRequest) -> str:
    for c in req.contents:
        for p in c.parts or []:
            if p.text and '"company"' in p.text:
                return json.loads(p.text)["company"]["domain"]
    return ""


def verifier_reply(domain: str, **over: Any) -> str:
    base: dict[str, Any] = {
        "isRealBusinessSite": True,
        "companyName": domain,
        "summary": "A family clinic.",
        "industry": "healthcare_clinic",
        "city": "Pune",
        "country": "India",
        "sizeBand": "11-50",
        "facts": [
            {
                "fact": "Open six days a week",
                "quote": "Our clinic is open six days a week in Pune",
                "url": f"https://{domain}/",
            }
        ],
        "triggers": [
            {
                "type": "expansion",
                "quote": "We are opening a second branch in Baner",
                "url": f"https://{domain}/",
            }
        ],
        "emails": [{"email": "hello@sunrise-clinic.example", "url": f"https://{domain}/"}],
        "scores": {"icp": 22, "opportunity": 16, "timing": 10, "commercial": 9},
    }
    base.update(over)
    return json.dumps(base)


def pages_for(domain: str, text: str = SUNRISE_TEXT) -> dict[str, Any]:
    return {"ok": True, "pages": [{"url": f"https://{domain}/", "text": text}]}


def make(
    found: list[tuple[str, str]],
    replies: dict[str, str],
    pages: dict[str, dict[str, Any]],
    fake_llm,
    concurrency: int = 4,
    peak: dict[str, int] | None = None,
):
    plan = {"icp": {"summary": "independent clinics", "industries": ["healthcare"]}, "candidateCount": 20}
    finder = {"candidates": [{"name": n, "domain": d, "why": "fits"} for n, d in found]}
    state = {"now": 0}

    async def fetcher(org_id: str, run_id: str, domain: str) -> dict[str, Any]:
        state["now"] += 1
        if peak is not None:
            peak["max"] = max(peak.get("max", 0), state["now"])
        await asyncio.sleep(0.02)
        state["now"] -= 1
        return pages.get(domain, {"ok": False, "reason": "unreachable", "pages": []})

    return build_agent(
        planner_model=fake_llm(plan),
        finder_model=fake_llm(finder),
        verifier_model=ToolCallingLlm(replies=replies),
        fetcher=fetcher,
        concurrency=concurrency,
    )


async def run(agent, request: dict[str, Any]) -> dict[str, Any]:
    return json.loads(await run_once(agent, json.dumps(request)))


async def test_a_search_returns_a_schema_valid_answer_with_only_what_the_pages_back_up(fake_llm):
    req = fixture("discover-input.valid")
    found = [
        ("Sunrise", "sunrise.example"),
        ("Invented", "invented.example"),
        ("Parked", "parked.example"),
        ("Offline", "offline.example"),
    ]
    replies = {
        "sunrise.example": verifier_reply("sunrise.example"),
        # a trigger quote that is NOT on the page, and a city the page does not mention
        "invented.example": verifier_reply(
            "invented.example",
            city="Chennai",
            triggers=[
                {"type": "funding", "quote": "We just raised a huge Series B round", "url": "https://invented.example/"}
            ],
        ),
        "parked.example": json.dumps({"isRealBusinessSite": False}),
        "offline.example": verifier_reply("offline.example"),
    }
    pages = {
        "sunrise.example": pages_for("sunrise.example"),
        "invented.example": pages_for("invented.example"),
        "parked.example": pages_for("parked.example", "This domain is for sale. " * 5),
        # offline.example: the fetcher answers "unreachable"
    }
    out = await run(make(found, replies, pages, fake_llm), req)
    jsonschema.validate(out, load_schema("discover.output"))
    DiscoverOutput.model_validate(out)

    by = {c["domain"]: c for c in out["candidates"]}
    assert set(by) == {"sunrise.example", "invented.example"}  # parked + offline dropped
    sunrise = by["sunrise.example"]
    assert sunrise["attributes"]["city"] == "Pune"
    assert [t["type"] for t in sunrise["triggers"]] == ["expansion"]
    assert sunrise["emailsSeen"][0]["email"] == "hello@sunrise-clinic.example"
    assert sunrise["evidence"][0]["quote"] == "Our clinic is open six days a week in Pune"
    # the invented trigger is dropped, and so is a city the page never mentions
    invented = by["invented.example"]
    assert invented["triggers"] == []
    assert "city" not in invented["attributes"]
    assert out["stats"] == {
        "proposed": 4,
        "fetched": 3,
        "verified": 2,
        "droppedUnverified": 2,
        "droppedSafety": 0,
    }


async def test_at_most_four_companies_are_checked_at_a_time(fake_llm):
    domains = [f"c{i}.example" for i in range(9)]
    found = [(d, d) for d in domains]
    replies = {d: verifier_reply(d) for d in domains}
    pages = {d: pages_for(d) for d in domains}
    peak: dict[str, int] = {}
    req = fixture("discover-input.valid")
    req["targetCount"] = 9
    out = await run(make(found, replies, pages, fake_llm, peak=peak), req)
    assert len(out["candidates"]) == 9
    assert 1 < peak["max"] <= 4


async def test_known_companies_are_never_fetched_and_the_answer_is_capped(fake_llm):
    req = fixture("discover-input.valid")
    req["targetCount"] = 2
    req["excludeCompanyKeys"] = ["www.known.example"]
    found = [("Known", "known.example")] + [(f"N{i}", f"n{i}.example") for i in range(5)]
    fetched: list[str] = []
    agent = make(
        found,
        {f"n{i}.example": verifier_reply(f"n{i}.example") for i in range(5)},
        {f"n{i}.example": pages_for(f"n{i}.example") for i in range(5)},
        fake_llm,
    )
    inner = agent.fetcher

    async def spy(o: str, r: str, d: str) -> dict[str, Any]:
        fetched.append(d)
        return await inner(o, r, d)

    agent.fetcher = spy
    out = await run(agent, req)
    assert "known.example" not in fetched
    assert len(out["candidates"]) == 2  # capped at targetCount


async def test_a_targeted_search_echoes_the_preference_and_the_match_is_only_a_claim(fake_llm):
    req = fixture("discover-input.targeted")
    found = [("Sunrise", "sunrise.example"), ("Mumbai", "mumbai.example")]
    replies = {
        "sunrise.example": verifier_reply("sunrise.example"),
        "mumbai.example": verifier_reply(
            "mumbai.example",
            city="Mumbai",
            facts=[
                {
                    "fact": "Open six days a week",
                    "quote": "Our clinic is open six days a week in Mumbai",
                    "url": "https://mumbai.example/",
                }
            ],
        ),
    }
    mumbai_text = SUNRISE_TEXT.replace("Pune", "Mumbai")
    pages = {
        "sunrise.example": pages_for("sunrise.example"),
        "mumbai.example": pages_for("mumbai.example", mumbai_text),
    }
    out = await run(make(found, replies, pages, fake_llm), req)
    assert out["mode"] == "targeted"
    assert out["stats"]["preferenceId"] == "pref-1"
    assert out["stats"]["preferenceRevision"] == 1
    claims = {c["domain"]: c["matchedPreference"] for c in out["candidates"]}
    assert claims == {"sunrise.example": True, "mumbai.example": False}


async def test_a_safety_block_and_an_unreachable_site_are_counted_separately(fake_llm):
    req = fixture("discover-input.valid")
    agent = make(
        [("Blocked", "blocked.example"), ("Down", "down.example")],
        {"blocked.example": verifier_reply("blocked.example"), "down.example": verifier_reply("down.example")},
        {
            "blocked.example": {"ok": False, "reason": "safety_blocked", "pages": []},
            "down.example": {"ok": False, "reason": "unreachable", "pages": []},
        },
        fake_llm,
    )
    out = await run(agent, req)
    assert out["candidates"] == []
    assert out["stats"]["droppedSafety"] == 1
    assert out["stats"]["droppedUnverified"] == 1


async def test_a_bad_request_gets_an_error_not_a_crash(fake_llm):
    agent = make([], {}, {}, fake_llm)
    out = json.loads(await run_once(agent, json.dumps({"goal": "no run id"})))
    assert "error" in out


async def test_planner_and_finder_see_no_email_and_the_exclusions(fake_llm):
    planner, finder = fake_llm({"icp": {"summary": "x"}}), fake_llm({"candidates": []})
    agent = build_agent(
        planner_model=planner,
        finder_model=finder,
        verifier_model=ToolCallingLlm(),
        fetcher=None,
    )
    req = fixture("discover-input.valid")
    await run(agent, req)
    sent = json.dumps(
        [c.model_dump(mode="json") for r in planner.seen + finder.seen for c in r.contents],
        default=str,
    )
    assert "@" not in sent
    assert "already-known.example" in sent  # the finder is told what to skip
    assert "Use ONLY" not in sent


def test_the_agent_tool_binds_the_run_so_the_model_only_passes_a_domain():
    from expelly_agents.discover.tools import make_fetch_tool

    calls: list[tuple[str, str, str]] = []

    async def fetcher(org: str, run_: str, domain: str) -> dict[str, Any]:
        calls.append((org, run_, domain))
        return {"ok": True, "pages": []}

    tool = make_fetch_tool("org-9", "run-9", fetcher)
    asyncio.run(tool("acme.example"))
    assert calls == [("org-9", "run-9", "acme.example")]
    assert tool.__name__ == "fetch_company_pages"
    assert list(tool.__annotations__) == ["domain", "return"]  # no org or run id for the model to change


def test_models_follow_the_task_catalogue(monkeypatch):
    for var in (
        "DISCOVER_PLANNER_MODEL",
        "DISCOVER_VERIFIER_MODEL",
        "GEMINI_MODEL_BALANCED",
        "GEMINI_MODEL_FAST",
    ):
        monkeypatch.delenv(var, raising=False)
    assert model_for("discover_plan") == model_for("discover_verify_extract")
    monkeypatch.setenv("GEMINI_MODEL_FAST", "fast-model")
    monkeypatch.setenv("GEMINI_MODEL_BALANCED", "balanced-model")
    assert model_for("discover_plan") == "balanced-model"
    assert model_for("discover_verify_extract") == "fast-model"
    monkeypatch.setenv("DISCOVER_VERIFIER_MODEL", "mine")
    assert model_for("discover_verify_extract") == "mine"


def test_helpers():
    assert company_key(" WWW.Acme.COM ") == "acme.com"
    pages = [{"url": "https://a/", "text": "Our  clinic is OPEN six days"}]
    assert quote_on_pages("our clinic is open six days", pages) == "https://a/"
    assert quote_on_pages("too short", pages) is None  # under 12 characters proves nothing
    assert quote_on_pages("a quote that is not on the page at all", pages) is None
    assert word_on_pages("clinic", pages) == "clinic"
    assert word_on_pages("clin", pages) is None  # whole words only
    assert parse_json("```json\n{\"isRealBusinessSite\": true}\n```", VerifierOutput) is not None
    assert parse_json("not json", VerifierOutput) is None
    req = DiscoverInput.model_validate(fixture("discover-input.targeted"))
    assert claims_match(req, {"city": "pune"}, []) is True
    assert claims_match(req, {"city": "Mumbai"}, []) is False
