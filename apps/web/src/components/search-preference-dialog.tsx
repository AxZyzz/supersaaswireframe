'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { toast } from '@/components/feedback';
import { newKey } from '@/lib/review';
import {
  createPreference,
  InsightRef,
  Proposal,
  proposePreference,
  SearchPreference,
} from '@/lib/search-preferences';

const BLOCKING = new Set(['active_preference_exists', 'same_evidence']);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * "Test next batch": shows exactly what a search preference would do (the
 * filter, the cap, the expiry, the evidence, what stays the same) and only
 * then lets a manager approve it. The numbers are recomputed on the server.
 */
export function SearchPreferenceDialog({
  insightRef,
  onClose,
  onCreated,
}: {
  insightRef: InsightRef;
  onClose: () => void;
  onCreated: (p: SearchPreference) => void;
}) {
  // mounted when the dialog opens: one fresh key per opening
  const [key] = useState(newKey);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    proposePreference(insightRef)
      .then((p) => live && setProposal(p))
      .catch(
        (e) =>
          live && setError(errorMessage(e, "Couldn't prepare the preview.")),
      );
    return () => {
      live = false;
    };
    // the reference is built once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = proposal?.warnings.some((w) => BLOCKING.has(w.code)) ?? false;

  async function approve() {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const pref = await createPreference(insightRef, {
        proposalHash: proposal.proposalHash,
        idempotencyKey: key,
      });
      toast(
        'Search preference approved. The next Discover run will use it.',
        'success',
      );
      onCreated(pref);
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Please try again."));
      setBusy(false);
    }
  }

  const ev = proposal?.evidence;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Test next batch"
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">
            Test next batch
          </h2>
          <button
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="text-faint hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm text-ink">
          {!proposal && !error && (
            <p className="text-muted">Preparing the preview…</p>
          )}
          {proposal && ev && (
            <>
              <div>
                <div className="text-tiny font-medium uppercase tracking-wide text-faint">
                  What changes
                </div>
                <p className="mt-0.5">
                  The next Discover searches for this offer reserve{' '}
                  <strong>up to {Math.round(proposal.capShare * 100)}%</strong>{' '}
                  of each batch ({proposal.example.batch12} of 12,{' '}
                  {proposal.example.batch20} of 20) for{' '}
                  <strong data-testid="preference-label">
                    {proposal.label}
                  </strong>
                  . A company counts only if its own website confirms it. The
                  rest of the batch is the normal search.
                </p>
                <p className="mt-1 text-muted">
                  Ends on {new Date(proposal.expiresAt).toLocaleDateString()} (
                  {proposal.expiresInDays} days). You can withdraw it at any
                  time.
                </p>
              </div>
              <div>
                <div className="text-tiny font-medium uppercase tracking-wide text-faint">
                  Why (exploratory evidence)
                </div>
                <p className="mt-0.5">{ev.sentence}</p>
                <p className="mt-0.5 text-tiny text-muted">
                  {ev.x} of {ev.n} companies, range {pct(ev.lo)} to {pct(ev.hi)}
                  ; overall {pct(ev.overallP)}. Computed{' '}
                  {new Date(ev.computedAt).toLocaleString()}.
                </p>
                {ev.confounding && (
                  <p className="mt-0.5 text-tiny text-warning-text">
                    {ev.confounding}
                  </p>
                )}
              </div>
              <div>
                <div className="text-tiny font-medium uppercase tracking-wide text-faint">
                  What stays the same
                </div>
                <ul className="mt-0.5 list-disc pl-5 text-muted">
                  {proposal.staysTheSame.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              {proposal.warnings.map((w) => (
                <p
                  key={w.code}
                  role="alert"
                  className={`rounded px-2 py-1.5 text-tiny ${
                    BLOCKING.has(w.code)
                      ? 'bg-danger-bg text-danger-text'
                      : 'bg-warning-bg text-warning-text'
                  }`}
                >
                  {w.message}
                </p>
              ))}
            </>
          )}
          {error && (
            <p
              role="alert"
              className="rounded bg-danger-bg px-2 py-1.5 text-tiny text-danger-text"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void approve()}
              disabled={busy || !proposal || blocked}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Approve preference'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
