/**
 * Learning Loop T16: the operator console links to the Looker Studio learning
 * dashboard (built from docs/LOOKER-STUDIO.md). The link is a runtime setting,
 * LOOKER_DASHBOARD_URL, so it can be set or changed without rebuilding the web
 * app. Only a Looker Studio address is ever returned: anything else (a typo, a
 * pasted tracking link) shows as "not set" rather than becoming a link.
 */
const LOOKER_HOSTS = new Set([
  'lookerstudio.google.com',
  'datastudio.google.com',
]);

export function learningDashboardUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !LOOKER_HOSTS.has(u.hostname)) return null;
    // a link with credentials in it is never returned
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
