# 🛠️ Jobs Pod (`server/domain/jobs`)

The Jobs Pod is the task execution engine of Oddjob. It defines 40+ specialized executors (API, Shell, AI, Database, etc.) and manages the configuration, testing, and lifecycle of individual automation units.

## Mach 3 Service Role: `worker` / `mission`
In the Mach 3 distributed architecture:
- **Worker Pod**: Executes the actual job logic for heavy I/O or compute tasks (e.g., Selenium, Large Data Transformations).
- **Mission Pod**: Orchestrates the sequential execution of jobs within a pipeline and handles high-level status updates.
- **Forge Pod**: Uses the `JobSynthesisService` to generate new job definitions based on AI-driven mission goals.

## Key Services
- **[JobService](./job.service.ts)**: Primary facade for job CRUD and configuration management.
- **[JobTestService](./job-test.service.ts)**: Provides an isolated environment for testing job configurations before deployment.
- **[JobSynthesisService](./job-synthesis.service.ts)**: (Mach 3) Offloads complex agent/job creation to the Forge Service via an asynchronous queue.
- **[Executors](./core/executors/index.ts)**: Contains the implementation for all supported job types (e.g., `YoutubeSyncExecutor`, `AiAgentExecutor`).

## Routes
- `GET /api/jobs`: List all job templates for the organization.
- `POST /api/jobs/:id/run`: Trigger an immediate execution.
- `POST /api/jobs/:id/test`: Execute a job in test mode with parameter overrides.
- `GET /api/job-types`: List all available executors and their schemas.

## Dependencies
- **Auth Pod**: Ensures jobs are scoped to the correct organization and user.
- **Knowledge Pod**: Supplies RAG assets and documents for AI-related executors.
- **Shared Messaging**: Listens for `job_execution_queue` events in the `worker` role.
- **Credentials Pod**: Provides secure tokens and keys for external service integrations.

## 🧪 Testing

The Jobs pod uses a decentralized testing structure aligned with the Mach 3 architecture. Tests are colocated with the domain logic to ensure self-containment.

### Test Structure
- **[unit/](./tests/unit/)**: Unit tests for core job logic, executors, and utility functions (e.g., `hardening`, `mcp`).
- **[integration/](./tests/integration/)**: Integration tests for API endpoints and complex job workflows.
- **[services/](./tests/services/)**: Focused tests for individual job services (e.g., `JobSynthesisService`).
  - [executors/](./tests/services/executors/): Specialized test suites for the 40+ job executors.
  - [agent/](./tests/services/agent/): Logic tests for the autonomous agent and mission orchestration.

### Running Tests
To run tests for this pod in isolation:
```bash
npx vitest server/domain/jobs
```

## Testing Status
- [x] Core Service: 🟢 Hardened tests passing for `job-synthesis` and `youtube-sync`
- [x] Executors: 🟢 Decentralized coverage across 40+ types
- [x] Mock Isolation: 🟢 Hardened mocks established for Mach 3 stabilization
