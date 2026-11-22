'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import {
  createPlaybook,
  draftPlaybook,
  editPlaybook,
  Playbook,
  PlaybookDraft,
  PlaybookEvidence,
  PlaybookSource,
  VALIDITY_CHOICES,
} from '@/lib/playbooks';

/**
 * Learning Loop T14: "Save as playbook" and "Edit". The draft is written by code
 * from the review's own numbers (an AI rewording is kept only if every number in
 * it is one the evidence supports). Nothing is saved until a person edits and
 * saves it. The evidence under the form is read-only: the server rebuilds it.
 */

const btn =
  'rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50';
const primary =
  'rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const field =
  'w-full rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

const NUMBER_LABEL: Record<string, string> = {
  winnerRatePct: 'Winner: qualified replies (%)',
  controlRatePct: 'Control: qualified replies (%)',
  winnerQualified: 'Winner: confirmed qualified companies',
  controlQualified: 'Control: confirmed qualified companies',
  winnerCompanies: 'Winner: companies',
  controlCompanies: 'Control: companies',
  liftPoints: 'Lift (percentage points)',
  liftLowPoints: 'Lift, low end (points)',
  liftHighPoints: 'Lift, high end (points)',
  confidenceLevel: 'Confidence level (%)',
  ratePct: 'Segment rate (%)',
  overallRatePct: 'Overall rate (%)',
  companies: 'Companies in the segment',
  withOutcome: '...with the outcome',
  rangeLowPct: 'Range, low end (%)',
  rangeHighPct: 'Range, high end (%)',
};

const words = (k: string) =>
  NUMBER_LABEL[k] ??
  k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-base font-semibold text-ink2">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: PlaybookEvidence }) {
  const rows = Object.entries(evidence.numbers).filter(([, v]) => v !== null);
  return (
    <details className="rounded border border-line bg-panel px-3 py-2 text-tiny text-muted">
      <summary className="cursor-pointer text-ink">
        Evidence (
        {evidence.source === 'review'
          ? "from the test's review"
          : 'from the Insights result'}
        )
      </summary>
      <p className="mt-1.5">
        Built by code from{' '}
        {evidence.source === 'review'
          ? `review revision ${evidence.revision}`
          : 'the approved search preference'}
        . You edit the words; the numbers and the source stay as they are.
      </p>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{words(k)}</dt>
            <dd className="text-right text-ink">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Form({
  initial,
  validDays,
  evidence,
  note,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  initial: { title: string; body: string };
  validDays: number;
  evidence: PlaybookEvidence;
  note: React.ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (v: {
    title: string;
    body: string;
    validDays: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [days, setDays] = useState(validDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ok = title.trim().length >= 3 && body.trim().length >= 10;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        body: body.trim(),
        validDays: days,
      });
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{note}</p>
      <label className="block">
        <span className="mb-1 flex justify-between text-tiny text-faint">
          <span>Title</span>
          <span>{title.length}/120</span>
        </span>
        <input
          data-testid="playbook-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          className={field}
        />
      </label>
      <label className="block">
        <span className="mb-1 flex justify-between text-tiny text-faint">
          <span>
            What we learned (plain words; it is given to the AI as a hint, not a
            fact)
          </span>
          <span>{body.length}/500</span>
        </span>
        <textarea
          data-testid="playbook-body"
          value={body}
          maxLength={500}
          rows={6}
          onChange={(e) => setBody(e.target.value)}
          className={field}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-tiny text-faint">
          How long is it valid?
        </span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className={field}
          data-testid="playbook-validity"
        >
          {!VALIDITY_CHOICES.some((c) => c.days === days) && (
            <option value={days}>{days} days</option>
          )}
          {VALIDITY_CHOICES.map((c) => (
            <option key={c.days} value={c.days}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <EvidenceList evidence={evidence} />
      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={busy} className={btn}>
          Cancel
        </button>
        <button
          onClick={() => void go()}
          disabled={busy || !ok}
          className={primary}
          data-testid="playbook-save"
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** Drafts from an approved promotion or search preference, lets a person edit it, saves it. */
export function SavePlaybookDialog({
  source,
  onClose,
  onSaved,
}: {
  source: PlaybookSource;
  onClose: () => void;
  onSaved: (p: Playbook) => void;
}) {
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    draftPlaybook(source)
      .then((d) => live && setDraft(d))
      .catch(
        (e) => live && setError(errorMessage(e, "Couldn't prepare a draft.")),
      );
    return () => {
      live = false;
    };
    // the source is fixed for the life of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Save as playbook" onClose={onClose}>
      {error && (
        <div className="space-y-3 text-sm">
          <p role="alert" className="text-danger-text">
            {error}
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className={btn}>
              Close
            </button>
          </div>
        </div>
      )}
      {!error && !draft && (
        <p className="text-sm text-muted">
          Preparing a draft from the numbers…
        </p>
      )}
      {draft && (
        <Form
          initial={{ title: draft.title, body: draft.body }}
          validDays={draft.validDays}
          evidence={draft.evidence}
          confirmLabel="Save playbook"
          onCancel={onClose}
          note={
            <>
              A playbook is a lesson the next searches and subject drafts can
              use as a hint.{' '}
              {draft.source === 'template'
                ? 'This draft was written by code from the numbers.'
                : 'This wording came from the AI, and every number in it was checked against the evidence.'}{' '}
              Nothing is saved until you press Save.
            </>
          }
          onSubmit={async (v) => onSaved(await createPlaybook(source, v))}
        />
      )}
    </Modal>
  );
}

/** Editing saves a NEW version; the old one stays in the history. */
export function EditPlaybookDialog({
  playbook,
  onClose,
  onSaved,
}: {
  playbook: Playbook;
  onClose: () => void;
  onSaved: (p: Playbook) => void;
}) {
  return (
    <Modal title="Edit playbook" onClose={onClose}>
      <Form
        initial={{ title: playbook.title, body: playbook.body }}
        validDays={90}
        evidence={playbook.evidence}
        confirmLabel="Save new version"
        onCancel={onClose}
        note={
          <>
            Saving creates version {playbook.version + 1}. Version{' '}
            {playbook.version} stays in the history, and validity starts again
            from today.
          </>
        }
        onSubmit={async (v) => onSaved(await editPlaybook(playbook.id, v))}
      />
    </Modal>
  );
}
