import { useSyncExternalStore } from "react";
import { hasSessionHint } from "./api";

const subscribe = (onChange: () => void) => {
  // Another tab signing in/out updates the hint here too.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * "Probably signed in" for public pages (Open app vs. Sign up). False on the
 * server and during hydration, then the browser's real value, with no
 * hydration mismatch and no setState-in-effect.
 */
export function useSessionHint(): boolean {
  return useSyncExternalStore(subscribe, hasSessionHint, () => false);
}
