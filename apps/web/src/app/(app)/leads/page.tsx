"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Download,
  LayoutGrid,
  List,
  Plus,
  Search,
  Tag,
  Upload,
} from "lucide-react";
import { ImportModal } from "@/components/import-modal";
import { DuplicatesModal } from "@/components/duplicates-modal";
import { LeadKanban } from "@/components/lead-kanban";
import {
  bulkTag,
  createLead,
  exportLeads,
  LEAD_STATUSES,
  Lead,
  LeadTag,
  listLeads,
  listTags,
  SCORE_STYLES,
} from "@/lib/leads";

const PAGE = 50;
const KANBAN_LIMIT = 200;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [score, setScore] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dedup, setDedup] = useState(false);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    const res = await listLeads({
      search: search || undefined,
      status: view === "kanban" ? undefined : status || undefined,
      score: score || undefined,
      limit: view === "kanban" ? KANBAN_LIMIT : PAGE,
      offset: view === "kanban" ? 0 : offset,
    });
    setLeads(res.data);
    setTotal(res.total);
    setLoading(false);
  }, [search, status, score, offset, view]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    void listTags().then(setTags);
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) =>
      s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)),
    );
  }
  async function applyBulk(action: "attach" | "detach") {
    if (!bulkTagId || selected.size === 0) return;
    setBulkBusy(true);
    await bulkTag(Array.from(selected), bulkTagId, action);
    setBulkBusy(false);
    await load();
  }

  async function quickCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") || "").trim();
    const firstName = String(data.get("firstName") || "").trim();
    const company = String(data.get("company") || "").trim();
    if (!email && !firstName && !company) return;
    await createLead({
      email: email || null,
      firstName: firstName || null,
      company: company || null,
    });
    setCreating(false);
    setOffset(0);
    await load();
  }

  const field =
    "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

  return (
    <div className="mx-auto max-w-shell space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={search}
            onChange={(e) => {
              setOffset(0);
              setSearch(e.target.value);
            }}
            placeholder="Search leads…"
            className={`${field} w-56 pl-8`}
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setOffset(0);
            setStatus(e.target.value);
          }}
          className={field}
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={score}
          onChange={(e) => {
            setOffset(0);
            setScore(e.target.value);
          }}
          className={field}
        >
          <option value="">All scores</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded border border-line-mid">
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-sm ${
              view === "table" ? "bg-accent-soft text-accent" : "text-muted"
            }`}
            title="Table view"
          >
            <List size={15} />
          </button>
          <button
            onClick={() => setView("kanban")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-sm ${
              view === "kanban" ? "bg-accent-soft text-accent" : "text-muted"
            }`}
            title="Kanban view"
          >
            <LayoutGrid size={15} />
          </button>
        </div>
        <button
          onClick={() =>
            void exportLeads({
              search: search || undefined,
              status: status || undefined,
              score: score || undefined,
            })
          }
          className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover"
        >
          <Download size={15} /> Export
        </button>
        <button
          onClick={() => setDedup(true)}
          className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover"
        >
          <Copy size={15} /> Duplicates
        </button>
        <button
          onClick={() => setImporting(true)}
          className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover"
        >
          <Upload size={15} /> Import CSV
        </button>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={15} /> New lead
        </button>
      </div>

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImported={() => {
            setOffset(0);
            void load();
          }}
        />
      )}

      {dedup && (
        <DuplicatesModal
          onClose={() => setDedup(false)}
          onMerged={() => {
            setOffset(0);
            void load();
          }}
        />
      )}

      {creating && (
        <form
          onSubmit={quickCreate}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-3"
        >
          <input name="firstName" placeholder="First name" className={field} />
          <input name="company" placeholder="Company" className={field} />
          <input
            name="email"
            type="email"
            placeholder="email@company.com"
            className={field}
          />
          <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
            Add
          </button>
        </form>
      )}

      {view === "kanban" ? (
        loading ? (
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        ) : (
          <LeadKanban leads={leads} onChange={() => void load()} />
        )
      ) : (
        <>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-soft2 bg-accent-soft p-2.5 text-sm">
          <Tag size={15} className="text-accent" />
          <span className="font-medium text-ink2">
            {selected.size} selected
          </span>
          <select
            value={bulkTagId}
            onChange={(e) => setBulkTagId(e.target.value)}
            className={field}
          >
            <option value="">Choose tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            disabled={!bulkTagId || bulkBusy}
            onClick={() => void applyBulk("attach")}
            className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            Add tag
          </button>
          <button
            disabled={!bulkTagId || bulkBusy}
            onClick={() => void applyBulk("detach")}
            className="rounded border border-line-mid px-3 py-1.5 font-medium text-ink disabled:opacity-40"
          >
            Remove tag
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
              <th className="w-8 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={leads.length > 0 && selected.size === leads.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No leads yet. Add one to get started.
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-line last:border-0 hover:bg-hover"
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.email ?? l.id}`}
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/leads/${l.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") ||
                        "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.company || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{l.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-neut-bg px-2 py-0.5 text-tiny capitalize text-muted">
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.score ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-tiny capitalize ${SCORE_STYLES[l.score]}`}
                      >
                        {l.score}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          {total} lead{total === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="rounded border border-line-mid px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
            className="rounded border border-line-mid px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
