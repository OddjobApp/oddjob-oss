/**
 * useApiQuery Hook
 * 
 * Standardized query hook that combines useQuery with apiRequest.
 * Provides consistent error handling and loading states.
 */

import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type UseApiQueryOptions<TData> = Omit<UseQueryOptions<TData, Error>, 'queryKey' | 'queryFn'> & {
  /** Whether the query should be enabled */
  enabled?: boolean;
};

export type UseApiQueryResult<TData> = UseQueryResult<TData, Error> & {
  /** Convenience property for empty data check */
  isEmpty: boolean;
};

/**
 * Standardized hook for API GET requests
 * 
 * @param endpoint - API endpoint (e.g., '/api/users')
 * @param params - Optional query parameters
 * @param options - Additional react-query options
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error, isEmpty } = useApiQuery<User[]>('/api/users');
 * 
 * // With query parameters
 * const { data } = useApiQuery<User[]>('/api/users', { role: 'admin' });
 * 
 * // With options
 * const { data } = useApiQuery<User[]>('/api/users', {}, { 
 *   enabled: !!userId,
 *   refetchInterval: 5000 
 * });
 * ```
 */
export function useApiQuery<TData = unknown>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: UseApiQueryOptions<TData>
): UseApiQueryResult<TData> {
  // Build query string from params
  const queryString = params
    ? Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    : '';

  const url = queryString ? `${endpoint}?${queryString}` : endpoint;

  const queryResult = useQuery<TData, Error>({
    queryKey: [endpoint, params],
    queryFn: async () => {
      const response = await apiRequest("GET", url);
      return response.json();
    },
    ...options,
  });

  return {
    ...queryResult,
    isEmpty: Array.isArray(queryResult.data)
      ? queryResult.data.length === 0
      : !queryResult.data,
  };
}

/**
 * Typed version for common data wrapper patterns
 * 
 * @example
 * ```tsx
 * // For API responses like { users: User[] }
 * const { data } = useApiQueryWithWrapper<{ users: User[] }>('/api/users');
 * const users = data?.users || [];
 * ```
 */
export function useApiQueryWithWrapper<TData extends Record<string, unknown>>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: UseApiQueryOptions<TData>
): UseApiQueryResult<TData> {
  return useApiQuery<TData>(endpoint, params, options);
}

export default useApiQuery;
