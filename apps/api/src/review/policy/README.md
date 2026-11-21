# Review policy (`review-policy/1`)

This folder decides what a Review says about a test. It is plain TypeScript: no
database, no AI, no framework. Give it counts, it gives back the numbers, the
checks, and one decision. **Every number a user sees in Review comes from here.**
AI may only explain the result afterwards; it never decides.

## What is counted

The unit is a **company**, not an email. Two people at one company are one unit,
and every company sees exactly one version.

- **Main result:** companies with a *confirmed* qualified reply (a person said
  yes), divided by *all companies assigned to that version*.
- **Second result:** booked calls.
- **Shown but never used to decide:** opens (they are unreliable), raw replies,
  bounces, unsubscribes, complaints.

## The decision (exactly one)

| Decision | Plain meaning |
|---|---|
| `guardrail_breach` | A deliverability limit was crossed. No winner. Fix sender health or the list first. Checked first because it is urgent. |
| `keep_collecting` | One of the trust checks below has not passed yet. The message says which, and when to look again. |
| `promote` | Every check passed and the difference is clearly big enough. Keep the stronger version. If the *challenger* is clearly worse, keep the control and propose pausing the challenger. |
| `inconclusive` | Every check passed but the result could still go either way. Keep the control. It says how many more companies would settle it, or that it is not worth continuing at this volume (when that number is more than 3x what we have). |

"Clearly big enough" means the **cautious end** of the 95% range for the
difference (the lower bound) is at least the minimum worthwhile lift (default
+2 points). We never promote on a lucky-looking average.

**Nothing is ever forced.** Two good versions can both stay. Pausing a version
is only a *proposed action* that a manager approves.

## The eight checks ("gates")

1. **window_mature** - every company has had its full reply window (default 14
   days) and the decision date has arrived. Otherwise: "X of Y companies are
   still inside their window. Earliest full read: date."
2. **outcome_coverage** - at least 90% of replying companies have a settled
   outcome (no AI "qualified" label still waiting for a person). Otherwise:
   "Confirm or reject N more replies."
3. **assignment_balance** - the companies split between versions the way we
   planned (50/50). A big skew (p < 0.001) means something is steering
   companies, so the comparison is not fair.
4. **delivery_balance** - both versions were delivered about equally. Fails only
   if the gap is real (p < 0.01) **and** more than 5 points.
5. **attribution_clean** - no reply could belong to two tests. Replies we could
   not tie to a test are shown but do not block.
6. **copy_frozen** - the wording, offer or audience did not change mid-test.
7. **guardrails** - per version: bounces < 5% of sent, unsubscribes < 2% and
   complaints < 0.3% of delivered. A breach blocks a winner and is reported as a
   deliverability warning, not as the version "losing".
8. **minimum_sample** - each version has at least the planned number of
   companies. With no plan it passes with the warning "no sample plan"; a
   version with no companies at all always fails.

## The statistics (`stats.ts`)

- **Wilson score interval** for one rate (stays sensible near 0% and 100%).
- **Newcombe hybrid score interval (method 10)** for the difference between two
  rates. Tested against Newcombe (1998): 56/70 vs 48/80 gives a difference of
  0.2000 with a 95% range of (0.0524, 0.3339).
- **Sample size per version.** Our promotion rule ("the lower bound must clear
  the minimum lift"): `n = (z_a + z_b)^2 * (p1q1 + p2q2) / (target - min)^2`.
  Example: baseline 3%, target +4 points, minimum +2 points needs **1,849
  companies per version**. The classic "is it different from zero" version is
  there too.
- **Sample-ratio mismatch** (chi-square, 1 degree of freedom) and a
  **two-proportion test** (used for delivery).

## Plain-English explanation (`explain-template.ts`)

Writes the result in words from the numbers alone, citing finding ids
(`F1`, `F2`, ...). It is the fallback whenever the AI explanation fails its
checks.

## Rules for this folder

- Pure: the same input always gives the same output (snapshot test).
- Only `./` imports and Node's `crypto` (a test enforces this).
- Change a rule => bump `POLICY_VERSION` so old reviews stay explainable.
