import React, { useEffect, useRef } from 'react';
import { useEventStream } from '@domain-ui/core/ui/hooks/use-event-stream';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { ToastAction } from '@domain-ui/core/ui/components/ui/toast';
import { Rocket } from 'lucide-react';
import { useLocation } from 'wouter';

export function GlobalEventNotifier() {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    // Track which event ids we've already toasted so reconnect-replayed events
    // don't double-toast. Capped to keep memory bounded.
    const shownIds = useRef<Set<string>>(new Set());
    const SHOWN_CAP = 500;

    const { events } = useEventStream({
        eventType: 'deployment.completed',
        autoConnect: true,
    });

    useEffect(() => {
        if (events.length === 0) return;

        // Process events in chronological order (oldest first) so the toast queue
        // matches the order things actually happened.
        const fresh = [...events].reverse().filter(e => {
            const eventId = (e as any).id;
            if (!eventId) return false;
            if (shownIds.current.has(eventId)) return false;
            return e.source === 'app-forge' && !!e.payload;
        });

        for (const event of fresh) {
            const eventId = (event as any).id as string;
            shownIds.current.add(eventId);

            const { name, slug } = event.payload;
            toast({
                title: "App Provisioned Successfully",
                description: (
                    <div className="flex items-center gap-2 mt-1">
                        <Rocket className="w-4 h-4 text-emerald-500" />
                        <span><strong>{name}</strong> is online and ready.</span>
                    </div>
                ),
                action: slug ? (
                    <ToastAction
                        altText="Open App"
                        onClick={() => setLocation(`/app/${slug}`)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground border-transparent"
                    >
                        Launch
                    </ToastAction>
                ) : undefined,
                duration: 10000,
            });
        }

        // Trim shown-set so it doesn't grow unbounded in long-lived sessions
        if (shownIds.current.size > SHOWN_CAP) {
            const overflow = Array.from(shownIds.current).slice(0, shownIds.current.size - SHOWN_CAP);
            for (const id of overflow) shownIds.current.delete(id);
        }
    }, [events, toast, setLocation]);

    return null;
}
