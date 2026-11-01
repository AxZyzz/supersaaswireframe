"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FlaskConical,
  Mail,
  MailOpen,
  Search,
  X,
} from "lucide-react";
import {
  CLASS_META,
  ConversationDetail,
  ConversationRow,
  getConversation,
  listConversations,
  ReplyClass,
  simulateReply,
  updateConversation,
} from "@/lib/inbox";
import { timeAgo } from "@/lib/analytics";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "interested", label: "Interested" },
  { key: "question", label: "Questions" },
  { key: "manual_review", label: "Needs review" },
];

const field =
  "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent";

function ClassBadge({ c }: { c: ReplyClass | null }) {
  if (!c) return null;
  const m = CLASS_META[c];
  return (
    <span className={`rounded-full px-2 py-0.5 text-tiny ${m.tone}`}>{m.label}</span>
  );
}

const leadLabel = (r: { lead_name: string | null; lead_email: string }) =>
  r.lead_name || r.lead_email;

export default function InboxPage() {
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [simOpen, setSimOpen] = useState(false);

  const load = useCallback(async () => {
    setRows(await listConversations({ filter, status, q: q.trim() || undefined }));
  }, [filter, status, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200); // debounce search typing
    return () => clearTimeout(t);
  }, [load]);

  async function open(id: string) {
    const d = await getConversation(id);
    setSelected(d);
    if (d.unread) {
      await updateConversation(id, { unread: false });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, unread: false } : r)));
    }
  }

  async function patch(
    body: Partial<{ unread: boolean; status: "open" | "closed"; classification: ReplyClass }>,
  ) {
    if (!selected) return;
    await updateConversation(selected.id, body);
    await load();
    if (body.status && body.status !== status) setSelected(null);
    else setSelected(await getConversation(selected.id));
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-shell overflow-hidden rounded-lg border border-line bg-white">
      {/* list */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-line">
        <div className="space-y-2 border-b border-line p-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leads or subjects"
              className={`${field} w-full pl-8`}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-0.5 text-tiny ${
                  filter === f.key
                    ? "bg-accent text-white"
                    : "bg-panel text-muted hover:bg-hover"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-tiny">
            <div className="flex gap-2">
              {(["open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatus(s);
                    setSelected(null);
                  }}
                  className={`capitalize ${status === s ? "font-medium text-ink" : "text-faint hover:text-ink"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSimOpen(true)}
              title="Inject a test reply (until real inbox sync is connected)"
              className="flex items-center gap-1 text-faint hover:text-accent"
            >
              <FlaskConical size={12} /> Test reply
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              No conversations. Replies to your campaigns land here.
            </p>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                onClick={() => void open(r.id)}
                className={`block w-full border-b border-line px-3 py-2.5 text-left hover:bg-hover ${
                  selected?.id === r.id ? "bg-accent-soft" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-sm ${r.unread ? "font-semibold text-ink" : "text-ink"}`}
                  >
                    {r.unread && (
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
                    )}
                    {leadLabel(r)}
                  </span>
                  <span className="shrink-0 text-tiny text-faint">
                    {timeAgo(r.last_message_at)}
                  </span>
                </div>
                <div className="truncate text-tiny text-muted">
                  {r.lead_company ? `${r.lead_company} · ` : ""}
                  {r.campaign_name ?? "No campaign"}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ClassBadge c={r.classification} />
                  <span className="truncate text-tiny text-faint">{r.snippet}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            Select a conversation.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-ink2">
                  {selected.subject || "(no subject)"}
                </h2>
                <p className="truncate text-tiny text-muted">
                  {selected.campaign_name ?? "No campaign"}
                  {selected.sender_email ? ` · via ${selected.sender_email}` : ""}
                </p>
              </div>
              <select
                value={selected.classification ?? ""}
                onChange={(e) => void patch({ classification: e.target.value as ReplyClass })}
                title="Reclassify"
                className={`${field} py-1 text-tiny`}
              >
                {(Object.keys(CLASS_META) as ReplyClass[]).map((k) => (
                  <option key={k} value={k}>
                    {CLASS_META[k].label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void patch({ unread: !selected.unread })}
                title={selected.unread ? "Mark read" : "Mark unread"}
                className="rounded border border-line-mid p-1.5 text-faint hover:text-ink"
              >
                {selected.unread ? <MailOpen size={14} /> : <Mail size={14} />}
              </button>
              <button
                onClick={() =>
                  void patch({ status: selected.status === "open" ? "closed" : "open" })
                }
                title={selected.status === "open" ? "Close" : "Reopen"}
                className="rounded border border-line-mid p-1.5 text-faint hover:text-ink"
              >
                {selected.status === "open" ? <Archive size={14} /> : <ArchiveRestore size={14} />}
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-panel p-4">
              {selected.thread.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${
                    m.direction === "outbound"
                      ? "ml-auto border-accent-soft2 bg-accent-soft"
                      : "border-line bg-white"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-tiny text-faint">
                    <span>
                      {m.direction === "outbound" ? "You" : m.from_email} ·{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </span>
                    {m.direction === "inbound" && <ClassBadge c={m.classification} />}
                  </div>
                  {m.subject && <div className="font-medium text-ink">{m.subject}</div>}
                  {m.body_text ? (
                    <p className="mt-1 whitespace-pre-wrap text-ink">{m.body_text}</p>
                  ) : (
                    <p className="mt-1 text-tiny italic text-muted">Campaign email sent</p>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-line px-4 py-2.5 text-tiny text-muted">
              Replying from the inbox arrives once a sending inbox (Gmail/SES) is connected.
            </div>
          </>
        )}
      </section>

      {/* lead context */}
      {selected?.lead && (
        <aside className="hidden w-64 shrink-0 space-y-4 overflow-y-auto border-l border-line p-4 text-sm xl:block">
          <div>
            <div className="font-semibold text-ink2">
              {[selected.lead.first_name, selected.lead.last_name].filter(Boolean).join(" ") ||
                selected.lead.email}
            </div>
            <div className="text-tiny text-muted">
              {[selected.lead.title, selected.lead.company].filter(Boolean).join(" · ")}
            </div>
          </div>
          <dl className="space-y-1.5 text-tiny">
            <div>
              <dt className="text-faint">Email</dt>
              <dd className="break-all text-ink">{selected.lead.email}</dd>
            </div>
            {selected.lead.phone && (
              <div>
                <dt className="text-faint">Phone</dt>
                <dd className="text-ink">{selected.lead.phone}</dd>
              </div>
            )}
            <div>
              <dt className="text-faint">Lead status</dt>
              <dd className="capitalize text-ink">{selected.lead.status}</dd>
            </div>
          </dl>
          {selected.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.tags.map((t) => (
                <span
                  key={t.name}
                  className="rounded-full px-2 py-0.5 text-tiny text-white"
                  style={{ background: t.color }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {selected.enrollment && (
            <div className="rounded border border-line bg-panel p-2.5 text-tiny">
              <div className="text-faint">Sequence</div>
              <div className="capitalize text-ink">
                {selected.enrollment.status}
                {selected.enrollment.stop_reason
                  ? ` (${selected.enrollment.stop_reason})`
                  : ""}
              </div>
              {selected.enrollment.status === "active" && selected.enrollment.next_send_at && (
                <div className="text-muted">
                  Next step {new Date(selected.enrollment.next_send_at).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
          <a
            href={`/leads/${selected.lead.id}`}
            className="block text-tiny text-accent hover:underline"
          >
            Open lead profile →
          </a>
        </aside>
      )}

      {simOpen && (
        <SimulateModal
          onClose={() => setSimOpen(false)}
          onDone={async (id) => {
            setSimOpen(false);
            await load();
            await open(id);
          }}
        />
      )}
    </div>
  );
}

// Injects a reply as if it had been received — for trying the inbox before a
// real inbox (Gmail/SES) is connected. Disabled server-side in production.
function SimulateModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (conversationId: string) => void | Promise<void>;
}) {
  const [fromEmail, setFromEmail] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      const r = await simulateReply({ fromEmail: fromEmail.trim(), body });
      await onDone(r.conversationId);
    } catch {
      setErr("Couldn't ingest — the sender must be one of your leads.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-8">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-line bg-white p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-section font-semibold text-ink2">Test reply</h2>
          <button onClick={onClose} className="text-faint hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="text-tiny text-muted">
          Simulates an inbound reply: it&apos;s threaded, AI-classified, and the lead&apos;s
          sequence is stopped (or rescheduled for out-of-office).
        </p>
        {err && <p className="text-sm text-danger-text">{err}</p>}
        <input
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="Lead email"
          className={`${field} w-full`}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply text"
          rows={4}
          className={`${field} w-full`}
        />
        <button
          onClick={() => void submit()}
          disabled={!fromEmail.trim() || !body.trim()}
          className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Inject reply
        </button>
      </div>
    </div>
  );
}
