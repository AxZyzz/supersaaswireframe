"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { Lead, listLeads } from "@/lib/leads";
import { addSegmentMembers } from "@/lib/segments";

const leadName = (l: Lead) =>
  [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || "—";

/**
 * Pick leads to add to a manual segment. Searches the workspace's leads
 * (name, email, company); leads already in the segment show as added.
 */
export function AddSegmentLeadsModal({
  segmentId,
  existing,
  onClose,
  onAdded,
}: {
  segmentId: string;
  /** Lead ids already in the segment (the visible page of members). */
  existing: Set<string>;
  onClose: () => void;
  onAdded: (memberCount: number, added: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debounced search; `live` drops responses for an older query.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      listLeads({ search: search.trim() || undefined, limit: 50 })
        .then((r) => {
          if (!live) return;
          setResults(r.data);
          setTotal(r.total);
        })
        .catch((e) => live && setErr(errorMessage(e, "Couldn't load leads.")));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectable = (results ?? []).filter((l) => !existing.has(l.id));
  const allPicked =
    selectable.length > 0 && selectable.every((l) => picked.has(l.id));

  async function submit() {
    if (picked.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await addSegmentMembers(segmentId, Array.from(picked));
      onAdded(r.memberCount, picked.size);
    } catch (e) {
      setErr(errorMessage(e, "Couldn't add leads."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">Add leads</h2>
          <button onClick={onClose} title="Close" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-line p-4">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or company"
              className="w-full rounded border border-line-mid bg-surface px-2.5 py-1.5 pl-8 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {results === null ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              {search.trim() ? "No leads match." : "No leads yet. Add some on the Leads page."}
            </p>
          ) : (
            <>
              {selectable.length > 0 && (
                <label className="flex items-center gap-3 border-b border-line px-5 py-2 text-tiny text-muted">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(
                        allPicked
                          ? new Set()
                          : new Set(selectable.map((l) => l.id)),
                      )
                    }
                  />
                  Select all shown
                </label>
              )}
              {results.map((l) => {
                const inSegment = existing.has(l.id);
                return (
                  <label
                    key={l.id}
                    className={`flex items-center gap-3 border-b border-line px-5 py-2 text-sm last:border-0 ${
                      inSegment ? "opacity-50" : "cursor-pointer hover:bg-hover"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={inSegment}
                      checked={inSegment || picked.has(l.id)}
                      onChange={() => toggle(l.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {leadName(l)}
                      </span>
                      <span className="block truncate text-tiny text-muted">
                        {[l.email, l.company].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {inSegment && <span className="text-tiny text-faint">added</span>}
                  </label>
                );
              })}
              {total > results.length && (
                <p className="px-5 py-2 text-tiny text-faint">
                  Showing {results.length} of {total}. Search to narrow down.
                </p>
              )}
            </>
          )}
        </div>

        {err && (
          <p className="border-t border-line px-5 py-2 text-sm text-danger-text">{err}</p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded border border-line-mid px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || picked.size === 0}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy
              ? "Adding…"
              : picked.size
                ? `Add ${picked.size} lead${picked.size === 1 ? "" : "s"}`
                : "Add leads"}
          </button>
        </div>
      </div>
    </div>
  );
}
