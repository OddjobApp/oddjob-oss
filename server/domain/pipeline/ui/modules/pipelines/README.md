# 🏗️ Pipelines Module (`client/src/modules/pipelines`)

The Pipelines Module provides a visual, node-based interface for designing, configuring, and monitoring automated workflows. It allows users to chain together multiple jobs, define data mappings between steps, and track complex executions in real-time.

## Mach 3 UI Role: `mission`
In the Mach 3 distributed architecture, this module acts as the control plane for **Pipeline Definitions**. It interacts with the backend pipeline pod to validate workflow topologies and monitor the execution progress of distributed tasks across the `worker` pods.

## Core Pages
- **[PipelinesPage](./pages/Pipelines.tsx)**: Manage existing pipeline templates and view historical execution data.
- **[PipelineEditor](pages/PipelineEditor.tsx)**: Full-screen visual editor for building and modifying workflows.
- **[PipelineExecutionDetail](./pages/PipelineExecutionDetail.tsx)**: Real-time monitoring view for a specific pipeline run, with node-level status and logs.
- **[TemplateWizard](./pages/TemplateWizard.tsx)**: Streamlined guide for creating new pipelines from pre-defined blueprints.

## Key Components
- **[PipelineCanvas](./components/PipelineCanvas.tsx)**: Interactive node-based workspace powered by **React Flow**.
- **StepConfigurator**: Form-based interface for configuring parameters and inputs for individual pipeline steps.
- **PipelineNode**: Customizable React Flow nodes representing different job types and control structures.
- **[ExecutionTimeline](./components/ExecutionTimeline.tsx)**: Gantt-style view of parallel and sequential task timing.

## Hooks & State
- **`usePipelineData`**: Fetches and caches pipeline templates.
- **`usePipelineExecution`**: Tracks the live state and progress of active pipeline runs via WebSockets.
- **`usePipelineGraph`**: Manages the local state of the visual DAG (nodes and edges) before saving to the backend.

## API Integration
- `GET /api/pipelines`: Fetch available templates.
- `POST /api/pipelines`: Create or update a workflow definition.
- `GET /api/pipelines/executions/:id`: Monitor runtime metrics.

## Testing Status
- [ ] Editor Logic: 🟡 UI interaction and node placement verified via manual testing
- [ ] Execution Sync: 🟢 Real-time updates validated against simulated mission runs
