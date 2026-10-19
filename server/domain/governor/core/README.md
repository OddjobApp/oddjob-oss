
# Governor Core Services

This module is the central governance and policy enforcement layer for the entire Oddjob platform. If the `agents/core` is the "brain," the Governor is the "conscience." It ensures that all actions taken by AI agents adhere to the organization's rules, budget constraints, and ethical guidelines.

## Core Responsibilities

### 1. Policy & Rule Enforcement
- **`governance.service.ts`**: The main service that allows administrators to define and manage governance policies (e.g., "No AI agent is allowed to interact with production financial data.").
- **`decision-router.ts`**: A critical checkpoint. Before an agent can execute a potentially sensitive action, it must pass through the Decision Router, which checks the proposed action against all active governance policies.

### 2. Budget & Resource Management
- **`budget-governance.service.ts`**: Enforces budget constraints on AI-powered Missions and App Forge builds, preventing cost overruns.
- **`scaling-governor.service.ts`**: Monitors system load and can automatically scale resources up or down, ensuring the platform remains performant and cost-effective.

### 3. Auditing & Human-in-the-Loop (HIL)
- **`audit-trace.service.ts`**: Works closely with the `audit` domain to create a detailed, tamper-proof record of all governance decisions.
- **`feedback-loop.service.ts`**: Manages the Human-in-the-Loop (HIL) process. If an agent proposes an action that is flagged by a policy, this service routes the decision to a human for approval via the Decision Inbox.

### 4. System Stability & Safety
- **`watchdog.ts`**: A safety service that monitors for runaway or misbehaving agents. If an agent starts acting erratically, the Watchdog can automatically pause or terminate it.
- **`innovation-lab.service.ts`**: Provides the sandboxed environment for safely testing new, unverified AI agents or skills.
