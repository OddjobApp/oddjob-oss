/**
 * Cycle Management Hooks
 * 
 * Custom hooks for data fetching and real-time updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useCycleStore } from './cycleStore';
import type { Cycle, Blueprint, AppStatus } from './types';
import { apiRequest } from '@/lib/queryClient';

const CYCLE_MANAGER_FETCH_TIMEOUT_MS = 15_000;

function getCycleBlueprints(cycle: Cycle | null | undefined): Blueprint[] {
  return Array.isArray(cycle?.metadata?.blueprints) ? cycle.metadata.blueprints : [];
}

/**
 * Hook for fetching cycle data
 */
export function useCycleData(cycleId: number, options: { enabled?: boolean; initialCycle?: Cycle | null } = {}) {
  const enabled = options.enabled ?? true;
  // Stabilize initialCycle via a ref so that a new object reference on each
  // render does NOT invalidate the useCallback and trigger an infinite refetch.
  const initialCycleRef = useRef<Cycle | null>(options.initialCycle ?? null);
  useEffect(() => {
    initialCycleRef.current = options.initialCycle ?? null;
  }, [options.initialCycle]);

  const initialCycle = initialCycleRef.current;
  const [cycle, setCycle] = useState<Cycle | null>(initialCycle);
  const [apps, setApps] = useState<Blueprint[]>(() => getCycleBlueprints(initialCycle));
  const [isLoading, setIsLoading] = useState(enabled && !initialCycle);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCycleData = useCallback(async () => {
    const initialCycle = initialCycleRef.current;
    if (!cycleId || !enabled) {
      if (initialCycle) {
        const fallbackApps = getCycleBlueprints(initialCycle);
        setCycle(initialCycle);
        setApps(fallbackApps);
        useCycleStore.getState().setCurrentCycle(initialCycle);
        useCycleStore.getState().setApps(fallbackApps);
      } else {
        setCycle(null);
        setApps([]);
      }
      setIsHydrated(false);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setIsHydrated(false);
      setError(null);

      const cycleRecord = initialCycle ?? await (async () => {
        const cycleResponse = await apiRequest('GET', `/api/cycles/${cycleId}`, undefined, CYCLE_MANAGER_FETCH_TIMEOUT_MS);
        const cycleData = await cycleResponse.json();
        return cycleData.cycle ?? cycleData;
      })();
      setCycle(cycleRecord);
      useCycleStore.getState().setCurrentCycle(cycleRecord);

      // The main cycle response already contains the blueprint plan. Render it
      // immediately, then hydrate richer app/runtime data in the background. A
      // temporarily slow /apps request must not blank the entire manager.
      const fallbackApps = getCycleBlueprints(cycleRecord);
      if (fallbackApps.length > 0) {
        setApps(fallbackApps);
        setIsLoading(false);
        useCycleStore.getState().setApps(fallbackApps);
      }

      try {
        const appsResponse = await apiRequest('GET', `/api/cycles/${cycleId}/apps`, undefined, CYCLE_MANAGER_FETCH_TIMEOUT_MS);
        const appsData = await appsResponse.json();
        const hydratedApps = Array.isArray(appsData) ? appsData : (appsData.apps || []);
        setApps(hydratedApps);
        setIsHydrated(true);
        useCycleStore.getState().setApps(hydratedApps);
      } catch (appsError) {
        if (fallbackApps.length === 0) throw appsError;
        console.warn('Cycle app hydration failed; using cycle blueprints:', appsError);
      }
      
    } catch (err: any) {
      // AbortError fires when the 15 s fetch timeout elapses or the component
      // unmounts mid-request. Surface a friendlier message instead of the raw
      // browser "signal is aborted without reason" string.
      if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('aborted')) {
        setError('The request timed out. The server may be busy — please retry.');
      } else {
        setError(err.message);
      }
      console.error('Error fetching cycle data:', err);
    } finally {
      setIsLoading(false);
    }
  // NOTE: initialCycle is intentionally omitted from deps — it is accessed via
  // initialCycleRef so that identity changes don't trigger spurious re-fetches.
  }, [cycleId, enabled]);

  useEffect(() => {
    if (enabled) {
      fetchCycleData();
    } else {
      const initialCycle = initialCycleRef.current;
      if (initialCycle) {
        const fallbackApps = getCycleBlueprints(initialCycle);
        setCycle(initialCycle);
        setApps(fallbackApps);
        useCycleStore.getState().setCurrentCycle(initialCycle);
        useCycleStore.getState().setApps(fallbackApps);
      }
      setIsHydrated(false);
      setIsLoading(false);
    }
  }, [fetchCycleData]);

  return { cycle, apps, isLoading, isHydrated, error, refetch: fetchCycleData };
}

