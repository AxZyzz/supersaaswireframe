"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { getTheme, onThemeChange, setTheme, ThemeChoice } from "@/lib/theme";

/** Fixed preview colours: each card shows its own theme, whatever is active. */
const LIGHT = { bg: "#ffffff", side: "#fbfbfb", line: "#ebebeb", text: "#333333", faint: "#d6d6d6", accent: "#3e63dd" };
const DARK = { bg: "#171717", side: "#1d1d1d", line: "#2e2e2e", text: "#ebebeb", faint: "#3d3d3d", accent: "#6b8cff" };

function Mini({ c }: { c: typeof LIGHT }) {
  return (
    <div className="flex h-full w-full" style={{ background: c.bg }}>
      <div className="w-1/4 border-r p-1.5" style={{ background: c.side, borderColor: c.line }}>
        <div className="mb-1 h-1.5 w-3/4 rounded-sm" style={{ background: c.accent }} />
        <div className="mb-1 h-1 w-full rounded-sm" style={{ background: c.faint }} />
        <div className="h-1 w-2/3 rounded-sm" style={{ background: c.faint }} />
      </div>
      <div className="flex-1 p-2">
        <div className="mb-1.5 h-1.5 w-1/2 rounded-sm" style={{ background: c.text }} />
        <div className="mb-1 h-1 w-full rounded-sm" style={{ background: c.faint }} />
        <div className="mb-2 h-1 w-5/6 rounded-sm" style={{ background: c.faint }} />
        <div className="h-2.5 w-1/3 rounded-sm" style={{ background: c.accent }} />
      </div>
    </div>
  );
}

const OPTIONS: {
  value: ThemeChoice;
  label: string;
  hint: string;
  icon: typeof Sun;
  preview: React.ReactNode;
}[] = [
  {
    value: "light",
    label: "Light",
    hint: "Clean white workspace (Twenty CRM style)",
    icon: Sun,
    preview: <Mini c={LIGHT} />,
  },
  { value: "dark", label: "Dark", hint: "Easier on the eyes at night", icon: Moon, preview: <Mini c={DARK} /> },
  {
    value: "system",
    label: "System",
    hint: "Follows your computer's setting",
    icon: Monitor,
    preview: (
      <div className="flex h-full w-full">
        <div className="w-1/2 overflow-hidden">
          <div className="h-full w-[200%]">
            <Mini c={LIGHT} />
          </div>
        </div>
        <div className="w-1/2 overflow-hidden">
          <div className="-ml-[100%] h-full w-[200%]">
            <Mini c={DARK} />
          </div>
        </div>
      </div>
    ),
  },
];

/** Settings → Appearance: light / dark / system, saved per browser. */
export function AppearanceSection() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(getTheme()); // eslint-disable-line react-hooks/set-state-in-effect -- read once after mount (storage is client-only)
    return onThemeChange(setChoice); // stay in sync with the header toggle
  }, []);

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink2">Appearance</h2>
      <p className="mb-4 text-sm text-muted">
        Choose how Expelly looks in this browser. You can also switch from the icon in the top bar.
      </p>
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = choice === o.value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              aria-label={`${o.label} theme: ${o.hint}`}
              onClick={() => {
                setTheme(o.value);
                setChoice(o.value);
              }}
              className={`overflow-hidden rounded-lg border text-left transition-colors ${
                active
                  ? "border-accent ring-2 ring-accent-soft2"
                  : "border-line hover:border-line-mid"
              }`}
            >
              <div className="h-20 border-b border-line">{o.preview}</div>
              <div className="flex items-start gap-2 p-3">
                <Icon size={15} className={active ? "mt-0.5 text-accent" : "mt-0.5 text-muted"} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink2">{o.label}</div>
                  <div className="text-tiny text-muted">{o.hint}</div>
                </div>
                {active && <Check size={15} className="mt-0.5 text-accent" />}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
