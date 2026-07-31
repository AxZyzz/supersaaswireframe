"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Play, Plus, Send, Trash2, Users } from "lucide-react";
import {
  addStep,
  archiveCampaign,
  Campaign,
  campaignAudience,
  CampaignDetail,
  CONDITION_LABELS,
  createCampaign,
  enrollCampaign,
  getCampaign,
  listCampaigns,
  removeStep,
  runDueSends,
  StepCondition,
} from "@/lib/campaigns";
import { listTemplates, Template } from "@/lib/templates";
import { listSegments, Segment } from "@/lib/segments";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neut-bg text-muted",
  scheduled: "bg-warning-bg text-warning-text",
  active: "bg-success-bg text-success-text",
  paused: "bg-warning-bg text-warning-text",
  completed: "bg-accent-soft text-accent",
  archived: "bg-neut-bg text-faint",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<CampaignDetail | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const loadList = useCallback(async () => {
    const [c, t, s] = await Promise.all([
      listCampaigns(),
      listTemplates(),
      listSegments(),
    ]);
    setCampaigns(c);
    setTemplates(t);
    setSegments(s);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const open = useCallback(async (id: string) => {
    setNote(null);
    const [detail, aud] = await Promise.all([
      getCampaign(id),
      campaignAudience(id),
    ]);
    setSelected(detail);
    setAudience(aud.count);
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "").trim();
    if (!name) return;
    const segmentId = String(f.get("segmentId") || "");
    const c = await createCampaign({
      name,
      segmentId: segmentId || undefined,
    });
    setCreating(false);
    await loadList();
    await open(c.id);
  }

  async function addStepTo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const f = new FormData(e.currentTarget);
    const variants = String(f.get("variants") || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    await addStep(selected.id, {
      templateId: String(f.get("templateId") || "") || undefined,
      delayHours: Number(f.get("delayHours")) || 0,
      condition: String(f.get("condition") || "always") as StepCondition,
      subjectVariants: variants.length ? variants : undefined,
    });
    e.currentTarget.reset();
    await open(selected.id);
  }

  async function enroll() {
    if (!selected) return;
    try {
      const r = await enrollCampaign(selected.id);
      setNote({ ok: true, text: `Enrolled ${r.enrolled} lead(s). Campaign active.` });
      await loadList();
      await open(selected.id);
    } catch {
      setNote({ ok: false, text: "Enroll failed — add a step first." });
    }
  }

  async function archive() {
    if (!selected) return;
    await archiveCampaign(selected.id);
    await loadList();
    await open(selected.id);
  }

  async function runSends() {
    if (!selected) return;
    const c = await runDueSends();
    setNote({
      ok: true,
      text: `Processed: ${c.sent ?? 0} sent, ${c.suppressed ?? 0} suppressed, ${c.completed ?? 0} completed.`,
    });
    await loadList();
    await open(selected.id);
  }

  const tplName = (id: string | null) =>
    templates.find((t) => t.id === id)?.name ?? "(no template)";

  const field =
    "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto flex max-w-shell gap-4">
      {/* list */}
      <aside className="w-72 shrink-0 space-y-2">
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={15} /> New campaign
        </button>
        {creating && (
          <form
            onSubmit={create}
            className="space-y-2 rounded-lg border border-line bg-panel p-3"
          >
            <input
              name="name"
              required
              placeholder="Campaign name"
              className={`${field} w-full`}
            />
            <select name="segmentId" className={`${field} w-full`}>
              <option value="">All leads (no segment)</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.member_count})
                </option>
              ))}
            </select>
            <button className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
              Create
            </button>
          </form>
        )}
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          {campaigns.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No campaigns yet.
            </p>
          ) : (
            campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => void open(c.id)}
                className={`block w-full border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover ${
                  selected?.id === c.id ? "bg-accent-soft" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {c.name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-tiny capitalize ${STATUS_STYLES[c.status]}`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="text-tiny text-muted">
                  {c.steps ?? 0} step{c.steps === 1 ? "" : "s"} ·{" "}
                  {c.leads ?? 0} enrolled
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* detail */}
      <div className="flex-1">
        {!selected ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-mid bg-white">
            <p className="text-sm text-muted">
              Select or create a campaign to build its sequence.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-white p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-section font-semibold text-ink2">
                    {selected.name}
                  </h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-tiny capitalize ${STATUS_STYLES[selected.status]}`}
                  >
                    {selected.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Users size={14} /> {audience ?? "…"} lead(s) in audience
                </div>
              </div>
              <button
                onClick={() => void enroll()}
                disabled={selected.status === "archived"}
                className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Play size={14} /> Enroll &amp; activate
              </button>
              <button
                onClick={() => void runSends()}
                disabled={selected.status !== "active"}
                title="Process due sends now"
                className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-40"
              >
                <Send size={14} /> Run due sends
              </button>
              <button
                onClick={() => void archive()}
                disabled={selected.status === "archived"}
                title="Archive"
                className="rounded border border-line-mid p-1.5 text-faint hover:text-danger-text disabled:opacity-40"
              >
                <Archive size={15} />
              </button>
            </div>

            {note && (
              <div
                className={`rounded border px-3 py-1.5 text-sm ${
                  note.ok
                    ? "border-success-text/30 bg-success-bg text-success-text"
                    : "border-danger-text/30 bg-danger-bg text-danger-text"
                }`}
              >
                {note.text}
              </div>
            )}

            {/* sequence */}
            <div className="rounded-lg border border-line bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink2">Sequence</h3>
              <div className="space-y-2">
                {selected.steps.length === 0 ? (
                  <p className="text-sm text-muted">
                    No steps yet. Add the first email below.
                  </p>
                ) : (
                  selected.steps.map((s) => (
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
                            : `after ${s.delay_hours}h`}{" "}
                          · {CONDITION_LABELS[s.condition]}
                          {s.subject_variants.length > 0 &&
                            ` · A/B ×${s.subject_variants.length}`}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await removeStep(s.id);
                          await open(selected.id);
                        }}
                        className="text-faint hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={addStepTo}
                className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
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
                    className={`${field} w-24`}
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
                  A/B subjects (comma-separated, optional)
                  <input
                    name="variants"
                    placeholder="Subject A, Subject B"
                    className={field}
                  />
                </label>
                <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
                  Add step
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
