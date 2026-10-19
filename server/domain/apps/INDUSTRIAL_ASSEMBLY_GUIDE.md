# Industrial Assembly: App Forge Pipeline Guide

This document outlines the architecture and execution strategy for the Oddjob App Forge pipeline (Mach 4.0).

## 1. Assembly vs. Coding
The App Forge prioritizes **Industrial Assembly** over raw code generation. Instead of asking the AI to write complex data-fetching logic, the system provides a curated **Block Registry** of "Self-Wiring" components.

### Key Concepts:
- **Block Registry**: A manifest of pre-assembled, high-fidelity components located in `server/domain/apps/core/block-registry.json`.
- **Self-Wiring Blocks**: Preferred components (e.g., `PlatformDatasetTableBlock`) that handle their own API calls, polling, and state management.
- **Packaged Foundations**: Source-level components from `server/domain/core/ui/components/packaged` that are injected into the AI context for targeted acceleration.

## 2. Pipeline Stages
The forge execution follows a 7-stage lifecycle to ensure governance and quality:

| Stage | Name | Description |
| :--- | :--- | :--- |
| 0 | Discovery | Researching requirements, resolving RAG assets, and generating the `DevelopmentPlan`. |
| 1 | Strategy | Finalizing the feature specification and architectural strategy. |
| 2 | Architecture | Proposing the `ArchitectureProposal` (components, services, data models). |
| 3 | Provisioning | **[NEW]** Proactively creating missing platform resources (Datasets, Pipelines) via MCP tools. |
| 4 | Assembly | Iterative file generation by the AI Architect using the approved plan and provisioned resources. |
| 5 | Hardening | Dependency sanitization and security auditing of the generated code. |
| 6 | Industrialization | Building the application container (`npm build`). |
| 7 | Ignition | Deploying and launching the containerized application. |

## 3. Resilience & Stability Improvements
Recent updates have introduced several failure-prevention mechanisms:

### A. Environment Safety
- **OneDrive Detection**: The system proactively warns if the build path is within a OneDrive-synced directory, which is a common cause of "late-stage" I/O failures.
- **Extended Timeouts**: `npm install` (5m) and `npm build` (10m) timeouts are increased to accommodate complex builds.

### B. Planning Resilience
- **Continuity Logic**: The AI Architect now directly consumes the user-approved `ArchitectureProposal` and `DevelopmentPlan`. This prevents redundant, low-quality re-planning.
- **Feature Spec Fallback**: If requirement decomposition fails to extract enough features, the system automatically falls back to the original mission description.
- **Architecture-Driven Tasks**: If the build planner fails to generate a task list, the system synthesizes a build queue directly from the architecture's component list.

### C. Session Persistence
- **Postgres Session Store**: Development and fallback sessions are persisted in PostgreSQL to prevent authentication drops during server restarts or long-running forge jobs.

## 4. Troubleshooting
If a forge fails in the "Assembly" stage, check the Redis error logs:
```bash
npx tsx scratch/dump_forge_errors.ts
```

Common issues:
- **Empty Task List**: Usually indicates a failure in `generateBuildPlan`. Check the AI logs for malformed JSON.
- **Late Stage Failure**: Check for file locks (OneDrive) or insufficient memory for the Next.js build process.
