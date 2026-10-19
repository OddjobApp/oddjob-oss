# UI Module: Pipeline

## Overview

The Pipeline UI module provides the front-end components for creating, managing, and monitoring automated workflows. It contains the visual builder and dashboards that make the `pipeline/core` services accessible to users.

## Key Features & Components

- **Pipeline Builder:** A visual, drag-and-drop interface for constructing pipelines. Users can drag different steps (e.g., "Run a Job," "Call an Agent," "Trigger Integration") onto a canvas and connect them to define the workflow logic.
- **Pipeline Dashboard:** A dashboard that lists all defined pipelines, showing their status, their schedule or trigger, and the success/failure history of their recent runs.
- **Pipeline Run Viewer:** A detailed view of a single execution of a pipeline. It visually shows the progress of the run, highlighting the current step and displaying the logs and outputs for each completed step.
- **Scheduler/Trigger Configuration:** Forms and controls within the builder that allow a user to define when a pipeline should run, whether it's on a recurring schedule (cron) or in response to a specific event.

## Data Flow

The Pipeline Builder is a highly interactive component that communicates with the `pipeline-definition.service.ts` to save and update pipeline structures. The dashboard and run viewer fetch their data from the `pipeline-engine.service.ts`, which provides the status and history of all pipeline executions. Triggering a pipeline manually from the UI sends a request to the `pipeline-engine.service.ts` to start a new run.
