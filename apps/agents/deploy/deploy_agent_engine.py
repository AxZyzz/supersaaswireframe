"""Deploy an Expelly agent to Vertex AI Agent Engine (Google now calls it "Agent Platform").

    python deploy/deploy_agent_engine.py --agent review_analyst            # DRY RUN: prints the plan
    python deploy/deploy_agent_engine.py --agent review_analyst --apply    # really deploys

Default is a dry run: it imports nothing from Google Cloud and creates nothing. `--apply` is the
only thing that touches the cloud, and Aman approves that step first (cost, region, service
account: see deploy/README.md). Run it from apps/agents with the `deploy` extra installed:

    pip install -e ".[deploy]"

NOTE FOR WHOEVER RUNS IT FIRST: the Agent Engine deploy API is in preview and renamed recently.
This script follows Google's A2A-on-Agent-Engine guide (`A2aAgent` + `agent_engines.create`). If
`--apply` fails with an attribute or argument error, check the current page, "Deploy an agent" in
the Agent Platform docs, and adjust `_create_remote` only; everything else is plain config.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass

AGENTS = {
    "review_analyst": {
        "module": "expelly_agents.review_analyst.agent",
        "display_name": "expelly-review-analyst",
        "description": "Explains an Expelly campaign review in plain English (aggregates only).",
        "model_env": "GEMINI_MODEL_BALANCED",
    },
    "copywriter": {
        "module": "expelly_agents.copywriter.agent",
        "display_name": "expelly-copywriter",
        "description": "Drafts three challenger email subject lines (drafts only).",
        "model_env": "GEMINI_MODEL_POWERFUL",
    },
    "discover": {
        "module": "expelly_agents.discover.agent",
        "display_name": "expelly-discover",
        "description": "Finds and checks companies for a Discover search; reads the web only through the Expelly API.",
        "model_env": "GEMINI_MODEL_BALANCED",
    },
}

# Pinned like pyproject.toml: Agent Engine installs exactly these in the agent's container.
REQUIREMENTS = [
    "google-cloud-aiplatform[agent_engines,adk]>=1.112.0",
    "google-adk[a2a]==2.15.0",
    "a2a-sdk==1.3.1",
    "pydantic>=2.9,<3",
]


@dataclass
class DeployPlan:
    agent: str
    project: str
    region: str
    display_name: str
    description: str
    service_account: str
    staging_bucket: str
    min_instances: int
    max_instances: int
    cpu: str
    memory: str
    env_vars: dict[str, str]
    requirements: list[str]


def build_plan(args: argparse.Namespace) -> DeployPlan:
    spec = AGENTS[args.agent]
    env = {
        # Cloud Trace: one trace shows API -> agent -> Gemini
        "ENABLE_CLOUD_TRACE": "true",
        # Gemini through Vertex AI, authenticated by the agent's service account (no API key)
        "GOOGLE_GENAI_USE_VERTEXAI": "true",
    }
    if args.model:
        env[spec["model_env"]] = args.model
    # Agent Engine reserves GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION; do not set them here.
    return DeployPlan(
        agent=args.agent,
        project=args.project,
        region=args.region,
        display_name=spec["display_name"],
        description=spec["description"],
        service_account=args.service_account
        or f"expelly-agents@{args.project}.iam.gserviceaccount.com",
        staging_bucket=args.staging_bucket,
        min_instances=args.min_instances,
        max_instances=args.max_instances,
        cpu=args.cpu,
        memory=args.memory,
        env_vars=env,
        requirements=REQUIREMENTS,
    )


def monthly_cost_estimate(plan: DeployPlan) -> str:
    """List price at the time of writing: ~$0.085 per vCPU-hour, ~$0.009 per GiB-hour. Confirm on
    Google's pricing page; this is only here so the dry run states the order of magnitude."""
    if plan.min_instances == 0:
        return "near $0 while idle (scales to zero); the first call after a pause is slower"
    mem_gib = float(plan.memory.lower().replace("gi", ""))
    per_hour = plan.min_instances * (float(plan.cpu) * 0.085 + mem_gib * 0.009)
    return f"about ${per_hour * 730:.0f} a month for {plan.min_instances} always-on instance(s)"


def _create_remote(plan: DeployPlan):  # pragma: no cover - needs Google Cloud
    import importlib

    import vertexai  # type: ignore[import-not-found]
    from a2a.types import AgentCapabilities, AgentCard, AgentSkill  # type: ignore[import-not-found]
    from vertexai.preview.reasoning_engines import A2aAgent  # type: ignore[import-not-found]

    module = importlib.import_module(AGENTS[plan.agent]["module"])
    card = AgentCard(
        name=plan.display_name,
        description=plan.description,
        version="0.1.0",
        capabilities=AgentCapabilities(streaming=False),
        default_input_modes=["text/plain"],
        default_output_modes=["application/json"],
        skills=[
            AgentSkill(
                id=plan.agent,
                name=plan.display_name,
                description=plan.description,
                tags=["expelly"],
            )
        ],
    )
    client = vertexai.Client(project=plan.project, location=plan.region)
    return client.agent_engines.create(
        agent=A2aAgent(agent_card=card, agent_executor_builder=module.build_executor),
        config={
            "display_name": plan.display_name,
            "description": plan.description,
            "requirements": plan.requirements,
            "extra_packages": ["expelly_agents"],
            "staging_bucket": plan.staging_bucket,
            "service_account": plan.service_account,
            "env_vars": plan.env_vars,
            "min_instances": plan.min_instances,
            "max_instances": plan.max_instances,
            "resource_limits": {"cpu": plan.cpu, "memory": plan.memory},
        },
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--agent", choices=sorted(AGENTS), required=True)
    p.add_argument("--project", default="YOUR_PROJECT_ID")
    p.add_argument("--region", default="us-central1", help="Agent Engine region (us-central1 is the safe one)")
    p.add_argument("--staging-bucket", default="gs://YOUR_PROJECT_ID-agent-staging")
    p.add_argument("--service-account", default="")
    p.add_argument("--min-instances", type=int, default=0, help="0 = scale to zero (cheapest)")
    p.add_argument("--max-instances", type=int, default=2)
    p.add_argument("--cpu", default="1")
    p.add_argument("--memory", default="1Gi")
    p.add_argument("--model", default="", help="override the Gemini model for this agent")
    p.add_argument("--apply", action="store_true", help="really deploy (default: dry run)")
    args = p.parse_args(argv)

    plan = build_plan(args)
    print(json.dumps(asdict(plan), indent=2))
    print(f"\nEstimated running cost: {monthly_cost_estimate(plan)}")
    if not args.apply:
        print("\nDRY RUN: nothing was created. Add --apply to deploy (after Aman's go).")
        return 0
    if "YOUR_PROJECT_ID" in plan.project or "YOUR_PROJECT_ID" in plan.staging_bucket:
        print("Refusing to deploy: set --project and --staging-bucket first.", file=sys.stderr)
        return 2
    remote = _create_remote(plan)
    print(f"\nDeployed: {remote}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
