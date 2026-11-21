"""Model choice per task, following the API's task catalogue (apps/api/src/ai/router/tasks.ts):
review_explain -> balanced tier, challenger_draft -> powerful tier. Same env vars as the API."""
from __future__ import annotations

import os

DEFAULT_MODEL = "gemini-3.5-flash-lite"

_TIER_ENV = {
    "review_explain": ("REVIEW_ANALYST_MODEL", "GEMINI_MODEL_BALANCED"),
    "challenger_draft": ("COPYWRITER_MODEL", "GEMINI_MODEL_POWERFUL"),
}


def model_for(task: str) -> str:
    """A blank env value means "use the default", same as unset."""
    for var in _TIER_ENV[task]:
        value = os.environ.get(var, "").strip()
        if value:
            return value
    return DEFAULT_MODEL
