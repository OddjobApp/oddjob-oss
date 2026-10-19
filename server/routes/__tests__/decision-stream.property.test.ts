/**
 * Property-based tests for Decision SSE stream event buffer replay logic
 * and organization scoping.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 4: Event Replay Correctness — buffer replay returns correct
 *   subsequence based on Last-Event-ID position
 * - Property 2: SSE Organization Scoping — events pushed for one org
 *   never appear in replay for a different org
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";

import {
  eventBuffers,
  replayFromBuffer,
  pushToBuffer,
  MAX_BUFFER_SIZE,
} from "../decision-stream.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clear all event buffers between tests */
function clearBuffers(): void {
  eventBuffers.clear();
}

/** Generate a unique event ID */
function makeEventId(index: number): string {
  return `evt-${index.toString().padStart(6, "0")}`;
}

/** Build an EventBufferEntry */
function makeEntry(index: number, type: string = "decision:new") {
  return {
    eventId: makeEventId(index),
    type,
    payload: JSON.stringify({ requestId: index, type }),
    timestamp: 1700000000000 + index * 1000,
  };
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generates a positive organizationId */
const orgIdArb = fc.integer({ min: 1, max: 10000 });

/** Generates a buffer size between 1 and MAX_BUFFER_SIZE (50) */
const bufferSizeArb = fc.integer({ min: 1, max: MAX_BUFFER_SIZE });

/** Generates an event type */
const eventTypeArb = fc.constantFrom("decision:new", "decision:resolved");

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Decision Stream Event Buffer Property Tests", () => {
  beforeEach(() => {
    clearBuffers();
  });

  /**
   * Feature: decision-inbox-surface, Property 4: Event Replay Correctness
   *
   * For any buffer of size S and a Last-Event-ID at position P (0-indexed),
   * the replayed events SHALL be exactly the events at positions P+1 through
   * min(P+50, S-1), in chronological order.
   *
   * **Validates: Requirements 2.8**
   */
  describe("Property 4: Event Replay Correctness", () => {
    it("replays exactly the events after the matched Last-Event-ID position in chronological order", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          bufferSizeArb,
          fc.integer({ min: 0, max: MAX_BUFFER_SIZE - 1 }),
          async (orgId, bufferSize, positionRaw) => {
            clearBuffers();

            // Ensure position P is within the buffer range
            const P = positionRaw % bufferSize;

            // Fill buffer with `bufferSize` entries
            for (let i = 0; i < bufferSize; i++) {
              pushToBuffer(orgId, makeEntry(i));
            }

            // Replay from position P
            const lastEventId = makeEventId(P);
            const replayed = replayFromBuffer(orgId, lastEventId);

            // Expected: events at positions P+1 through S-1
            const expectedCount = bufferSize - P - 1;
            expect(replayed.length).toBe(expectedCount);

            // Verify exact event IDs in chronological order
            for (let i = 0; i < replayed.length; i++) {
              expect(replayed[i].eventId).toBe(makeEventId(P + 1 + i));
            }

            // Verify chronological order (timestamps are increasing)
            for (let i = 1; i < replayed.length; i++) {
              expect(replayed[i].timestamp).toBeGreaterThan(replayed[i - 1].timestamp);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("replays the entire buffer when Last-Event-ID is not found", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          bufferSizeArb,
          async (orgId, bufferSize) => {
            clearBuffers();

            // Fill buffer
            for (let i = 0; i < bufferSize; i++) {
              pushToBuffer(orgId, makeEntry(i));
            }

            // Use a Last-Event-ID that doesn't exist in the buffer
            const unknownId = "unknown-event-id-xyz";
            const replayed = replayFromBuffer(orgId, unknownId);

            // Should return the entire buffer
            expect(replayed.length).toBe(bufferSize);

            // Verify chronological order
            for (let i = 0; i < replayed.length; i++) {
              expect(replayed[i].eventId).toBe(makeEventId(i));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("returns empty when replaying from the last event in the buffer", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          bufferSizeArb,
          async (orgId, bufferSize) => {
            clearBuffers();

            // Fill buffer
            for (let i = 0; i < bufferSize; i++) {
              pushToBuffer(orgId, makeEntry(i));
            }

            // Replay from the very last event — nothing to replay
            const lastEventId = makeEventId(bufferSize - 1);
            const replayed = replayFromBuffer(orgId, lastEventId);

            expect(replayed.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("buffer never exceeds MAX_BUFFER_SIZE after any number of pushes", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          fc.integer({ min: MAX_BUFFER_SIZE + 1, max: MAX_BUFFER_SIZE * 3 }),
          async (orgId, totalPushes) => {
            clearBuffers();

            // Push more entries than MAX_BUFFER_SIZE
            for (let i = 0; i < totalPushes; i++) {
              pushToBuffer(orgId, makeEntry(i));
            }

            const buffer = eventBuffers.get(orgId)!;
            expect(buffer.length).toBeLessThanOrEqual(MAX_BUFFER_SIZE);
            expect(buffer.length).toBe(MAX_BUFFER_SIZE);

            // Verify the buffer contains the most recent MAX_BUFFER_SIZE entries
            const expectedStartIndex = totalPushes - MAX_BUFFER_SIZE;
            for (let i = 0; i < buffer.length; i++) {
              expect(buffer[i].eventId).toBe(makeEventId(expectedStartIndex + i));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("replay after overflow returns correct chronological subset", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          fc.integer({ min: MAX_BUFFER_SIZE + 1, max: MAX_BUFFER_SIZE * 3 }),
          fc.integer({ min: 0, max: MAX_BUFFER_SIZE - 1 }),
          async (orgId, totalPushes, posInBuffer) => {
            clearBuffers();

            // Push entries (overflowing the buffer)
            for (let i = 0; i < totalPushes; i++) {
              pushToBuffer(orgId, makeEntry(i));
            }

            // The buffer now holds indices [totalPushes-50 .. totalPushes-1]
            const bufferStart = totalPushes - MAX_BUFFER_SIZE;
            const targetIndex = bufferStart + posInBuffer;
            const lastEventId = makeEventId(targetIndex);

            const replayed = replayFromBuffer(orgId, lastEventId);

            // Expected: everything after posInBuffer in the buffer
            const expectedCount = MAX_BUFFER_SIZE - posInBuffer - 1;
            expect(replayed.length).toBe(expectedCount);

            // Verify chronological order and correct IDs
            for (let i = 0; i < replayed.length; i++) {
              expect(replayed[i].eventId).toBe(makeEventId(targetIndex + 1 + i));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: decision-inbox-surface, Property 2: SSE Organization Scoping
   *
   * For any event with organizationId X, verify only clients with orgId X
   * receive it; clients with orgId Y ≠ X do not.
   *
   * **Validates: Requirements 2.4**
   */
  describe("Property 2: SSE Organization Scoping", () => {
    it("events pushed for orgId X never appear in replay for orgId Y where Y ≠ X", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          orgIdArb.filter((y) => true), // will filter in pre-condition
          bufferSizeArb,
          async (orgX, orgY, bufferSize) => {
            // Pre-condition: orgIds must be different
            fc.pre(orgX !== orgY);
            clearBuffers();

            // Push events only for orgX
            for (let i = 0; i < bufferSize; i++) {
              pushToBuffer(orgX, makeEntry(i));
            }

            // Replay for orgY — should get nothing (empty buffer for orgY)
            const replayedY = replayFromBuffer(orgY, "any-event-id");
            expect(replayedY.length).toBe(0);

            // Replay for orgX should return the buffer
            const replayedX = replayFromBuffer(orgX, "unknown-id");
            expect(replayedX.length).toBe(bufferSize);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("events for multiple orgs are isolated — replay for org A returns only org A events", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          orgIdArb,
          bufferSizeArb,
          bufferSizeArb,
          async (orgA, orgB, sizeA, sizeB) => {
            // Pre-condition: orgs must be different
            fc.pre(orgA !== orgB);
            clearBuffers();

            // Push events for both orgs with distinct event IDs
            for (let i = 0; i < sizeA; i++) {
              pushToBuffer(orgA, {
                eventId: `orgA-evt-${i}`,
                type: "decision:new",
                payload: JSON.stringify({ org: orgA, index: i }),
                timestamp: 1700000000000 + i * 1000,
              });
            }

            for (let i = 0; i < sizeB; i++) {
              pushToBuffer(orgB, {
                eventId: `orgB-evt-${i}`,
                type: "decision:new",
                payload: JSON.stringify({ org: orgB, index: i }),
                timestamp: 1700000000000 + i * 1000,
              });
            }

            // Replay for orgA — should only contain orgA events
            const replayedA = replayFromBuffer(orgA, "unknown-id");
            expect(replayedA.length).toBe(sizeA);
            for (const entry of replayedA) {
              expect(entry.eventId.startsWith("orgA-")).toBe(true);
              const parsed = JSON.parse(entry.payload);
              expect(parsed.org).toBe(orgA);
            }

            // Replay for orgB — should only contain orgB events
            const replayedB = replayFromBuffer(orgB, "unknown-id");
            expect(replayedB.length).toBe(sizeB);
            for (const entry of replayedB) {
              expect(entry.eventId.startsWith("orgB-")).toBe(true);
              const parsed = JSON.parse(entry.payload);
              expect(parsed.org).toBe(orgB);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("replaying with a valid Last-Event-ID from org X returns nothing for org Y", async () => {
      await fc.assert(
        fc.asyncProperty(
          orgIdArb,
          orgIdArb,
          bufferSizeArb,
          fc.integer({ min: 0, max: MAX_BUFFER_SIZE - 1 }),
          async (orgX, orgY, bufferSize, posRaw) => {
            fc.pre(orgX !== orgY);
            clearBuffers();

            const P = posRaw % bufferSize;

            // Push events for orgX
            for (let i = 0; i < bufferSize; i++) {
              pushToBuffer(orgX, makeEntry(i));
            }

            // Try to replay from orgX's event ID on orgY — should be empty
            const lastEventId = makeEventId(P);
            const replayedY = replayFromBuffer(orgY, lastEventId);
            expect(replayedY.length).toBe(0);

            // Same ID on orgX should return events after position P
            const replayedX = replayFromBuffer(orgX, lastEventId);
            expect(replayedX.length).toBe(bufferSize - P - 1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
