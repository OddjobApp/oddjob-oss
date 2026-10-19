# 🏗️ Pipeline Pod (`server/domain/pipeline`)

The Pipeline Pod manages the definition, validation, and visual representation of automated workflows. It serves as the engine for sequential and parallel task execution, providing the logic for input/output mapping between steps.

## Mach 3 Service Role: `mission` / `worker`
In the Mach 3 distributed architecture:
- **Mission Pod**: Coordinates the high-level execution flow and step transitions for pipelines.
- **Worker Pod**: Executes individual steps (as defined by the Pipeline Engine) that require intense computation or external I/O.

## Key Services
- **[PipelineEngine](./core/pipeline-engine.ts)**: Validates and decomposes pipelines into executable steps.
- **[ExecutionManager](./core/execution-manager.ts)**: Handles the runtime state of a pipeline execution.
- **[PipelineMonitor](./core/pipeline-monitor.ts)**: Provides real-time metrics and health checks for active workflows.
- **[PipelineTriggerService](./core/pipeline-trigger.service.ts)**: Routes external events (webhooks, schedules) to trigger specific pipelines.
- **[PipelineGraph](./core/pipeline-graph.ts)**: manages the visual representation and layout of the workflow canvas.

## Routes
- `GET /api/pipelines`: List all pipeline templates.
- `POST /api/pipelines`: Create a new workflow.
- `POST /api/pipelines/:id/run`: Trigger an ad-hoc execution.

## Dependencies
- **Jobs Pod**: Provides the underlying executors for each pipeline step.
- **Auth Pod**: Enforces organization-level access to pipeline definitions and results.
- **Observability Hub**: Consumes execution events for distributed tracing.

## 🧪 Testing

The Pipeline pod uses a decentralized testing structure. Tests are colocated with the workflow logic to ensure architectural integrity.

### Test Structure
- **[services/](./tests/services/)**: Focused tests for the pipeline engine, execution manager, and schema validation (e.g., `schema-comparison`).
- **[integration/](./tests/integration/)**: End-to-end pipeline execution flows and deep API audits.

### Running Tests
To run tests for this pod in isolation:
```bash
npx vitest server/domain/pipeline
```

## Testing Status
- [x] Core Services: 🟢 Decentralized tests passing for engine and execution
- [x] UI/Components: 🟢 Integrated tests for React Flow and canvas logic passing
