"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Tags, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import {
  deleteLeadStatus,
  invalidateLeadStatuses,
  LeadStatus,
  listLeadStatuses,
  renameLeadStatus,
  saveLeadStatuses,
  STATUS_COLORS,
  StatusDot,
} from "@/lib/lead-statuses";

const field =
  "rounded border border-line-mid bg-surface px-2 py-1 text-sm outline-none focus:border-accent";

/**
 * Settings → Lead statuses (T2.3). System statuses are locked (reply
 * automation and conversion write them) but can be recoloured and moved.
 */
export function LeadStatusesSection({ canEdit }: { canEdit: boolean }) {
  const [list, setList] = useState<LeadStatus[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("blue");
  const [removing, setRemoving] = useState<{ name: string; moveTo: string } | null>(null);

  const load = useCallback(async () => setList(await listLeadStatuses()), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast(ok);
      invalidateLeadStatuses();
      await load();
    } catch (e) {
      toast(errorMessage(e, "Couldn't update statuses."), "error");
    }
  }

  const save = (next: LeadStatus[]) =>
    run(() => saveLeadStatuses(next.map(({ name, color }) => ({ name, color }))));

  function add() {
    const name = newName.trim();
    if (!name || !list) return;
    setNewName("");
    void save([...list, { name, color: newColor as LeadStatus["color"], system: false, count: 0 }]);
  }

  function move(i: number, d: -1 | 1) {
    if (!list) return;
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setList(next);
    void save(next);
  }

  if (!list) return null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-section font-semibold text-ink2">
        <Tags size={16} className="text-faint" /> Lead statuses
      </h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        The stages your leads move through — used in filters, the lead profile and the kanban
        board. Locked statuses are set automatically by replies and conversions.
      </p>
      <ul className="divide-y divide-line rounded border border-line">
        {list.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 px-3 py-2 text-sm">
            <StatusDot color={s.color} />
            {canEdit && !s.system ? (
              <input
                defaultValue={s.name}
                aria-label={`Rename ${s.name}`}
                onBlur={(e) => {
                  const to = e.target.value.trim();
                  if (to && to.toLowerCase() !== s.name) {
                    void run(() => renameLeadStatus(s.name, to), `Renamed to "${to.toLowerCase()}".`);
                  }
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={`${field} min-w-0 flex-1 capitalize`}
              />
            ) : (
              <span className="flex flex-1 items-center gap-1.5 capitalize text-ink">
                {s.name}
                {s.system && <Lock size={11} className="text-faint" aria-label="System status" />}
              </span>
            )}
            <span className="w-16 text-right text-tiny text-faint">
              {s.count} lead{s.count === 1 ? "" : "s"}
            </span>
            {canEdit && (
              <>
                <select
                  value={s.color}
                  aria-label={`Colour for ${s.name}`}
                  onChange={(e) => {
                    const next = list.map((x) =>
                      x.name === s.name ? { ...x, color: e.target.value as LeadStatus["color"] } : x,
                    );
                    setList(next);
                    void save(next);
                  }}
                  className={`${field} py-0.5 text-tiny`}
                >
                  {STATUS_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="text-faint hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === list.length - 1}
                  aria-label="Move down"
                  className="text-faint hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => setRemoving({ name: s.name, moveTo: "new" })}
                  disabled={s.system}
                  aria-label={`Delete ${s.name}`}
                  title={s.system ? "System statuses can't be deleted" : "Delete"}
                  className="text-faint hover:text-danger-text disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {removing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-danger-text/30 bg-danger-bg px-3 py-2 text-sm">
          <span className="text-ink">
            Delete <b className="capitalize">{removing.name}</b> and move its leads to
          </span>
          <select
            value={removing.moveTo}
            onChange={(e) => setRemoving({ ...removing, moveTo: e.target.value })}
            className={`${field} py-0.5`}
          >
            {list
              .filter((x) => x.name !== removing.name)
              .map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
          </select>
          <button
            onClick={() => {
              const r = removing;
              setRemoving(null);
              void run(() => deleteLeadStatus(r.name, r.moveTo), "Status deleted.");
            }}
            className="rounded bg-danger-text px-2.5 py-1 text-tiny font-medium text-white"
          >
            Delete
          </button>
          <button onClick={() => setRemoving(null)} className="text-tiny text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New status, e.g. Meeting booked"
            maxLength={40}
            className={`${field} min-w-0 flex-1`}
          />
          <select value={newColor} onChange={(e) => setNewColor(e.target.value)} className={field}>
            {STATUS_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={!newName.trim()}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      )}
    </section>
  );
}
