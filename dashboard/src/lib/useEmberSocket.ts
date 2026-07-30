/**
 * @file React hook for the Emberflow server's WebSocket feed (`WS_URL`,
 * ws://localhost:4100/ws). Maintains a single connection per mounted
 * component, parses incoming frames as `EmberEvent` JSON, and reconnects
 * with exponential backoff (capped at 15s) when the connection drops.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { WS_URL } from "./api";
import type { EmberEvent } from "./types";

/**
 * Connection state exposed by {@link useEmberSocket}. There is no distinct
 * "closed" state: the hook always retries, so a lost connection reports
 * `reconnecting` until the socket opens again.
 */
export type SocketStatus =
  | "connecting" // first attempt, nothing to worry about yet
  | "open"
  | "reconnecting"; // lost (or never got) the connection — retrying with backoff

const MAX_BACKOFF_MS = 15_000;

/**
 * Connects to the Emberflow WebSocket. Exposes the connection state and the last
 * event, and reconnects automatically with exponential backoff.
 *
 * Pass `onEvent` for anything where missing an event matters (log lines!) —
 * React may coalesce rapid `lastEvent` state updates, but the callback fires
 * once per message.
 */
export function useEmberSocket(onEvent?: (event: EmberEvent) => void) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<EmberEvent | null>(null);

  // Keep the latest callback in a ref so the socket effect never has to
  // re-run (re-running would tear down and reopen the connection).
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        retries = 0;
        setStatus("open");
      };

      ws.onmessage = (msg: MessageEvent) => {
        try {
          const event = JSON.parse(String(msg.data)) as EmberEvent;
          setLastEvent(event);
          onEventRef.current?.(event);
        } catch {
          // ignore malformed frames
        }
      };

      // onerror always precedes onclose; closing here funnels both paths
      // (failed connect + dropped connection) into the onclose handler.
      ws.onerror = () => ws?.close();

      ws.onclose = () => {
        if (disposed) return;
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** retries, MAX_BACKOFF_MS);
        retries += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { status, lastEvent };
}
