"use client";

import { useEffect, useRef, useState } from "react";
import { wsUrl } from "./api";
import type { SocketMessage } from "./types";

/**
 * Subscribe to one event's live channel. Reconnects with backoff; if the socket is
 * down the page still works over plain HTTP — real-time is an enhancement only.
 */
export function useEventSocket(
  eventId: string,
  onMessage: (msg: SocketMessage) => void,
  token?: string | null,
): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      ws = new WebSocket(wsUrl(`/ws/events/${eventId}${qs}`));
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data) as SocketMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        attempt += 1;
        timer = setTimeout(open, Math.min(1000 * 2 ** attempt, 15000));
      };
    };
    open();

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [eventId, token]);

  return connected;
}
