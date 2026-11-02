"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoadError, loadErrorText } from "@/components/feedback";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { SCORE_STYLES } from "@/lib/leads";
import {
  getSegment,
  listSegmentMembers,
  refreshSegment,
  Segment,
  SegmentMember,
} from "@/lib/segments";

export default function SegmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [members, setMembers] = useState<SegmentMember[]>([]);
  const [total, setTotal] = useState(0);

  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [seg, mem] = await Promise.all([
        getSegment(id),
        listSegmentMembers(id),
      ]);
      setSegment(seg);
      setMembers(mem.data);
      setTotal(mem.total);
    } catch (e) {
      setErr(loadErrorText(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    await refreshSegment(id);
    setTimeout(() => void load(), 800);
  }

  if (err) return <LoadError message={err} onRetry={() => void load()} />;
  if (!segment) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-shell space-y-4">
      <Link
        href="/segments"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={14} /> Segments
      </Link>

      <div className="flex items-center">
        <div>
          <h1 className="text-title font-semibold text-ink2">{segment.name}</h1>
          <p className="text-sm text-muted">
            <span className="capitalize">{segment.type}</span> ·{" "}
            {segment.member_count} member{segment.member_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex-1" />
        {segment.type === "smart" && (
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No members{" "}
                  {segment.type === "smart" ? "match the rules yet." : "yet."}
                </td>
              </tr>
            ) : (
              members.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-line last:border-0 hover:bg-hover"
                >
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
      <p className="text-sm text-muted">{total} total</p>
    </div>
  );
}
