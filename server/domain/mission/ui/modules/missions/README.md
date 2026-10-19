# 🚀 Missions Module (`client/src/modules/missions`)

The Missions Module is the primary user interface for orchestrating and monitoring high-autonomy agentic workflows. It provides real-time visibility into mission progress, agent thought streams, and cross-team collaboration via a centralized "Activity Center" and "Mission Dashboard."

## Mach 3 UI Role: `mission`
In the Mach 3 distributed architecture, this module provides the user interface for the **Mission Service**. It visualizes the state transitions managed by the backend mission pod, allowing users to track multi-step goals, review deliverables, and intervene in Human-In-The-Loop (HIL) decision points.

## Core Pages
- **[MissionsPage](./pages/Missions.tsx)**: Global overview of all active and archived missions.
- **[CreateMissionPage](./pages/CreateMission.tsx)**: Multi-step wizard for defining goals, assembling agent teams, and pre-flight validation.
- **[MissionDetailPage](./pages/MissionDetail.tsx)**: Real-time execution monitor with live logs and state tracking.
- **[ActivityCenterPage](./pages/ActivityCenter.tsx)**: Unified feed of all agent activities and system events across the organization.

## Key Components
- **[MissionTracker](./components/MissionTracker.tsx)**: Visual progress bar and milestone tracker for individual missions.
- **[MissionChat](./components/MissionChat.tsx)**: Interactive interface for communicating with active agent teams.
- **[BlackboardExplorer](./components/BlackboardExplorer.tsx)**: Inspects the shared "Blackboard" state used by agents during execution.
- **[ThoughtStream](./components/ThoughtStream.tsx)**: Displays the real-time cognitive trace and reasoning of agents for transparency.
- **[WorkstreamGraph](./components/WorkstreamGraph.tsx)**: Visualizes the DAG of task dependencies within a mission.

## Hooks & State
- **`useMissionData`**: Fetches and caches mission metadata using React Query.
- **`useMissionExecution`**: Manages real-time updates for active mission runs via WebSockets/SSE.
- **`useMissionMutations`**: Provides functions for creating, cancelling, and archiving missions.

## API Integration
- `GET /api/missions`: Core mission listing.
- `POST /api/missions/delegate`: Triggering sub-missions.
- `GET /api/mission-runs/:id`: Fetching granular execution data.

## Testing Status
- [ ] UI Components: 🟡 Verified via Storybook and manual testing
- [ ] Data Flows: 🟢 Integration tests for mission creation and tracking passing
