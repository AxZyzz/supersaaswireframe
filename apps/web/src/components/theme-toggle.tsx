"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, getTheme, setTheme, ThemeChoice } from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const ICON = { system: Monitor, light: Sun, dark: Moon };
const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

/** Header button cycling system → light → dark. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const current = getTheme();
    setChoice(current); // eslint-disable-line react-hooks/set-state-in-effect -- read once after mount (storage is client-only)
    // follow OS changes while on "system"
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => getTheme() === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const Icon = ICON[choice];
  return (
    <button
      onClick={() => {
        const next = NEXT[choice];
        setTheme(next);
        setChoice(next);
      }}
      title={`${LABEL[choice]} (click to change)`}
      aria-label={LABEL[choice]}
      className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"
    >
      <Icon size={15} />
    </button>
  );
}
