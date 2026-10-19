import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

/**
 * usePrefetch Hook
 * 
 * Provides a way to proactively fetch data before the user navigates.
 * Best used on mouseEnter or focus events of links/cards.
 */
export function usePrefetch() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(
    async (endpoint: string, params?: Record<string, any>) => {
      const queryKey = params ? [endpoint, params] : [endpoint];
      
      // Don't prefetch if we already have fresh data
      const queryState = queryClient.getQueryState(queryKey);
      if (queryState?.status === 'success' && (Date.now() - queryState.dataUpdatedAt < 30000)) {
        return;
      }

      await queryClient.prefetchQuery({
        queryKey,
        queryFn: async () => {
          const queryString = params
            ? Object.entries(params)
                .filter(([_, v]) => v !== undefined && v !== "")
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
                .join("&")
            : "";
          
          const url = queryString ? `${endpoint}?${queryString}` : endpoint;
          const res = await apiRequest("GET", url);
          return res.json();
        },
        staleTime: 1000 * 30, // Consider prefetched data fresh for 30s
      });
    },
    [queryClient]
  );

  return prefetch;
}

export default usePrefetch;
