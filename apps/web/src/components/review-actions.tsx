"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Undo2, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import {
  ActionRecord,
  approveReviewAction,
  ChallengerDraft,
  createChallengerDrafts,
  errorCode,
  listChallengerDrafts,
  listReviewActions,
  newKey,
  resumeVariant,
  Review,
  ReviewAction,
  revertReviewAction,
} from "@/lib/review";
import { previewTemplate, renderSample } from "@/lib/templates";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";
import { SavePlaybookDialog } from "@/components/playbook-dialogs";

/**
 * Learning Loop T11: what a manager can do with a review. Every button opens a
 * dialog that says exactly what will change. A request key is made when the
 * dialog opens and the button is disabled while it runs, so a double click is
 * one change. Agents see the history but no buttons.
 */

const btn =
  "rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type DialogState =
  | { kind: "keep"; action: ReviewAction }
  | { kind: "pause"; action: ReviewAction; label: string; companies: number }
  | { kind: "resume"; variantId: string; label: string }
  | { kind: "revert"; record: ActionRecord };

function Modal({
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
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Confirm dialog: states the change, takes a reason, runs once. */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  reasonLabel,
  reasonRequired,
  onClose,
  run,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  onClose: () => void;
  /** Throws on failure; the message is shown in the dialog. */
  run: (reason: string, key: string) => Promise<void>;
}) {
  // mounted when the dialog opens: one fresh key per opening
  const [key] = useState(newKey);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await run(reason.trim(), key);
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Please try again."));
      setBusy(false);
    }
  }

  const missing = reasonRequired && reason.trim().length === 0;
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm text-ink">
        <div>{body}</div>
        {reasonLabel && (
          <label className="block text-tiny font-medium text-muted">
            {reasonLabel}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              className="mt-1 w-full rounded border border-line-mid bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="rounded bg-danger-bg px-2 py-1.5 text-tiny text-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className={btn}>
            Cancel
          </button>
          <button onClick={() => void go()} disabled={busy || missing} className={primary}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Drawer: pick an AI-drafted subject, preview the email, approve it as a new test. */
function ChallengerDrawer({
  review,
  action,
  templateId,
  onClose,
  onDone,
}: {
  review: Review;
  action: ReviewAction;
  templateId: string | null;
  onClose: () => void;
  onDone: (r: ActionRecord) => void;
}) {
  const [drafts, setDrafts] = useState<ChallengerDraft[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const existing = await listChallengerDrafts(review.id);
        const list = existing.length ? existing : (await createChallengerDrafts(review.id)).drafts;
        if (live) setDrafts(list);
      } catch (e) {
        if (live) {
          setError(errorMessage(e, "Couldn't draft challengers."));
          setDrafts([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [review.id]);

  async function more() {
    setBusy(true);
    setError(null);
    try {
      const r = await createChallengerDrafts(review.id);
      setDrafts((d) => [...r.drafts, ...(d ?? [])]);
    } catch (e) {
      setError(errorMessage(e, "Couldn't draft more."));
    }
    setBusy(false);
  }

  async function pick(d: ChallengerDraft) {
    setPicked(d.id);
    setKey(newKey()); // a different choice is a different request
    setPreview(null);
    setPreviewing(true);
    try {
      const html = templateId ? (await previewTemplate(templateId)).html : "";
      setPreview({ subject: renderSample(d.subject), html: sanitizeEmailHtml(html) });
    } catch (e) {
      setError(errorMessage(e, "Couldn't render the preview."));
    }
    setPreviewing(false);
  }

  async function approve() {
    if (!picked || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await approveReviewAction(review.id, action.actionId, {
        revision: review.revision,
        idempotencyKey: key,
        draftId: picked,
      });
      onDone(r);
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Please try again."));
      if (errorCode(e) === "stale_review") onDone(null as unknown as ActionRecord);
      setBusy(false);
    }
  }

  const keepLabel =
    review.result.arms.find((a) => a.variantId === review.result.winnerVariantId)?.label ??
    review.result.arms.find((a) => a.isControl)?.label ??
    "A";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Review a challenger"
        className="flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-float"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">Review a challenger</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-muted">
            AI drafts these subject lines from the winning one. Nothing is used until you pick one,
            preview it and approve it. Approving ends this test and starts a new one: version{" "}
            {keepLabel} stays as the control, the pick becomes the challenger. Companies already
            contacted keep the version they got.
          </p>
          {drafts === null && <p className="text-muted">Drafting…</p>}
          {drafts && drafts.length === 0 && !error && (
            <p className="text-muted">No drafts yet.</p>
          )}
          <ul className="space-y-2">
            {(drafts ?? []).map((d) => (
              <li key={d.id}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 ${
                    picked === d.id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="draft"
                    checked={picked === d.id}
                    onChange={() => void pick(d)}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-ink">{d.subject}</span>
                    <span className="text-tiny text-faint">
                      {d.source === "template" ? "Built from a template" : "AI draft"}
                    </span>
                    {d.playbooks && d.playbooks.length > 0 && (
                      <Link
                        href={`/review/playbooks#pb-${d.playbooks[0].id}`}
                        onClick={(e) => e.stopPropagation()}
                        title={d.playbooks.map((p) => p.title).join(" · ")}
                        data-testid="draft-playbooks"
                        className="ml-2 text-tiny text-accent hover:underline"
                      >
                        Used {d.playbooks.length} playbook{d.playbooks.length === 1 ? "" : "s"}
                      </Link>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button onClick={() => void more()} disabled={busy || drafts === null} className={btn}>
            <Sparkles size={14} className="mr-1 inline" /> Draft 3 more
          </button>

          {picked && (
            <div className="rounded border border-line bg-panel p-3">
              <div className="mb-1 text-tiny font-medium uppercase tracking-wide text-faint">
                Preview (sample data)
              </div>
              {previewing && <p className="text-muted">Rendering…</p>}
              {preview && (
                <>
                  <div className="mb-2 border-b border-line pb-2">
                    <span className="text-faint">Subject: </span>
                    <span className="font-medium text-ink" data-testid="challenger-preview-subject">
                      {preview.subject}
                    </span>
                  </div>
                  <div
                    className="email-canvas prose-email max-w-none rounded p-3 text-sm"
                    dangerouslySetInnerHTML={{
                      __html: preview.html || "<p class='text-muted'>(no email body to show)</p>",
                    }}
                  />
                </>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="rounded bg-danger-bg px-2 py-1.5 text-tiny text-danger-text">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} disabled={busy} className={btn}>
            Cancel
          </button>
          <button
            onClick={() => void approve()}
            disabled={busy || !picked || !preview}
            title={!preview ? "Pick a subject and look at the preview first" : undefined}
            className={primary}
          >
            {busy ? "Working…" : "Approve challenger"}
          </button>
        </div>
      </aside>
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString();

function describe(h: ActionRecord, noun = "version"): string {
  const v = h.payload.variantLabel ? `${noun} ${h.payload.variantLabel}` : `a ${noun}`;
  const undo = h.revertsActionId ? " (undo)" : "";
  switch (h.type) {
    case "keep_testing":
      return "Kept testing";
    case "pause_variant":
      return `Paused ${v}${undo}`;
    case "resume_variant":
      return `Resumed ${v}${undo}`;
    case "approve_challenger":
      return `Approved challenger "${h.payload.challengerSubject ?? ""}" and started a new test`;
  }
}

export function ReviewActions({
  review,
  canManage,
  templateId,
  onChanged,
}: {
  review: Review;
  canManage: boolean;
  /** The first step's email, used to preview a challenger. */
  templateId: string | null;
  /** Called after any change so the Review reloads. */
  onChanged: () => void;
}) {
  const campaignId = review.experiment?.campaignId ?? null;
  const simulated = review.simulated;
  const [history, setHistory] = useState<ActionRecord[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [drawer, setDrawer] = useState<ReviewAction | null>(null);
  const [savePlaybook, setSavePlaybook] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!campaignId || simulated) {
      setHistory([]);
      return;
    }
    try {
      setHistory(await listReviewActions(campaignId));
    } catch {
      setHistory([]);
    }
  }, [campaignId, simulated]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, review.id, review.revision]);

  const allowed = review.result.allowedActions;
  const keep = allowed.find((a) => a.type === "keep_testing");
  const pauses = allowed.filter((a) => a.type === "pause_variant");
  const draft = allowed.find((a) => a.type === "draft_challenger");

  const done = (actionId: string) =>
    history.some((h) => h.actionId === actionId && h.status === "applied" && !h.revertsActionId);

  // versions paused right now in THIS test: an applied pause not yet undone
  const paused = useMemo(() => {
    const out = new Map<string, string>();
    for (const h of history) {
      if (h.experimentId !== review.experimentId) continue;
      if (h.type === "pause_variant" && h.status === "applied" && h.payload.variantId) {
        out.set(h.payload.variantId, h.payload.variantLabel ?? "?");
      }
    }
    return [...out].map(([variantId, label]) => ({ variantId, label }));
  }, [history, review.experimentId]);

  // T17: a send-time test has send windows, not versions of the copy
  const sendTime = review.experiment?.kind === "send_time";
  const noun = sendTime ? "send window" : "version";
  const armLabel = (id?: string) =>
    review.result.arms.find((a) => a.variantId === id)?.label ?? `this ${noun}`;
  const armCompanies = (id?: string) =>
    review.inputs.arms.find((a) => a.variantId === id)?.assigned ?? 0;

  /** After a change: reload everything, and say what happened. */
  async function afterChange(message: string) {
    toast(message, "success");
    setDialog(null);
    setDrawer(null);
    await loadHistory();
    onChanged();
  }

  /** A stale-review refusal reloads the review so the person sees what changed. */
  function stale(e: unknown): never {
    if (errorCode(e) === "stale_review") onChanged();
    throw e;
  }

  const showButtons = canManage && !simulated;
  const keepDone = keep ? done(keep.actionId) : false;

  return (
    <div className="mt-3">
      {simulated && (
        <p className="mb-2 text-tiny text-warning-text">Simulation: nothing changes.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {showButtons && keep && (
          <button
            onClick={() => setDialog({ kind: "keep", action: keep })}
            disabled={keepDone}
            className={btn}
          >
            Keep testing
          </button>
        )}
        {showButtons &&
          pauses.map((a) => {
            const label = armLabel(a.variantId);
            const already = done(a.actionId) || paused.some((p) => p.variantId === a.variantId);
            return (
              <button
                key={a.actionId}
                onClick={() =>
                  setDialog({
                    kind: "pause",
                    action: a,
                    label,
                    companies: armCompanies(a.variantId),
                  })
                }
                disabled={already}
                className={btn}
              >
                Pause {label}
              </button>
            );
          })}
        {showButtons &&
          paused.map((p) => (
            <button
              key={p.variantId}
              onClick={() => setDialog({ kind: "resume", variantId: p.variantId, label: p.label })}
              className={btn}
            >
              Resume {p.label}
            </button>
          ))}
        {showButtons && draft && (
          <button onClick={() => setDrawer(draft)} className={btn}>
            Review a challenger
          </button>
        )}
        {showButtons && !sendTime && review.result.decision === "promote" && paused.length > 0 && (
          // T14: the promotion was approved (the loser is paused): keep what was learned
          <button
            onClick={() => setSavePlaybook(true)}
            className={btn}
            data-testid="save-playbook"
            title="Keep what this test taught, so future searches and subject drafts can use it as a hint"
          >
            Save as playbook
          </button>
        )}
        {showButtons && (
          // the "who to find more of" loop starts from Insights (T12)
          <Link
            href="/review/insights"
            title="See which groups reply most, then approve a bounded test for the next search"
            className={btn}
          >
            Apply to next search
          </Link>
        )}
      </div>

      {history.length > 0 && !simulated && (
        <div className="mt-4 border-t border-line pt-3">
          <h4 className="mb-1.5 text-tiny font-medium uppercase tracking-wide text-faint">
            Action history
          </h4>
          <ul className="space-y-1.5" aria-label="Action history">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className={h.status === "reverted" ? "text-faint line-through" : "text-ink"}>
                  {describe(h, noun)}
                </span>
                {h.status === "reverted" && <span className="text-tiny text-faint">undone</span>}
                <span className="text-tiny text-muted">
                  by {h.approvedBy?.name ?? "someone"} · {when(h.requestedAt)} · revision{" "}
                  {h.revision}
                </span>
                {h.reason && <span className="text-tiny text-muted">“{h.reason}”</span>}
                {canManage && h.canRevert && (
                  <button
                    onClick={() => setDialog({ kind: "revert", record: h })}
                    className="ml-auto flex items-center gap-1 text-tiny text-accent hover:underline"
                  >
                    <Undo2 size={12} /> Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {savePlaybook && (
        <SavePlaybookDialog
          source={{ reviewId: review.id }}
          onClose={() => setSavePlaybook(false)}
          onSaved={() => {
            setSavePlaybook(false);
            toast("Saved as a playbook. Future drafts can use it as a hint.", "success");
          }}
        />
      )}

      {dialog?.kind === "keep" && (
        <ConfirmDialog
          title="Keep testing"
          confirmLabel="Keep testing"
          reasonLabel="Note (optional)"
          onClose={() => setDialog(null)}
          body={
            <p>
              Nothing changes in the test. This records that you looked at revision{" "}
              {review.revision} and chose to keep collecting results.
            </p>
          }
          run={async (reason, key) => {
            try {
              await approveReviewAction(review.id, dialog.action.actionId, {
                revision: review.revision,
                idempotencyKey: key,
                reason: reason || undefined,
              });
            } catch (e) {
              stale(e);
            }
            await afterChange("Recorded: keep testing.");
          }}
        />
      )}

      {dialog?.kind === "pause" && (
        <ConfirmDialog
          title={`Pause ${noun} ${dialog.label}`}
          confirmLabel={`Pause ${dialog.label}`}
          reasonLabel="Why? (shown in the history)"
          onClose={() => setDialog(null)}
          body={
            <p>
              {sendTime ? "Send window" : "Version"} <strong>{dialog.label}</strong> stops being used for <strong>new</strong>{" "}
              companies from now. {dialog.companies} companies already on {dialog.label} keep it.
              History is kept. You can resume any time.
            </p>
          }
          run={async (reason, key) => {
            try {
              await approveReviewAction(review.id, dialog.action.actionId, {
                revision: review.revision,
                idempotencyKey: key,
                reason: reason || undefined,
              });
            } catch (e) {
              stale(e);
            }
            await afterChange(`${sendTime ? "Send window" : "Version"} ${dialog.label} paused for new companies.`);
          }}
        />
      )}

      {dialog?.kind === "resume" && (
        <ConfirmDialog
          title={`Resume ${noun} ${dialog.label}`}
          confirmLabel={`Resume ${dialog.label}`}
          onClose={() => setDialog(null)}
          body={
            <p>
              {sendTime ? "Send window" : "Version"} <strong>{dialog.label}</strong> can be given to new companies again from now.
              Companies already assigned keep the {noun} they have.
            </p>
          }
          run={async (_reason, key) => {
            try {
              await resumeVariant(review.experimentId ?? "", dialog.variantId, {
                revision: review.revision,
                idempotencyKey: key,
              });
            } catch (e) {
              stale(e);
            }
            await afterChange(`${sendTime ? "Send window" : "Version"} ${dialog.label} resumed.`);
          }}
        />
      )}

      {dialog?.kind === "revert" && (
        <ConfirmDialog
          title="Undo this action"
          confirmLabel="Undo"
          reasonLabel="Why are you undoing it?"
          reasonRequired
          onClose={() => setDialog(null)}
          body={
            <p>
              This undoes “{describe(dialog.record, noun)}” for new companies. Companies already assigned
              keep their {noun}.
            </p>
          }
          run={async (reason, key) => {
            await revertReviewAction(dialog.record.id, { idempotencyKey: key, reason });
            await afterChange("Undone.");
          }}
        />
      )}

      {drawer && (
        <ChallengerDrawer
          review={review}
          action={drawer}
          templateId={templateId}
          onClose={() => setDrawer(null)}
          onDone={(r) => {
            if (!r) {
              onChanged();
              return;
            }
            void afterChange("Challenger approved. A new test is running.");
          }}
        />
      )}
    </div>
  );
}
