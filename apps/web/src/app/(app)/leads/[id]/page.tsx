"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Trash2, UserX } from "lucide-react";
import { canManage, useRole } from "@/lib/me";
import { toast } from "@/components/feedback";
import {
  addNote,
  deleteLead,
  getLead,
  LeadDetail,
  updateLead,
} from "@/lib/leads";
import { useLeadStatuses } from "@/lib/lead-statuses";

export default function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = useRole();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const statuses = useLeadStatuses();
  const [note, setNote] = useState("");
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      setLead(await getLead(id));
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(status: string) {
    await updateLead(id, { status });
    await load();
  }
  async function setScore(score: string) {
    await updateLead(id, { score: (score || null) as LeadDetail["score"] });
    await load();
  }
  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await addNote(id, note.trim());
    setNote("");
    await load();
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-shell">
        <p className="text-sm text-muted">Lead not found.</p>
        <Link href="/leads" className="text-sm text-accent">
          ← Back to leads
        </Link>
      </div>
    );
  }
  if (!lead) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  const name =
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead";
  const field =
    "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

  return (
    <div className="mx-auto grid max-w-shell grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={14} /> Leads
        </Link>

        <div className="rounded-lg border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-title font-semibold text-ink2">{name}</h1>
            {canManage(role) && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete ${name}?`)) return;
                    await deleteLead(id);
                    toast("Lead deleted.");
                    router.replace("/leads");
                  }}
                  title="Delete lead"
                  className="rounded p-1.5 text-faint hover:bg-hover hover:text-danger-text"
                >
                  <Trash2 size={15} />
                </button>
                <button
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Forget ${name}? Their data is deleted and their address is suppressed so they're never emailed again. Use this for erasure requests.`,
                      )
                    )
                      return;
                    await deleteLead(id, true);
                    toast("Lead forgotten and suppressed.");
                    router.replace("/leads");
                  }}
                  title="Forget (GDPR erasure): delete + never email again"
                  className="flex items-center gap-1 rounded px-2 py-1 text-tiny text-faint hover:bg-hover hover:text-danger-text"
                >
                  <UserX size={14} /> Forget
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-muted">
            {[lead.title, lead.company].filter(Boolean).join(" · ") || "—"}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label="Email" value={lead.email} />
            <Row label="Phone" value={lead.phone} />
            <Row label="Source" value={lead.source} />
            <Row
              label="Added"
              value={new Date(lead.created_at).toLocaleDateString()}
            />
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              Status
              <select
                value={lead.status}
                onChange={(e) => void setStatus(e.target.value)}
                className={field}
              >
                {[...new Set([...statuses.map((x) => x.name), lead.status])].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              Score
              <select
                value={lead.score ?? ""}
                onChange={(e) => void setScore(e.target.value)}
                className={field}
              >
                <option value="">none</option>
                <option value="hot">hot</option>
                <option value="warm">warm</option>
                <option value="cold">cold</option>
              </select>
            </label>
          </div>

          {lead.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {lead.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full px-2 py-0.5 text-tiny text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="mb-3 text-section font-semibold text-ink2">Notes</h2>
          <form onSubmit={submitNote} className="mb-4 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              className={`${field} flex-1`}
            />
            <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
              Add
            </button>
          </form>
          {lead.notes.length === 0 ? (
            <p className="text-sm text-faint">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {lead.notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded border border-line bg-panel px-3 py-2 text-sm"
                >
                  <p className="text-ink">{n.body}</p>
                  <p className="mt-1 text-tiny text-faint">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-3 text-section font-semibold text-ink2">Activity</h2>
        <ol className="space-y-3">
          {lead.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <div>
                <p className="capitalize text-ink">
                  {e.type.replace(/_/g, " ")}
                </p>
                <p className="text-tiny text-faint">
                  {new Date(e.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-tiny uppercase tracking-wide text-faint">{label}</dt>
      <dd className="text-ink">{value || "—"}</dd>
    </div>
  );
}
