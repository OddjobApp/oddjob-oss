import { useState, useEffect, useRef, useCallback } from "react";

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

/**
 * React hook for subscribing to Oddjob's Server-Sent Events stream.
 * Provides real-time event streaming with automatic reconnection.
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

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (type) {
      const types = Array.isArray(type) ? type : [type];
      params.append("type", types.join(","));
    }
    if (source) params.append("source", source);
    if (recentLimit) params.append("limit", String(recentLimit));
    return `/api/events/stream?${params.toString()}`;
  }, [type, source, recentLimit]);

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = buildUrl();
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle special events
        if (event.lastEventId === "recent" || data.events) {
          // Recent events batch on connect
          const recentEvents: OddjobEvent[] = data.events || [];
          setEvents(prev => [...recentEvents, ...prev]);
          if (recentEvents.length > 0) {
            setLastEvent(recentEvents[recentEvents.length - 1]);
          }
          return;
        }

        if (event.lastEventId === "connected") {
          // Connection established event
          return;
        }

        // Regular event
        const oddjobEvent: OddjobEvent = {
          eventId: data.eventId || crypto.randomUUID(),
          eventType: data.eventType || event.type || "unknown",
          timestamp: data.timestamp || Date.now(),
          source: data.source || "system",
          payload: data.payload || data,
          context: data.context,
        };

        setEvents(prev => [...prev, oddjobEvent]);
        setLastEvent(oddjobEvent);
      } catch (e) {
        console.error("[useEventStream] Failed to parse event:", e);
      }
    };

    es.onerror = (err) => {
      setIsConnected(false);
      setError(new Error("EventSource connection error"));
      onError?.(err as Event);
      onDisconnect?.();

      // Auto-reconnect with exponential backoff
      const maxDelay = 30000;
      const baseDelay = 1000;
      const delay = Math.min(baseDelay * Math.pow(2, reconnectAttemptsRef.current), maxDelay);
      reconnectAttemptsRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [buildUrl, onConnect, onDisconnect, onError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    disconnect();
    connect();
  }, [connect, disconnect]);

  const clear = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  // Connect on mount if autoConnect is true
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Reconnect when filter options change
  useEffect(() => {
    if (isConnected) {
      reconnect();
    }
  }, [type, source]);

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
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  
  return events.filter(event => {
    return patterns.some(p => {
      if (p.includes("*")) {
        const regex = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^.]*") + "$");
        return regex.test(event.eventType);
      }
      return event.eventType === p;
    });
  });
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
