"""The JSON Schemas in packages/shared are the contract; the pydantic models must agree with them.
The NestJS side runs the SAME fixture files through the SAME schemas (agents/contracts.spec.ts)."""
from __future__ import annotations

import jsonschema
import pytest
from pydantic import ValidationError

from expelly_agents.shared.schemas import (
    CopywriterInput,
    CopywriterOutput,
    DiscoverInput,
    DiscoverOutput,
    ReviewAnalystInput,
    ReviewAnalystOutput,
    load_schema,
)

from .conftest import fixture

CASES = [
    ("review-analyst.input", ReviewAnalystInput, "review-analyst-input.valid", True),
    ("review-analyst.output", ReviewAnalystOutput, "review-analyst-output.valid", True),
    # schema-valid on purpose: the API validator (not the schema) catches these
    ("review-analyst.output", ReviewAnalystOutput, "review-analyst-output.hallucinated-number", True),
    ("review-analyst.output", ReviewAnalystOutput, "review-analyst-output.premature-winner", True),
    ("review-analyst.output", ReviewAnalystOutput, "review-analyst-output.unknown-finding", True),
    ("copywriter.input", CopywriterInput, "copywriter-input.valid", True),
    ("copywriter.output", CopywriterOutput, "copywriter-output.valid", True),
    ("discover.input", DiscoverInput, "discover-input.valid", True),
    ("discover.input", DiscoverInput, "discover-input.targeted", True),
    ("discover.output", DiscoverOutput, "discover-output.valid", True),
    # schema-valid on purpose: the API re-checks quotes and decides matchedPreference itself
    ("discover.output", DiscoverOutput, "discover-output.unverified-trigger", True),
    ("discover.output", DiscoverOutput, "discover-output.claims-match", True),
]


@pytest.mark.parametrize("schema,model,name,ok", CASES)
def test_schema_and_pydantic_accept_the_same_fixtures(schema, model, name, ok):
    data = fixture(name)
    jsonschema.validate(data, load_schema(schema))
    model.model_validate(data)


def test_both_reject_two_candidates():
    bad = fixture("copywriter-output.valid")
    bad["candidates"] = bad["candidates"][:2]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, load_schema("copywriter.output"))
    with pytest.raises(ValidationError):
        CopywriterOutput.model_validate(bad)


def test_both_reject_a_bad_finding_id_and_extra_fields():
    bad = fixture("review-analyst-output.valid")
    bad["points"][0]["findingIds"] = ["finding-1"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, load_schema("review-analyst.output"))
    with pytest.raises(ValidationError):
        ReviewAnalystOutput.model_validate(bad)

    extra = fixture("review-analyst-output.valid")
    extra["confidence"] = 0.99
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(extra, load_schema("review-analyst.output"))
    with pytest.raises(ValidationError):
        ReviewAnalystOutput.model_validate(extra)


def test_both_reject_an_evidence_package_with_lead_fields():
    """The analyst input has no place for lead names or emails."""
    bad = fixture("review-analyst-input.valid")
    bad["leadEmail"] = "someone@example.com"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, load_schema("review-analyst.input"))
    with pytest.raises(ValidationError):
        ReviewAnalystInput.model_validate(bad)


def test_model_facing_schemas_are_gemini_safe_and_agree_with_the_contract():
    """Gemini rejects additionalProperties / pattern in response_schema; the strict contract
    still accepts everything the lenient models produce."""
    import json

    from expelly_agents.shared.schemas import (
        ModelCopywriterOutput,
        ModelReviewAnalystOutput,
    )

    for model, fixture_name, schema in [
        (ModelReviewAnalystOutput, "review-analyst-output.valid", "review-analyst.output"),
        (ModelCopywriterOutput, "copywriter-output.valid", "copywriter.output"),
    ]:
        text = json.dumps(model.model_json_schema())
        assert "additionalProperties" not in text
        assert '"pattern"' not in text
        out = model.model_validate(fixture(fixture_name))
        jsonschema.validate(out.model_dump(), load_schema(schema))


def test_both_reject_oversized_and_malformed_discover_requests():
    big = fixture("discover-input.valid")
    big["targetCount"] = 51
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(big, load_schema("discover.input"))
    with pytest.raises(ValidationError):
        DiscoverInput.model_validate(big)

    lead = fixture("discover-input.valid")
    lead["leadEmail"] = "someone@example.com"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(lead, load_schema("discover.input"))
    with pytest.raises(ValidationError):
        DiscoverInput.model_validate(lead)

    bad = fixture("discover-input.targeted")
    bad["preference"]["filter"]["factor"] = "favourite_colour"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, load_schema("discover.input"))
    with pytest.raises(ValidationError):
        DiscoverInput.model_validate(bad)


def test_both_reject_a_bad_trigger_type_and_extra_fields_in_a_discover_answer():
    bad = fixture("discover-output.unverified-trigger")
    bad["candidates"][0]["triggers"][0]["type"] = "vibes"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, load_schema("discover.output"))
    with pytest.raises(ValidationError):
        DiscoverOutput.model_validate(bad)

    extra = fixture("discover-output.valid")
    extra["confidence"] = 0.9
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(extra, load_schema("discover.output"))
    with pytest.raises(ValidationError):
        DiscoverOutput.model_validate(extra)
