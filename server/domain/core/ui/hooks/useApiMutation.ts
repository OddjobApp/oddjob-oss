/**
 * useApiMutation Hook
 * 
 * Standardized mutation hook that combines useMutation with apiRequest.
 * Provides consistent error handling, toast notifications, and cache invalidation.
 */

import { useMutation, useQueryClient, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type UseApiMutationOptions<TData, TVariables> = UseMutationOptions<TData, Error, TVariables> & {
  /** Toast message on success */
  successMessage?: string | ((data: TData) => string);
  /** Toast message on error */
  errorMessage?: string | ((error: Error) => string);
  /** Query keys to invalidate on success */
  invalidateKeys?: string[];
  /** Whether to show toast on success (default: true if successMessage provided) */
  showSuccessToast?: boolean;
  /** Whether to show toast on error (default: true) */
  showErrorToast?: boolean;
  onSuccess?: (data: TData, variables: TVariables, context: any) => void;
  onError?: (error: Error, variables: TVariables, context: any) => void;
  /** Configuration for optimistic updates */
  optimisticConfig?: {
    /** The query keys that should be optimistically updated */
    queryKey: any[];
    /** Function to transform the existing data with the current variables */
    updateFn: (oldData: any, variables: TVariables) => any;
  };
};

export type UseApiMutationResult<TData, TVariables> = UseMutationResult<TData, Error, TVariables> & {
  /** Convenience method that returns a promise */
  execute: (variables: TVariables) => Promise<TData>;
};

/**
 * Standardized hook for API mutations (POST, PUT, PATCH, DELETE)
 * 
 * @param method - HTTP method
 * @param endpoint - API endpoint or function to generate endpoint from variables
 * @param options - Mutation options including toast messages and cache invalidation
 * 
 * @example
 * ```tsx
 * // Simple POST
 * const createUser = useApiMutation<User, CreateUserInput>('POST', '/api/users', {
 *   successMessage: 'User created successfully',
 *   invalidateKeys: ['/api/users'],
 * });
 * await createUser.execute({ name: 'John', email: 'john@example.com' });
 * 
 * // Dynamic endpoint
 * const updateUser = useApiMutation<User, { id: number; data: Partial<User> }>(
 *   'PATCH',
 *   (vars) => `/api/users/${vars.id}`,
 *   {
 *     successMessage: 'User updated',
 *     invalidateKeys: ['/api/users'],
 *   }
 * );
 * await updateUser.execute({ id: 1, data: { name: 'Jane' } });
 * 
 * // DELETE
 * const deleteUser = useApiMutation<void, number>('DELETE', (id) => `/api/users/${id}`, {
 *   successMessage: 'User deleted',
 *   invalidateKeys: ['/api/users'],
 * });
 * await deleteUser.execute(userId);
 * ```
 */
export function useApiMutation<TData = unknown, TVariables = unknown>(
  method: HttpMethod,
  endpoint: string | ((variables: TVariables) => string),
  options?: UseApiMutationOptions<TData, TVariables>
): UseApiMutationResult<TData, TVariables> {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    successMessage,
    errorMessage,
    invalidateKeys,
    showSuccessToast = !!successMessage,
    showErrorToast = true,
    onSuccess,
    onError,
    optimisticConfig,
    ...mutationOptions
  } = options || {};

  const mutation = useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const url = typeof endpoint === 'function' ? endpoint(variables) : endpoint;

      // For DELETE, don't send body. For others, extract data from variables.
      let body: unknown = variables;

      // Handle cases where variables is an object with id and data
      if (typeof variables === 'object' && variables !== null && 'data' in variables) {
        body = (variables as { data: unknown }).data;
      }

      // Don't send body for DELETE requests
      const response = method === 'DELETE'
        ? await apiRequest(method, url)
        : await apiRequest(method, url, body);

      // Handle empty responses (204 No Content)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return undefined as TData;
      }

      return response.json();
    },
    onMutate: async (variables: TVariables) => {
      // If we have an optimistic config, perform the update
      if (optimisticConfig) {
        // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
        await queryClient.cancelQueries({ queryKey: optimisticConfig.queryKey });

        // Snapshot the previous value
        const previousData = queryClient.getQueryData(optimisticConfig.queryKey);

        // Optimistically update to the new value
        queryClient.setQueryData(optimisticConfig.queryKey, (old: any) => 
          optimisticConfig.updateFn(old, variables)
        );

        // Return a context object with the snapshotted value
        return { previousData };
      }
      return {};
    },
    onSuccess: (data, variables, context) => {
      // Show success toast
      if (showSuccessToast && successMessage) {
        const message = typeof successMessage === 'function'
          ? successMessage(data)
          : successMessage;
        toast({ title: "Success", description: message });
      }

      // Invalidate queries
      if (invalidateKeys?.length) {
        invalidateKeys.forEach(key => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      }

      // Call original onSuccess
      onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      // Show error toast
      if (showErrorToast) {
        const message = errorMessage
          ? (typeof errorMessage === 'function' ? errorMessage(error) : errorMessage)
          : error.message || 'An error occurred';
        toast({
          title: "Error",
          description: message,
          variant: "destructive"
        });
      }

      // If we have an optimistic config, roll back
      if (optimisticConfig && (context as any)?.previousData) {
        queryClient.setQueryData(optimisticConfig.queryKey, (context as any).previousData);
      }

      // Call original onError
      onError?.(error, variables, context);
    },
    onSettled: (data, error, variables, context) => {
      // If we have an optimistic config, invalidate to ensure we have the real data
      if (optimisticConfig) {
        queryClient.invalidateQueries({ queryKey: optimisticConfig.queryKey });
      }
    },
    ...mutationOptions,
  });

  return {
    ...mutation,
    execute: async (variables: TVariables) => {
      return mutation.mutateAsync(variables);
    },
  };
}

/**
 * Convenience hook for POST requests
 */
export function useApiPost<TData = unknown, TVariables = unknown>(
  endpoint: string | ((variables: TVariables) => string),
  options?: UseApiMutationOptions<TData, TVariables>
) {
  return useApiMutation<TData, TVariables>('POST', endpoint, options);
}

/**
 * Convenience hook for PUT requests
 */
export function useApiPut<TData = unknown, TVariables = unknown>(
  endpoint: string | ((variables: TVariables) => string),
  options?: UseApiMutationOptions<TData, TVariables>
) {
  return useApiMutation<TData, TVariables>('PUT', endpoint, options);
}

/**
 * Convenience hook for PATCH requests
 */
export function useApiPatch<TData = unknown, TVariables = unknown>(
  endpoint: string | ((variables: TVariables) => string),
  options?: UseApiMutationOptions<TData, TVariables>
) {
  return useApiMutation<TData, TVariables>('PATCH', endpoint, options);
}

/**
 * Convenience hook for DELETE requests
 */
export function useApiDelete<TData = unknown, TVariables = unknown>(
  endpoint: string | ((variables: TVariables) => string),
  options?: UseApiMutationOptions<TData, TVariables>
) {
  return useApiMutation<TData, TVariables>('DELETE', endpoint, options);
}

export default useApiMutation;

