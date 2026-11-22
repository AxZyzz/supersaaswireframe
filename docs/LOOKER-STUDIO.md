# Looker Studio learning dashboard (Learning Loop T16)

A shareable dashboard for the demo: **what works, where and when**. It reads only the demo views in the BigQuery
dataset `expelly_demo`. Every one of those views is hard-wired to ONE workspace (the demo workspace), so no other
customer's numbers can ever appear on it. Building it takes **about 30 minutes**, and you do the clicking.

| Page | Shows | Data source |
|---|---|---|
| 1. What works | The funnel (contacted, reached, replied, qualified, booked) for any audience factor: country, city, industry... | `demo_factor_funnel` |
| 2. When to send | A day-of-week by time-of-day heatmap of how companies responded | `demo_send_time_grid` |
| 3. Review history | Every Review decision over time, with the lift and its confidence range | `demo_review_history` |
| 4. Targeted vs baseline | Did the "find more of this" searches beat the normal search? | `demo_search_policy_compare` |
| (all pages) | "Data as of" tile | `demo_data_freshness` |

## Before you start (once)

Someone with the project owner login runs this to create the dataset and the views (about a minute, free; Claude can
do it for you and explain each step first):

```bash
PROJECT=supersaas-513613 DEMO_ORG_ID=<the demo workspace id> infra/bigquery/apply-demo.sh
```

- **The demo workspace id** is shown in small grey text under each workspace name in the operator console
  (Operator, workspace list). Click it to select it, then copy.
- The script creates `expelly_demo` (asia-south1), creates five `demo_*` views, and lets those views read
  `expelly_learning`. It can be run again any time.
- **Two views may be skipped at first:** `demo_review_history` and `demo_search_policy_compare` need real data
  (a first Review revision and a first Search preference). Pages 3 and 4 stay empty until then. Run the script again
  later and refresh the data source.

Sign in to <https://lookerstudio.google.com> with the **A2B Google account** (the one that owns the Google Cloud project).

## Step 1: connect the five data sources (about 8 minutes)

Do this five times, once per view:

1. **Create** (top left) -> **Data source**.
2. Choose the **BigQuery** connector and authorise it if asked.
3. **My projects** -> `supersaas-513613` -> dataset **`expelly_demo`** -> table (the view) from the list above -> **Connect**.
4. In the data source editor, top right, check **Data credentials**: it should say **Owner's credentials**. This is what
   lets people with the link see the charts without any Google Cloud access. They can only ever see what these demo
   views return.
5. Rename the data source to the view name (top left), then **Create report** (or **Add to report** from the second one on).

Check the field types once per source (Looker guesses well, fix only what is wrong):

| Fields | Type | Default aggregation |
|---|---|---|
| `sent`, `reached`, `bounced`, `opened`, `replied`, `positive`, `qualified`, `booked`, `unsubscribed` (funnel); `reached`, `replied`, `qualified` (send-time); `runs`, `discovered`, `became_lead`, `reached`, `replied`, `qualified` (search) | Number | **Sum** |
| `lift`, `lift_lo`, `lift_hi` (review history) | Number (percent) | **Average** |
| `qualified_per_reached`, `qualified_per_run`, `became_lead_share` | Number | **Average** |
| `computed_at`, `last_change` | Date & Time | none |
| everything else (`factor`, `bucket`, `day_sorted`, `block_sorted`, `tz_basis`, `decision`, `arm`, `preference_label`, `experiment_id`) | Text | none |

## Step 2: add three calculated fields (about 3 minutes)

In each data source: **Add a field** -> **Add calculated field**. Rates must be computed from sums (an average of
percentages is wrong).

| Data source | Name | Formula |
|---|---|---|
| `demo_factor_funnel` | **Reply rate** | `SUM(replied) / SUM(reached)` |
| `demo_factor_funnel` | **Qualified rate** | `SUM(qualified) / SUM(reached)` |
| `demo_factor_funnel` | **Booked rate** | `SUM(booked) / SUM(reached)` |
| `demo_send_time_grid` | **Reply rate** | `SUM(replied) / SUM(reached)` |
| `demo_send_time_grid` | **Qualified rate** | `SUM(qualified) / SUM(reached)` |
| `demo_search_policy_compare` | **Qualified per reached** | `SUM(qualified) / SUM(reached)` |
| `demo_search_policy_compare` | **Qualified per run** | `SUM(qualified) / SUM(runs)` |

Set each rate's type to **Percent** (or two decimals for "per run").

## Step 3: page 1, "What works" (about 8 minutes)

Rename the page **What works**.

1. **Add a control** -> **Drop-down list**. Control field: `factor` (from `demo_factor_funnel`). Turn **off** "Allow
   multiple selections". Default selected item: `country`.
   **Why it matters:** one company is counted under every factor (its country, its industry, its city...). Adding up
   rows of different factors counts everyone several times. With one factor selected, every number on the page is
   correct.
