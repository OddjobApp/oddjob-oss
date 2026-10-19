import { useState, useEffect, useCallback } from 'react';
import { subscribeEvents } from '../services/event-bus';

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
    /** Narrow to one org's events; the stream itself is already scoped to the active org. */
    organizationId?: number;
    maxBuffer?: number;
    autoConnect?: boolean;
}

/**
 * useEventStream
 *
 * A reactive list of incoming system events, newest first, read through the
 * shared event bus: every instance in every tab shares one connection (see
 * services/shared-event-source.ts).
 */
export function useEventStream(options: UseEventStreamOptions = {}) {
    const { eventType, organizationId, maxBuffer = 100, autoConnect = true } = options;
    const [events, setEvents] = useState<SystemEvent[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [active, setActive] = useState(autoConnect);

    // Follow the option, as the old effect did when it reconnected on change.
    useEffect(() => setActive(autoConnect), [autoConnect]);

    useEffect(() => {
        if (!active) return;
        let wasOpen = false;
        const unsubscribe = subscribeEvents(
            { type: eventType },
            (event) => {
                const eventOrg = event.context?.organizationId;
                if (organizationId && eventOrg != null && Number(eventOrg) !== organizationId) return;
                setEvents((prev) => [event as SystemEvent, ...prev].slice(0, maxBuffer));
            },
            (state) => {
                const open = state === 'open';
                setIsConnected(open);
                if (open) setError(null);
                else if (wasOpen) setError(new Error('Event stream connection failed'));
                wasOpen = open;
            },
        );
        return () => {
            unsubscribe();
            setIsConnected(false);
        };
    }, [active, eventType, organizationId, maxBuffer]);

    const connect = useCallback(() => setActive(true), []);
    const disconnect = useCallback(() => setActive(false), []);

    const clearEvents = useCallback(() => {
        setEvents([]);
    }, []);

    return {
        events,
        isConnected,
        error,
        connect,
        disconnect,
        clearEvents
    };
}
