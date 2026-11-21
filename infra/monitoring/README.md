# Cloud Monitoring for the learning loop (T13)

**Nothing here has been run.** These are Google Cloud changes. They wait until T08, T09, T10 and T13
are deployed (Aman, 2026-11-21), and each command is explained and approved before it runs.

## What it is

The API writes structured JSON log lines (Cloud Run turns them into Cloud Logging entries):

* `loop_health`: one per workspace every 6 hours (`apps/api/src/loop-health/loop-health-logic.ts`):
  `coverage_min`, `stuck_actions`, `srm_breaches`, `unattributed_7d`, `gate_failures_total`, ...
* `ai_route` / `ai_circuit_open`: every AI call and every time the model router opens a circuit (T08).
* `weekly_review` / `weekly_review_failed`: the weekly auto-review (this task).

**Log-based metrics** turn those lines into numbers; **alert policies** email you when a number is bad.

## Cost

Log-based metrics and alert policies on logs are a few cents a month at this volume (the first 50 GiB
of logs a month are free, and these metrics add no log volume). The notification channel is free.

## The notification channel (you create or approve it)

Alerts need somewhere to go. Creating the channel is your call, so this is yours to approve:

```powershell
$P = "supersaas-513613"
gcloud beta monitoring channels create --project=$P --type=email `
  --display-name="Expelly alerts" --channel-labels=email_address=YOUR_EMAIL
gcloud beta monitoring channels list --project=$P --format="value(name,displayName)"
```

Put the returned channel name (`projects/.../notificationChannels/123`) in each policy file's
`notificationChannels` before creating it (the files have the placeholder `CHANNEL_NAME`).

## 1. Log-based metrics (4 counters)

```powershell
foreach ($m in "expelly_loop_coverage_low","expelly_loop_stuck_actions","expelly_loop_unattributed","expelly_ai_circuit_open") {
  gcloud logging metrics create $m --project=$P --config-from-file="infra/monitoring/metrics/$m.json"
}
```

| Metric | Counts log lines where |
|---|---|
| `expelly_loop_coverage_low` | `loop_health` and `coverage_min < 0.8` |
| `expelly_loop_stuck_actions` | `loop_health` and `stuck_actions > 0` |
| `expelly_loop_unattributed` | `loop_health` and `unattributed_7d > 0` (watched, no alert) |
| `expelly_ai_circuit_open` | `ai_circuit_open` (T08) |

## 2. Alert policies (4)

```powershell
foreach ($a in "stuck-actions","coverage-low","ai-circuit-open","weekly-review-failed") {
  gcloud alpha monitoring policies create --project=$P --policy-from-file="infra/monitoring/alert-policies/$a.json"
}
```

| Policy | Fires when |
|---|---|
| Stuck review actions | at least one workspace reports a stuck action in the last 30 minutes of data (`loop-health` runs every 6 h, so a stuck action is caught within 6 h) |
| Outcome coverage low | 4 or more `coverage_min < 0.8` lines in 24 hours (the loop-health job runs every 6 h, so that is every run) |
| AI circuit open often | more than 3 `ai_circuit_open` lines in an hour |
| Weekly review failed | the `expelly-weekly-review` Scheduler job logs a non-OK attempt, or the API logs `weekly_review_failed` |

## Test an alert without waiting

Dry run: create the policy, then send a test notification from the console (Monitoring, Alerting,
the policy, "Send test notification"), or write one matching log line:

```powershell
gcloud logging write expelly-loop-test '{"event":"loop_health","status":"bad","stuck_actions":1,"coverage_min":0.5}' `
  --payload-type=json --severity=WARNING --project=$P
```

(That line only reaches the metric if it comes from the API's log stream; for a true end-to-end test,
insert a stuck action in a test workspace and run the `expelly-loop-health` job.)

## Roll back

```powershell
gcloud alpha monitoring policies list --project=$P --format="value(name,displayName)"
gcloud alpha monitoring policies delete POLICY_NAME --project=$P
gcloud logging metrics delete expelly_loop_stuck_actions --project=$P
```
