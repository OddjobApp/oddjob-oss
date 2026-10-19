
# Admin Core Services

This module contains core services related to the administration, monitoring, and high-level control of the Oddjob platform.

## Responsibilities

The services in this module provide the foundational capabilities for the Admin Dashboard and other system-wide operational tools.

### Key Services

- **`analytics.service.ts`**: Gathers and aggregates key metrics from across the platform for display in the Admin Dashboard.

- **`dashboard.service.ts`**: Provides the specific data and aggregations required to power the main Admin Dashboard UI.

- **`circuit-breaker.service.ts`**: Implements a system-wide circuit breaker pattern. This is a critical stability feature that can automatically halt failing operations to prevent cascading failures.

- **`usage.service.ts`**: Tracks resource consumption and user activity, providing data for billing, quotas, and platform analytics.

- **`quiet-hours.ts`**: Manages the system's "quiet hours" configuration, during which notifications and other non-essential background tasks may be paused.

- **`dead-letter-queue.service.ts`**: Manages a queue for failed jobs or events that could not be processed, allowing for later inspection and retry.
