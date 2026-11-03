"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadError, loadErrorText } from "@/components/feedback";
import { Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { SegmentCreateModal } from "@/components/segment-create-modal";
import {
  deleteSegment,
  listSegments,
  refreshSegment,
  Segment,
} from "@/lib/segments";
import { HelpLink } from "@/components/help-link";

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [err, setErr] = useState<string | null>(null);

  // `loading` starts true; the error clears once a (re)load succeeds.
  const fetchAndApply = useCallback(
    (isLive: () => boolean = () => true) =>
      listSegments()
        .then((s) => {
          if (!isLive()) return;
          setErr(null);
          setSegments(s);
        })
        .catch((e) => isLive() && setErr(loadErrorText(e)))
        .finally(() => isLive() && setLoading(false)),
    [],
  );
  const load = useCallback(() => fetchAndApply(), [fetchAndApply]);

  useEffect(() => {
    let live = true;
    void fetchAndApply(() => live);
    return () => {
      live = false;
    };
  }, [fetchAndApply]);

  async function refresh(id: string) {
    await refreshSegment(id);
    // give the worker a moment, then reload counts
    setTimeout(() => void load(), 800);
  }
  async function remove(id: string) {
    await deleteSegment(id);
    await load();
  }

  if (err) return <LoadError message={err} onRetry={() => void load()} />;

  return (
    <div className="mx-auto max-w-shell space-y-4">
      <div className="flex items-center">
        <h1 className="text-title font-semibold text-ink2">Segments</h1>
        <span className="ml-2"><HelpLink slug="segments" /></span>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={15} /> New segment
        </button>
      </div>

      {creating && (
        <SegmentCreateModal
          onClose={() => setCreating(false)}
          onCreated={() => void load()}
        />
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Members</th>
              <th className="px-4 py-2.5 font-medium">Refreshed</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : segments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No segments yet. Create one to group your leads.
                </td>
              </tr>
            ) : (
              segments.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-line last:border-0 hover:bg-hover"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/segments/${s.id}`}
                      className="flex items-center gap-2 font-medium text-ink hover:text-accent"
                    >
                      <Users size={14} className="text-faint" />
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-neut-bg px-2 py-0.5 text-tiny capitalize text-muted">
                      {s.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{s.member_count}</td>
                  <td className="px-4 py-2.5 text-tiny text-faint">
                    {s.last_refreshed_at
                      ? new Date(s.last_refreshed_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      {s.type === "smart" && (
                        <button
                          onClick={() => void refresh(s.id)}
                          title="Refresh"
                          className="text-faint hover:text-accent"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => void remove(s.id)}
                        title="Delete"
                        className="text-faint hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
