"""The deploy script is a dry run by default: it prints the plan and never reaches Google."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy" / "deploy_agent_engine.py"


@pytest.fixture
def deploy():
    spec = importlib.util.spec_from_file_location("deploy_agent_engine", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["deploy_agent_engine"] = mod  # dataclasses look the module up by name
    spec.loader.exec_module(mod)
    return mod


def test_dry_run_prints_the_plan_and_creates_nothing(deploy, capsys, monkeypatch):
    monkeypatch.setattr(deploy, "_create_remote", lambda plan: pytest.fail("touched the cloud"))
    assert deploy.main(["--agent", "review_analyst"]) == 0
    out = capsys.readouterr().out
    plan = json.loads(out[: out.index("\nEstimated")])
    assert plan["region"] == "us-central1"
    assert plan["min_instances"] == 0
    assert plan["service_account"].startswith("expelly-agents@")
    assert plan["env_vars"]["GOOGLE_GENAI_USE_VERTEXAI"] == "true"
    # Agent Engine reserves these: the script must not set them
    assert "GOOGLE_CLOUD_PROJECT" not in plan["env_vars"]
    assert "DRY RUN" in out


def test_apply_refuses_placeholder_project(deploy, monkeypatch):
    monkeypatch.setattr(deploy, "_create_remote", lambda plan: pytest.fail("touched the cloud"))
    assert deploy.main(["--agent", "copywriter", "--apply"]) == 2


def test_cost_estimate_states_the_order_of_magnitude(deploy):
    import argparse

    args = argparse.Namespace(
        agent="copywriter", project="p", region="us-central1", staging_bucket="gs://b",
        service_account="", min_instances=1, max_instances=2, cpu="1", memory="1Gi", model="",
    )
    cost = deploy.monthly_cost_estimate(deploy.build_plan(args))
    assert "always-on" in cost and "$6" in cost  # about $68 a month


def test_both_agents_expose_an_executor_builder():
    from expelly_agents.copywriter.agent import build_executor as c
    from expelly_agents.review_analyst.agent import build_executor as r

    assert callable(c) and callable(r)
    assert r() is not None  # builds ADK's A2A executor without any network call