/**
 * Hook for real-time updates via SSE
 */
export function useRealTimeUpdates(cycleId: number) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const { setCurrentCycle, setApps, setActiveAppIndex, autoAdvance } = useCycleStore();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!cycleId) {
      setConnected(false);
      return;
    }

    // Create EventSource connections
    const cycleEvents = new EventSource(`/api/cycles/${cycleId}/events`);
    const appEvents = new EventSource(`/api/cycles/${cycleId}/apps/events`);
    
    eventSourceRef.current = cycleEvents;
    
    // Handle cycle status changes
    cycleEvents.addEventListener('cycle.status_changed', (event) => {
      const data = JSON.parse(event.data);
      const currentCycle = useCycleStore.getState().currentCycle;
      if (currentCycle) {
        setCurrentCycle({ ...currentCycle, status: data.status });
      }
    });
    
    // Handle cycle progress updates
    cycleEvents.addEventListener('cycle.progress_updated', (event) => {
      const data = JSON.parse(event.data);
      // Update progress indicators in store if needed
    });
    
    // Handle app status changes
    appEvents.addEventListener('app.status_changed', (event) => {
      const data = JSON.parse(event.data);
      const currentApps = useCycleStore.getState().apps;
      const updatedApps = currentApps.map((app: Blueprint) => 
        app.name === data.appName 
          ? { ...app, status: data.status as AppStatus }
          : app
      );
      setApps(updatedApps);
      
      // Auto-advance to next app if enabled
      if (autoAdvance && data.status === 'completed') {
        const currentIndex = currentApps.findIndex((a: Blueprint) => a.name === data.appName);
        if (currentIndex !== -1 && currentIndex < currentApps.length - 1) {
          setActiveAppIndex(currentIndex + 1);
        }
      }
    });
    
    // Handle step changes
    appEvents.addEventListener('app.step_changed', (event) => {
      const data = JSON.parse(event.data);
      const currentApps = useCycleStore.getState().apps;
      const updatedApps = currentApps.map((app: Blueprint) =>
        app.name === data.appName
          ? { ...app, currentStep: data.stepIndex }
          : app
      );
      setApps(updatedApps);
    });
    
    // Handle connection status
    cycleEvents.onopen = () => setConnected(true);
    cycleEvents.onerror = () => setConnected(false);
    
    // Cleanup
    return () => {
      cycleEvents.close();
      appEvents.close();
    };
  }, [cycleId, setCurrentCycle, setApps, setActiveAppIndex, autoAdvance]);

  return { connected };
}

/**
 * Hook for cycle actions
 */
export function useCycleActions(cycleId: number) {
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pauseCycle = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/pause`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to pause cycle');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const resumeCycle = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/resume`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to resume cycle');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const abortCycle = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/abort`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to abort cycle');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  return { pauseCycle, resumeCycle, abortCycle, isMutating, error };
}

/**
 * Hook for app actions
 */
export function useAppActions(cycleId: number, appName: string) {
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startApp = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to start app');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const pauseApp = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/pause`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to pause app');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const resumeApp = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/resume`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to resume app');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const skipApp = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/skip`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to skip app');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const retryApp = async () => {
    try {
      setIsMutating(true);
      setError(null);
      
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to retry app');
      }
      
      const result = await response.json();
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const completeApp = async (output?: unknown) => {
    try {
      setIsMutating(true);
      setError(null);
      const response = await fetch(`/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output }),
      });
      if (!response.ok) throw new Error('Failed to complete app step');
      return await response.json();
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  return { startApp, pauseApp, resumeApp, skipApp, retryApp, completeApp, isMutating, error };
}
