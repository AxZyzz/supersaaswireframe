"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  campaignFromSequence,
  generateSequence,
  GeneratedStep,
} from "@/lib/ai";
import { Segment } from "@/lib/segments";
import { AiEditBar } from "@/components/ai-edit-bar";

const field =
  "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

// AI campaign builder (T6.3): brief -> generate a sequence -> review/edit steps
// (by hand or by asking the AI) -> approve into a draft campaign. The mock
// provider returns realistic placeholder copy; real copy needs Bedrock creds.
export default function AiBuilder({
  segments,
  onClose,
  onDone,
}: {
  segments: Segment[];
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [stepCount, setStepCount] = useState(3);
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    if (!goal.trim()) {
      setNote("Describe the goal first.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await generateSequence({
        goal: goal.trim(),
        audience: audience.trim() || undefined,
        tone: tone.trim() || undefined,
        steps: stepCount,
      });
      setSteps(r.steps);
      setGenerated(true);
      if (!name) setName(goal.trim().slice(0, 60));
      if (r.steps.length === 0) {
        setNote(
          `Model "${r.model}" returned no steps. On the mock provider that's expected — add steps below, or set AWS credentials for real generation.`,
        );
      }
    } catch {
      setNote("Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  const setStep = (i: number, patch: Partial<GeneratedStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      { subject: "", body: "", delayHours: prev.length === 0 ? 0 : 48 },
    ]);
  const removeStep = (i: number) =>
    setSteps((prev) => prev.filter((_, j) => j !== i));

  async function approve() {
    const clean = steps.filter((s) => s.subject.trim() && s.body.trim());
    if (!name.trim() || clean.length === 0) {
      setNote("Give the campaign a name and at least one complete step.");
      return;
    }
    setBusy(true);
    try {
      const c = await campaignFromSequence({
        name: name.trim(),
        segmentId: segmentId || undefined,
        steps: clean,
      });
      await onDone(c.id);
    } catch {
      setNote("Could not create the campaign.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-section font-semibold text-ink2">
            <Sparkles size={16} className="text-accent" /> AI campaign builder
          </h2>
          <button
            onClick={onClose}
            className="text-faint hover:text-ink"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {note && (
            <div className="rounded border border-warning-text/30 bg-warning-bg px-3 py-1.5 text-sm text-warning-text">
              {note}
            </div>
          )}

          {/* brief */}
          <div className="space-y-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Goal — e.g. Book demos with B2B SaaS founders"
              className={`${field} w-full`}
            />
            <div className="flex flex-wrap gap-2">
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Audience (optional)"
                className={`${field} flex-1`}
              />
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="Tone (optional)"
                className={`${field} w-40`}
              />
              <input
                type="number"
                min={1}
                max={8}
                value={stepCount}
                onChange={(e) => setStepCount(Number(e.target.value) || 3)}
                title="Number of emails"
                className={`${field} w-20`}
              />
              <button
                onClick={() => void generate()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Sparkles size={14} /> {busy ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>

          {/* generated / editable steps */}
          {generated && (
            <div className="space-y-3 border-t border-line pt-4">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-line bg-panel p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-tiny font-medium text-accent">
                      {i + 1}
                    </span>
                    <input
                      value={s.subject}
                      onChange={(e) => setStep(i, { subject: e.target.value })}
                      placeholder="Subject"
                      className={`${field} flex-1`}
                    />
                    <label className="flex items-center gap-1 text-tiny text-faint">
                      after
                      <input
                        type="number"
                        min={0}
                        value={s.delayHours}
                        onChange={(e) =>
                          setStep(i, { delayHours: Number(e.target.value) || 0 })
                        }
                        className={`${field} w-16`}
                      />
                      h
                    </label>
                    <button
                      onClick={() => removeStep(i)}
                      className="text-faint hover:text-danger-text"
                      aria-label="Remove step"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    value={s.body}
                    onChange={(e) => setStep(i, { body: e.target.value })}
                    placeholder="Email body (supports {first_name} tokens)"
                    rows={4}
                    className={`${field} w-full`}
                  />
                  <AiEditBar
                    draft={{ subject: s.subject, body: s.body }}
                    onChange={(d) => setStep(i, d)}
                  />
                </div>
              ))}
              <button
                onClick={addStep}
                className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover"
              >
                <Plus size={14} /> Add step
              </button>
            </div>
          )}
        </div>

        {/* footer: approve */}
        {generated && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campaign name"
              className={`${field} flex-1`}
            />
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className={field}
            >
              <option value="">All leads</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.member_count})
                </option>
              ))}
            </select>
            <button
              onClick={() => void approve()}
              disabled={busy}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create draft campaign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
