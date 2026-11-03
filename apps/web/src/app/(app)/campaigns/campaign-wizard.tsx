"use client";

import { useCallback, useState } from "react";
import { Check, Clock, Send, Trash2, X } from "lucide-react";
import {
  addStep,
  CampaignDetail,
  campaignAudience,
  createCampaign,
  enrollCampaign,
  getCampaign,
  removeStep,
  scheduleCampaign,
  StepCondition,
  updateCampaign,
} from "@/lib/campaigns";
import { Template } from "@/lib/templates";
import { Segment } from "@/lib/segments";
import { Sender } from "@/lib/senders";

const STEPS = ["Setup", "Sequence", "Senders", "Review"] as const;

const field =
  "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export default function CampaignWizard({
  templates,
  segments,
  senders,
  onClose,
  onDone,
}: {
  templates: Template[];
  segments: Segment[];
  senders: Sender[];
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set());
  const [launchMode, setLaunchMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async (id: string) => {
    const d = await getCampaign(id);
    setDetail(d);
    return d;
  }, []);

  // Persist step 1 (create on first pass, update thereafter) then advance.
  async function fromSetup() {
    if (!name.trim()) {
      setErr("Give the campaign a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let id = campaignId;
      if (!id) {
        const c = await createCampaign({
          name: name.trim(),
          segmentId: segmentId || undefined,
        });
        id = c.id;
        setCampaignId(id);
      } else {
        await updateCampaign(id, {
          name: name.trim(),
          segmentId: segmentId || null,
        });
      }
      await reload(id);
      setStep(1);
    } catch {
      setErr("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addStepNow(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!campaignId) return;
    const f = new FormData(e.currentTarget);
    const variants = String(f.get("variants") || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    await addStep(campaignId, {
      templateId: String(f.get("templateId") || "") || undefined,
      delayHours: Number(f.get("delayHours")) || 0,
      condition: String(f.get("condition") || "always") as StepCondition,
      subjectVariants: variants.length ? variants : undefined,
    });
    e.currentTarget.reset();
    await reload(campaignId);
  }

  async function saveSenders() {
    if (!campaignId) return;
    setBusy(true);
    try {
      await updateCampaign(campaignId, { senderIds: [...selectedSenders] });
      setStep(3);
      const aud = await campaignAudience(campaignId);
      setAudience(aud.count);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!campaignId) return;
    setBusy(true);
    setErr(null);
    try {
      if (launchMode === "schedule") {
        if (!scheduledAt) {
          setErr("Pick a date and time.");
          setBusy(false);
          return;
        }
        await scheduleCampaign(campaignId, new Date(scheduledAt).toISOString());
      } else {
        await enrollCampaign(campaignId);
      }
      await onDone(campaignId);
    } catch {
      setErr(
        launchMode === "schedule"
          ? "Schedule failed — the time must be in the future."
          : "Launch failed — add a step first.",
      );
      setBusy(false);
    }
  }

  const tplName = (id: string | null) =>
    templates.find((t) => t.id === id)?.name ?? "(no template)";
  const stepCount = detail?.steps.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-surface shadow-lg">
        {/* header + stepper */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">New campaign</h2>
          <button
            onClick={onClose}
            className="text-faint hover:text-ink"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-tiny font-medium ${
                  i < step
                    ? "bg-success-text text-white"
                    : i === step
                      ? "bg-accent text-white"
                      : "bg-neut-bg text-faint"
                }`}
              >
                {i < step ? <Check size={13} /> : i + 1}
              </div>
              <span
                className={`text-sm ${i === step ? "font-medium text-ink" : "text-muted"}`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="mx-1 h-px w-6 bg-line-mid" />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-4 px-5 py-5">
          {err && (
            <div className="rounded border border-danger-text/30 bg-danger-bg px-3 py-1.5 text-sm text-danger-text">
              {err}
            </div>
          )}

          {/* Step 1 — Setup */}
          {step === 0 && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-tiny font-medium uppercase tracking-wide text-faint">
                  Campaign name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Q3 outreach"
                  className={`${field} w-full`}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-tiny font-medium uppercase tracking-wide text-faint">
                  Audience
                </span>
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className={`${field} w-full`}
                >
                  <option value="">All leads (no segment)</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.member_count})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Step 2 — Sequence */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-2">
                {stepCount === 0 ? (
                  <p className="text-sm text-muted">
                    Add the first email in the sequence.
                  </p>
                ) : (
                  detail?.steps.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-2 text-sm"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-tiny font-medium text-accent">
                        {s.step_order + 1}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium text-ink">
                          {tplName(s.template_id)}
                        </div>
                        <div className="text-tiny text-muted">
                          {s.delay_hours === 0
                            ? "immediately"
                            : `after ${s.delay_hours}h`}
                          {s.subject_variants.length > 0 &&
                            ` · A/B ×${s.subject_variants.length}`}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await removeStep(s.id);
                          if (campaignId) await reload(campaignId);
                        }}
                        className="text-faint hover:text-danger-text"
                        aria-label="Remove step"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form
                onSubmit={addStepNow}
                className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
              >
                <label className="flex flex-col gap-1 text-tiny text-faint">
                  Template
                  <select name="templateId" className={field}>
                    <option value="">(none)</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-tiny text-faint">
                  Delay (h)
                  <input
                    name="delayHours"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className={`${field} w-20`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-tiny text-faint">
                  Condition
                  <select name="condition" className={field} defaultValue="always">
                    <option value="always">Always send</option>
                    <option value="opened_no_reply">If opened, no reply</option>
                    <option value="not_opened">If not opened</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-tiny text-faint">
                  A/B subjects (comma-separated)
                  <input
                    name="variants"
                    placeholder="Subject A, Subject B"
                    className={field}
                  />
                </label>
                <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
                  Add
                </button>
              </form>
            </div>
          )}

          {/* Step 3 — Senders */}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                Choose sender accounts to rotate across. Leave all unchecked to
                use every verified sender.
              </p>
              {senders.length === 0 ? (
                <p className="rounded border border-dashed border-line-mid px-3 py-4 text-center text-sm text-muted">
                  No senders yet. Add one in Settings — the campaign will use any
                  available sender.
                </p>
              ) : (
                senders.map((s) => {
                  const on = selectedSenders.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-3 rounded border border-line bg-panel px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelectedSenders((prev) => {
                            const next = new Set(prev);
                            if (on) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          })
                        }
                      />
                      <div className="flex-1">
                        <div className="font-medium text-ink">
                          {s.from_name}{" "}
                          <span className="font-normal text-muted">
                            &lt;{s.from_email}&gt;
                          </span>
                        </div>
                        <div className="text-tiny text-muted">
                          {s.provider.toUpperCase()} · {s.daily_limit}/day ·{" "}
                          {s.status}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          )}

          {/* Step 4 — Review + launch */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
                <div>
                  <div className="text-tiny uppercase tracking-wide text-faint">
                    Name
                  </div>
                  <div className="font-medium text-ink">{name}</div>
                </div>
                <div>
                  <div className="text-tiny uppercase tracking-wide text-faint">
                    Audience
                  </div>
                  <div className="font-medium text-ink">
                    {audience ?? "…"} lead(s)
                  </div>
                </div>
                <div>
                  <div className="text-tiny uppercase tracking-wide text-faint">
                    Steps
                  </div>
                  <div className="font-medium text-ink">{stepCount}</div>
                </div>
                <div>
                  <div className="text-tiny uppercase tracking-wide text-faint">
                    Senders
                  </div>
                  <div className="font-medium text-ink">
                    {selectedSenders.size === 0
                      ? "All available"
                      : `${selectedSenders.size} selected`}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="launch"
                    checked={launchMode === "now"}
                    onChange={() => setLaunchMode("now")}
                  />
                  <Send size={14} /> Launch now
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="launch"
                    checked={launchMode === "schedule"}
                    onChange={() => setLaunchMode("schedule")}
                  />
                  <Clock size={14} /> Schedule for
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    disabled={launchMode !== "schedule"}
                    className={`${field} disabled:opacity-40`}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* footer nav */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <button
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
            className="rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step === 0 && (
            <button
              onClick={() => void fromSetup()}
              disabled={busy}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Next
            </button>
          )}
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={stepCount === 0}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Next
            </button>
          )}
          {step === 2 && (
            <button
              onClick={() => void saveSenders()}
              disabled={busy}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              onClick={() => void finish()}
              disabled={busy}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {launchMode === "schedule" ? "Schedule campaign" : "Launch campaign"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
