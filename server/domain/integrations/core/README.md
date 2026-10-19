
# Integrations Core Services

This module contains the core services for connecting to and interacting with all third-party platforms. It is also home to the powerful **Supervisor** engine, which provides a layer of AI-driven governance and orchestration on top of these integrations.

## Core Responsibilities

### 1. Individual Service Integrations
This module contains the low-level, provider-specific logic for each third-party service. Each service is responsible for handling the authentication, API calls, and data transformation for its respective platform.

- `gmail.service.ts`
- `slack.service.ts`
- `confluence.service.ts`
- `google-drive.service.ts`
- etc.

### 2. The Supervisor Engine

The `supervisor/` directory contains a sophisticated AI-driven engine that acts as a gatekeeper and orchestrator for all integration-related tasks. When an agent wants to use a tool that interacts with an external service (e.g., "Send a message to Slack"), the request is first routed to the Supervisor.

- **`supervisor-engine.ts`**: The core of the engine. It receives the agent's request and uses a series of "Guards" to ensure the action is safe and compliant.

- **`guards/`**: A collection of policy guards that check the request against various criteria:
    - **`budget-guard.ts`**: Checks if the proposed action will exceed any budget constraints.
    - (Other guards for security, rate-limiting, etc.)

- **`judge-service.ts`**: If a guard is triggered, the Judge service can be invoked to make a more nuanced decision or to escalate the request to a human for approval (HIL).

- **`task-state-manager.ts`**: Tracks the state of long-running tasks that may involve multiple interactions with external services.

In essence, the Supervisor provides a critical layer of security, governance, and orchestration that allows agents to safely and reliably interact with the outside world.
