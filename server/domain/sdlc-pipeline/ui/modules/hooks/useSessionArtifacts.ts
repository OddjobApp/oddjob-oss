import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import type { ArtifactLineage } from "../types/index.js";

/**
 * Artifact lineage (grouped by phase) for a session.
 * Task 4.4 — Requirements 15.1, 19.1
 */
export function useSessionArtifacts(sessionId: string | undefined) {
  return useQuery<ArtifactLineage>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", sessionId, "artifacts"],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/generation-sessions/${sessionId}/artifacts`);
      return res.json();
    },
  });
}
