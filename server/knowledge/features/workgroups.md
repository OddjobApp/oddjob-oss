# Workgroups & Missions

Workgroups are the collaborative unit of the Oddjob platform. They represent a team of Agents (Jobs/Pipelines) working together towards a shared **Objective**.

## Core Concepts

### 1. Workgroup (`workgroups` table)
A persistent container for a team.
- **Objective**: The high-level goal (e.g., "Monitor competitor pricing and adjust our rates").
- **Blackboard**: A shared JSON memory state accessible by all members.
- **Members**: Jobs or Pipelines assigned to roles.

### 2. Member Roles
- **Primary Strategist**: The Supervisor Agent responsible for planning.
- **Member**: A worker agent (Job/Pipeline) that executes tasks.
- **Critic**: An agent that reviews outputs (Quality Control).
- **Gatekeeper**: Human-in-the-loop or innovative policy checker.

### 3. Mission (`missions` table)
An active "campaign" or execution run of the workgroup.
- **Status**: `active`, `paused`, `completed`, `failed`.
- **Mission Context**: Ephemeral state for the specific run.
- **Pipeline Execution**: The underlying orchestration engine process.

## The Blackboard System
The **Blackboard** is the central communication hub. It allows agents to share context without direct message passing.

### Structure
```json
{
  "messages": [
    { "role": "user", "content": "Update pricing for Q3", "timestamp": "..." }
  ],
  "sharedMemories": [
    { "source": "crawler-job", "observation": "Competitor X dropped price to $10", "timestamp": "..." }
  ],
  "strategicPlan": {
    "phase": "analysis",
    "nextSteps": ["scrape_competitor", "calculate_margin"]
  },
  "lastUserGuidance": {
    "content": "Focus on Enterprise plans only",
    "timestamp": "..."
  }
}
```

## Supervisor Architecture
Workgroups are typically led by a **Supervisor Agent** (Job Type: `supervisor`).
1. **User Input** → Blackboard (`lastUserGuidance`)
2. **Supervisor** reads Blackboard & Objective.
3. **Supervisor** formulates a Plan (which tools/pipelines to call).
4. **Supervisor** triggers Member Pipelines.
5. **Member Pipelines** execute and write results back to Blackboard (`add_shared_memory`).
6. **Supervisor** evaluates results and iterates.

## Operational Flows

### Launching a Mission
1. User defines Objective in Workgroup Settings.
2. User clicks "Launch Mission".
3. System creates a `Mission` record.
4. System triggers the `Mission Supervisor` pipeline.
5. Supervisor agent wakes up, reads Objective, and starts delegation.

### Mission Collaboration
- Agents use `update_blackboard` to share state.
- Agents use `add_shared_memory` to log key findings.
- Agents use `get_blackboard` to understand the current context.

## Mission Management
Missions are durable execution records. Advanced management features include:
- **Bulk Operations**: Select multiple missions to perform actions like deletion or status updates.
- **Resume Capabilities**: Missions waiting on files or human approval can be resumed manually or automatically via triggers.
- **Timeline Tracking**: View a detailed DAG (Directed Acyclic Graph) of the mission plan and execution checkpoints.

## Integration with Knowledge Graph
Workgroups are represented as Nodes in the Knowledge Graph.
- **Type**: `Workgroup`
- **Relationships**:
  - `MANAGES` → Entities (the things being worked on)
  - `HAS_MEMBER` → Jobs/Pipelines
  - `EXECUTED_MISSION` → Mission Nodes
