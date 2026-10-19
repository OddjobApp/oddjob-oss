import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import { normalizeSession } from "./normalize.js";
import type { SessionListItem } from "../types/index.js";

// Match the Decision Dashboard's refresh cadence.
const BLOCKED_POLL_MS = 10_000;

/**
 * Blocked sessions for the Decision Dashboard integration widget.
 * Task 4.7 — Requirements 9.1, 9.5
 */
export function useBlockedSessions() {
  return useQuery<SessionListItem[]>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", { status: "blocked" }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/generation-sessions?status=blocked");
      const raw = await res.json();
      return Array.isArray(raw) ? raw.map(normalizeSession) : [];
    },
    refetchInterval: BLOCKED_POLL_MS,
  });
}
