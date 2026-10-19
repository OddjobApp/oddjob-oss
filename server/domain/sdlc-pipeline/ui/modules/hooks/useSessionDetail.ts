import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import { normalizeSession } from "./normalize.js";
import type { GenerationSession } from "../types/index.js";
import { isTerminalStatus } from "./session-status.js";

const DETAIL_POLL_MS = 5_000;

/**
 * Single session detail. Polls every 5s until the session reaches a terminal state.
 * Task 4.2 — Requirements 3.1, 18.2, 18.3
 */
export function useSessionDetail(sessionId: string | undefined) {
  return useQuery<GenerationSession>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/generation-sessions/${sessionId}`);
      return normalizeSession(await res.json()) as unknown as GenerationSession;
    },
    refetchInterval: (query) =>
      isTerminalStatus(query.state.data?.status) ? false : DETAIL_POLL_MS,
  });
}
