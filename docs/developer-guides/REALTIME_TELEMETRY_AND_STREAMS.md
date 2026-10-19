# Real-Time Telemetry & Spatial Streams Guide

This guide establishes the architectural standards for emitting, streaming, and visualizing live agent telemetry and geospatial incident signals across Oddjob using WebSockets, the **Universal Event Envelope (UEE)**, and the **Eulerian Hexagonal (Uber H3)** spatial engine.

---

## 1. The Universal Event Envelope (UEE)

All asynchronous telemetry, log streams, and agent actions must be wrapped in a standardized Universal Event Envelope. This guarantees uniform distributed tracing, forensic auditing, and cross-service interoperability.

### UEE Payload Structure
```typescript
export interface UniversalEventEnvelope<T = unknown> {
  /** Unique UUID v4 identifying the event instance */
  eventId: string;
  /** ISO 8601 timestamp when the event was produced */
  timestamp: string;
  /** Dot-delimited event type (e.g. 'agent.trajectory.step', 'spatial.signal.detected') */
  eventType: string;
  /** Source service or agent identifier */
  source: string;
  /** Active tenant / organization identifier */
  organizationId: number;
  /** W3C Distributed Tracing headers */
  trace: {
    traceparent: string;
    traceId: string;
    spanId: string;
  };
  /** Eulerian Hexagonal (Uber H3) index if geospatial */
  spatial?: {
    h3Index: string;
    resolution: number;
    latitude: number;
    longitude: number;
  };
  /** Payload payload data */
  data: T;
}
```

---

## 2. Eulerian Spatial Analytics with Uber H3

Oddjob uses the **Uber H3 Discrete Global Grid System** to discretize geospatial events into hexagonal cells.

### Key Rules:
1. **Resolution Scale**:
   - **Resolution 7** (~5.16 km²): Regional cluster aggregations, metro incident density.
   - **Resolution 8** (~0.73 km²): Standard neighborhood dispatch zones.
   - **Resolution 9** (~0.10 km²): Tactical field service unit tracking.
2. **Deterministic Indexing**: Store the 15-character hexadecimal H3 index as a indexed column (`h3_index`) in PostgreSQL.
3. **K-Ring Aggregation**: When querying spatial hotspots or radius searches, query neighboring hexagons using `h3.gridDisk(centerIndex, k)`.

---

## 3. WebSocket Stream Consumption Best Practices

When consuming real-time streams in React UI components (e.g., [`TacticalMapControl.tsx`](../../server/domain/core/ui/components/packaged/TacticalMapControl.tsx) or log viewers):

1. **Buffer & Throttle High-Frequency Updates**:
   - Do not trigger a full React re-render on every individual WebSocket message if rates exceed 30 msgs/sec.
   - Buffer incoming events into a ref array and flush to component state on a `requestAnimationFrame` loop or a 100ms throttle.
2. **Cap Ring Buffers**:
   - Always limit in-memory log history (e.g., `prev => [entry, ...prev.slice(0, 99)]`) to prevent browser memory leaks during extended sessions.
3. **Graceful Reconnection**:
   - Use exponential backoff with jitter on WebSocket connection drops.

---

## 4. Verification

Verify the spatial stream emitter and H3 index calculation locally:

```bash
npm run smoke:spatial-stream
```
Validates WebSocket payload handshakes, spatial coordinates conversion, and resolution integrity.
