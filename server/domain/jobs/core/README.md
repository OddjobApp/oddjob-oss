
# Jobs Core Services

This module is the workhorse of the Oddjob platform. It contains the core services and infrastructure for defining, scheduling, and executing all background jobs.

## The Executor Pattern

The `executors/` directory is the heart of this module. It follows a powerful and extensible **Executor Pattern**. Each file in this directory is a self-contained "Executor" responsible for a single, specific type of job. This makes the system incredibly easy to extend: to add a new type of job, you simply need to create a new Executor file.

### Key Executor Types

- **AI & Agent Executors:**
    - `ai-agent-executor.ts`: Runs a full AI agent to accomplish a complex, multi-step task.
    - `ai-api-executor.ts`: Makes a single, direct call to an AI model.
    - `selenium-job-executor.ts`: Executes a browser automation job using the "Ghost Runner."

- **Integration & Sync Executors:**
    - `confluence-sync-executor.ts`: Syncs data from a Confluence space.
    - `jira-sync-executor.ts`: Syncs data from a Jira project.
    - `google-drive-sync-executor.ts`: Syncs files from Google Drive.

- **Code & Script Executors:**
    - `python-executor.ts`: Executes a Python script.
    - `node-executor.ts`: Executes a Node.js script.
    - `shell-executor.ts`: Executes a shell command.

- **Utility & Orchestration Executors:**
    - `human-approval-executor.ts`: Pauses a workflow and waits for a human to approve or reject it via the Decision Inbox.
    - `iterator-executor.ts`: Loops over a list of items and runs a sub-job for each one.
    - `dispatcher-executor.ts`: A powerful meta-executor that can dynamically dispatch to other executors based on its input.

## Other Core Services

- **`job-health.service.ts`**: Monitors the health and status of running and completed jobs.
- **`streaming-logs.service.ts`**: Provides the infrastructure for streaming real-time logs from a running job to the frontend.
- **`token-tracking.service.ts`**: Tracks the AI token consumption for each job, feeding that data into the `analytics` domain.
- **`wakeup-agents.job.ts`**: The scheduled job responsible for waking up hibernating "Ghost Runner" agents to continue their long-running missions.
