# Core Services: Mission Domain

## Overview

The `mission` domain is the heart of task execution and orchestration within the platform. It provides the services necessary to define, plan, execute, and monitor complex, long-running objectives known as "Missions." A Mission is a high-level goal that is broken down into a series of steps, which are then executed by `agents` using various tools.

This domain acts as the project management and operational control center, ensuring that tasks are carried out efficiently and reliably.

## Core Responsibilities

- **Mission Planning:** Provides services to decompose a high-level user request into a structured plan, often represented as a Directed Acyclic Graph (DAG) of tasks.
- **Execution Orchestration:** Manages the step-by-step execution of a mission plan. It dispatches tasks to the `jobs` domain, assigns them to appropriate `agents`, and ensures that dependencies between steps are respected.
- **State Management:** Persistently tracks the state of each mission and its individual steps (e.g., `pending`, `in_progress`, `completed`, `failed`). This allows for mission execution to be paused, resumed, and audited.
- **Real-time Monitoring:** Provides data for the frontend to visualize the progress of a mission, offering live updates as steps are completed.
- **Mission Control:** Exposes APIs for users to interact with missions, such as starting, pausing, or aborting them.

## Key Services

- **`mission-orchestrator.service.ts`:** The central service that oversees the entire lifecycle of a mission, from planning to completion.
- **`mission-planner.service.ts`:** Takes a mission objective and generates the detailed execution plan, often leveraging an AI agent for task decomposition.
- **`mission-state.service.ts`:** Manages the persistent storage and retrieval of mission state, ensuring resilience.

## Interactions with Other Domains

- **`agents`:** The `mission` domain assigns tasks to `agents` for execution. It is the primary consumer of the `agents` domain's capabilities.
- **`jobs`:** Dispatches individual mission steps as background jobs to the `jobs` domain for asynchronous execution.
- **`governor`:** Consults the `governor` domain before executing potentially sensitive steps to ensure policy compliance.
- **`audit`:** Logs all significant events in the mission lifecycle (e.g., mission start, step completion, agent actions) to the `audit` domain to create an immutable record.
- **`ui` (Implicit):** Provides the backend logic and data that powers the Mission Control and System Explorer pages in the user interface.
