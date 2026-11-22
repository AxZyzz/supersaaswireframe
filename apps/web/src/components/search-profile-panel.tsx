'use client';

import { useCallback, useEffect, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { toast } from '@/components/feedback';
import { SavePlaybookDialog } from '@/components/playbook-dialogs';
import {
  countdown,
  getPreference,
  getPreferenceResults,
  listPreferences,
  PrefDetail,
  PrefResults,
  pctPoints,
  STATE_LABEL,
  withdrawPreference,
} from '@/lib/search-preferences';

const card = 'rounded-lg border border-line bg-surface p-4';
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`;

const ACTION_LABEL: Record<string, string> = {
  created: 'Approved',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  reverted: 'Reverted',
  deactivated: 'Switched off automatically',
};

/**
 * Discover's "search profile": the active search preference with its expiry
 * countdown and a Withdraw button, how it is doing against the normal search,
 * and its history. Agents see it but cannot change it.
 */
export function SearchProfilePanel({
  canManage,
  refreshKey,
}: {
  canManage: boolean;
  /** Bumped by the page when a run finishes, so the numbers refresh. */
  refreshKey?: number;
}) {
  const [pref, setPref] = useState<PrefDetail | null>(null);
  const [results, setResults] = useState<PrefResults | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [savePlaybook, setSavePlaybook] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await listPreferences();
      // the active one, else the most recent one that ended (its history)
      const shown = all.find((p) => p.status === 'active') ?? all[0] ?? null;
      if (!shown) {
        setPref(null);
        setResults(null);
      } else {
        const [detail, res] = await Promise.all([
          getPreference(shown.id),
          getPreferenceResults(shown.id),
        ]);
        setPref(detail);
        setResults(res);
      }
    } catch {
      setPref(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function withdraw() {
    if (!pref) return;
    setBusy(true);
    try {
      await withdrawPreference(pref.id, reason.trim() || undefined);
      toast(
        'Search preference withdrawn. New searches are back to normal.',
        'success',
      );
      setConfirming(false);
      setReason('');
      await load();
    } catch (e) {
      toast(errorMessage(e, "Couldn't withdraw it."), 'error');
    }
    setBusy(false);
  }

  if (!loaded || !pref) return null;
  const active = pref.status === 'active';

  return (
    <section aria-label="Search profile" className={card}>
      <div className="flex flex-wrap items-center gap-3">
        <Crosshair size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-ink2">Search profile</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-tiny font-medium ${
            active ? 'bg-success-bg text-success-text' : 'bg-neut-bg text-muted'
          }`}
        >
          {active ? 'Preference active' : `Preference ${pref.status}`}
        </span>
        {canManage && (active || pref.status === 'expired') && (
          // T14: keep the lesson so future searches can use it as a hint
          <button
            onClick={() => setSavePlaybook(true)}
            data-testid="save-playbook"
            className="ml-auto rounded border border-line-mid px-2.5 py-1 text-sm text-ink hover:bg-hover"
          >
            Save as playbook
          </button>
        )}
        {active && canManage && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className={`${active && canManage ? '' : 'ml-auto '}rounded border border-line-mid px-2.5 py-1 text-sm text-ink hover:bg-hover`}
          >
            Withdraw
          </button>
        )}
      </div>

      <p className="mt-2 text-sm text-ink">
        {active ? (
          <>
            Up to <strong>{Math.round(pref.capShare * 100)}%</strong> of each
            search is reserved for <strong>{pref.label}</strong>. Ends in{' '}
            <strong data-testid="preference-countdown">
              {countdown(pref.expiresAt)}
            </strong>{' '}
            ({new Date(pref.expiresAt).toLocaleDateString()}). The rest is the
            normal search.
          </>
        ) : (
          <>
            {pref.label}: {pref.endedReason ?? pref.status}. New searches use
            the normal profile.
          </>
        )}
      </p>
      <p className="mt-0.5 text-tiny text-faint">
        Why: {pref.evidence.sentence} Approved by{' '}
        {pref.approvedBy?.name ?? 'someone'}.
      </p>

      {confirming && (
        <div className="mt-3 space-y-2 rounded border border-line bg-panel p-3 text-sm">
          <p>
            New searches stop reserving slots for {pref.label} right away. A
            search that already started keeps it. History is kept.
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={500}
            className="w-full rounded border border-line-mid bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded border border-line-mid px-3 py-1 text-sm hover:bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void withdraw()}
              disabled={busy}
              className="rounded bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Withdraw preference'}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div
          className="mt-4 rounded border border-line bg-panel p-3"
          aria-label="Did it work?"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-tiny font-medium uppercase tracking-wide text-faint">
              Did it work? Targeted vs normal search
            </h3>
            <span className="rounded-full bg-info-bg px-2 py-0.5 text-tiny font-medium text-info-text">
              {STATE_LABEL[results.verdict.state]}
            </span>
          </div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-tiny text-faint">
                <th className="py-1 font-normal">Companies</th>
                <th className="font-normal">Targeted</th>
                <th className="font-normal">Normal</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Discovered (verified)', 'discovered'],
                  ['Contactable (valid email)', 'contactable'],
                  ['Reached', 'reached'],
                  ['Confirmed qualified', 'qualified'],
                ] as const
              ).map(([label, k]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 text-muted">{label}</td>
                  <td className="text-ink">{results.targeted[k]}</td>
                  <td className="text-ink">{results.baseline[k]}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-1 text-muted">Qualified per reached</td>
                <td className="text-ink">
                  {pct(results.verdict.qualifiedPerReached.targeted)}
                </td>
                <td className="text-ink">
                  {pct(results.verdict.qualifiedPerReached.baseline)}
                </td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1 text-muted">
                  Qualified per search ({results.runs})
                </td>
                <td className="text-ink">
                  {results.targeted.qualifiedPerRun?.toFixed(1) ?? '–'}
                </td>
                <td className="text-ink">
                  {results.baseline.qualifiedPerRun?.toFixed(1) ?? '–'}
                </td>
              </tr>
            </tbody>
          </table>
          {results.verdict.diff && (
            <p className="mt-1 text-sm text-ink">
              Difference: {pctPoints(results.verdict.diff.d)} points (range{' '}
              {pctPoints(results.verdict.diff.lo)} to{' '}
              {pctPoints(results.verdict.diff.hi)}).
            </p>
          )}
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {results.verdict.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-1 text-tiny text-faint">{results.note}</p>
        </div>
      )}

      {pref.revisions.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-tiny font-medium uppercase tracking-wide text-faint">
            History
          </h3>
          <ul className="space-y-1 text-sm" aria-label="Preference history">
            {[...pref.revisions].reverse().map((r) => (
              <li
                key={`${r.revision}-${r.action}`}
                className="flex flex-wrap gap-x-2"
              >
                <span className="text-ink">
                  {ACTION_LABEL[r.action] ?? r.action}
                </span>
                <span className="text-tiny text-muted">
                  {r.actor_name ? `by ${r.actor_name} · ` : 'automatic · '}
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.reason && (
                  <span className="text-tiny text-muted">“{r.reason}”</span>
                )}
                {r.after?.note && (
                  <span className="text-tiny text-faint">{r.after.note}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {savePlaybook && (
        <SavePlaybookDialog
          source={{ preferenceId: pref.id }}
          onClose={() => setSavePlaybook(false)}
          onSaved={() => {
            setSavePlaybook(false);
            toast('Saved as a playbook. Future searches can use it as a hint.', 'success');
          }}
        />
      )}
    </section>
  );
}
