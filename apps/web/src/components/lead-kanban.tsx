"use client";

import Link from "next/link";
import { useState } from "react";
import { Lead, SCORE_STYLES, updateLead } from "@/lib/leads";
import { StatusDot, useLeadStatuses } from "@/lib/lead-statuses";

/**
 * Status kanban. Columns = the default status set plus any custom statuses
 * present on the current leads. Drag a card to another column → PATCH status.
 */
export function LeadKanban({
  leads,
  onChange,
}: {
  leads: Lead[];
  onChange: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const statuses = useLeadStatuses();
  const columns = Array.from(
    new Set([...statuses.map((s) => s.name), ...leads.map((l) => l.status)]),
  );
  const colorOf = (name: string) => statuses.find((s) => s.name === name)?.color;

  async function drop(status: string) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    await updateLead(id, { status });
    onChange();
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const items = leads.filter((l) => l.status === col);
        return (
          <div
            key={col}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col);
            }}
            onDrop={() => void drop(col)}
            className={`flex w-64 shrink-0 flex-col rounded-lg border ${
              overCol === col
                ? "border-accent bg-accent-soft"
                : "border-line bg-panel"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2 text-sm font-medium capitalize text-ink">
              <span className="flex items-center gap-1.5">
                <StatusDot color={colorOf(col)} />
                {col}
              </span>
              <span className="rounded-full bg-surface px-1.5 text-tiny text-faint">
                {items.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {items.map((l) => (
                <div
                  key={l.id}
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  className="cursor-grab rounded border border-line bg-surface p-2.5 text-sm active:cursor-grabbing"
                >
                  <Link
                    href={`/leads/${l.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {[l.first_name, l.last_name].filter(Boolean).join(" ") ||
                      "Unnamed"}
                  </Link>
                  <div className="text-tiny text-muted">{l.company || "—"}</div>
                  {l.score && (
                    <span
                      className={`mt-1 inline-block rounded-full px-1.5 text-micro capitalize ${SCORE_STYLES[l.score]}`}
                    >
                      {l.score}
                    </span>
                  )}
                </div>
              ))}
              {items.length === 0 && (
                <p className="px-1 py-3 text-center text-tiny text-faint">
                  Drop here
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