2. **Scorecards** (five, in a row): `Sent`, `Reached`, `Replied`, `Qualified`, `Booked` (Sum of each field). This is the funnel.
3. **Bar chart** (horizontal): dimension `bucket`, metrics `Reached`, `Replied`, `Qualified`, `Booked`; sort by `Reached`
   descending; show 10 rows. Title: "Companies by <factor value>".
4. **Table**: dimension `bucket`; metrics `Sent`, `Reached`, **Reply rate**, `Qualified`, **Qualified rate**,
   `Booked`. Under **Style**, turn on **Heatmap** for the two rate columns. Sort by `Reached` descending.
5. **Scorecard**: **Data as of**. Add the data source `demo_data_freshness`, metric `last_change` with aggregation
   **Maximum**, type Date & Time. Put it in the page header (the data is about 15 minutes behind the live app).
6. **Text box** under the table: "Reached = contacted and not bounced. Qualified and booked are confirmed by a person
   or by Google Calendar. Small groups are noise: look at the Reached column before trusting a rate."

## Step 4: page 2, "When to send" (about 5 minutes)

**Add a page** -> rename it **When to send**.

1. **Control**: drop-down on `tz_basis` (default: all). `recipient` means the send time is in the company's own
   timezone; `workspace` means we did not know it and used the workspace timezone.
2. **Pivot table** (not the plain table): row dimension `day_sorted`, column dimension `block_sorted`, metric **Reply
   rate**. Under **Style**, choose **Heatmap**. The labels sort in the right order (1) Mon ... 7) Sun, 0) 6-8 am ... 7)
   8-10 pm) because of the number in front.
3. **A second pivot table** beside it with the metric `Reached` (a heatmap of how many companies each cell holds).
   A hot Reply rate cell with a tiny Reached count means nothing.
4. **Text box**: "Observation only. Send times are not varied on purpose, so a hot cell is a hint, not a finding. The
   send-time test (T17) is what proves it."

## Step 5: page 3, "Review history" (about 4 minutes)

**Add a page** -> **Review history** (data source `demo_review_history`).

1. **Control**: drop-down on `experiment_id`.
2. **Time series chart**: dimension `computed_at`; metrics `lift`, `lift_lo`, `lift_hi` (Average, percent). The two
   outer lines are the 95% range: when the lower line is above zero, the challenger really is ahead.
3. **Table**: `computed_at`, `experiment_id`, `revision`, `decision`, `lift`, `lift_lo`, `lift_hi`, `policy_version`;
   sort by `computed_at` descending. The decision is computed by code (never by AI).
4. If the page is empty, no real Review revision exists yet (Try-simulation reviews are left out on purpose).

## Step 6: page 4, "Targeted vs baseline" (about 4 minutes)

**Add a page** -> **Targeted vs baseline** (data source `demo_search_policy_compare`).

1. **Clustered column chart**: dimension `preference_label`, breakdown dimension `arm`, metric **Qualified per reached**.
   `targeted` = prospects found through the reserved share (at most 20% of a batch); `baseline` = the normal search
   in the same runs.
2. **Table**: `preference_label`, `arm`, `runs`, `discovered`, `became_lead`, `reached`, `qualified`, **Qualified per
   reached**, **Qualified per run**.
3. **Text box**: "Same runs, same budget: the only difference is who we looked for. Needs a few hundred reached
   companies per arm before it means anything."

## Step 7: title, share, link (about 2 minutes)

1. Report title: **Expelly learning loop (demo workspace)**.
2. **Share** -> **Manage access** -> under link sharing choose **Anyone with the link** -> **Viewer**. Safe: the charts
   can only ever show what the five `demo_*` views return.
3. Copy the link, then give it to the API as `LOOKER_DASHBOARD_URL` (Claude can set it on your go; one new revision).
   The operator console then shows **Learning dashboard -> Open the dashboard**.

## Check it is safe (1 minute)

In BigQuery Studio, run:

```sql
SELECT
  (SELECT COUNT(*) FROM `supersaas-513613.expelly_demo.demo_factor_funnel`) AS demo_rows,
  (SELECT COUNT(*) FROM `supersaas-513613.expelly_learning.factor_funnel` WHERE org_id = '<the demo workspace id>') AS expected_rows
```

The two numbers must be equal. The demo view has no `org_id` column at all, so a chart cannot even show a workspace id.

## If something looks wrong

| Problem | Fix |
|---|---|
| A page is empty | The matching view was skipped (no review or search preference yet). Run `apply-demo.sh` again after the first review, then **Resource** -> **Manage added data sources** -> **Refresh fields**. |
| "Permission denied" in a chart | Open the data source and set **Data credentials** to **Owner's credentials**. |
| Numbers look three times too big | A factor is not selected on page 1: the control must have exactly one `factor`. |
| Rates over 100% | The rate is an average of percentages. Use the calculated field (sum divided by sum), not the raw column. |
| Data looks old | Datastream copies the database about every 15 minutes. The "Data as of" tile says how far it has got. |
| A new field is missing | **Resource** -> **Manage added data sources** -> **Edit** -> **Refresh fields**. |
