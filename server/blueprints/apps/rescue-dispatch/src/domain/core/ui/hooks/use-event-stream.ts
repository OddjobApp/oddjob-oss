import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './use-toast.js';

export interface SystemEvent {
    eventId: string;
    eventType: string;
    source: string;
    timestamp: string | number;
    payload: any;
    organizationId?: number;
    userId?: string;
    context?: any;
}

interface UseEventStreamOptions {
    eventType?: string;
    organizationId?: number;
    maxBuffer?: number;
    autoConnect?: boolean;
}

/**
 * useEventStream
 * 
 * Custom hook to connect to the Oddjob Real-time Event Stream (SSE).
 * Provides a reactive list of incoming system events.
 */
export function useEventStream(options: UseEventStreamOptions = {}) {
    const { eventType, organizationId, maxBuffer = 100, autoConnect = true } = options;
    const [events, setEvents] = useState<SystemEvent[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const { toast } = useToast();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectAttemptsRef = useRef(0);

    const connect = useCallback(() => {
        if (eventSourceRef.current) return;

        const url = new URL('/api/events/stream', window.location.origin);
        if (eventType) url.searchParams.append('type', eventType);
        if (organizationId) url.searchParams.append('organizationId', organizationId.toString());

        const es = new EventSource(url.toString(), { withCredentials: true });

        es.onopen = () => {
            setIsConnected(true);
            setError(null);
            reconnectAttemptsRef.current = 0;
        };

        es.onmessage = (event) => {
            try {
                // Ignore heartbeats
                if (event.data === ': heartbeat') return;

                const parsedEvent: SystemEvent = JSON.parse(event.data);
                
                setEvents(prev => {
                    const updated = [parsedEvent, ...prev];
                    return updated.slice(0, maxBuffer);
                });
            } catch (err) {
                console.error('[useEventStream] Failed to parse event data:', err);
            }
        };

        es.onerror = () => {
            setError(new Error('Event stream connection failed'));
            setIsConnected(false);
            es.close();
            eventSourceRef.current = null;
            // Exponential back-off: 3s → 6s → 12s, capped at 30s
            const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
            reconnectAttemptsRef.current += 1;
            setTimeout(connect, delay);
        };

        eventSourceRef.current = es;
    }, [eventType, organizationId, maxBuffer]);

    const disconnect = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setIsConnected(false);
        }
    }, []);

    const clearEvents = useCallback(() => {
        setEvents([]);
    }, []);

    useEffect(() => {
        if (autoConnect) {
            connect();
        }
        return () => disconnect();
    }, [connect, disconnect, autoConnect]);

    return {
        events,
        isConnected,
        error,
        connect,
        disconnect,
        clearEvents
    };
}
