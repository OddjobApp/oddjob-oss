import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import type { EventStreamResponse, PipelineLifecycleEvent, SessionStatus } from "../types/index.js";
import { isTerminalStatus } from "./session-status.js";

const EVENTS_POLL_MS = 3_000;

/**
 * Incremental lifecycle-event stream for a session. Maintains a local, ordered
 * event buffer and a cursor, fetching only events newer than the cursor. Polls
 * every 3s and stops once the session is terminal or a `session_completed`
 * event has been received.
 * Task 4.5 — Requirements 22.4, 22.5, 18.2, 18.3
 */
export function useSessionEvents(
  sessionId: string | undefined,
  options?: { status?: SessionStatus; enabled?: boolean },
) {
  const [events, setEvents] = useState<PipelineLifecycleEvent[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const lastProcessedCursor = useRef<string | null>(null);

  const terminalEventSeen = events.some((e) => e.eventType === "session_completed");
  const stopped = terminalEventSeen || isTerminalStatus(options?.status);

  const query = useQuery<EventStreamResponse>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", sessionId, "events", cursor],
    enabled: (options?.enabled ?? true) && !!sessionId,
    queryFn: async () => {
      const url = `/api/generation-sessions/${sessionId}/events${
        cursor ? `?since=${encodeURIComponent(cursor)}` : ""
      }`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    refetchInterval: stopped ? false : EVENTS_POLL_MS,
  });

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    // Guard against re-processing the same response (React strict-mode / re-renders).
    if (data.cursor === lastProcessedCursor.current) return;
    lastProcessedCursor.current = data.cursor;
    if (data.events.length > 0) {
      setEvents((prev) => [...prev, ...data.events]);
    }
    setCursor(data.cursor);
  }, [query.data]);

  return {
    events,
    cursor,
    stopped,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
