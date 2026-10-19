# 📨 Shared Messaging Package (`packages/shared-messaging`)

The Shared Messaging Package is the asynchronous backbone of the Oddjob platform. It provides a standardized, type-safe wrapper around RabbitMQ for inter-service communication, ensuring reliable message delivery, dead-letter handling, and consistent event patterns across all Mach 3 pods.

## Role in Mach 3
In the distributed architecture, this package is imported by nearly every service to:
- **Publish Tasks**: The `mission` pod publishes jobs to the `worker` queue.
- **Broadcast Events**: Services emit "Domain Events" (e.g., `job.completed`) via a fanout exchange.
- **Command Routing**: Routes specific commands to dedicated pods (e.g., `forge.synthesis.start`).

## Core Features
- **Connection Management**: Singleton-based connection pooling with automatic recovery and graceful shutdown.
- **Standardized Envelopes**: Every message is wrapped in a `MessageEnvelope<T>` containing `messageId`, `timestamp`, `source`, and `correlationId`.
- **Dead-Letter Support**: All queues are automatically configured with a Dead-Letter Exchange (DLX) for failed message isolation.
- **Simplified API**: High-level `publish`, `subscribe`, and `publishToExchange` methods that handle boilerplate assertion and serialization.

## Key Exports
- **[connect()](./src/rabbitmq.ts)**: Initializes the global RabbitMQ connection and asserts standard exchanges.
- **[publish()](./src/rabbitmq.ts)**: Sends a persistent, type-safe message to a specific queue.
- **[subscribe()](./src/rabbitmq.ts)**: Consumes messages from a queue with automatic ACKs and error-based NACKs.
- **[Events](./src/events.ts)**: Predefined constants and factory functions for common system events.
- **[Types](./src/types.ts)**: TypeScript interfaces for message payloads and queue configurations.

## Standard Exchanges & Queues
- **Exchanges**:
    - `oddjob.jobs` (topic): Internal job routing.
    - `oddjob.pipelines` (topic): Pipeline lifecycle events.
    - `oddjob.events` (fanout): Global system notifications.
- **Queues**:
    - `job_execution_queue`: Primary queue for worker tasks.
    - `forge_queue`: Dedicated queue for agent synthesis (Forge Service).
    - `dead_letter`: Sink for unprocessable messages.

## Usage Example
```typescript
import { publish, QUEUES } from "@oddjob/shared-messaging";

await publish(QUEUES.JOB_EXECUTION, {
    jobId: "123",
    executor: "youtube-sync"
}, { type: "job.start" });
```

## Testing Status
- [ ] Transport: 🟢 Unit tests with `amqplib-mocks` passing
- [ ] Reliability: 🟡 Persistence and DLX behavior verified in staging environments
