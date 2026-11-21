'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { getLoopHealth, LoopHealth, pctOf } from '@/lib/loop-health';

const TONE = {
  ok: 'bg-success-bg text-success-text',
  warn: 'bg-warning-bg text-warning-text',
  bad: 'bg-danger-bg text-danger-text',
  neutral: 'bg-neut-bg text-muted',
} as const;
type Tone = keyof typeof TONE;

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-tiny font-medium ${TONE[tone]}`}
      data-tone={tone}
    >
      {label}: <strong>{value}</strong>
    </span>
  );
}

/**
 * "Loop health": the counts that say whether the data feeding Review and
 * Insights can be trusted (T13). Red items link to what needs fixing. Hidden
 * until there is a running test to watch.
 */
export function LoopHealthStrip() {
  const [h, setH] = useState<LoopHealth | null>(null);

  useEffect(() => {
    let live = true;
    getLoopHealth()
      .then((r) => live && setH(r))
      .catch(() => live && setH(null));
    return () => {
      live = false;
    };
  }, []);

  if (!h || (h.experiments.length === 0 && h.problems.length === 0))
    return null;

  const coverages = h.experiments
    .map((e) => e.coverage)
    .filter((c): c is number => c !== null);
  const minCoverage = coverages.length ? Math.min(...coverages) : null;
  const srmChecked = h.experiments.filter((e) => e.srmP !== null);
  const srmBad = srmChecked.filter((e) => (e.srmP ?? 1) < 0.001).length;
  const gateTotal = Object.values(h.gateFailures).reduce((a, b) => a + b, 0);
  const headline =
    h.status === 'ok'
      ? 'Loop health: OK'
      : h.status === 'warn'
        ? 'Loop health: worth a look'
        : 'Loop health: needs attention';

  return (
    <section
      aria-label="Loop health"
      data-status={h.status}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Activity size={16} className="text-accent" />
        <h2 className="mr-1 text-sm font-semibold text-ink2">{headline}</h2>
        <Chip
          label="Outcome coverage"
          value={pctOf(minCoverage)}
          tone={
            minCoverage === null ? 'neutral' : minCoverage < 0.9 ? 'bad' : 'ok'
          }
        />
        <Chip
          label="Split"
          value={
            srmChecked.length === 0
              ? 'not checked'
              : srmBad > 0
                ? `${srmBad} off plan`
                : 'as planned'
          }
          tone={srmChecked.length === 0 ? 'neutral' : srmBad > 0 ? 'bad' : 'ok'}
        />
        <Chip
          label="Stuck actions"
          value={String(h.stuckActions)}
          tone={h.stuckActions > 0 ? 'bad' : 'ok'}
        />
        <Chip
          label="Unattributed replies (7 days)"
          value={String(h.unattributed7d)}
          tone={h.unattributed7d > 0 ? 'warn' : 'ok'}
        />
        <Chip label="Failed checks" value={String(gateTotal)} tone="neutral" />
        <Chip
          label="Search fill"
          value={pctOf(h.allocation.avgFill)}
          tone={
            h.allocation.avgFill !== null && h.allocation.avgFill < 0.5
              ? 'warn'
              : 'neutral'
          }
        />
        {h.preferencesExpiringSoon.length > 0 && (
          <Chip
            label="Preferences ending soon"
            value={String(h.preferencesExpiringSoon.length)}
            tone="neutral"
          />
        )}
      </div>
      {h.problems.length > 0 && (
        <ul
          className="mt-3 space-y-1 text-sm"
          aria-label="Loop health problems"
        >
          {h.problems.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  p.severity === 'bad'
                    ? 'bg-danger-text'
                    : p.severity === 'warn'
                      ? 'bg-warning-text'
                      : 'bg-faint'
                }`}
                aria-hidden
              />
              <span className="text-ink">
                {p.message}{' '}
                {p.link && (
                  <Link href={p.link} className="text-accent hover:underline">
                    Look at it
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
