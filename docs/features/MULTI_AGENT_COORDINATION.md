# Multi-Agent Coordination

## Overview

The Multi-Agent Coordination Service enables specialized agents to collaborate on complex missions through role-based coordination, message passing, consensus building, and conflict resolution.

## Purpose

- **Specialized roles** - Different agents for planning, execution, review
- **Collaboration** - Agents work together on complex tasks
- **Consensus** - Democratic decision-making among agents
- **Conflict resolution** - Handle disagreements between agents
- **Coordination** - Orchestrate multi-agent workflows

## Architecture

### Agent Roles

```
Mission
├── Planner Agent      → Strategy, architecture, roadmap
├── Executor Agent     → Implementation, coding, testing
├── Reviewer Agent     → Quality, audit, validation
├── Specialist Agent   → Domain expertise, optimization
└── Coordinator Agent  → Facilitation, conflict resolution
```

### Coordination Flow

```
Complex Task
    ↓
Create Agents (roles based on needs)
    ↓
Assign Tasks to each Agent
    ↓
Agents Work + Message Each Other
    ↓
Consensus on Approach? → Vote
    ↓
Conflict Detected? → Resolve
    ↓
Review & Integrate Results
    ↓
Complete Mission
```

## MCP Tools

### create_agent
Create a specialized agent for a mission.

**Input:**
```json
{
  "missionId": 123,
  "name": "ArchitecturePlanner",
  "role": "planner",
  "specialties": ["microservices", "scalability"]
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "id": "agent_123_planner_1713742800000_abc123",
    "name": "ArchitecturePlanner",
    "role": "planner",
    "capabilities": {
      "canPlan": true,
      "canExecute": false,
      "canReview": true,
      "canMakeDecisions": true,
      "specialties": ["microservices", "scalability"],
      "maxConcurrentTasks": 3
    },
    "missionId": 123,
    "status": "idle",
    "currentTasks": [],
    "messages": [],
    "createdAt": "2024-04-21T10:30:00Z",
    "lastActiveAt": "2024-04-21T10:30:00Z"
  }
}
```

### get_agents
Get all agents for a mission.

**Input:**
```json
{
  "missionId": 123
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "id": "agent_123_planner_...",
        "name": "ArchitecturePlanner",
        "role": "planner",
        "status": "working",
        "currentTasks": ["task_1", "task_2"]
      }
    ],
    "total": 3,
    "byRole": {
      "planner": 1,
      "executor": 1,
      "reviewer": 1
    }
  }
}
```

### send_agent_message
Send a message between agents.

**Input:**
```json
{
  "fromAgentId": "agent_123_planner_...",
  "toAgentId": "agent_123_executor_...",
  "type": "task_assignment",
  "content": "Please implement the API layer according to the architecture document",
  "priority": "high",
  "requiresResponse": true
}
```

**Message Types:**
- `task_assignment` - Assign work to another agent
- `review_request` - Request code review
- `review_feedback` - Provide review comments
- `consensus_proposal` - Propose team decision
- `consensus_vote` - Cast vote on proposal
- `conflict_notification` - Alert about conflict
- `information_share` - Share knowledge
- `decision_request` - Ask for decision
- `status_update` - Report progress

### create_consensus_proposal
Create a proposal for agents to vote on.

**Input:**
```json
{
  "missionId": 123,
  "proposedBy": "agent_123_planner_...",
  "topic": "Database Selection",
  "proposal": "We should use PostgreSQL for the primary database",
  "options": ["postgresql", "mysql", "mongodb"],
  "deadline": "2024-04-21T12:00:00Z",
  "conclusionThreshold": 0.7
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "id": "consensus_123_1713742800000",
    "missionId": 123,
    "proposedBy": "agent_123_planner_...",
    "topic": "Database Selection",
    "proposal": "We should use PostgreSQL...",
    "options": ["postgresql", "mysql", "mongodb"],
    "votes": {},
    "status": "open",
    "deadline": "2024-04-21T12:00:00Z",
    "minParticipation": 2,
    "conclusionThreshold": 0.7,
    "createdAt": "2024-04-21T10:30:00Z"
  }
}
```

### cast_consensus_vote
Cast a vote on a proposal.

**Input:**
```json
{
  "consensusId": "consensus_123_1713742800000",
  "agentId": "agent_123_reviewer_...",
  "option": "postgresql"
}
```

When enough votes are cast to reach the conclusion threshold, the consensus is automatically concluded and all agents are notified.

### assign_agent_task
Assign a task to an agent.

