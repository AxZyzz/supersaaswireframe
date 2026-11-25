# Learning Loop: spec checklist mapped to tests (T18, section 2)

**Date:** 2026-11-23 · **Branch:** `ll/T18` · **Where:** every test lives in `apps/api/src/` and runs in the normal
`npm test -w apps/api` (local database, mock AI and mock email). Each test name below was checked to exist in the file
named. **All 11 cases are covered and passing.** Two had no test that said so, so two were written here (marked **NEW**).

How to run one case: `npx jest <file> -t "<part of the test name>"` from `apps/api`.

| # | Case (from T18) | Proven by (file → test name) |
|---|---|---|
| 1 | **Multiple contacts per company** | `campaigns/experiments.integration.spec.ts` → "assigns 20 leads across 12 companies deterministically, shares variant among colleagues, …" · `outcomes/outcomes.integration.spec.ts` → "a second contact at the same company gets the same company key and variant" · `review/review.integration.spec.ts` → "counts companies, not emails: two contacts at one company are ONE verified qualified company" · `insights/insights.integration.spec.ts` → "counts each company once, even with two contacts, …" · `sending/send-window.integration.spec.ts` → "runs a send-time test: stable assignment per company, …" |
| 2 | **Send retry after assignment** | `campaigns/experiments.integration.spec.ts` → "assigns 20 leads across 12 companies deterministically, …, retries on error without double-assigning, …" (a provider error on the first send, three ticks at once, one assignment per company) |
| 3 | **Campaign edit during a test** | `campaigns/experiments.integration.spec.ts` → "freezes variants, audience segment, senders, step delays and template copy while experiment is running (409 experiment_running)" · `review/policy/gates.spec.ts` → "fails when something was edited while running" (the Review gate) · `sending/send-window.integration.spec.ts` → the send-time test also proves the campaign's send window and a second test are refused while one runs |
| 4 | **Delayed and duplicate outcomes** | *Duplicate:* `outcomes/outcomes.integration.spec.ts` → "the same reply delivered twice (duplicate sync) records ONE event", "manual outcomes are idempotent on the client key" · `integrations/calendar.integration.spec.ts` → "a repeated sync never duplicates the outcome" · `inbox/gmail-reply-sync.integration.spec.ts` → "never processes the same Gmail message twice" · `outcomes/outcome-logic.spec.ts` → "idempotency keys are stable for the same real-world event". *Delayed:* `outcomes/outcomes.integration.spec.ts` → "a late reply (after the response window) is stored, not dropped" · `review/review.integration.spec.ts` → "a reply after the response window is stored but not counted" |
| 5 | **Wrong-tenant access** | `outcomes/outcomes.integration.spec.ts` → "another workspace cannot see or verify these outcomes (RLS)" · `review/review.integration.spec.ts` → "another workspace cannot read or refresh this review (404), nor open its revisions" · `review/review-actions.integration.spec.ts` → "agent cannot approve, resume, revert or draft (403); other workspace gets 404" · `search-preferences/search-preferences.integration.spec.ts` → "agent cannot propose, approve, withdraw or revert (403); … other workspace gets 404" · `playbooks/playbooks.integration.spec.ts` → "another workspace cannot read, version, edit or retire this workspace's playbooks, …" · `campaigns/campaigns.integration.spec.ts` → "isolates campaigns between orgs" · **NEW** `campaigns/experiments.integration.spec.ts` → "another workspace cannot read, edit, start, stop or create a test on this workspace's campaign (404), and nothing changes" (subject and send-time tests, and the campaign's send window) · `auth/security-t18.integration.spec.ts` → "… never touches another workspace". Database level: every tenant table has RLS enabled and forced (`docs/SECURITY-REVIEW.md`, addendum) |
| 6 | **Paused variant with queued jobs** | `review/review-actions.integration.spec.ts` → "paused version: new companies get only A; a colleague already on B keeps B; resume allows B again" (first touches queued after the pause) · **NEW** "a company ASSIGNED to a version before it was paused, with nothing sent yet, keeps that version (reassigning would bias the test)" (the documented T11 rule, `send.service.ts`) · "in-flight follow-ups after a pause still send with the original variant attribution" · "approved challenger: new companies join the new test; companies already assigned stay out of it" |
| 7 | **Competing approvals** | `review/review-actions.integration.spec.ts` → "simultaneous approvals (two parallel requests, different keys) -> exactly one applied", "two parallel pauses of different versions never leave zero active versions" · `search-preferences/search-preferences.integration.spec.ts` → "two parallel approvals (different keys) -> exactly one preference" |
| 8 | **Search results short of quota** | `search-preferences/search-preferences.integration.spec.ts` → "a run reserves 20%: cap 2 of 10, targeted finds 1 so 1 is filled from the normal search; overlap counts once" · "if the targeted search fails, the whole shortfall is filled from the normal search" |
| 9 | **High-open / low-conversion fixture** | `review/policy/decide.spec.ts` → "high opens, low conversion: B has 60% opens but 1% qualified, A 30% opens and 4% -> never B" · `review/simulation.spec.ts` → "high_open_low_conv -> never B (control wins), though B has twice the opens" · `review/review.integration.spec.ts` → "gives each scenario the expected decision" (through the real API) |
| 10 | **Misleading city effect** | `review/simulation.spec.ts` → "misleading_city -> inconclusive overall, but the city slice looks strong" · `review/review.integration.spec.ts` → "gives each scenario the expected decision" (`misleading_city` is `inconclusive`) |
| 11 | **Valid winner** | `review/policy/decide.spec.ts` → "valid winner -> promote the challenger, propose pausing the control" · `review/review.integration.spec.ts` → "gives each scenario the expected decision" (`valid_winner` is `promote`) |

## The two tests added in this pass

1. **A company assigned before a pause keeps its version.** A company is pre-assigned to version B (the state a failed
   or deferred first send leaves: an assignment row, nothing sent), B is paused through the real approval, then all six
   companies are sent. The pre-assigned one still gets B with B's subject; the five unassigned ones get only A; the
   assignment row is not rewritten (`reassigned_from` stays empty). Without this, the rule that "an assignment is the
   randomisation" was only a code comment.
2. **Another workspace cannot touch this workspace's tests.** Eight requests from a second workspace (read, list, edit,
   start, stop, create a subject test, create a send-time test, set the campaign's send window) all answer 404, and the
   first workspace's test, its variants, its single-test list and its (empty) send window are unchanged afterwards.

## What these tests do not prove

They run against a local database with mock email and mock AI. They do not show the loop on the live Google Cloud
deployment (T18 section 1, the end-to-end run), real Gmail delivery, or real Gemini behaviour. Those need the live site
(blocked until billing for the project is restored) and are recorded separately.
