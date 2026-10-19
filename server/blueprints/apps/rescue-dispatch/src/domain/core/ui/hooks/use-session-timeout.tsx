import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
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

export function useSessionTimeout() {
  const { user, logoutMutation } = useAuth();
  const [, setLocation] = useLocation();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (!user) {
      return;
    }

    const timeoutMinutes = getSessionTimeout();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    timeoutRef.current = setTimeout(() => {
      // Session expired - logout
      logoutMutation.mutate(undefined, {
        onSuccess: () => {
          setLocation('/auth/login');
        }
      });
    }, timeoutMs);

    lastActivityRef.current = Date.now();
  }, [user, logoutMutation, setLocation]);

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

