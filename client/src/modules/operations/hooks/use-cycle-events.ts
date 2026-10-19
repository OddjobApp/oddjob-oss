import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";

/**
 * Subscribes to real-time cycle events via SSE and invalidates the
 * /api/cycles query cache when the fleet state changes.
 * Drop this into CyclesDashboard to eliminate polling lag.
 */
export function useCycleEvents() {
    useEffect(() => {
        const es = new EventSource(
            "/api/events/stream?type=cycle.*",
            { withCredentials: true }
        );

        const handleEvent = (e: MessageEvent) => {
            try {
                const event = JSON.parse(e.data);
                if (!event?.eventType?.startsWith("cycle.")) return;
                // Invalidate the cycles list so React Query refetches immediately
                queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            } catch { /* malformed event — ignore */ }
        };

        es.addEventListener("message", handleEvent);

        es.onerror = () => {
            // EventSource auto-reconnects; nothing to do here
        };

        return () => {
            es.removeEventListener("message", handleEvent);
            es.close();
        };
    }, []);
}
