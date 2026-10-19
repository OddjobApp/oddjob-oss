/**
 * Prefetch Loader
 *
 * Client-side module that fetches the prefetch manifest early in the page lifecycle
 * and fires all listed API calls concurrently, storing results in a shared cache
 * for components to consume instead of making duplicate requests.
 *
 * All operations are gracefully fault-tolerant: errors never surface to the user
 * and the app continues functioning normally without prefetch.
 */

export interface PrefetchCacheEntry {
  data: any;
  fetchedAt: number; // Date.now() timestamp
}

interface PrefetchEndpointEntry {
  method: string;
  path: string;
  staticParams: Record<string, string>;
}

interface PrefetchManifest {
  screenPath: string;
  scope: string;
  generatedAt: string;
  endpoints: PrefetchEndpointEntry[];
}

/** Staleness threshold in milliseconds (30 seconds) */
const STALENESS_MS = 30_000;

/** Manifest fetch timeout in milliseconds (5 seconds) */
const MANIFEST_TIMEOUT_MS = 5_000;

/** Shared in-memory cache for prefetched results, keyed by "METHOD:path" */
const prefetchCache: Map<string, PrefetchCacheEntry> = new Map();

/**
 * Derive a cache key from method and path.
 */
function cacheKey(method: string, path: string): string {
  return `${method.toUpperCase()}:${path}`;
}

/**
 * Build a URL with static params appended as query parameters.
 */
function buildUrl(path: string, staticParams: Record<string, string>): string {
  const params = Object.entries(staticParams);
  if (params.length === 0) return path;
  const searchParams = new URLSearchParams(params);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${searchParams.toString()}`;
}

/**
 * Initialize prefetching for the current screen path.
 *
 * Fetches the manifest from the Manifest API, then fires all listed endpoint
 * calls concurrently, storing results in the shared cache.
 *
 * Graceful fallback behavior:
 * - Silently skips on manifest fetch error (4xx/5xx) or timeout (5s)
 * - Completes without firing requests for empty manifests (zero endpoints)
 * - Stores null for individual prefetch request failures
 * - Entire function wrapped in try/catch so script errors don't break the app
 * - No user-visible errors from any code path
 */
export function initPrefetch(screenPath: string): void {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);

    fetch(`/api/xray/prefetch-manifest?screen=${encodeURIComponent(screenPath)}`, {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((response) => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          // Silently skip on 4xx/5xx — components will fetch normally
          return;
        }
        return response.json();
      })
      .then((manifest: PrefetchManifest | undefined) => {
        if (!manifest || !manifest.endpoints || manifest.endpoints.length === 0) {
          // Empty manifest or no endpoints — nothing to prefetch
          return;
        }

        // Fire all endpoint calls concurrently
        const fetches = manifest.endpoints.map((endpoint) => {
          const key = cacheKey(endpoint.method, endpoint.path);
          const url = buildUrl(endpoint.path, endpoint.staticParams || {});

          return fetch(url, {
            method: endpoint.method,
            credentials: "same-origin",
          })
            .then((res) => {
              if (!res.ok) {
                // Individual request failure — store null so component fetches normally
                prefetchCache.set(key, { data: null, fetchedAt: Date.now() });
                return;
              }
              return res.json().then((data) => {
                prefetchCache.set(key, { data, fetchedAt: Date.now() });
              });
            })
            .catch(() => {
              // Network error on individual request — store null
              prefetchCache.set(key, { data: null, fetchedAt: Date.now() });
            });
        });

        // Wait for all fetches to settle (don't need to do anything with result)
        Promise.allSettled(fetches);
      })
      .catch(() => {
        // Manifest fetch failed (network error, abort/timeout, JSON parse error)
        // Silently skip — components will fetch through normal code paths
        clearTimeout(timeoutId);
      });
  } catch {
    // Top-level catch: script errors, missing dependencies, etc.
    // App continues without prefetch, no errors surfaced to the user
  }
}

/**
 * Check if a prefetched result exists and is fresh (< 30 seconds old).
 * Returns the cached data, or null if stale/missing/failed.
 */
export function getPrefetchedResult(method: string, path: string): any | null {
  const key = cacheKey(method, path);
  const entry = prefetchCache.get(key);

  if (!entry) return null;
  if (entry.data === null) return null;
  if (Date.now() - entry.fetchedAt >= STALENESS_MS) return null;

  return entry.data;
}

/**
 * Check if prefetch has a result for a given method and path (without returning it).
 * Returns true if an entry exists in the cache, regardless of staleness.
 */
export function hasPrefetchedResult(method: string, path: string): boolean {
  return prefetchCache.has(cacheKey(method, path));
}

/**
 * Clear all cached prefetch results.
 * Called on route transitions to reset the cache for the new screen.
 */
export function clearPrefetchCache(): void {
  prefetchCache.clear();
}
