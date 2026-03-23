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

export function SSEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Map of event type → set of listeners. Stored in a ref so the EventSource
  // handler always sees the current set without needing to re-subscribe.
  const listenersRef = useRef<Map<string, Set<SSEListener>>>(new Map());

  useEffect(() => {
    if (!user) return;
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("access_token")
        : null;
    if (!token) return;

    const es = new EventSource(
      `/api/events/user?token=${encodeURIComponent(token)}`
    );

    es.onmessage = (e: MessageEvent) => {
      let event: { type: string; data?: unknown };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      const listeners = listenersRef.current.get(event.type);
      if (listeners) {
        listeners.forEach((l) => l(event.data));
      }
    };

    return () => es.close();
  }, [user?.id]); // re-open when the logged-in user changes

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
