"""Cloud Trace: ADK emits OpenTelemetry spans for every agent run and model call. With
ENABLE_CLOUD_TRACE=true they go to Cloud Trace, so one trace shows API -> agent -> Gemini
(the API sends the W3C `traceparent` header on its A2A call)."""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def setup_tracing() -> bool:
    if os.environ.get("ENABLE_CLOUD_TRACE", "").lower() != "true":
        return False
    try:
        from google.adk.telemetry.google_cloud import get_gcp_exporters
        from google.adk.telemetry.setup import maybe_set_otel_providers

        maybe_set_otel_providers([get_gcp_exporters(enable_cloud_tracing=True)])
        return True
    except Exception as exc:  # tracing must never stop the agent
        log.warning("Cloud Trace not enabled: %s", exc)
        return False