**Input:**
```json
{
  "missionId": 123,
  "assignedBy": "agent_123_planner_...",
  "assignedTo": "agent_123_executor_...",
  "description": "Implement user authentication API",
  "priority": "high",
  "deadline": "2024-04-21T18:00:00Z",
  "reviewBy": "agent_123_reviewer_..."
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "id": "task_123_1713742800000_abc123",
    "missionId": 123,
    "assignedTo": "agent_123_executor_...",
    "assignedBy": "agent_123_planner_...",
    "description": "Implement user authentication API",
    "status": "pending",
    "priority": "high",
    "dependencies": [],
    "deliverables": [],
    "deadline": "2024-04-21T18:00:00Z",
    "createdAt": "2024-04-21T10:30:00Z",
    "reviewBy": "agent_123_reviewer_..."
  }
}
```

### update_agent_task_status
Update task progress.

**Input:**
```json
{
  "taskId": "task_123_1713742800000_abc123",
  "status": "completed",
  "result": { "filesChanged": ["auth.ts", "middleware.ts"] }
}
```

When status changes to `completed` and a reviewer is assigned, they automatically receive a review request.

### detect_conflict
Record a conflict between agents.

**Input:**
```json
{
  "missionId": 123,
  "agents": ["agent_123_planner_...", "agent_123_executor_..."],
  "type": "approach_disagreement",
  "description": "Disagreement on whether to use REST or GraphQL",
  "severity": "medium"
}
```

**Conflict Types:**
- `task_dispute` - Disagreement over task ownership
- `resource_contention` - Competing for same resources
- `approach_disagreement` - Different technical approaches
- `priority_conflict` - Conflicting priorities
- `deadlock` - Circular dependencies blocking progress

### get_mission_coordination_stats
Get coordination metrics.

**Output:**
```json
{
  "success": true,
  "data": {
    "agentCount": 5,
    "tasksByStatus": {
      "pending": 2,
      "in_progress": 3,
      "completed": 8,
      "failed": 0,
      "blocked": 1
    },
    "messagesExchanged": 45,
    "activeConsensus": 1,
    "openConflicts": 0,
    "avgTaskCompletionTime": 1800000
  }
}
```

## Usage

### Setting Up a Multi-Agent Mission

```typescript
import { multiAgentCoordinationService } from "./multi-agent-coordination.service.js";

async function setupComplexMission(missionId: number) {
    // Create specialized agents
    const planner = multiAgentCoordinationService.createAgent(
        missionId,
        "SystemArchitect",
        "planner"
    );
    
    const executor = multiAgentCoordinationService.createAgent(
        missionId,
        "CodeBuilder",
        "executor"
    );
    
    const reviewer = multiAgentCoordinationService.createAgent(
        missionId,
        "QualityGuardian",
        "reviewer"
    );

    // Assign tasks with dependencies
    const designTask = multiAgentCoordinationService.assignTask(
        missionId,
        "coordinator",
        planner.id,
        "Design the system architecture",
        { priority: "high" }
    );

    const buildTask = multiAgentCoordinationService.assignTask(
        missionId,
        planner.id,
        executor.id,
        "Implement the API layer",
        { 
            priority: "high",
            dependencies: [designTask.id],
            reviewBy: reviewer.id
        }
    );

    // Facilitate collaboration on a complex decision
    const { agents, tasks, consensus } = 
        multiAgentCoordinationService.facilitateCollaboration(
            missionId,
            "Database selection for high-scale system",
            ["planner", "specialist", "reviewer"]
        );

    return { planner, executor, reviewer, tasks };
}
```

### Agent Communication

```typescript
// Send direct message
multiAgentCoordinationService.sendMessage(planner.id, {
    toAgentId: executor.id,
    type: "task_assignment",
    content: "Start with the auth module",
    priority: "high",
    requiresResponse: true,
});

// Broadcast to all
multiAgentCoordinationService.sendMessage(planner.id, {
    type: "information_share",
    content: "Architecture document is ready",
    priority: "medium",
});
```

### Consensus Building

```typescript
// Create proposal
const consensus = multiAgentCoordinationService.createConsensusProposal(
    missionId,
    planner.id,
    "API Protocol",
    "Should we use REST or GraphQL for the public API?",
    ["rest", "graphql", "grpc"],
    { conclusionThreshold: 0.8 }
);

// Agents vote
multiAgentCoordinationService.castVote(consensus.id, planner.id, "rest");
multiAgentCoordinationService.castVote(consensus.id, reviewer.id, "rest");
multiAgentCoordinationService.castVote(consensus.id, executor.id, "graphql");

// Check result
const result = multiAgentCoordinationService.getConsensus(consensus.id);
if (result.status === "concluded") {
    console.log(`Decision: ${result.result}`); // "rest"
}
```

### Conflict Resolution

