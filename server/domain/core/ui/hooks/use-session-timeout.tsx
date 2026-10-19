import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";

const SESSION_TIMEOUT_KEY = 'sessionTimeoutMinutes';
const DEFAULT_TIMEOUT = 20; // minutes

export function getSessionTimeout(): number {
  const stored = localStorage.getItem(SESSION_TIMEOUT_KEY);
  if (stored) {
    const minutes = parseInt(stored, 10);
    // Enforce a minimum of 5 minutes and absolute sanity check
    if (!isNaN(minutes) && minutes >= 5) {
      return minutes;
    }
  }
  return DEFAULT_TIMEOUT;
}

export function setSessionTimeout(minutes: number): void {
  localStorage.setItem(SESSION_TIMEOUT_KEY, minutes.toString());
}

/**
 * How often real user activity is reported to the server.
 *
 * The server expires a session after SESSION_IDLE_TIMEOUT_MINUTES without any
 * request. Without this ping, "idle" server-side would mean "made no HTTP
 * request", not "was not using the app" — and those differ: react-query runs
 * with refetchOnWindowFocus:false and a 30s staleTime, so someone reading one
 * page can sit there generating no traffic at all and be logged out while
 * present. Pinging on activity makes the server's notion of idleness match the
 * user's.
 */
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

export function useSessionTimeout() {
  const { user, logoutMutation } = useAuth();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastPingRef = useRef<number>(0);

  /**
   * Tell the server the user is still here. GET /api/user is already the
   * session probe and is cheap, so it doubles as the keepalive — the idle
   * middleware stamps `lastSeenAt` from any authenticated request. Throttled,
   * and failures are ignored: a missed ping only risks an early expiry, which
   * lands the user on the login page rather than breaking anything.
   */
  const pingServer = useCallback(() => {
    const now = Date.now();
    if (now - lastPingRef.current < KEEPALIVE_INTERVAL_MS) return;
    lastPingRef.current = now;
    fetch('/api/user', { credentials: 'include' }).catch(() => {});
  }, []);

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (!user) {
      return;
    }

    pingServer();

    const timeoutMinutes = getSessionTimeout();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    timeoutRef.current = setTimeout(() => {
      const returnTo = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      const loginUrl = `/auth/login?returnTo=${returnTo}`;

      // Redirect on SETTLED, not on success.
      //
      // The case that matters most is the one where the server session has
      // already gone (expired, pruned, or revoked): POST /api/logout then
      // answers 401, apiRequest throws, the mutation lands in onError, and a
      // success-only redirect leaves the user sitting on a stale,
      // authenticated-looking page with a "Logout failed" toast — the exact
      // opposite of being returned to the login page.
      //
      // A full page load rather than wouter's setLocation: /auth/* is served by
      // a SEPARATE SPA entry (login.html — see server/vite.ts), so a client-side
      // navigation only rewrites the URL inside the current router and never
      // loads the login app. Every other login redirect in the codebase
      // (use-auth, Layout, AppSidebar) uses window.location for this reason.
      logoutMutation.mutate(undefined, {
        onSettled: () => {
          window.location.href = loginUrl;
        }
      });
    }, timeoutMs);

    lastActivityRef.current = Date.now();
  }, [user, logoutMutation, pingServer]);

  useEffect(() => {
    if (!user) {
      // Clear timeout if user is not logged in
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Set up activity listeners
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
      'keydown'
    ];

    // Throttle activity tracking to avoid excessive resets
    // Only reset timer if at least 1 second has passed since last reset
    let activityThrottle: NodeJS.Timeout | null = null;
    const throttledHandleActivity = () => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityRef.current;

      // Only reset if more than 1 second has passed since last activity
      if (timeSinceLastActivity > 1000) {
        if (activityThrottle) {
          clearTimeout(activityThrottle);
        }
        // Debounce: wait a bit before actually resetting to avoid rapid resets
        activityThrottle = setTimeout(() => {
          resetTimer();
        }, 500);
      }
    };

    events.forEach(event => {
      window.addEventListener(event, throttledHandleActivity, { passive: true });
    });

    // Initialize timer
    resetTimer();

    // Cleanup
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, throttledHandleActivity);
      });
      if (activityThrottle) {
        clearTimeout(activityThrottle);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [user, resetTimer]);

  return {
    resetTimer,
    getRemainingTime: () => {
      if (!user || !timeoutRef.current) return 0;
      const timeoutMinutes = getSessionTimeout();
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const elapsed = Date.now() - lastActivityRef.current;
      return Math.max(0, timeoutMs - elapsed);
    }
  };
}

