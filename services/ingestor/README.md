# 📥 Ingestor Service (`services/ingestor`)

The Ingestor Service is the "front-line" of the Oddjob data pipeline. It is a high-performance Fastify server dedicated to receiving "Pulse" events from client-side trackers and resolving their semantic intent before buffering them for downstream processing.

## Mach 3 Service Role: `gateway`
In the Mach 3 distributed architecture, the Ingestor acts as the **Gateway** for telemetry data. It ensures that raw user interactions are validated, enriched with intent vectors, and safely queued without blocking the client.

## Core Responsibilities
- **Intent Resolution**: Matches incoming pulses against a hierarchical `intent_map.json` and dynamic Redis rules to determine the user's "SCORE" (Symptom, Challenge, Opportunity, Risk, Effort).
- **Session Scoring**: Accumulates intent vectors over a session to identify emergent patterns (e.g., high frustration, interest in a specific feature).
- **Threshold Evaluation**: Triggers immediate server-side actions if a user's cumulative score crosses a defined threshold.
- **Buffering**: Publishes enriched pulses to the `intent.raw` RabbitMQ queue for the Consumer service.

## Integration Points
- **RabbitMQ**: Source of truth for the `intent.raw` buffer.
- **Redis**: Used for synchronizing dynamic scoring rules and thresholds from the Admin dashboard.
- **PostgreSQL**: Stores historical "Psychologist Events" for long-term behavior analysis.
- **Shared Redis/Messaging**: Uses `@oddjob/shared-redis` and `@oddjob/shared-messaging` for consistent infrastructure configuration.

## Key Files
- `server.js`: Main service logic and Fastify routes.
- `intent_map.json`: Static mapping of routes/actions to intent vectors.

## Routes
- `POST /pulse`: Primary endpoint for telemetry ingestion.
- `GET /health`: Service health check.
- `GET /session/:sessionId/scoring-context`: Retrieve real-time scores for a specific user.

## Testing Status
- [ ] Integration: 🔴 Untested (Requires RabbitMQ/Redis mock environment)
- [ ] Logic: 🟡 Rule matching logic verified via local unit tests
