# 🚀 Mission Pod (`server/domain/mission`)

The Mission Pod is the core orchestration layer of the Oddjob platform. It manages the full lifecycle of complex, multi-step "Missions," coordinating between AI agents, human-in-the-loop approvals, and distributed job execution.

## Mach 3 Service Role: `mission`
In the Mach 3 distributed architecture, this pod typically resides in the **Mission Service**, which is responsible for state transition, execution monitoring, and high-level goal decomposition.

## Key Services
- **[MissionService](./core/mission.service.ts)**: Primary facade for creating and managing missions.
- **[MissionExecutionService](./core/mission-execution.service.ts)**: Orchestrates the step-by-step execution logic.
- **[MissionLifecycleService](./core/mission-lifecycle.service.ts)**: Manages transitions through `pending`, `running`, `completed`, and `failed` states.
- **[MissionDependencyResolver](./core/mission-dependency-resolver.service.ts)**: Resolves upstream data requirements before execution.
- **[MissionRunService](./core/mission-run.service.ts)**: Manages instance-specific data for individual mission executions.

## Routes
- `GET /api/missions`: List all missions.
- `GET /api/mission-runs`: List historical and active runs.
- `POST /api/missions/delegate`: Trigger sub-agent delegation.

## Dependencies
- **Jobs Pod**: Executes individual task units within a mission.
- **Pipeline Pod**: provides the workflow templates used by missions.
- **Knowledge Pod**: Supplies semantic context for agentic missions.
- **Shared Messaging**: Publishes state updates to the Mission Event Bus.

## 🧪 Testing

The Mission pod uses a decentralized testing structure. Tests are colocated with the orchestration logic to ensure architectural integrity.

### Test Structure
- **[services/](./tests/services/)**: Focused tests for mission orchestration and lifecycle management (e.g., `dashboard`, `templates`).
  - **billing/**: Cost calculation and ROI analysis for missions.
- **[integration/](./tests/integration/)**: End-to-end mission execution flows and API audits.

### Running Tests
To run tests for this pod in isolation:
```bash
npx vitest server/domain/mission
```

## Testing Status
- [x] Core Services: 🟢 Decentralized tests passing for lifecycle and execution
- [x] Integration: 🟢 Hardened API audits and billing validation passing
