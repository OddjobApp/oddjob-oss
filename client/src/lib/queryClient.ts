import { QueryClient } from "@tanstack/react-query";
import { ClientAppError, ErrorCode } from "./errors";
import { getPrefetchedResult } from "./prefetch-loader";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey, signal }) => {
        const url = queryKey[0] as string;
        if (typeof url !== 'string' || !url.startsWith('/')) {
          throw new Error(`Invalid query key for default fetch: ${url}`);
        }

        // Check the prefetch cache before making a network request.
        // If a fresh prefetched result exists, return it immediately.
        const prefetched = getPrefetchedResult('GET', url);
        if (prefetched !== null) {
          return prefetched;
        }

        const res = await apiRequest('GET', url, undefined, undefined, signal);
        return res.json();
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: false,
      staleTime: 1000 * 30, // 30 seconds
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
  },
});

export function getQueryClient() {
  return queryClient;
}

// Cache for CSRF token
let csrfTokenCache: string | null = null;
let isFetchingToken = false;
let authFailureTimestamp = 0;
const AUTH_COOLDOWN_MS = 30000;
const FETCH_TIMEOUT_MS = 300000; // 300s default timeout

async function fetchWithTimeout(url: string, options: any = {}) {
  const { timeout = FETCH_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  } finally {
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

async function getCsrfToken(): Promise<string | null> {
  const now = Date.now();
  if (now - authFailureTimestamp < AUTH_COOLDOWN_MS) return null;

  // Use cached token from the /api/user query cache
  const userData = queryClient.getQueryData(["/api/user"]);
  if (userData && typeof userData === 'object' && 'csrfToken' in userData) {
    csrfTokenCache = (userData as any).csrfToken;
    return csrfTokenCache;
  }

  if (isFetchingToken) return null;

  isFetchingToken = true;
  try {
    console.debug('[getCsrfToken] Fetching CSRF token from /api/user...');
    const res = await fetchWithTimeout('/api/user', { credentials: 'include', timeout: 5000 });
    if (res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await res.json();
        if (data.csrfToken) {
          csrfTokenCache = data.csrfToken;
          queryClient.setQueryData(["/api/user"], { ...data });
          return csrfTokenCache;
        }
      }
    } else if (res.status === 401) {
      authFailureTimestamp = Date.now();
    }
  } catch (e) {
    console.error('[getCsrfToken] Failed to fetch from /api/user:', e);
  }

  // Fallback: /api/csrf-token
  try {
    console.debug('[getCsrfToken] Fallback: Fetching from /api/csrf-token...');
    const res = await fetchWithTimeout('/api/csrf-token', { credentials: 'include', timeout: 5000 });
    if (res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await res.json();
        if (data.csrfToken) {
          csrfTokenCache = data.csrfToken;
          return csrfTokenCache;
        }
      }
    }
  } catch (e) {
    console.error('[getCsrfToken] Failed to fetch from /api/csrf-token:', e);
  } finally {
    isFetchingToken = false;
  }

  return null;
}

/**
 * The organization a request should run as: request URL > window location > session storage.
 *
 * Exported because anything that talks to the API WITHOUT going through apiRequest has
 * to agree with it. EventSource was the counter-example: the crew SSE stream opened
 * `/api/crew/<key>/stream` with no orgId, so the server fell back to the user's
 * default_org_id while every other call on the page sent the selected org. The room was
 * then CREATED under one org and read under another -- read paths call ensureSession,
 * which is find-or-create -- and the mismatch surfaced as "Room not in this
 * organization" for a room the user had just opened.
 *
 * Duplicating this precedence is what let the two drift apart, so there is one copy.
 */
