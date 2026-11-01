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
