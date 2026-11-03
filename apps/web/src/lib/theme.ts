"use client";

/**
 * Light / dark / system theme (E9). The choice is a per-browser convenience
 * kept in localStorage; "system" follows the OS. THEME_INIT runs in <head>
 * before paint so there's no flash of the wrong theme.
 */
export type ThemeChoice = "system" | "light" | "dark";
const KEY = "ss.theme";

export const THEME_INIT = `(function(){try{var t=localStorage.getItem("${KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: still apply for this page view
  }
  applyTheme(choice);
}
