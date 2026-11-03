"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getAccessToken } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type LiveTopic = "inbox" | "notifications" | "campaigns" | "team";
export interface LiveEvent {
  type: LiveTopic;
  id?: string;
}

let socket: Socket | null = null;

/**
 * One shared socket per tab. `auth` is a callback so every (re)connect sends
 * the *current* access token — tokens rotate every 15 minutes. If the server
 * rejects us (expired token), we wait for the next REST call to refresh and
 * reconnect on the following attempt; polling fallbacks cover the gap.
 */
function getSocket(): Socket | null {
  if (typeof window === "undefined" || !getAccessToken()) return null;
  if (!socket) {
    socket = io(API_URL, {
      path: "/realtime",
      transports: ["websocket"],
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
    });
    socket.on("unauthorized", () => {
      // retry later with whatever token the REST layer has refreshed by then
      setTimeout(() => socket?.connect(), 15_000);
    });
  }
  return socket;
}

export function disconnectLive() {
  socket?.disconnect();
  socket = null;
}

/** Calls `onChange` whenever the server says `topic` changed. Events carry
 *  no data — refetch through the normal API (which enforces permissions). */
export function useLive(topic: LiveTopic, onChange: (e: LiveEvent) => void) {
  // Latest callback, updated after render (refs must not be written while
  // rendering) so the socket listener never calls a stale closure.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const listener = (e: LiveEvent) => {
      if (e.type === topic) handler.current(e);
    };
    s.on("change", listener);
    return () => {
      s.off("change", listener);
    };
  }, [topic]);
}
