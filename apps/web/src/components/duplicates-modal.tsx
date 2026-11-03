"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  DuplicateGroup,
  findDuplicates,
  Lead,
  mergeLeads,
} from "@/lib/leads";

export function DuplicatesModal({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // primary lead id chosen per group (keyed by the first lead's id)
  const [primary, setPrimary] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const g = await findDuplicates();
      setGroups(g);
      setPrimary(
        Object.fromEntries(g.map((grp) => [grp.leads[0].id, grp.leads[0].id])),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const name = (l: Lead) =>
    [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed";

  async function merge(group: DuplicateGroup) {
    const key = group.leads[0].id;
    const primaryId = primary[key];
    const mergeIds = group.leads
      .map((l) => l.id)
      .filter((id) => id !== primaryId);
    setBusy(key);
    await mergeLeads(primaryId, mergeIds);
    setBusy(null);
    onMerged();
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-line bg-surface shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">
            Duplicate leads
          </h2>
          <button onClick={onClose} className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">Scanning…</p>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No duplicates found. Your list is clean.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Pick which record to keep — the others merge into it (their
                tags, notes, and history move over).
              </p>
              {groups.map((group) => {
                const key = group.leads[0].id;
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-line bg-panel p-3"
                  >
                    <div className="mb-2 space-y-1.5">
                      {group.leads.map((l) => (
                        <label
                          key={l.id}
                          className="flex items-center gap-2 rounded bg-surface px-2.5 py-1.5 text-sm"
                        >
                          <input
                            type="radio"
                            name={`primary-${key}`}
                            checked={primary[key] === l.id}
                            onChange={() =>
                              setPrimary((p) => ({ ...p, [key]: l.id }))
                            }
                          />
                          <span className="font-medium text-ink">
                            {name(l)}
                          </span>
                          <span className="text-muted">
                            {l.company || "—"}
                          </span>
                          <span className="text-faint">{l.email || "—"}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <button
                        disabled={busy === key}
                        onClick={() => void merge(group)}
                        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                      >
                        {busy === key ? "Merging…" : "Merge"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
