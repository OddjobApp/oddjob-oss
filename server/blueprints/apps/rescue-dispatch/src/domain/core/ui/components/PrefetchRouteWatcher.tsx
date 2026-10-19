import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { clearPrefetchCache, initPrefetch } from "@/lib/prefetch-loader";

/**
 * Debounce interval in milliseconds.
 * Prevents redundant manifest fetches during rapid navigation
 * (e.g., browser back/forward spam).
 */
const DEBOUNCE_MS = 150;

/**
 * PrefetchRouteWatcher
 *
 * Invisible component that listens to wouter route changes and re-triggers
 * prefetch for each new screen. Debounces rapid transitions to avoid
 * redundant manifest fetches.
 *
 * Mount this component once inside the router context (e.g., within Layout
 * or ProtectedRoutes) so it has access to the current location.
 */
export function PrefetchRouteWatcher() {
  const [location] = useLocation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPrefetchedRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip if this is the same path we already prefetched (initial render
    // is handled by main.tsx bootstrap, avoid duplicate on mount)
    if (lastPrefetchedRef.current === location) return;

    // Clear any pending debounced prefetch
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastPrefetchedRef.current = location;
      clearPrefetchCache();
      initPrefetch(location);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [location]);

  return null;
}
