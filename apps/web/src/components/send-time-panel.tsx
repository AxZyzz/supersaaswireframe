"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Lock, Play, Square } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { ClockSelect, WindowEditor } from "@/components/window-editor";
import {
  createCampaignExperiment,
  describeSendWindow,
  Experiment,
  listCampaignExperiments,
  sameSendWindow,
  SendWindow,
  startExperiment,
  stopExperiment,
  updateExperiment,
} from "@/lib/campaigns";
import { getOrg } from "@/lib/org";

// Tue-Thu mornings against Tue-Thu afternoons: the question most senders ask first.
const DEFAULT_A: SendWindow = { days: [2, 3, 4], startHour: 9, endHour: 11, tzBasis: "recipient" };
const DEFAULT_B: SendWindow = { days: [2, 3, 4], startHour: 14, endHour: 16, tzBasis: "recipient" };

/**
 * "Test two send times" (Learning Loop T17). Companies are split at random into
 * two send windows. The email and the subject are the same in both, so the only
 * difference is WHEN it arrives; Review then judges on confirmed qualified
 * replies, exactly as for a subject test.
 */
export function SendTimePanel({
  campaignId,
  campaignStatus,
  canManage,
  onChanged,
}: {
  campaignId: string;
  campaignStatus: string;
  canManage: boolean;
  onChanged?: (exp: Experiment | null) => void;
}) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [a, setA] = useState<SendWindow>(DEFAULT_A);
  const [b, setB] = useState<SendWindow>(DEFAULT_B);
  const [busy, setBusy] = useState(false);
  const [workspaceZone, setWorkspaceZone] = useState<string | undefined>();

  const applyList = useCallback(
    (list: Experiment[]) => {
      setExperiments(list);
      const cur = list.find((e) => e.kind === "send_time") ?? null;
      if (cur && cur.variants.length >= 2) {
        const [va, vb] = [
          cur.variants.find((v) => v.label === "A") ?? cur.variants[0],
          cur.variants.find((v) => v.label === "B") ?? cur.variants[1],
        ];
        if (va.send_window) setA(va.send_window);
        if (vb.send_window) setB(vb.send_window);
      }
      onChanged?.(cur);
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
    void getOrg()
      .then((o) => live && setWorkspaceZone(o.timezone))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [campaignId, applyList]);

  const current = experiments.find((e) => e.kind === "send_time") ?? null;
  const subjectRunning = experiments.some((e) => e.kind === "subject" && e.status === "running");
  const isRunning = current?.status === "running";
  const editableCampaign = ["draft", "paused"].includes(campaignStatus);
  const canEditSetup = canManage && editableCampaign && !isRunning && !subjectRunning;
  const basis = a.tzBasis;
  const setBasis = (tzBasis: SendWindow["tzBasis"]) => {
    setA({ ...a, tzBasis });
    setB({ ...b, tzBasis });
  };

  async function save(thenStart: boolean) {
    if (sameSendWindow(a, b)) {
      toast("The two windows are the same. Pick two different times to compare.", "error");
      return;
    }
    setBusy(true);
    try {
      const windows = [
        { label: "A", window: { ...a, tzBasis: basis } },
        { label: "B", window: { ...b, tzBasis: basis } },
      ];
      let exp = current;
      if (!exp || exp.status === "stopped" || exp.status === "decided") {
        exp = await createCampaignExperiment(campaignId, { kind: "send_time", windows });
      } else if (exp.status === "draft") {
        exp = await updateExperiment(exp.id, { windows });
      }
      if (thenStart) {
        await startExperiment(exp.id);
        toast("Send-time test started. The email, the sequence and both windows are now frozen.");
      } else {
        toast("Send-time test saved as a draft.");
      }
      await load();
    } catch (e) {
      toast(errorMessage(e, "Could not save the send-time test."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!current) return;
    setBusy(true);
    try {
      await stopExperiment(current.id);
      toast("Send-time test stopped (no decision). The campaign is unlocked.");
      await load();
    } catch (e) {
      toast(errorMessage(e, "Could not stop the test."), "error");
    } finally {
      setBusy(false);
    }
  }

  const armStats = (label: "A" | "B") => {
    const v = current?.variants.find((x) => x.label === label);
    return v ? `${v.assigned_companies ?? 0} companies · ${v.sent_count ?? 0} sent` : null;
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-panel p-3.5" data-testid="send-time-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-accent" />
          <span className="text-sm font-semibold text-ink2">Test two send times · Step 1</span>
          {current && (
            <span
              className={`rounded-full px-2 py-0.5 text-tiny font-medium capitalize ${
                isRunning
                  ? "bg-success-bg text-success-text"
                  : current.status === "stopped"
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
            {current.assigned_companies} compan{current.assigned_companies === 1 ? "y" : "ies"} assigned
          </div>
        )}
      </div>

      <p className="mt-1.5 text-tiny text-muted">
        Each company is randomly given send time A or B and keeps it for its whole sequence. The
        email and its subject are identical; only the time differs. We&apos;ll judge on confirmed
        qualified replies within {current?.response_window_days ?? 14} days. While this test runs
        its two windows replace the campaign&apos;s own send window.
      </p>

      {subjectRunning && (
        <p className="mt-2 rounded border border-warning-text/30 bg-warning-bg px-2.5 py-1.5 text-tiny text-warning-text">
          A subject test is running on this campaign. One test at a time: stop it to test send times.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["A", a, setA, "Send time A (control)"],
            ["B", b, setB, "Send time B"],
          ] as const
        ).map(([key, win, set, title]) => (
          <div key={key} className="flex flex-col gap-1.5 rounded border border-line bg-surface p-2.5">
            <div className="flex items-center justify-between text-tiny">
              <span className="font-medium text-ink">{title} · 50%</span>
              <span className="text-muted">{armStats(key)}</span>
            </div>
            <WindowEditor
              value={win}
              onChange={(w) => set({ ...w, tzBasis: basis })}
              disabled={!canEditSetup || busy}
              label={title}
            />
            <div className="text-tiny text-muted">{describeSendWindow({ ...win, tzBasis: basis })}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 max-w-xs">
        <ClockSelect
          value={basis}
          onChange={setBasis}
          disabled={!canEditSetup || busy}
          workspaceZone={workspaceZone}
        />
        <p className="mt-1 text-tiny text-muted">
          Both windows use the same clock, so the test measures the time of day and nothing else.
        </p>
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isRunning ? (
            <>
              <button
                type="button"
                disabled={busy || !editableCampaign || subjectRunning}
                onClick={() => void save(true)}
                className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Play size={12} /> Start send-time test
              </button>
              <button
                type="button"
                disabled={busy || !editableCampaign || subjectRunning}
                onClick={() => void save(false)}
                className="rounded border border-line-mid px-2.5 py-1.5 text-tiny text-ink hover:bg-hover disabled:opacity-50"
              >
                Save draft
              </button>
              {!editableCampaign && (
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
