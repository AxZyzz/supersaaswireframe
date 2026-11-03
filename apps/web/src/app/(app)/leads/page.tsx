"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
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
import { ImportModal, ImportSource } from "@/components/import-modal";
import { DuplicatesModal } from "@/components/duplicates-modal";
import { canManage, useRole } from "@/lib/me";
import { addSegmentMembers, listSegments, Segment } from "@/lib/segments";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { LeadKanban } from "@/components/lead-kanban";
import {
  bulkTag,
  createLead,
  exportLeads,
  Lead,
  LeadTag,
  listLeads,
  listTags,
  SCORE_STYLES,
} from "@/lib/leads";
import { StatusDot, useLeadStatuses } from "@/lib/lead-statuses";

const PAGE = 50;
const KANBAN_LIMIT = 200;

const noopSubscribe = () => () => {};

export default function LeadsPage() {
  const role = useRole();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const statuses = useLeadStatuses();
  const colorOf = (name: string) => statuses.find((s) => s.name === name)?.color;
  const [score, setScore] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource>("file");
  const router = useRouter();

  // Back from "Connect Google Sheets" (/leads?sheets=connected|error):
  // reopen the importer on the Google Sheet tab, or say what went wrong.
  const urlQuery = useSyncExternalStore(
    noopSubscribe,
    () => window.location.search,
    () => "",
  );
  // (/leads?import=sheet, from Settings → Integrations, opens it directly.)
  const query = new URLSearchParams(urlQuery);
  const sheetsResult = query.get("sheets");
  const pending = sheetsResult ?? (query.get("import") === "sheet" ? "open" : null);
  const [handledSheets, setHandledSheets] = useState<string | null>(null);
  if (pending && pending !== handledSheets) {
    setHandledSheets(pending);
    if (pending !== "error") {
      setImportSource("sheet");
      setImporting(true);
    }
  }
  useEffect(() => {
    if (!pending) return;
    const p = new URLSearchParams(urlQuery);
    if (pending === "error") {
      toast(p.get("reason") || "Connecting Google Sheets failed.", "error");
    } else if (pending !== "open") {
      toast(`Google Sheets connected${p.get("email") ? `: ${p.get("email")}` : ""}`);
    }
    router.replace("/leads");
  }, [pending, urlQuery, router]);
  const [dedup, setDedup] = useState(false);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    // failures surface via the global Toaster; the spinner always clears
    try {
      const res = await listLeads({
        search: search || undefined,
        status: view === "kanban" ? undefined : status || undefined,
        score: score || undefined,
        limit: view === "kanban" ? KANBAN_LIMIT : PAGE,
        offset: view === "kanban" ? 0 : offset,
      });
      setLeads(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [search, status, score, offset, view]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    void listTags().then(setTags);
  }, []);

  // Manual segments the selection can be added to (admins/managers).
  const [manualSegments, setManualSegments] = useState<Segment[]>([]);
  const [bulkSegmentId, setBulkSegmentId] = useState("");
  useEffect(() => {
    if (!canManage(role)) return;
    listSegments()
      .then((s) => setManualSegments(s.filter((x) => x.type === "manual")))
      .catch(() => setManualSegments([]));
  }, [role]);

  async function addSelectedToSegment() {
    if (!bulkSegmentId || selected.size === 0) return;
    const seg = manualSegments.find((s) => s.id === bulkSegmentId);
    setBulkBusy(true);
    try {
      const r = await addSegmentMembers(bulkSegmentId, Array.from(selected));
      toast(`Added to ${seg?.name ?? "segment"} · ${r.memberCount} in segment`);
      setBulkSegmentId("");
    } catch (e) {
      toast(errorMessage(e, "Couldn't add to segment."), "error");
    } finally {
      setBulkBusy(false);
    }
  }

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
    "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

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
          {statuses.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
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
        {/* merging + bulk import are manager actions (API enforces too) */}
        {canManage(role) && (
          <>
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
          </>
        )}
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={15} /> New lead
        </button>
      </div>

      {importing && (
        <ImportModal
          initialSource={importSource}
          onClose={() => {
            setImporting(false);
            setImportSource("file");
          }}
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
          {canManage(role) && manualSegments.length > 0 && (
            <>
              <span className="mx-1 h-5 w-px bg-line-mid" />
              <select
                value={bulkSegmentId}
                onChange={(e) => setBulkSegmentId(e.target.value)}
                className={field}
              >
                <option value="">Choose segment…</option>
                {manualSegments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!bulkSegmentId || bulkBusy}
                onClick={() => void addSelectedToSegment()}
                className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Add to segment
              </button>
            </>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="text-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neut-bg px-2 py-0.5 text-tiny capitalize text-muted">
                      <StatusDot color={colorOf(l.status)} />
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
