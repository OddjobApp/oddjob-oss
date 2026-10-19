# Core Services: Pipeline Domain

## Overview

The `pipeline` domain provides the services for creating, managing, and executing automated workflows, or "Pipelines." A Pipeline is a sequence of processing steps that are chained together to perform a complex task, such as data ingestion and transformation, CI/CD for App Forge builds, or periodic analysis.

This domain abstracts the complexity of workflow orchestration, allowing developers and the system itself to define powerful, repeatable processes.

## Core Responsibilities

- **Pipeline Definition:** Provides services and schemas for defining the structure of a pipeline, including its individual steps, their order, and how data flows between them.
- **Execution Engine:** Manages the execution of pipeline runs. It triggers the first step and orchestrates the flow of control and data to subsequent steps based on the pipeline's definition.
- **Step Execution:** Integrates with other domains to execute the logic for each step. For example, a pipeline step might invoke a `job`, call an `agent`, or trigger an `integration`.
- **State and Logging:** Tracks the state of each pipeline run and logs the inputs, outputs, and status of every step for debugging and auditing purposes.
- **Scheduling and Triggers:** Includes services for scheduling pipelines to run at specific times (e.g., using cron expressions) or for triggering them based on events (e.g., a new file landing in a specific directory).

## Key Services

- **`pipeline-engine.service.ts`:** The core orchestrator that manages the lifecycle of a pipeline run.
- **`pipeline-definition.service.ts`:** Handles the creation, validation, and storage of pipeline definitions.
- **`pipeline-scheduler.service.ts`:** Manages the scheduling and event-based triggering of pipelines.

## Interactions with Other Domains

- **`jobs`:** Often uses the `jobs` domain to execute individual pipeline steps as isolated, background processes.
- **`apps`:** The App Forge heavily relies on the `pipeline` domain to define and execute the multi-wave build process for creating new applications.
- **`integrations`:** Pipelines are frequently used to orchestrate data flows between the platform and external systems via the `integrations` domain.
- **`knowledge`:** A common use case for pipelines is to define a workflow for ingesting data from a source, processing it, and indexing it into the `knowledge` base.
