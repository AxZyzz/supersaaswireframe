"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Lock, Play, Square, AlertCircle } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import {
  createCampaignExperiment,
  Experiment,
  listCampaignExperiments,
  startExperiment,
  stopExperiment,
  updateExperiment,
} from "@/lib/campaigns";

const field =
  "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function ExperimentPanel({
  campaignId,
  campaignStatus,
  step1Id,
  defaultSubject,
  canManage,
  onChanged,
}: {
  campaignId: string;
  campaignStatus: string;
  step1Id: string;
  defaultSubject?: string;
  canManage: boolean;
  onChanged?: (exp: Experiment | null) => void;
}) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [subjectA, setSubjectA] = useState(defaultSubject || "");
  const [subjectB, setSubjectB] = useState("");
  const [busy, setBusy] = useState(false);

  const applyList = useCallback(
    (list: Experiment[]) => {
      setExperiments(list);
      // send-time tests (T17) have their own panel
      const current = list.find((e) => e.kind !== "send_time") ?? null;
      if (current && current.variants.length >= 2) {
        setSubjectA(current.variants[0].subject);
        setSubjectB(current.variants[1].subject);
      }
      onChanged?.(current);
    },
    [onChanged],
  );

  const load = useCallback(async () => {
    try {
      applyList(await listCampaignExperiments(campaignId));
    } catch {
      applyList([]);
    }
  }, [campaignId, applyList]);

  useEffect(() => {
    let live = true;
    void listCampaignExperiments(campaignId)
      .then((list) => live && applyList(list))
      .catch(() => live && applyList([]));
    return () => {
      live = false;
    };
  }, [campaignId, applyList]);

  const current = experiments.find((e) => e.kind !== "send_time") ?? null;
  // one test at a time: a running send-time test (T17) blocks a subject test
  const timeRunning = experiments.some(
    (e) => e.kind === "send_time" && e.status === "running",
  );
  const isRunning = current?.status === "running";
  const isStopped = current?.status === "stopped";
  const canEditSetup =
    canManage &&
    ["draft", "paused"].includes(campaignStatus) &&
    !isRunning &&
    !timeRunning;

  async function saveAndStart() {
    const a = subjectA.trim();
    const b = subjectB.trim();
    if (!a || !b) {
      toast("Enter both Subject A and Subject B to run a test.", "error");
      return;
    }
    setBusy(true);
    try {
      let exp = current;
      if (!exp || exp.status === "stopped") {
        exp = await createCampaignExperiment(campaignId, {
          stepId: step1Id,
          variants: [
            { label: "A", subject: a },
            { label: "B", subject: b },
          ],
        });
      } else if (exp.status === "draft") {
        exp = await updateExperiment(exp.id, {
          variants: [
            { label: "A", subject: a },
            { label: "B", subject: b },
          ],
        });
      }
      await startExperiment(exp.id);
      toast("Company-level A/B test started. Sequence and subjects are now frozen.");
      await load();
    } catch (e) {
      toast(errorMessage(e, "Could not start the experiment."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const a = subjectA.trim();
    const b = subjectB.trim();
    if (!a || !b) {
      toast("Enter both Subject A and Subject B.", "error");
      return;
    }
    setBusy(true);
    try {
      if (!current || current.status === "stopped") {
        await createCampaignExperiment(campaignId, {
          stepId: step1Id,
          variants: [
            { label: "A", subject: a },
            { label: "B", subject: b },
          ],
        });
      } else if (current.status === "draft") {
        await updateExperiment(current.id, {
          variants: [
            { label: "A", subject: a },
            { label: "B", subject: b },
          ],
        });
      }
      toast("Experiment saved as draft.");
      await load();
    } catch (e) {
      toast(errorMessage(e, "Could not save experiment."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!current) return;
    setBusy(true);
    try {
      await stopExperiment(current.id);
      toast("Experiment stopped (no decision). Copy and steps are unlocked.");
      await load();
    } catch (e) {
      toast(errorMessage(e, "Could not stop experiment."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-panel p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical size={15} className="text-accent" />
          <span className="text-sm font-semibold text-ink2">
            A/B test (company-level) · Step 1
          </span>
          {current && (
            <span
              className={`rounded-full px-2 py-0.5 text-tiny font-medium capitalize ${
                isRunning
                  ? "bg-success-bg text-success-text"
                  : isStopped
                    ? "bg-neut-bg text-faint"
                    : "bg-warning-bg text-warning-text"
              }`}
            >
              {current.status}
            </span>
          )}
          {isRunning && (
            <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 text-tiny text-accent">
              <Lock size={11} /> Frozen while running
            </span>
          )}
        </div>
        {current && (
          <div className="text-tiny text-muted">
            {current.assigned_companies} compan{current.assigned_companies === 1 ? "y" : "ies"} assigned ·{" "}
            target per arm:{" "}
            <span className="font-medium text-ink">
              {current.target_n_per_arm ?? "set in Review"}
            </span>
          </div>
        )}
      </div>

      <p className="mt-1.5 text-tiny text-muted">
        We&apos;ll judge on confirmed qualified replies within{" "}
        {current?.response_window_days ?? 14} days (min lift +
        {current?.min_lift_pp ?? 2} pp, baseline{" "}
        {Math.round((current?.baseline_rate ?? 0.03) * 100)}%). Each company
        sees one version across all contacts and retries.
      </p>

      {timeRunning && (
        <p className="mt-2 rounded border border-warning-text/30 bg-warning-bg px-2.5 py-1.5 text-tiny text-warning-text">
          A send-time test is running on this campaign. One test at a time: stop it to test subjects.
        </p>
      )}

      {current && current.ineligible_count > 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-warning-text/30 bg-warning-bg px-2.5 py-1.5 text-tiny text-warning-text">
          <AlertCircle size={13} />
          <span>
            {current.ineligible_count} enrolled lead
            {current.ineligible_count === 1 ? " was" : "s were"} skipped (
            <code>experiment_ineligible</code>: missing company key).
          </span>
        </div>
      )}

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-tiny text-faint">
          <span className="flex items-center justify-between">
            <span>Version A (Control · 50%)</span>
            {current?.variants[0] && (
              <span className="text-muted">
                {current.variants[0].assigned_companies ?? 0} co ·{" "}
                {current.variants[0].sent_count ?? 0} sent
              </span>
            )}
          </span>
          <input
            value={subjectA}
            onChange={(e) => setSubjectA(e.target.value)}
            disabled={!canEditSetup || busy}
            placeholder="Quick question for {company|your team}"
            className={`${field} disabled:opacity-60`}
          />
        </label>
        <label className="flex flex-col gap-1 text-tiny text-faint">
          <span className="flex items-center justify-between">
            <span>Version B (Challenger · 50%)</span>
            {current?.variants[1] && (
              <span className="text-muted">
                {current.variants[1].assigned_companies ?? 0} co ·{" "}
                {current.variants[1].sent_count ?? 0} sent
              </span>
            )}
          </span>
          <input
            value={subjectB}
            onChange={(e) => setSubjectB(e.target.value)}
            disabled={!canEditSetup || busy}
            placeholder="Idea for {first_name|there} at {company|your company}"
            className={`${field} disabled:opacity-60`}
          />
        </label>
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isRunning ? (
            <>
              <button
                type="button"
                disabled={busy || timeRunning || !["draft", "paused"].includes(campaignStatus)}
                onClick={() => void saveAndStart()}
                className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Play size={12} /> Start A/B test
              </button>
              <button
                type="button"
                disabled={busy || timeRunning || !["draft", "paused"].includes(campaignStatus)}
                onClick={() => void saveDraft()}
                className="rounded border border-line-mid px-2.5 py-1.5 text-tiny text-ink hover:bg-hover disabled:opacity-50"
              >
                Save draft
              </button>
              {!["draft", "paused"].includes(campaignStatus) && (
                <span className="text-tiny text-muted">
                  Pause the campaign first to start or edit a test.
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void stop()}
              className="inline-flex items-center gap-1.5 rounded border border-danger-text/40 bg-danger-bg px-3 py-1.5 text-tiny font-medium text-danger-text hover:opacity-90 disabled:opacity-50"
            >
              <Square size={12} /> Stop test
            </button>
          )}
        </div>
      )}
    </div>
  );
}
