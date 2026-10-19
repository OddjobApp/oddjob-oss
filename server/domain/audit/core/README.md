
# Audit Core Services

This module provides the core services for creating a comprehensive and immutable audit trail of all significant actions taken within the Oddjob platform. This is a critical feature for security, compliance, and debugging.

## Core Responsibilities

### Key Services

- **`audit-service.ts`**: The main entry point for the audit system. It provides a generic `recordAction()` function that can be called by any other service to log an event.

- **`transaction-log.ts`**: Implements a low-level, append-only transaction log. This ensures that once an audit event is recorded, it cannot be altered, providing a high degree of integrity.

- **`reasoning-audit.service.ts`**: A specialized service that hooks into the AI agents' reasoning processes. It records not just the final action an agent takes, but also the chain of thought, the tools it considered, and the reasons for its decision. This provides an invaluable "black box recorder" for debugging AI behavior.
