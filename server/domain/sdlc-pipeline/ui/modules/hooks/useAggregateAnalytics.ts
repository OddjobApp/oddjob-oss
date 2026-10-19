import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import type { AggregateAnalytics } from "../types/index.js";

/**
 * Aggregate quality/cost analytics for the metrics dashboard. No auto-polling —
 * the returned `refetch` drives manual refreshes. `since` is an ISO date string.
 * Task 4.6 — Requirements 20.1, 18.5
 */
export function useAggregateAnalytics(since?: string) {
  return useQuery<AggregateAnalytics>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", "analytics", since ?? null],
    queryFn: async () => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      const res = await apiRequest("GET", `/api/generation-sessions/analytics${qs}`);
      return res.json();
    },
    refetchInterval: false,
  });
}
