# Real-Time Event Stream (SSE)

## Overview

Oddjob uses Server-Sent Events (SSE) to push live system events to the browser without polling. The same infrastructure is used for mission phase transitions, forge build progress, agent traces, and any custom event emitted via `eventStream.publish()`.

## Architecture

```
Server services
  └─ eventStream.publish(type, payload, context, source)
        ├─ Persists to eventLog (Postgres)
        ├─ Publishes to Redis pub/sub channel: oddjob:events
        └─ Fills in-memory recentEvents buffer (last 100)

Redis subscriber
  └─ eventStream.on("*", handler)
        └─ Notifies all active SSE connections

Browser
  └─ EventSource('/api/events/stream?type=mission.*')
        ├─ Replays last 50 matching events on connect (buffer catch-up)
        └─ Receives live events as they arrive
```

## API Reference

### `GET /api/events/stream` — SSE connection

Opens a persistent SSE connection. On connect, the server immediately replays the last 50 matching events from the buffer so the client doesn't miss recent state.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `type` | string | Event type pattern. Supports `*` (single segment) and `**` (multi-segment). e.g. `mission.*`, `forge.**` |
| `organizationId` | number | If provided, system-wide events (no org) always pass; org-scoped events only pass if they match |

**Response:** `text/event-stream`

Each SSE message is a JSON-encoded `EventPayload`:

```json
{
  "eventId": "uuid",
  "eventType": "mission.phase_changed",
  "timestamp": 1712345678901,
  "source": "rolling-wave",
  "payload": { "missionRunId": 42, "phase": "EXECUTING" },
  "context": { "organizationId": 1, "subject": "mission-run:42" }
}
```

Heartbeats are sent every 25 seconds as SSE comments (`: heartbeat`) to keep the connection alive through proxies.

### `GET /api/events/live` — Recent buffer

Returns the last N events from the in-memory buffer (no DB query).

**Query params:** `type`, `source`, `limit` (default 50)

### `GET /api/events` — Historical query

Queries the `eventLog` table with full filtering.

**Query params:** `type`, `source`, `search`, `limit`, `offset`, `since`, `until`, `organizationId`

### `POST /api/events/emit` — Custom event

Emits a custom event. Useful for testing and cross-service notifications.

```json
{ "type": "custom.event", "payload": { "key": "value" }, "source": "my-service" }
```

### `GET /api/events/stats` — Event statistics

Returns event counts by type, source, and day for the last N days.

### Webhook Subscriptions

- `GET /api/events/subscriptions` — list active subscriptions
- `POST /api/events/subscriptions` — create a subscription
- `GET /api/events/subscriptions/:id/history` — delivery history

## Frontend Hook

```typescript
import { useEventStream } from "@domain-ui/core/ui/hooks/use-event-stream";

const { events, isConnected } = useEventStream({
    eventType: "mission.*",        // optional type filter
    organizationId: 1,             // optional org filter
    maxBuffer: 100,                // max events to keep in state (default 100)
    autoConnect: true,             // auto-open on mount (default true)
});
```

The hook:
- Opens an `EventSource` to `/api/events/stream` with the given filters
- Reconnects automatically with exponential back-off (3s → 6s → 12s, capped at 30s)
- Resets back-off counter on successful reconnect
- Receives the server's buffer replay on every connect, so state is always current

## Event Types

| Type | Source | Payload |
|------|--------|---------|
| `mission.phase_changed` | rolling-wave | `{ missionRunId, phase }` |
| `mission.trace` | rolling-wave | `{ missionRunId, traceEntry }` |
| `mission.crew_assembled` | rolling-wave | `{ missionRunId, crew[] }` |
| `mission.idle` | rolling-wave | `{ missionRunId }` |
| `forge.progress` | app-forge | `{ appId, stage, pct, message }` |
| `forge.failed` | app-forge | `{ appId, error }` |
| `INTENT_STABILIZED` | psychologist | `{ user_id, state, confidence, suggestion: { id, strategy, user_text, agent_prompt, ... } }` |
| `intervention.triggered` | scoring-runner | `{ interventionId, memoryId, thresholdId, vector, score, title, description, aiPrompt, rationale, priority, confidence, sessionId, action }` |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `REDIS_PASSWORD` | — | Optional Redis auth password |

## Error Handling

- Redis unavailable: falls back to local `EventEmitter` (single-process only, no cross-pod events)
- Webhook delivery failures: retried up to `retryCount` times with `retryDelayMs` delay
- SSE client disconnect: listener is unsubscribed and heartbeat cleared immediately
