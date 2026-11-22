#!/usr/bin/env bash
# Learning Loop T07: create or replace every BigQuery view in expelly_learning.
#
#   PROJECT=supersaas-513613 infra/bigquery/apply.sh            # all views
#   PROJECT=supersaas-513613 infra/bigquery/apply.sh company    # only files whose name contains "company"
#
# Safe to run again: every file is CREATE OR REPLACE. Files run in name order
# (00_ first) because later views read earlier ones. Needs `bq` signed in
# (gcloud auth login) and the datasets from README step 2.
#
# Cost: creating a view scans nothing. It is free.
set -euo pipefail

cd "$(dirname "$0")"

# Git Bash on Windows: bq cannot find a Python on its own. Point it at the one bundled with the Cloud SDK.
if [ -z "${CLOUDSDK_PYTHON:-}" ] && command -v bq >/dev/null 2>&1; then
  bundled="$(dirname "$(command -v bq)")/../platform/bundledpython/python.exe"
  [ -f "$bundled" ] && export CLOUDSDK_PYTHON="$bundled"
fi

PROJECT="${PROJECT:?set PROJECT, e.g. PROJECT=supersaas-513613}"
RAW="${RAW:-expelly_raw}"
LEARN="${LEARN:-expelly_learning}"
LOCATION="${LOCATION:-asia-south1}"
FILTER="${1:-}"

count=0
skipped=()
for f in views/*.sql; do
  if [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]]; then continue; fi
  echo "== $f"
  # The SQL goes in through stdin: passing multi-line SQL as an argument breaks on Windows (bq.cmd).
  if out=$(sed -e "s|\${PROJECT}|${PROJECT}|g" -e "s|\${RAW}|${RAW}|g" -e "s|\${LEARN}|${LEARN}|g" "$f"       | bq query --use_legacy_sql=false --project_id="$PROJECT" --location="$LOCATION" --quiet 2>&1); then
    count=$((count + 1))
  elif echo "$out" | grep -q "Not found: Table"; then
    # Datastream only creates a table in expelly_raw when its first row arrives (e.g. no review has run yet).
    echo "   skipped: a source table is not in ${RAW} yet (it appears with its first row); run apply.sh again later"
    skipped+=("$f")
  else
    echo "$out" >&2
    exit 1
  fi
done

echo
echo "applied $count file(s) to ${PROJECT}:${LEARN}"
if [ "${#skipped[@]}" -gt 0 ]; then echo "waiting for data (skipped): ${skipped[*]}"; fi
bq ls --project_id="$PROJECT" --location="$LOCATION" "${PROJECT}:${LEARN}"
