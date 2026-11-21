// Run: node --test src/lib/prospect-run-state.test.mjs (from apps/web; Node 22.18+
// strips the .ts types natively). The web app has no test runner, and these
// helpers are pure, so the built-in one is enough.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POLL_ERRORS,
  POLL_ERROR_MS,
  POLL_MS,
  STALE_RUN_MS,
  emptyStateText,
  isRunStalled,
  isRunWorking,
  nextPollDelay,
} from "./prospect-run-state.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const run = (status, ageMs) => ({ status, created_at: ago(ageMs) });

test("a fresh queued/running run is working and keeps polling", () => {
  for (const status of ["queued", "running"]) {
    const r = run(status, 60_000);
    assert.equal(isRunStalled(r, NOW), false);
    assert.equal(isRunWorking(r, NOW), true);
    assert.equal(nextPollDelay(r, 0, NOW), POLL_MS);
  }
});

test("an orphaned run older than the API's 30-minute window is stalled: form unlocks, polling stops", () => {
  for (const status of ["queued", "running"]) {
    const r = run(status, STALE_RUN_MS + 1_000);
    assert.equal(isRunStalled(r, NOW), true);
    // Before the fix the page treated this as working forever (button disabled,
    // a GET every 2.5s for as long as the tab stayed open).
    assert.equal(isRunWorking(r, NOW), false);
    assert.equal(nextPollDelay(r, 0, NOW), null);
  }
});

test("finished runs are never stalled or working", () => {
  for (const status of ["done", "failed"]) {
    const r = run(status, STALE_RUN_MS * 10);
    assert.equal(isRunStalled(r, NOW), false);
    assert.equal(isRunWorking(r, NOW), false);
    assert.equal(nextPollDelay(r, 0, NOW), null);
  }
  assert.equal(isRunWorking(null, NOW), false);
});

test("an unparseable created_at never marks a run stalled", () => {
  const r = { status: "running", created_at: "not a date" };
  assert.equal(isRunStalled(r, NOW), false);
  assert.equal(isRunWorking(r, NOW), true);
});

test("failed polls back off and give up after MAX_POLL_ERRORS in a row", () => {
  for (let errors = 1; errors < MAX_POLL_ERRORS; errors++) {
    assert.equal(nextPollDelay(null, errors, NOW), POLL_ERROR_MS);
  }
  assert.equal(nextPollDelay(null, MAX_POLL_ERRORS, NOW), null);
  assert.equal(nextPollDelay(run("running", 1_000), MAX_POLL_ERRORS + 3, NOW), null);
});

test("empty state only points at the form for roles that have it", () => {
  assert.match(emptyStateText("admin"), /Describe your target above/);
  assert.match(emptyStateText("manager"), /Describe your target above/);
  // Agents have no form on the page, so "above" would point at nothing.
  assert.doesNotMatch(emptyStateText("agent"), /above/);
  assert.match(emptyStateText("agent"), /Ask a manager or admin/);
  assert.equal(emptyStateText(null), null);
});
