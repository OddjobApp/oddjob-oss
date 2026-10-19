import { describe, expect, it } from "vitest";
import { signalStudioScopePrefix, signalStudioSelectionFromEvent } from "./signal-studio";

// An `event_primitives` row as /api/event-primitives returns it.
const row = {
  id: "5f0c1d2e-0000-4000-8000-000000000001",
  organizationId: 3,
  sourceEntryId: "entry-9",
  eventType: "port_congestion",
  targetSector: "Logistics",
  jurisdiction: "SG",
  severity: "High",
  sourceUrl: "https://example.test/feed/9",
  extractionTimestamp: "2026-09-27T10:00:00.000Z",
  confidenceScore: 0.82,
  rawText: "Berth waits at Tanjong Pagar reached 4 days. Carriers are diverting.",
  h3Index: "872830828ffffff",
  dwellMinutes: 5760,
  latitude: 1.26,
};

describe("signalStudioSelectionFromEvent", () => {
  it("carries the row's own fields", () => {
    expect(signalStudioSelectionFromEvent(row)).toEqual({
      signalId: row.id,
      eventType: "port_congestion",
      severity: "High",
      sector: "Logistics",
      jurisdiction: "SG",
      confidenceScore: 0.82,
      extractedAt: "2026-09-27T10:00:00.000Z",
      sourceUrl: "https://example.test/feed/9",
      excerpt: "Berth waits at Tanjong Pagar reached 4 days",
      h3Index: "872830828ffffff",
      dwellMinutes: 5760,
    });
  });

  it("leaves missing fields out rather than inventing defaults", () => {
    // The pod used to fill a missing jurisdiction with "Global" and severity
    // with "Medium"; an agent reads either as fact.
    const selection = signalStudioSelectionFromEvent({ id: "sig-2", eventType: "tariff_change", rawText: null, h3Index: null });
    expect(selection).toEqual({ signalId: "sig-2", eventType: "tariff_change" });
    expect(Object.keys(selection!)).not.toContain("jurisdiction");
  });

  it("returns nothing for a row with no id to refer back to", () => {
    expect(signalStudioSelectionFromEvent({ eventType: "x" })).toBeUndefined();
    expect(signalStudioSelectionFromEvent(null)).toBeUndefined();
  });

  it("prefixes the next message with the selection, like the other studios", () => {
    const selection = signalStudioSelectionFromEvent(row)!;
    expect(signalStudioScopePrefix(selection)).toBe(`[Signal Studio selection: ${JSON.stringify(selection)}]`);
  });
});
