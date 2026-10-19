import { useState, useEffect, useRef, useCallback } from "react";
import { compileTypeMatcher, subscribeEvents } from "../services/event-bus";

export interface OddjobEvent {
  eventId: string;
  eventType: string;
  timestamp: number;
  source: string;
  payload: Record<string, any>;
  context?: Record<string, any>;
}

export interface UseEventStreamOptions {
  /** Filter by event type(s). Supports wildcards like "forge.*" or "mission.**" */
  type?: string | string[];
  /** Filter by event source */
  source?: string;
  /** Number of recent events to fetch on connect for catch-up */
  recentLimit?: number;
  /** Whether to connect automatically */
  autoConnect?: boolean;
  /** Called when connection is established */
  onConnect?: () => void;
  /** Called when connection is lost */
  onDisconnect?: () => void;
  /** Called on connection error */
  onError?: (error: Event) => void;
}

export interface UseEventStreamReturn {
  /** All events received since connection */
  events: OddjobEvent[];
  /** Latest event received */
  lastEvent: OddjobEvent | null;
  /** Connection status */
  isConnected: boolean;
  /** Connection error if any */
  error: Error | null;
  /** Manually reconnect */
  reconnect: () => void;
  /** Disconnect manually */
  disconnect: () => void;
  /** Clear event buffer */
  clear: () => void;
}

/** Events a hook instance keeps; the old unbounded buffer grew for the life of the page. */
const MAX_BUFFERED_EVENTS = 500;

/**
 * React hook for subscribing to Oddjob's Server-Sent Events stream.
 *
 * Reads through the shared event bus: every instance, in every tab, shares one
 * connection (see services/shared-event-source.ts), so mounting this hook no
 * longer costs a connection from the browser's per-host pool.
 */
export function useEventStream(options: UseEventStreamOptions = {}): UseEventStreamReturn {
  const {
    type,
    source,
    recentLimit = 50,
    autoConnect = true,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const [events, setEvents] = useState<OddjobEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<OddjobEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [active, setActive] = useState(autoConnect);
  const [generation, setGeneration] = useState(0);

  // Callbacks are read through a ref so an inline arrow does not resubscribe.
  const callbacks = useRef({ onConnect, onDisconnect, onError });
  callbacks.current = { onConnect, onDisconnect, onError };

  const typeKey = Array.isArray(type) ? type.join(",") : type ?? "";
  const cap = Math.max(recentLimit, MAX_BUFFERED_EVENTS);

  useEffect(() => {
    if (!active) return;
    let wasOpen = false;
    const unsubscribe = subscribeEvents(
      { type: typeKey || undefined, source },
      (event) => {
        const oddjobEvent: OddjobEvent = {
          ...event,
          eventId: event.eventId || crypto.randomUUID(),
          timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.parse(event.timestamp) || Date.now(),
        };
        setEvents((prev) => {
          const next = [...prev, oddjobEvent];
          return next.length > cap ? next.slice(next.length - cap) : next;
        });
        setLastEvent(oddjobEvent);
      },
      (state) => {
        const open = state === "open";
        setIsConnected(open);
        if (open) {
          setError(null);
          callbacks.current.onConnect?.();
        } else if (wasOpen) {
          setError(new Error("EventSource connection error"));
          callbacks.current.onError?.(new Event("error"));
          callbacks.current.onDisconnect?.();
        }
        wasOpen = open;
      },
    );
    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [active, typeKey, source, cap, generation]);

  const disconnect = useCallback(() => setActive(false), []);

  const reconnect = useCallback(() => {
    setActive(true);
    setGeneration((g) => g + 1);
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  return {
    events,
    lastEvent,
    isConnected,
    error,
    reconnect,
    disconnect,
    clear,
  };
}

/**
 * Hook for filtering events by type pattern
 */
export function useFilteredEvents(
  events: OddjobEvent[],
  pattern: string | string[]
): OddjobEvent[] {
  const matches = compileTypeMatcher(pattern);
  return events.filter(event => matches(event.eventType));
}

/**
 * Hook for getting the latest event of a specific type
 */
export function useLatestEvent(
  events: OddjobEvent[],
  type: string
): OddjobEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].eventType === type) {
      return events[i];
    }
  }
  return null;
}

export default useEventStream;
