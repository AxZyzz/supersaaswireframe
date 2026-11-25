import { spreadFraction } from './send-window';

/**
 * Catch-up guard (Learning Loop T18 follow-up, written for the restore after
 * the 2026-11-23 billing closure).
 *
 * After an outage, or after a campaign was paused for days and resumed, every
 * lead's next email is overdue at once. Without a guard the send loop works
 * through them as fast as the sender caps allow, at any hour, and late
 * follow-ups arrive as a burst. With the guard, a send that is overdue by more
 * than `staleAfterHours` is NOT sent now: it is moved to a deterministic point
 * inside the next `spreadHours`, and is then due again and sent normally (sender
 * caps, windows, suppression and the rest of the checks still apply at that
 * time).
 *
 * "How overdue" is measured by the DATABASE clock in the claim query (the same
 * clock that decides what is due), never by the app's clock, so a fake clock in
 * a test or a clock drift on one instance cannot make fresh sends look stale.
 *
 * Pure functions: no database, no clock, no environment.
 */
export const DEFAULT_STALE_AFTER_HOURS = 24;
export const DEFAULT_CATCHUP_SPREAD_HOURS = 24;

export interface CatchUpConfig {
  /** Overdue by more than this many hours = stale. 0 (or less) turns the guard off. */
  staleAfterHours: number;
  /** Stale sends are moved to a point inside the next this-many hours. */
  spreadHours: number;
}

const num = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * The settings from `SEND_STALE_AFTER_HOURS` and `SEND_CATCHUP_SPREAD_HOURS`.
 * Missing or unreadable values fall back to the defaults (env validation
 * refuses a bad value at boot, so this only matters for a value set later).
 */
export function catchUpConfigFrom(
  staleRaw: string | undefined,
  spreadRaw: string | undefined,
): CatchUpConfig {
  const stale = num(staleRaw);
  const spread = num(spreadRaw);
  return {
    staleAfterHours:
      stale === null || stale < 0 ? DEFAULT_STALE_AFTER_HOURS : stale,
    spreadHours:
      spread === null || spread <= 0 ? DEFAULT_CATCHUP_SPREAD_HOURS : spread,
  };
}

export type CatchUpDecision =
  | { stale: false }
  | {
      stale: true;
      /** How many hours overdue it was (for the log). */
      overdueHours: number;
      /** Move it this many seconds from the database's now(). */
      delaySeconds: number;
    };

/**
 * Is a send that was due `overdueSeconds` ago too late to send in a burst?
 * `seed` must be stable per lead and step (campaign_lead id + step), so the
 * same send always lands on the same point and a retry does not shuffle it.
 */
export function catchUpDecision(args: {
  overdueSeconds: number;
  config: CatchUpConfig;
  seed: string;
}): CatchUpDecision {
  const { overdueSeconds, config } = args;
  if (config.staleAfterHours <= 0) return { stale: false }; // guard off
  if (!Number.isFinite(overdueSeconds)) return { stale: false };
  if (overdueSeconds <= config.staleAfterHours * 3600) return { stale: false };
  const spreadSeconds = Math.floor(config.spreadHours * 3600);
  return {
    stale: true,
    overdueHours: Math.round((overdueSeconds / 3600) * 10) / 10,
    delaySeconds: Math.floor(
      spreadFraction(`${args.seed}:catch-up`) * spreadSeconds,
    ),
  };
}
