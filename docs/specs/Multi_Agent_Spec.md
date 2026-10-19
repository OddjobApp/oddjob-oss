# Decentralized Multi-Agent Coordination Spec

## Status

Initial runtime substrate implemented in `server/domain/mission/core/multi-agent-coordination.service.ts`.
Affordance memory implemented in `server/domain/mission/core/affordance-map.service.ts`.

This spec replaces the earlier Python-oriented sketch with the Oddjob mission-domain implementation path. The goal is to make decentralized coordination useful immediately while producing the traces needed for later affordance learning, world-model plasticity, and HRL/meta-controller training.

## Problem

Oddjob can already model missions, agents, delegation, mission blackboards, and execution traces. The missing capability is decentralized collaboration: multiple specialized agents need a shared workspace where they can discover goals, claim work, publish observations, resolve disputes, and leave structured coordination history without one planner micromanaging every action.

## Goals

- Spawn or reuse a role-based pool of specialized mission agents.
- Share mission state through a typed blackboard that supports mission, role, and agent visibility.
- Allow workers to claim available work when another worker is offline or overloaded.
- Capture coordination trajectories as training data for future HRL/meta-controller policies.
- Preserve the existing mission service architecture and MCP-facing coordination APIs.

## Non-Goals

- No live RL training in this slice.
- No Redis/database persistence in this slice; the service remains in-memory like the existing coordination service.
- No new Python agent runtime in this slice.
- No autonomous execution of arbitrary external tools from the coordinator pool until governance hooks are attached.

## Architecture

### Coordinator Pool

`createCoordinatorPool(missionId, config)` creates or reuses:

- one `coordinator` agent
- one worker per required role
- optional seeded tasks
- optional `mission.goal` blackboard item

The coordinator is a facilitator. It creates shared context, assigns seed work, and can later be wired to mission supervisor policies.

### Shared Blackboard

`BlackboardItem` represents shared coordination knowledge:

- `goal`: high-level mission objective
- `observation`: discovered fact
- `hypothesis`: proposed explanation or strategy
- `request`: request for another agent
- `result`: completed work output
- `constraint`: guardrail or limitation
- `affordance`: discovered action opportunity
- `meta_trajectory`: high-level planning trace

Visibility supports:

- `mission`: all mission agents
- `role`: agents with a target role
- `agent`: one target agent

This gives agents a way to coordinate without requiring the coordinator to route every message.

### Decentralized Task Claiming

`claimNextTask(missionId, agentId)` lets an available agent claim the highest-priority pending task whose current assignee is offline. This is intentionally conservative. Future versions can expand claiming to overloaded agents, expired leases, or stalled work after the task-state manager is connected.

### Coordination Trajectories

Every important coordination event can be logged as a `CoordinationTrajectory`:

- agent created
- task assigned
- task claimed
- task started
- task completed
- task failed
- task blocked
- blackboard posted
- consensus reached

Trajectories include optional `rewardHint`, `state`, and `outcome`. These are deliberately lightweight, so later HRL work can train on real Oddjob behavior without retrofitting trace capture.

## Current Implementation

Implemented in `multi-agent-coordination.service.ts`:

- `BlackboardItem`
- `CoordinatorPoolConfig`
- `CoordinationTrajectory`
- `postBlackboardItem`
- `readBlackboard`
- `claimNextTask`
- `createCoordinatorPool`
- `getTrajectoriesForMission`
- automatic trajectory logging for agent, task, blackboard, and consensus events
- system-message delivery fix for conflict resolution

Exposed through MCP:

- `create_coordinator_pool`
- `post_agent_blackboard_item`
- `read_agent_blackboard`
- `claim_agent_task`
- `get_coordination_trajectories`

## Affordance Memory

Implemented in `affordance-map.service.ts`:

- `recordObservation`
- `queryAffordances`
- `suggestActions`
- `mergeObservation`
- `getMissionStats`

An affordance observation links:

- a state descriptor, such as a UI button, API endpoint, file, tool, or system surface
- an action, such as click, type, call, read, write, or execute
- an outcome, including success/failure/unknown status, evidence, confidence, and reward hint

Affordance observations can be published onto the multi-agent blackboard as `affordance` items, which lets other agents use exploration results without direct message routing.

Exposed through MCP:

- `record_affordance_observation`
- `query_affordances`
- `suggest_affordance_actions`

Tests added in `server/domain/mission/tests/multi-agent-coordination.service.test.ts` cover:

- mission-visible blackboard posts
- role-targeted blackboard posts
- cross-mission write rejection
- task claiming from an offline assignee
- coordinator pool creation with seed tasks
- lifecycle trajectory logging

## Next Slices

1. Persist blackboard items and trajectories.
2. Add task leases and stale-task claiming.
3. Persist affordance observations.
4. Connect document-derived knowledge to blackboard observations and constraints.
5. Add exploration-mode runners that probe UIs/APIs and write affordance observations.
6. Add a simple meta-controller interface that reads trajectories and proposes sub-goals before any PPO-style training.

## Success Criteria

- A complex mission can create a role-based agent pool.
- Agents can discover the goal from the blackboard.
- Agents can publish observations/results without direct routing.
- Another worker can take over pending work from an offline assignee.
- Coordination history is queryable and suitable for offline policy training.
