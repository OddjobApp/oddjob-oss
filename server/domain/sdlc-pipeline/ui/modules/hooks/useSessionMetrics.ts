import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import type { SessionMetrics, SessionStatus } from "../types/index.js";
import { isTerminalStatus } from "./session-status.js";

const METRICS_POLL_MS = 10_000;

/**
 * Cost/timing metrics for a session. Polls every 10s while non-terminal.
 * Pass the session's current status so polling stops on terminal states.
 * Task 4.3 — Requirements 6.1, 6.2, 18.2
 */
export function useSessionMetrics(sessionId: string | undefined, status?: SessionStatus) {
  return useQuery<SessionMetrics>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", sessionId, "metrics"],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/generation-sessions/${sessionId}/metrics`);
      return res.json();
    },
    refetchInterval: isTerminalStatus(status) ? false : METRICS_POLL_MS,
  });
}
