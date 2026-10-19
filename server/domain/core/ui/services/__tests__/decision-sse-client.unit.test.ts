/**
 * DecisionSSEClient - Unit Tests
 *
 * The client reads `/api/decisions/stream` through the shared stream (one
 * connection per browser per org). Reconnect backoff and Last-Event-ID resume
 * belong to the shared stream and are tested in shared-event-source tests;
 * these cover what the client adds:
 * - named decision events reach onEvent
 * - stream state maps to 'connected' / 'reconnecting'
 * - Requirement 2.7: REST polling while the stream stays down, and back to
 *   'connected' (polling stopped) once it opens again
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DecisionSSEClient,
  type DecisionEvent,
  type ConnectionState,
} from "../decision-sse-client.js";
import { __resetSharedStreams } from "../shared-event-source.js";
import { __resetEventBusOrg, setEventStreamOrg } from "../event-bus.js";

type Listener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: Listener | null = null;
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The server returned an error status: the browser gives up on this one. */
  fail(): void {
    this.readyState = 2;
    this.onerror?.();
  }

  /** The connection dropped: the browser retries it by itself. */
  drop(): void {
    this.readyState = 0;
    this.onerror?.();
  }

  emit(event: string, data: unknown, lastEventId = ""): void {
    const message = { data: JSON.stringify(data), lastEventId } as MessageEvent;
    if (event === "message") this.onmessage?.(message);
    for (const listener of this.listeners.get(event) ?? []) listener(message);
  }

  static latest(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

describe("DecisionSSEClient", () => {
  let client: DecisionSSEClient;
  let onEvent: ReturnType<typeof vi.fn<(event: DecisionEvent) => void>>;
  let onConnectionChange: ReturnType<typeof vi.fn<(state: ConnectionState) => void>>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("BroadcastChannel", undefined);
    sessionStorage.clear();

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 5, highRiskAgingCount: 1, oldestPendingAt: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    onEvent = vi.fn<(event: DecisionEvent) => void>();
    onConnectionChange = vi.fn<(state: ConnectionState) => void>();
    client = new DecisionSSEClient({
      onEvent,
      onConnectionChange,
      fallbackAfterMs: 10000,
      fallbackPollIntervalMs: 10000,
    });
  });

  afterEach(() => {
    client.disconnect();
    __resetSharedStreams();
    __resetEventBusOrg();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("connection", () => {
    it("opens the decision stream for the active org", () => {
      setEventStreamOrg(473);
      client.connect();
      expect(MockEventSource.latest().url).toBe("/api/decisions/stream?organizationId=473");
    });

    it("reports 'connected' once, when the stream opens", () => {
      client.connect();
      MockEventSource.latest().open();
      MockEventSource.latest().open();
      expect(onConnectionChange.mock.calls).toEqual([["connected"]]);
      expect(client.getConnectionState()).toBe("connected");
    });

    it("shares one connection between clients in a tab", () => {
      const other = new DecisionSSEClient({ onEvent: vi.fn(), onConnectionChange: vi.fn() });
      client.connect();
      other.connect();
      expect(MockEventSource.instances).toHaveLength(1);
      other.disconnect();
    });

    it("ignores a second connect()", () => {
      client.connect();
      client.connect();
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });

  describe("events", () => {
    it("passes decision:new and decision:resolved to onEvent", () => {
      client.connect();
      const es = MockEventSource.latest();
      es.open();
      es.emit("decision:new", { eventId: "e1", requestId: 42, toolName: "deploy", riskLevel: "high" }, "e1");
      es.emit("decision:resolved", { eventId: "e2", requestId: 42, newStatus: "approved" }, "e2");

      expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "decision:new", requestId: 42, toolName: "deploy" }));
      expect(onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "decision:resolved", requestId: 42, newStatus: "approved" }));
    });

    it("ignores unnamed messages and malformed payloads", () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      client.connect();
      const es = MockEventSource.latest();
      es.emit("message", { requestId: 1 });
      (es as any).listeners.get("decision:new")[0]({ data: "not json", lastEventId: "" });
      expect(onEvent).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });

  describe("Requirement 2.7: polling while the stream is down", () => {
    it("reports 'reconnecting' when an open stream drops", () => {
      client.connect();
      MockEventSource.latest().open();
      MockEventSource.latest().drop();
      expect(client.getConnectionState()).toBe("reconnecting");
    });

    it("does not poll while the stream recovers within the fallback window", async () => {
      client.connect();
      MockEventSource.latest().open();
      MockEventSource.latest().drop();
      await vi.advanceTimersByTimeAsync(5000);
      MockEventSource.latest().open();
      await vi.advanceTimersByTimeAsync(20000);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.getConnectionState()).toBe("connected");
    });

    it("switches to polling when the stream never opens", async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(10000);

      expect(client.getConnectionState()).toBe("polling");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/approvals/pending/count",
        expect.objectContaining({ credentials: "include" }),
      );
    });

    it("polls every interval and emits the counts as a synthetic event", async () => {
      client.connect();
      MockEventSource.latest().fail();
      await vi.advanceTimersByTimeAsync(10000);
      const first = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);

      expect(fetchMock.mock.calls.length).toBeGreaterThan(first);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ requestId: -1, toolName: "__poll__", count: 5 }));
    });

    it("keeps reconnecting underneath polling, and stops polling once the stream opens", async () => {
      client.connect();
      MockEventSource.latest().fail();
      await vi.advanceTimersByTimeAsync(10000);
      expect(client.getConnectionState()).toBe("polling");

      // The shared stream has been retrying with backoff the whole time.
      expect(MockEventSource.instances.length).toBeGreaterThan(1);
      MockEventSource.latest().open();
      expect(client.getConnectionState()).toBe("connected");

      const calls = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });
  });

  describe("disconnect()", () => {
    it("closes the stream and stops the fallback timer", async () => {
      client.connect();
      const es = MockEventSource.latest();
      client.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(es.closed).toBe(true);

      await vi.advanceTimersByTimeAsync(20000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stops polling", async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(10000);
      const calls = fetchMock.mock.calls.length;
      client.disconnect();
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });
  });
});