export function resolveActiveOrgId(url?: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    if (url) {
      const target = new URL(url, window.location.origin);
      const fromUrl = target.searchParams.get('orgId') || target.searchParams.get('organizationId');
      if (fromUrl && !isNaN(parseInt(fromUrl, 10))) return parseInt(fromUrl, 10);
    }
    const windowParams = new URLSearchParams(window.location.search);
    const fromWindow = windowParams.get('orgId') || windowParams.get('organizationId');
    if (fromWindow && !isNaN(parseInt(fromWindow, 10))) return parseInt(fromWindow, 10);

    const stored = sessionStorage.getItem('selectedOrganizationId');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export async function apiRequest(method: string, url: string, body?: any, timeoutMs?: number, signal?: AbortSignal): Promise<Response> {
  let csrfToken: string | null = null;
  const shouldSkipCsrf = url.startsWith('/api/login');

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !shouldSkipCsrf) {
    try {
      csrfToken = await getCsrfToken();
    } catch (e) {
      console.warn('[apiRequest] Failed to fetch CSRF token:', e);
    }
  }

  const orgId = resolveActiveOrgId(url);

  let requestUrl = url;
  if (orgId !== null) {
    const urlObj = new URL(url, window.location.origin);
    if (!urlObj.searchParams.has('orgId')) {
      urlObj.searchParams.set('orgId', orgId.toString());
      requestUrl = urlObj.pathname + urlObj.search;
    }
  }

  // FormData must set its own multipart boundary, so leave Content-Type unset for it.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  if (orgId !== null) headers['x-organization-id'] = orgId.toString();

  console.debug(`[apiRequest] ${method} ${requestUrl}`);

  let response = await fetchWithTimeout(requestUrl, {
    method,
    headers,
    credentials: 'include',
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    timeout: timeoutMs ?? FETCH_TIMEOUT_MS,
    signal
  });

  // On 403, refresh CSRF token and retry once.
  if (response.status === 403 && csrfToken) {
    csrfTokenCache = null;
    try {
      const userRes = await fetchWithTimeout('/api/user', { credentials: 'include', timeout: 5000 });
      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.csrfToken) {
          csrfTokenCache = userData.csrfToken;
          headers['x-csrf-token'] = userData.csrfToken;
          response = await fetchWithTimeout(requestUrl, {
            method,
            headers,
            credentials: 'include',
            body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
            timeout: timeoutMs ?? FETCH_TIMEOUT_MS,
          });
        }
      }
    } catch (e) {
      console.error('[apiRequest] Failed to refresh CSRF token:', e);
    }
  }

  if (response.status === 401) {
    authFailureTimestamp = Date.now();
    csrfTokenCache = null;
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorDetails: any = null;
    let errorText = '';

    try {
      errorText = await response.text();
    } catch {}

    if (errorText?.trim()) {
      const trimmedErrorText = errorText.trim();
      const contentType = response.headers.get('content-type') || '';
      const looksLikeHtml = contentType.includes('text/html') || /^<!doctype html/i.test(trimmedErrorText) || /^<html[\s>]/i.test(trimmedErrorText);

      if (looksLikeHtml) {
        errorMessage = response.status === 503
          ? 'Oddjob is still starting. Try again in a moment.'
          : `HTTP ${response.status}: ${response.statusText || 'Unexpected HTML response'}`;
      } else {
        try {
          const errorJson = JSON.parse(trimmedErrorText);
          errorDetails = errorJson;
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          } else {
            const serverMessage = errorJson.details || errorJson.error || errorJson.message;
            if (serverMessage) {
              errorMessage = typeof serverMessage === 'string' ? serverMessage : (serverMessage.message || JSON.stringify(serverMessage));
            } else {
              errorMessage = JSON.stringify(errorJson, null, 2);
            }
          }
        } catch {
          errorMessage = trimmedErrorText;
        }
      }
    }

    let error: ClientAppError;
    if (errorDetails?.error?.code) {
      error = new ClientAppError(
        errorDetails.error.message || errorMessage,
        response.status,
        errorDetails.error.code,
        { details: errorDetails.error.details, correlationId: errorDetails.correlationId }
      );
    } else {
      error = new ClientAppError(errorMessage, response.status, ErrorCode.INTERNAL_ERROR, { details: errorDetails });
    }
    (error as any).rawResponse = errorText;
    throw error;
  }

  return response;
}
