# UI Module: Mission

## Overview

The Mission UI module is the primary operational view for users to monitor and interact with their tasks. It provides the front-end components for launching new missions, tracking the progress of active missions, and reviewing the results of completed ones.

This module visualizes the complex orchestration happening in the `mission/core` domain.

## Key Features & Components

- **Mission Control Dashboard:** A central dashboard that lists all missions, filterable by status (`in-progress`, `completed`, `failed`, `paused`). It provides a high-level overview of all activity.
- **Mission Detail Page (`MissionDetail.tsx`):** A detailed view of a single mission. It shows the mission's objectives, its current status, and a step-by-step log of its execution. It includes controls to `Pause`, `Resume`, or `Abort` the mission.
- **System Explorer Page (`SystemExplorerPage.tsx`):** The home of the "X-Ray" feature. This page displays a `react-flow` dependency graph, visualizing the relationships between missions, agents, pipelines, and other system components. It allows users to visually explore the architecture of their tasks.
- **Mission Launch Form:** A form where users can define the objective for a new mission and kick off the planning and execution process.

## Data Flow

Components in this module heavily consume data from the `mission` API. The Mission Control dashboard fetches a list of all missions. The `MissionDetail.tsx` page often uses WebSockets to receive real-time updates on a mission's progress. The `SystemExplorerPage.tsx` fetches its graph data from the `xray` domain's API to render the dependency visualization. User actions like pausing a mission trigger API calls to the `mission-orchestrator.service.ts`.
