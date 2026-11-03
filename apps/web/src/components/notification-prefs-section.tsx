"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  getEmailNotificationPrefs,
  getNotificationPrefs,
  NotificationPref,
  setEmailNotificationPrefs,
  setNotificationPrefs,
} from "@/lib/notifications";

type Channel = "app" | "email";

function Switch({
  on,
  label,
  disabled,
  onClick,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors disabled:opacity-40 ${
        on ? "bg-accent" : "bg-line-faint"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/**
 * Per-member notification switches for this workspace: what shows in the
 * bell, and what also arrives by email (T7.5). An email only goes out for
 * notifications that are on in the app and still unread after a minute.
 */
export function NotificationPrefsSection() {
  const [app, setApp] = useState<NotificationPref[] | null>(null);
  const [email, setEmail] = useState<NotificationPref[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getNotificationPrefs().then(setApp);
    void getEmailNotificationPrefs().then(setEmail);
  }, []);

  async function toggle(channel: Channel, type: string) {
    const cur = channel === "app" ? app : email;
    const set = channel === "app" ? setApp : setEmail;
    if (!cur) return;
    const next = cur.map((p) => (p.type === type ? { ...p, enabled: !p.enabled } : p));
    set(next); // optimistic
    setSaving(true);
    const muted = next.filter((p) => !p.enabled).map((p) => p.type);
    try {
      set(
        await (channel === "app"
          ? setNotificationPrefs(muted)
          : setEmailNotificationPrefs(muted)),
      );
    } catch (e) {
      set(cur); // roll back; the global toaster shows why
      throw e;
    } finally {
      setSaving(false);
    }
  }

  if (!app || !email) return null;
  const inApp = new Map(app.map((p) => [p.type, p]));

  return (
    <section id="notifications" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Bell size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Notifications</h2>
        {saving && <span className="text-tiny text-faint">Saving…</span>}
      </div>
      <p className="mb-4 text-sm text-muted">
        What shows up in your notification bell for this workspace, and what also
        arrives by email (only if still unread a minute later). Only affects you.
      </p>
      <div className="flex items-center justify-end gap-6 border-b border-line pb-1.5 text-tiny uppercase tracking-wide text-faint">
        <span className="w-12 whitespace-nowrap text-center">In app</span>
        <span className="w-12 whitespace-nowrap text-center">Email</span>
      </div>
      <ul className="divide-y divide-line">
        {email.map((e) => {
          const a = inApp.get(e.type);
          return (
            <li key={e.type} className="flex items-center gap-6 py-2.5">
              <span className="flex-1 text-sm text-ink">{a?.label ?? e.label}</span>
              <span className="flex w-12 justify-center">
                {a ? (
                  <Switch
                    on={a.enabled}
                    label={`${a.label}: in app`}
                    onClick={() => void toggle("app", a.type)}
                  />
                ) : (
                  <span className="text-tiny text-faint">—</span>
                )}
              </span>
              <span className="flex w-12 justify-center">
                <Switch
                  on={e.enabled && (a ? a.enabled : true)}
                  disabled={a ? !a.enabled : false}
                  label={`${e.label}: email`}
                  onClick={() => void toggle("email", e.type)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
