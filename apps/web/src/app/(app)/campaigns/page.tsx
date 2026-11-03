"use client";

import { errorMessage } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Copy,
  Pause,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  addStep,
  archiveCampaign,
  Campaign,
  campaignAudience,
  CampaignDetail,
  CampaignStats,
  campaignStats,
  CONDITION_LABELS,
  duplicateCampaign,
  enrollCampaign,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  removeStep,
  resumeCampaign,
  runDueSends,
  StepCondition,
} from "@/lib/campaigns";
import { listTemplates, Template } from "@/lib/templates";
import { listSegments, Segment } from "@/lib/segments";
import { listSenders, Sender } from "@/lib/senders";
import CampaignWizard from "./campaign-wizard";
import AiBuilder from "./ai-builder";
import { useLive } from "@/lib/realtime";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neut-bg text-muted",
  scheduled: "bg-warning-bg text-warning-text",
  active: "bg-success-bg text-success-text",
  paused: "bg-warning-bg text-warning-text",
  completed: "bg-accent-soft text-accent",
  archived: "bg-neut-bg text-faint",
};

const fetchList = () =>
  Promise.all([listCampaigns(), listTemplates(), listSegments(), listSenders()]);

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selected, setSelected] = useState<CampaignDetail | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const applyList = useCallback(
    ([c, t, s, sn]: Awaited<ReturnType<typeof fetchList>>) => {
      setCampaigns(c);
      setTemplates(t);
      setSegments(s);
      setSenders(sn);
    },
    [],
  );
  const loadList = useCallback(
    async () => applyList(await fetchList()),
    [applyList],
  );

  useEffect(() => {
    let live = true;
    void fetchList().then((r) => live && applyList(r));
    return () => {
      live = false;
    };
  }, [applyList]);

  // Reload a campaign's detail without clearing the status note — used by
  // live updates, so "Processed: N sent" isn't wiped by its own event.
  const refresh = useCallback(async (id: string) => {
    const [detail, aud, st] = await Promise.all([
      getCampaign(id),
      campaignAudience(id),
      campaignStats(id),
    ]);
    setSelected(detail);
    setAudience(aud.count);
    setStats(st);
  }, []);

  const open = useCallback(
    async (id: string) => {
      setNote(null);
      await refresh(id);
    },
    [refresh],
  );

  // Live: sends, pauses and resumes from anywhere update this page.
  useLive("campaigns", () => {
    void loadList();
    if (selected) void refresh(selected.id);
  });

  async function wizardDone(id: string) {
    setWizardOpen(false);
    setAiOpen(false);
    await loadList();
    await open(id);
  }

  async function duplicate() {
    if (!selected) return;
    const c = await duplicateCampaign(selected.id);
    await loadList();
    await open(c.id);
    setNote({ ok: true, text: "Duplicated as a new draft." });
  }

  async function togglePause() {
    if (!selected) return;
    if (selected.status === "paused") await resumeCampaign(selected.id);
    else await pauseCampaign(selected.id);
    await loadList();
    await open(selected.id);
  }

  async function addStepTo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    // Keep the form: React clears e.currentTarget once we await.
    const form = e.currentTarget;
    const f = new FormData(form);
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
    form.reset();
    await open(selected.id);
  }

  async function enroll() {
    if (!selected) return;
    try {
      const r = await enrollCampaign(selected.id);
      await loadList();
      await open(selected.id); // clears the note, so set it after
      setNote({ ok: true, text: `Enrolled ${r.enrolled} lead(s). Campaign active.` });
    } catch (e) {
      // e.g. no steps yet, or the plan's active-campaign limit
      setNote({ ok: false, text: errorMessage(e, "Enroll failed.") });
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
    await loadList();
    await open(selected.id); // clears the note, so set it after
    setNote({
      ok: true,
      text: `Processed: ${c.sent ?? 0} sent, ${c.suppressed ?? 0} suppressed, ${c.completed ?? 0} completed.`,
    });
  }

  const tplName = (id: string | null) =>
    templates.find((t) => t.id === id)?.name ?? "(no template)";

  const pct = (n: number, d: number) =>
    d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;

  const field =
    "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto flex max-w-shell gap-4">
      {/* list */}
      <aside className="w-72 shrink-0 space-y-2">
        <button
          onClick={() => setWizardOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={15} /> New campaign
        </button>
        <button
          onClick={() => setAiOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-accent-soft2 bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft2"
        >
          <Sparkles size={15} /> AI draft
        </button>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-mid bg-surface">
            <p className="text-sm text-muted">
              Select or create a campaign to build its sequence.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4">
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
                onClick={() => void togglePause()}
                disabled={
                  !["active", "scheduled", "paused"].includes(selected.status)
                }
                title={selected.status === "paused" ? "Resume" : "Pause"}
                className="rounded border border-line-mid p-1.5 text-faint hover:text-ink disabled:opacity-40"
              >
                {selected.status === "paused" ? (
                  <Play size={15} />
                ) : (
                  <Pause size={15} />
                )}
              </button>
              <button
                onClick={() => void duplicate()}
                title="Duplicate"
                className="rounded border border-line-mid p-1.5 text-faint hover:text-ink"
              >
                <Copy size={15} />
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

            {/* stats */}
            {stats && (
              <div className="rounded-lg border border-line bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink2">
                  Performance
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {[
                    { label: "Sent", value: stats.sent, sub: null },
                    {
                      label: "Opened",
                      value: stats.opened,
                      sub: pct(stats.opened, stats.sent),
                    },
                    {
                      label: "Clicked",
                      value: stats.clicked,
                      sub: pct(stats.clicked, stats.sent),
                    },
                    {
                      label: "Unsub",
                      value: stats.unsubscribed,
                      sub: pct(stats.unsubscribed, stats.sent),
                    },
                    { label: "Bounced", value: stats.bounced, sub: null },
                    {
                      label: "Completed",
                      value: stats.leads.completed,
                      sub: `${stats.leads.total} total`,
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded border border-line bg-panel px-3 py-2"
                    >
                      <div className="text-tiny uppercase tracking-wide text-faint">
                        {m.label}
                      </div>
                      <div className="text-lg font-semibold text-ink">
                        {m.value}
                      </div>
                      {m.sub && (
                        <div className="text-tiny text-muted">{m.sub}</div>
                      )}
                    </div>
                  ))}
                </div>

                {stats.variants.length > 1 && (
                  <div className="mt-4">
                    <div className="mb-1.5 text-tiny font-medium uppercase tracking-wide text-faint">
                      A/B subjects
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-tiny text-faint">
                          <th className="py-1 font-medium">Variant</th>
                          <th className="py-1 font-medium">Sent</th>
                          <th className="py-1 font-medium">Open %</th>
                          <th className="py-1 font-medium">Click %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.variants.map((v) => (
                          <tr
                            key={v.variant_index}
                            className="border-t border-line"
                          >
                            <td className="py-1 text-ink">
                              {String.fromCharCode(65 + v.variant_index)}
                            </td>
                            <td className="py-1 text-muted">{v.sent}</td>
                            <td className="py-1 text-muted">
                              {pct(v.opened, v.sent)}
                            </td>
                            <td className="py-1 text-muted">
                              {pct(v.clicked, v.sent)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* sequence */}
            <div className="rounded-lg border border-line bg-surface p-4">
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

      {wizardOpen && (
        <CampaignWizard
          templates={templates}
          segments={segments}
          senders={senders}
          onClose={() => setWizardOpen(false)}
          onDone={wizardDone}
        />
      )}

      {aiOpen && (
        <AiBuilder
          segments={segments}
          onClose={() => setAiOpen(false)}
          onDone={wizardDone}
        />
      )}
    </div>
  );
}
