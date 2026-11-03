"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  Notification,
  notificationUnread,
} from "@/lib/notifications";
import { timeAgo } from "@/lib/analytics";
import { useLive } from "@/lib/realtime";

// Header notification center (T7.5). Polls the unread count; the live socket
// gateway (T7.2) will push instead.
export function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const tick = () =>
      notificationUnread()
        .then((r) => live && setUnread(r.unread))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Live: new notifications (and reads in other tabs) update the bell.
  useLive("notifications", () => {
    void notificationUnread()
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
    if (open) void listNotifications().then(setItems);
  });

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setItems(await listNotifications());
  }

  async function go(n: Notification) {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    await markAllNotificationsRead();
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => void toggle()}
        aria-label="Notifications"
        className="relative rounded p-1.5 text-muted hover:bg-hover hover:text-ink"
      >
        <Bell size={17} strokeWidth={1.9} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-micro font-medium leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold text-ink2">Notifications</span>
            {unread > 0 && (
              <button onClick={() => void readAll()} className="text-tiny text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void go(n)}
                  className={`block w-full border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-hover ${
                    n.read_at ? "" : "bg-accent-soft/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-sm ${n.read_at ? "text-ink" : "font-medium text-ink2"}`}>
                      {n.title}
                    </span>
                    <span className="shrink-0 text-tiny text-faint">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-tiny text-muted">{n.body}</p>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