```typescript
// Detect conflict
const conflict = multiAgentCoordinationService.detectConflict(
    missionId,
    [planner.id, executor.id],
    "approach_disagreement",
    "Planner wants microservices, Executor prefers monolith",
    "high"
);

// Propose resolution
multiAgentCoordinationService.proposeResolution(
    conflict.id,
    coordinator.id,
    "Use modular monolith as stepping stone to microservices"
);

// Agents vote on resolution
multiAgentCoordinationService.voteOnResolution(
    conflict.id,
    0, // First proposed resolution
    planner.id,
    "support"
);

multiAgentCoordinationService.voteOnResolution(
    conflict.id,
    0,
    executor.id,
    "support"
);

// If majority supports, conflict is resolved
const resolved = multiAgentCoordinationService.getConflict(conflict.id);
console.log(resolved.status); // "resolved"
```

### Monitoring Coordination

```typescript
// Get statistics
const stats = multiAgentCoordinationService.getMissionStats(missionId);

console.log(`Active agents: ${stats.agentCount}`);
console.log(`Messages exchanged: ${stats.messagesExchanged}`);
console.log(`Open conflicts: ${stats.openConflicts}`);

// Check individual agents
const agents = multiAgentCoordinationService.getAgentsForMission(missionId);
for (const agent of agents) {
    console.log(`${agent.name} (${agent.role}): ${agent.status}`);
    console.log(`  Tasks: ${agent.currentTasks.length}`);
    console.log(`  Messages: ${agent.messages.length}`);
}
```

## Agent Roles

### Planner
- **Can**: Plan, Review, Decide
- **Cannot**: Execute
- **Best for**: Architecture, Strategy, Roadmaps
- **Max Tasks**: 3

### Executor
- **Can**: Execute
- **Cannot**: Plan, Review, Decide
- **Best for**: Implementation, Coding, Testing
- **Max Tasks**: 5

### Reviewer
- **Can**: Review, Decide
- **Cannot**: Plan, Execute
- **Best for**: Quality, Audits, Validation
- **Max Tasks**: 4

### Specialist
- **Can**: Plan, Execute, Review, Decide
- **Best for**: Domain expertise, Optimization
- **Max Tasks**: 2

### Coordinator
- **Can**: Everything + Facilitation
- **Best for**: Conflict resolution, Team management
- **Max Tasks**: 10

## Best Practices

1. **Choose roles wisely** - Match agent capabilities to mission needs
2. **Limit team size** - 3-5 agents per mission for efficiency
3. **Clear task assignments** - Define deliverables and deadlines
4. **Use consensus sparingly** - Only for major architectural decisions
5. **Resolve conflicts early** - Don't let disagreements fester
6. **Monitor communication** - High message count may indicate confusion
7. **Review regularly** - Use reviewer agents for quality gates

## Testing

Test file: `server/domain/mission/tests/multi-agent-coordination.service.test.ts`

```bash
npm test -- multi-agent-coordination.service.test.ts
```

### Manual Testing

```typescript
// Create test agents
const agent1 = multiAgentCoordinationService.createAgent(1, "Test1", "planner");
const agent2 = multiAgentCoordinationService.createAgent(1, "Test2", "executor");

// Test messaging
const msg = multiAgentCoordinationService.sendMessage(agent1.id, {
    toAgentId: agent2.id,
    type: "information_share",
    content: "Hello!",
    priority: "low",
});

// Check received
const messages = multiAgentCoordinationService.getMessages(agent2.id);
console.log(messages[0].content); // "Hello!"
```

## Integration with Mission Runner

```typescript
// In mission-run.service.ts
async function runMultiAgentMission(missionId: number, objective: string) {
    // Setup coordination
    const coordinator = multiAgentCoordinationService.createAgent(
        missionId, "Coordinator", "coordinator"
    );

    // Break down objective into tasks
    const tasks = await this.decomposeObjective(objective);
    
    // Assign to appropriate agents
    for (const task of tasks) {
        const role = this.determineRole(task);
        const agent = multiAgentCoordinationService.createAgent(
            missionId, `${role}_${task.id}`, role
        );
        
        multiAgentCoordinationService.assignTask(
            missionId,
            coordinator.id,
            agent.id,
            task.description,
            { priority: task.priority }
        );
    }

    // Wait for completion or consensus
    return this.monitorMissionProgress(missionId);
}
```

## Future Enhancements

- [ ] Dynamic role assignment based on task needs
- [ ] Agent reputation scoring
- [ ] Machine learning for optimal team composition
- [ ] Natural language agent conversations
- [ ] Agent specialization learning
- [ ] Cross-mission agent reuse
- [ ] Agent performance analytics
- [ ] Visual agent interaction diagrams
