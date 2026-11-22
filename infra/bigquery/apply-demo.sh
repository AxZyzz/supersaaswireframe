#!/usr/bin/env bash
# Learning Loop T16: create the demo dataset and its views for the Looker Studio dashboard.
#
#   PROJECT=supersaas-513613 DEMO_ORG_ID=<the demo workspace id> infra/bigquery/apply-demo.sh
#
# What it does, in order:
#   1. creates the dataset expelly_demo (asia-south1) if it does not exist       free
#   2. creates or replaces the demo_* views, each filtered to DEMO_ORG_ID         free, scans nothing
#   3. lets expelly_demo's views read expelly_learning (authorized dataset)        free
# Safe to run again. A view whose source view does not exist yet (review_history and
# search_policy_compare wait for the first review / search preference) is skipped, not an error.
#
# DEMO_ORG_ID is not stored in git: pass it on the command line. It must be a workspace id (a UUID).
set -euo pipefail

cd "$(dirname "$0")"

# Git Bash on Windows: bq cannot find a Python on its own. Point it at the one bundled with the Cloud SDK.
if [ -z "${CLOUDSDK_PYTHON:-}" ] && command -v bq >/dev/null 2>&1; then
  bundled="$(dirname "$(command -v bq)")/../platform/bundledpython/python.exe"
  [ -f "$bundled" ] && export CLOUDSDK_PYTHON="$bundled"
fi

PROJECT="${PROJECT:?set PROJECT, e.g. PROJECT=supersaas-513613}"
DEMO_ORG_ID="${DEMO_ORG_ID:?set DEMO_ORG_ID to the demo workspace id}"
LEARN="${LEARN:-expelly_learning}"
DEMO="${DEMO:-expelly_demo}"
LOCATION="${LOCATION:-asia-south1}"

# Only a UUID goes into the SQL text: nothing else can sneak in.
if ! [[ "$DEMO_ORG_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "DEMO_ORG_ID must be a workspace id like 3f2b8c1e-0a4d-4c8e-9b1a-5d6e7f8a9b0c" >&2
  exit 2
fi

echo "== dataset ${PROJECT}:${DEMO}"
if bq show --project_id="$PROJECT" "${PROJECT}:${DEMO}" >/dev/null 2>&1; then
  echo "   exists"
else
  bq mk --dataset --location="$LOCATION" --project_id="$PROJECT" \
    --description "Demo workspace only: views for the Looker Studio learning dashboard (Learning Loop T16)" \
    "${PROJECT}:${DEMO}"
fi

count=0
skipped=()
for f in demo/*.sql; do
  echo "== $f"
  # The SQL goes in through stdin: passing multi-line SQL as an argument breaks on Windows (bq.cmd).
  if out=$(sed -e "s|\${PROJECT}|${PROJECT}|g" -e "s|\${LEARN}|${LEARN}|g" -e "s|\${DEMO}|${DEMO}|g" -e "s|\${DEMO_ORG_ID}|${DEMO_ORG_ID}|g" "$f" \
      | bq query --use_legacy_sql=false --project_id="$PROJECT" --location="$LOCATION" --quiet 2>&1); then
    count=$((count + 1))
  elif echo "$out" | grep -q "Not found: Table"; then
    echo "   skipped: its source view is not in ${LEARN} yet (it appears after the first review / search preference); run again later"
    skipped+=("$f")
  else
    echo "$out" >&2
    exit 1
  fi
done

echo "== let ${DEMO} read ${LEARN} (authorized dataset)"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
bq show --format=prettyjson --project_id="$PROJECT" "${PROJECT}:${LEARN}" | node demo/authorize.js "$PROJECT" "$DEMO" > "$tmp"
bq update --source "$tmp" "${PROJECT}:${LEARN}" >/dev/null
echo "   done"

echo
echo "applied $count file(s) to ${PROJECT}:${DEMO}"
if [ "${#skipped[@]}" -gt 0 ]; then echo "waiting for data (skipped): ${skipped[*]}"; fi
bq ls --project_id="$PROJECT" --location="$LOCATION" "${PROJECT}:${DEMO}"
