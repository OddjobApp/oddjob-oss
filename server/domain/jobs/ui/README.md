# UI Module: Jobs

## Overview

The Jobs UI module provides a low-level view into the platform's background job processing system, which is powered by `bullmq`. This interface is typically used by administrators and developers for debugging and monitoring the health of the job queues.

It provides a visual representation of the activity managed by the `jobs/core` services.

## Key Features & Components

- **Queue Dashboard:** A dashboard that provides a real-time overview of all job queues. It displays the number of jobs that are waiting, active, completed, or failed for each queue (e.g., `forge-jobs`, `agent-tasks`, `integration-webhooks`).
- **Job Inspector:** A detailed view that allows a user to inspect a specific job. It shows the job's ID, its payload (the data it's processing), its current status, and a log of its execution attempts.
- **Queue Management Controls:** UI elements that allow administrators to perform actions on a queue, such as pausing it, clearing all jobs, or retrying all failed jobs.

## Data Flow

The components in this module interact with the `jobs` domain's API, which in turn queries the underlying `bullmq` and Redis infrastructure to get real-time data about the state of the queues and jobs. Actions taken in the UI (like retrying a job) trigger the corresponding management functions in the `job-executor.service.ts`.
