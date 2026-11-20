// Pure helpers for the Discover page's run lifecycle (no imports with runtime
// side effects, so they can be unit-tested with `node --test`).
import type { ProspectRun } from "./prospects";

type RunLike = Pick<ProspectRun, "status" | "created_at">;
type Role = "admin" | "manager" | "agent";

/** Same window the API uses for its "a search is already running" check
 *  (prospects.service startRun). A queued/running run older than this is an
 *  orphan (queue.add failed, or the instance died mid-run): the server already
 *  accepts a new search, so the UI must stop waiting on it too. */
export const STALE_RUN_MS = 30 * 60_000;
export const POLL_MS = 2_500;
export const POLL_ERROR_MS = 5_000;
/** Consecutive failed polls before giving up (about 30s of errors). */
export const MAX_POLL_ERRORS = 6;

const inFlight = (run: RunLike) => run.status === "queued" || run.status === "running";

/** Queued/running on paper, but too old to still be progressing. */
export function isRunStalled(run: RunLike, now: number): boolean {
  if (!inFlight(run)) return false;
  const created = Date.parse(run.created_at);
  return Number.isFinite(created) && now - created > STALE_RUN_MS;
}

/** Genuinely in progress: blocks a new search and keeps the poll going. */
export function isRunWorking(run: RunLike | null, now: number): boolean {
  return !!run && inFlight(run) && !isRunStalled(run, now);
}

/** Delay before the next poll, or null to stop polling.
 *  `errors` is the number of consecutive failed polls so far. */
export function nextPollDelay(run: RunLike | null, errors: number, now: number): number | null {
  if (errors > 0) return errors >= MAX_POLL_ERRORS ? null : POLL_ERROR_MS;
  return isRunWorking(run, now) ? POLL_MS : null;
}

/** Empty-state copy. Only managers/admins have the search form, so agents get
 *  pointed at someone who can run one; null while the role is still loading. */
export function emptyStateText(role: Role | null): string | null {
  if (role === null) return null;
  return role === "admin" || role === "manager"
    ? "No searches yet. Describe your target above to find your first prospects."
    : "No searches yet. Ask a manager or admin to run a search.";
}
