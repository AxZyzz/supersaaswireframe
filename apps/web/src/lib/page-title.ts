// Top-bar title for each app route (prefix match, first hit wins). Pure so it
// can be unit-tested; every sidebar entry needs a row here or the header
// falls back to "Dashboard".
export const TITLES: [string, string][] = [
  ["/discover", "Discover"],
  ["/leads", "Leads"],
  ["/campaigns", "Campaigns"],
  ["/segments", "Segments"],
  ["/inbox", "Inbox"],
  ["/templates", "Templates"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
  ["/help", "Help"],
  ["/operator", "Operator console"],
  ["/dashboard", "Dashboard"],
];

export function pageTitle(pathname: string): string {
  return TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Dashboard";
}
