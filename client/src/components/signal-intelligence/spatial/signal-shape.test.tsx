/**
 * "Cannot read properties of undefined (reading 'eventType')" — the Subscriptions
 * view died on mount inside Signal Studio.
 *
 * IntelligenceSignal declares `event` as required, and the surfaces that render a
 * signal read `signal.event.eventType`. But the Studio pod holds RAW events (its
 * query is typed `any[]`, so no compiler objected), and the wizard's rerun path
 * assigns `workflow.signal as any` — both handed over an object whose `event` was
 * undefined, and the read took the whole view down with it.
 *
 * Two guarantees here: the raw event converts to a signal, and a signal arriving
 * without an event degrades instead of crashing.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toIntelligenceSignal, type SignalEvent, type IntelligenceSignal } from "./utils";
import { SubscriptionsView } from "./SubscriptionsView";

const RAW_EVENT: SignalEvent = {
    id: "evt-1",
    eventType: "PORT_CONGESTION",
    targetSector: "Logistics",
    jurisdiction: "Singapore",
    severity: "High",
    confidenceScore: 0.82,
    rawText: "Berth waiting times at Tuas have doubled week over week. Carriers are diverting.",
    extractionTimestamp: new Date(Date.now() - 30 * 60_000).toISOString(),
};

function show(selectedSignal: IntelligenceSignal | null) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <SubscriptionsView organizationId={7} selectedSignal={selectedSignal} />
        </QueryClientProvider>,
    );
}

describe("toIntelligenceSignal", () => {
    it("nests the raw event where every consumer reads it", () => {
        const signal = toIntelligenceSignal(RAW_EVENT);

        expect(signal.event).toBe(RAW_EVENT);
        expect(signal.event.eventType).toBe("PORT_CONGESTION");
        expect(signal.id).toBe("evt-1");
    });

    it("derives the presentation fields from the event, inventing nothing", () => {
        const signal = toIntelligenceSignal(RAW_EVENT, Date.parse(RAW_EVENT.extractionTimestamp) + 30 * 60_000);

        expect(signal.kind).toBe("threat");            // High severity
        expect(signal.score).toBe(82);                  // 0.82 confidence
        expect(signal.confidence).toBe("High");
        expect(signal.age).toBe("30m ago");
        expect(signal.subtitle).toBe("Logistics · Singapore");
        expect(signal.title).toBe("Berth waiting times at Tuas have doubled week over week");
    });

    it("falls back to the event type when there is no text to title it with", () => {
        expect(toIntelligenceSignal({ ...RAW_EVENT, rawText: null }).title).toBe("PORT CONGESTION");
    });

    it("calls a low-severity event an opportunity", () => {
        expect(toIntelligenceSignal({ ...RAW_EVENT, severity: "Low" }).kind).toBe("opportunity");
    });
});

describe("SubscriptionsView with a signal", () => {
    it("shows the signal's event details when they are there", async () => {
        show(toIntelligenceSignal(RAW_EVENT));

        expect(await screen.findByText(/Event Type: PORT_CONGESTION/)).toBeInTheDocument();
        expect(screen.getByText(/Severity: High/)).toBeInTheDocument();
    });

    // The crash: a raw event passed straight through as a signal.
    it("renders rather than crashing when the signal carries no event", async () => {
        const eventless = { ...RAW_EVENT, kind: "threat", title: "Port congestion", subtitle: "Logistics", age: "30m ago", impact: "High" } as unknown as IntelligenceSignal;

        show(eventless);

        // The view is up; the part that needs the event is simply absent.
        expect(await screen.findByTestId("subscriptions-view-page")).toBeInTheDocument();
        expect(screen.queryByText(/Event Type:/)).not.toBeInTheDocument();
    });

    it("renders with no signal at all", async () => {
        show(null);
        expect(await screen.findByTestId("subscriptions-view-page")).toBeInTheDocument();
    });
});
