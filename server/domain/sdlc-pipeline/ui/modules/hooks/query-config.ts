/**
 * Shared resilience options for the workbench's polling read queries (Task 10.1):
 * 3 retry attempts with exponential backoff (capped at 30s). Applied per-hook
 * rather than globally so the app-wide queryClient default (retry: false) is
 * unaffected. Stale-while-revalidate is provided by TanStack's default behavior
 * (cached data is retained during background refetches).
 */
export const RESILIENT_QUERY = {
  retry: 3,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
} as const;
