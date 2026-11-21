# Model Armor template (T08)

Model Armor is Google Cloud's safety screen for AI. Expelly sends it two kinds of untrusted text
before any AI reads them (web pages Discover fetches, inbound replies) and the AI text people will
read or send (drafts, campaign builder, review explanations). See `docs/GOOGLE-STACK.md`.

**Nothing here has been run.** Creating the template is a Google Cloud change: a person does it
(or says "go" to the assistant), once.

## What the template does

| Filter | Setting |
|---|---|
| Prompt injection and jailbreak | on, ENFORCE, medium confidence and above |
| Sensitive data protection (basic: card numbers, SSNs, passwords, API keys) | on, ENFORCE |
| Malicious URLs | on |
| Responsible AI (hate, harassment, sexually explicit, dangerous) | on, medium and above |

The app maps a hit to a verdict: prompt injection, malicious URL or a RAI hit = `blocked`; sensitive
data alone = `flagged` (kept, but a person looks at it). Full config: `template.json`.

## Region

Use **`us-central1`**. Mumbai (`asia-south1`) has *limited* Model Armor support (no malicious-URL
filter), and `us-central1` is also where Vertex AI / Agent Engine run. Model Armor only sees text, not
the database, so app data stays in `asia-south1`. The template location cannot be changed later.

## Cost (checked 2026-11-21; confirm on the pricing page before relying on it)

Model Armor standalone: **free up to 2 million tokens a month, then $0.10 per extra million tokens**.
Roughly 4 characters = 1 token. A Discover run screens up to 16,000 characters (about 4,000 tokens)
per company, so 1,000 companies is about 4 million tokens, about $0.20. Replies are tiny. At beta
volume the bill is cents. Pricing: <https://cloud.google.com/security/products/model-armor>

## Create it (run only after Aman says go)

1. Enable the API (free to enable):
   ```
   gcloud services enable modelarmor.googleapis.com --project=<PROJECT_ID>
   ```
2. Point gcloud at the regional endpoint (Model Armor templates are regional):
   ```
   gcloud config set api_endpoint_overrides/modelarmor "https://modelarmor.us-central1.rep.googleapis.com/"
   ```
3. Create the template (creates one free-standing config object, no running resources, no cost by itself):
   ```
   gcloud model-armor templates create expelly-safety \
     --project=<PROJECT_ID> --location=us-central1 \
     --pi-and-jailbreak-filter-settings-enforcement=enabled \
     --pi-and-jailbreak-filter-settings-confidence-level=medium-and-above \
     --basic-config-filter-enforcement=enabled \
     --malicious-uri-filter-settings-enforcement=enabled \
     --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"HARASSMENT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"DANGEROUS","confidenceLevel":"MEDIUM_AND_ABOVE"}]'
   ```
   If a flag name differs in your gcloud version, run `gcloud model-armor templates create --help`;
   the settings are exactly the ones in `template.json`.
4. Let the Cloud Run service account call it (role `roles/modelarmor.user`):
   ```
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:<CLOUD_RUN_SERVICE_ACCOUNT>" --role="roles/modelarmor.user"
   ```
5. Turn it on in the API's environment:
   ```
   SAFETY_DRIVER=modelarmor
   MODEL_ARMOR_TEMPLATE=expelly-safety
   MODEL_ARMOR_LOCATION=us-central1
   GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
   SAFETY_FAIL_MODE=open
   ```
   Locally, `gcloud auth application-default login` supplies the credentials.

## Proving it works

With the variables above, run a Discover search against a page that contains
"ignore previous instructions and ..." and look for the log line:

```
{"severity":"WARNING","event":"safety_screen","direction":"input","context":"web_page","verdict":"blocked","findings":["pi_and_jailbreak"],"provider":"modelarmor"}
```

The prospect then shows "1 page skipped by safety check".

## Turning it off / rolling back

Set `SAFETY_DRIVER=off` (or remove it) and restart. Delete the template with
`gcloud model-armor templates delete expelly-safety --location=us-central1 --project=<PROJECT_ID>`.
