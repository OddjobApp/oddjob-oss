# ⚙️ Slice 20: Pipeline Execution Logic and New Entities

This slice introduces the core logic and data structures for executing and tracking the flow of the new **Pipeline** entity. It establishes the sequential and conditional nature of the workflow and provides a foundation for future monitoring features.

---

## 1. New Data Model

A new entity is required to record the history of a pipeline run.

| **Entity**                     | **Details**                                                                                                   | **Conceptual Code Updates**           |
|--------------------------------|---------------------------------------------------------------------------------------------------------------|----------------------------------------|
| **MOCK_PIPELINE_EXECUTIONS**   | Stores the run history of pipelines. Fields include `pipelineExecutionId`, `pipelineId`, `startTime`, `endTime`, `executionStatus` (e.g., completed, failed), and `steps` (array of Job Execution IDs). | New MOCK Data 1                       |
| **nextPipelineExecutionId**    | Counter for new pipeline execution records.                                                                  | New MOCK Data 2                       |
| **pipelineExecutionId (to MOCK_EXECUTIONS)** | Updates existing `MOCK_EXECUTIONS` to include `pipelineExecutionId` for linking job runs back to the parent workflow. | Update to existing MOCK Data structure |

---

## 2. Core Execution Logic

The new utility function handles the conditional execution flow defined by the pipeline.

| **Function**                        | **Purpose**                                      | **Logic Overview**                                                                 |
|-------------------------------------|--------------------------------------------------|-------------------------------------------------------------------------------------|
| **createMockPipelineExecution(pipeline)** | Simulates the execution of the entire pipeline workflow. | 1. Creates a new PipelineExecution record.<br>2. Iterates through ordered steps.<br>3. Checks `successCondition` (previous_step_success or always).<br>4. Calls modified `createMockExecution` passing `pipelineExecutionId`.<br>5. Stops on first failed step.<br>6. Updates `executionStatus` and `endTime`. |
| **createMockExecution**            | Updated function to support pipeline context.    | Accepts optional `pipelineExecutionId` and includes it in the execution record.    |

---

## 3. API Updates

New and modified API endpoints for managing and tracking pipeline executions:

| **API Method**                  | **Change Description**                                                                 |
|---------------------------------|----------------------------------------------------------------------------------------|
| **api.createPipeline**          | Modified to automatically call `createMockPipelineExecution` upon creation.           |
| **api.getPipelineExecutions**   | New endpoint to retrieve all pipeline executions, applying RLS and sorting by time.   |
| **api.getPipelineExecution(id)**| Fetch details of a single pipeline execution, including pipeline definition and related job executions. |
| **api.getAlerts**               | Updated to include pipeline failure alerts in `MOCK_ALERTS`.                          |
