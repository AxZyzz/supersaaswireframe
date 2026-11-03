"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  getNotificationPrefs,
  NotificationPref,
  setNotificationPrefs,
} from "@/lib/notifications";

/** Per-member mute switches for in-app notifications (this workspace only). */
export function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState<NotificationPref[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getNotificationPrefs().then(setPrefs);
  }, []);

  async function toggle(type: string) {
    if (!prefs) return;
    const next = prefs.map((p) => (p.type === type ? { ...p, enabled: !p.enabled } : p));
    setPrefs(next); // optimistic
    setSaving(true);
    try {
      setPrefs(await setNotificationPrefs(next.filter((p) => !p.enabled).map((p) => p.type)));
    } catch (e) {
      setPrefs(prefs); // roll back; the global toaster shows why
      throw e;
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Bell size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Notifications</h2>
        {saving && <span className="text-tiny text-faint">Saving…</span>}
      </div>
      <p className="mb-4 text-sm text-muted">
        Choose what shows up in your notification bell for this workspace. Only affects you.
      </p>
      <ul className="divide-y divide-line">
        {prefs.map((p) => (
          <li key={p.type} className="flex items-center justify-between py-2.5">
            <span className="text-sm text-ink">{p.label}</span>
            <button
              role="switch"
              aria-checked={p.enabled}
              aria-label={p.label}
              onClick={() => void toggle(p.type)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                p.enabled ? "bg-accent" : "bg-line-faint"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${
                  p.enabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
