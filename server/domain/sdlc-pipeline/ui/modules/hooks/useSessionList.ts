import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESILIENT_QUERY } from "./query-config.js";
import { normalizeSession } from "./normalize.js";
import type { SessionListItem, SessionFilters } from "../types/index.js";

const LIST_POLL_MS = 15_000;

/**
 * Session list for the dashboard table. Polls every 15s while mounted.
 * Task 4.1 — Requirements 1.1, 1.3, 18.1
 */
export function useSessionList(filters?: Pick<SessionFilters, "status" | "templateId">) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.templateId) params.set("templateId", filters.templateId);
  const qs = params.toString();

  return useQuery<SessionListItem[]>({
    ...RESILIENT_QUERY,
    queryKey: ["/api/generation-sessions", { status: filters?.status, templateId: filters?.templateId }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/generation-sessions${qs ? `?${qs}` : ""}`);
      const raw = await res.json();
      return Array.isArray(raw) ? raw.map(normalizeSession) : [];
    },
    refetchInterval: LIST_POLL_MS,
  });
}
