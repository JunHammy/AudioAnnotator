"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";

type SSEListener = (data: unknown) => void;

interface SSEContextValue {
  /** Subscribe to a named event type. Returns an unsubscribe function. */
  on: (event: string, listener: SSEListener) => () => void;
}

const SSEContext = createContext<SSEContextValue>({ on: () => () => {} });

/**
 * Connect to an SSE endpoint using fetch + ReadableStream so that the
 * Authorization: Bearer header can be sent — no token in the URL.
 * Auto-reconnects with capped exponential backoff on network errors.
 */
async function connectSSE(
  url: string,
  token: string,
  onMessage: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`SSE ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by double newlines.
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) {
          onMessage(line.slice(5).trim());
        }
      }
    }
  }
}

export function SSEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const listenersRef = useRef<Map<string, Set<SSEListener>>>(new Map());

  useEffect(() => {
    if (!user) return;

    const abortController = new AbortController();
    let retryDelay = 1000;

    async function run() {
      while (!abortController.signal.aborted) {
        const token = localStorage.getItem("access_token");
        if (!token) break;

        try {
          await connectSSE(
            "/api/events/user",
            token,
            (raw) => {
              let event: { type: string; data?: unknown };
              try { event = JSON.parse(raw); } catch { return; }
              const listeners = listenersRef.current.get(event.type);
              if (listeners) listeners.forEach((l) => l(event.data));
            },
            abortController.signal,
          );
          // Stream ended cleanly — reconnect immediately.
          retryDelay = 1000;
        } catch (err: unknown) {
          if (abortController.signal.aborted) break;
          // 401 → token gone, stop retrying.
          if (err instanceof Error && err.message.includes("401")) break;
          // Back off up to 30 s on transient errors.
          await new Promise((r) => setTimeout(r, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      }
    }

    run();
    return () => abortController.abort();
  }, [user?.id]);

  const on: SSEContextValue["on"] = (event, listener) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(listener);
    return () => {
      listenersRef.current.get(event)?.delete(listener);
    };
  };

  return <SSEContext.Provider value={{ on }}>{children}</SSEContext.Provider>;
}

export function useSSE() {
  return useContext(SSEContext);
}
