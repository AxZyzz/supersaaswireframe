"use client";

import { DAY_NAMES, SendWindow } from "@/lib/campaigns";

const select =
  "rounded border border-line-mid bg-surface px-2 py-1 text-sm outline-none focus:border-accent disabled:opacity-60";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Days + start/end hour of one send window (Learning Loop T17). The clock
 * (recipient or workspace time) is chosen once by the parent, because both arms
 * of a send-time test must read the same clock.
 */
export function WindowEditor({
  value,
  onChange,
  disabled,
  label,
}: {
  value: SendWindow;
  onChange: (w: SendWindow) => void;
  disabled?: boolean;
  label: string;
}) {
  function toggleDay(d: number) {
    const has = value.days.includes(d);
    // never leave zero days: the API refuses a window with nothing to send on
    if (has && value.days.length === 1) return;
    const days = has ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b);
    onChange({ ...value, days });
  }
  function setStart(h: number) {
    onChange({ ...value, startHour: h, endHour: value.endHour <= h ? Math.min(24, h + 1) : value.endHour });
  }
  function setEnd(h: number) {
    onChange({ ...value, endHour: h, startHour: value.startHour >= h ? Math.max(0, h - 1) : value.startHour });
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {DAY_NAMES.map((name, i) => {
          const d = i + 1;
          const on = value.days.includes(d);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggleDay(d)}
              className={`rounded border px-2 py-1 text-tiny font-medium disabled:opacity-60 ${
                on
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-mid bg-surface text-muted hover:bg-hover"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-tiny text-faint">
        <label className="flex items-center gap-1.5">
          From
          <select
            aria-label={`${label} start hour`}
            value={value.startHour}
            disabled={disabled}
            onChange={(e) => setStart(Number(e.target.value))}
            className={select}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          until
          <select
            aria-label={`${label} end hour`}
            value={value.endHour}
            disabled={disabled}
            onChange={(e) => setEnd(Number(e.target.value))}
            className={select}
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export function ClockSelect({
  value,
  onChange,
  disabled,
  workspaceZone,
}: {
  value: SendWindow["tzBasis"];
  onChange: (v: SendWindow["tzBasis"]) => void;
  disabled?: boolean;
  workspaceZone?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-tiny text-faint">
      Which clock
      <select
        aria-label="Which clock the window is read on"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SendWindow["tzBasis"])}
        className={select}
      >
        <option value="recipient">Each recipient&apos;s own local time</option>
        <option value="workspace">Our workspace time{workspaceZone ? ` (${workspaceZone})` : ""}</option>
      </select>
    </label>
  );
}
