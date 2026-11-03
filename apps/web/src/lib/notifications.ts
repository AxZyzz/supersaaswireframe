import { api } from "./api";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export const listNotifications = () => api<Notification[]>("/notifications");

export const notificationUnread = () =>
  api<{ unread: number }>("/notifications/unread-count");

export const markNotificationRead = (id: string) =>
  api<{ read: boolean }>(`/notifications/${id}/read`, { method: "POST" });

export const markAllNotificationsRead = () =>
  api<{ marked: number }>("/notifications/read-all", { method: "POST" });

export interface NotificationPref {
  type: string;
  label: string;
  enabled: boolean;
}

export const getNotificationPrefs = () =>
  api<NotificationPref[]>("/notifications/preferences");

export const setNotificationPrefs = (muted: string[]) =>
  api<NotificationPref[]>("/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify({ muted }),
  });

/** Email channel (T7.5): same types plus "weekly_summary". */
export const getEmailNotificationPrefs = () =>
  api<NotificationPref[]>("/notifications/email-preferences");

export const setEmailNotificationPrefs = (muted: string[]) =>
  api<NotificationPref[]>("/notifications/email-preferences", {
    method: "PUT",
    body: JSON.stringify({ muted }),
  });
