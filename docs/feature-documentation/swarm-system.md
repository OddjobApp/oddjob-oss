# Multi-Agent Swarming System

## Overview

The Swarm System enables multiple AI agents to collaborate as a decentralized collective, making decisions through consensus, sharing knowledge via a blackboard, and resolving conflicts automatically.

## Key Capabilities

- **Consensus-Based Decisions**: Multiple algorithms (simple majority, super majority, unanimous, confidence-weighted, BFT-tolerant)
- **Specialized Roles**: Coordinator, Strategist, Executor, Critic, Researcher, Innovator, Communicator, Monitor, Arbiter
- **Shared Blackboard**: CRDT-based distributed memory with hierarchical keys and real-time sync
- **Conflict Resolution**: Automatic mediation, arbitration, compromise finding, and escalation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Swarm Coordinator                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Consensus  │  │  Blackboard  │  │   Conflict   │      │
│  │   Service    │  │   Service    │  │  Resolution  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │ Agent 1 │◄─────►│ Agent 2 │◄─────►│ Agent 3 │
   │Critic   │       │Executor │       │Researcher
   └─────────┘       └─────────┘       └─────────┘
```

## Quick Start

### Creating a Swarm

```typescript
import { swarmCoordinator } from "@domain/agents/core/swarm";

// Create swarm
const swarm = await swarmCoordinator.createSwarm({
  name: "Code Review Squad",
  organizationId: 1,
  goal: "Review and improve code quality"
});

// Add agents with roles
await swarmCoordinator.joinSwarm(swarm.id, "agent-1", { 
  role: "critic", 
  autoAssignRole: false 
});
await swarmCoordinator.joinSwarm(swarm.id, "agent-2", { 
  autoAssignRole: true 
}); // Auto-assigned based on swarm composition
```

### Proposing and Voting

```typescript
// Propose a change
const proposal = await swarmCoordinator.propose(
  swarm.id,
  "agent-1",           // proposer
  "code_change",       // proposal type
  {                    // payload
    file: "src/main.ts",
    change: "refactor function"
  },
  {
    algorithm: "confidence_weighted",
    timeoutMs: 30000,
    requiredQuorum: 3
  }
);

// Agents vote
await swarmCoordinator.vote(
  swarm.id,
  "agent-1",
  proposal.id,
  "yes",
  0.9,                 // confidence
  "Improves readability" // reasoning
);

// Check result
const result = consensusService.getProposal(proposal.id);
if (result.status === "accepted") {
  await swarmCoordinator.execute(swarm.id, "agent-2", proposal.id);
}
```

### Using the Blackboard

```typescript
// Write to shared memory
await swarmCoordinator.writeToBlackboard(
  swarm.id,
  "agent-1",
  "review.notes",
  { findings: ["Issue A", "Issue B"] }
);

// Read from blackboard
const notes = await swarmCoordinator.readFromBlackboard(
  swarm.id,
  "agent-2",
  "review.notes"
);

// Subscribe to updates
const blackboard = swarmCoordinator.getBlackboard(swarm.id);
const unsubscribe = blackboard.subscribe((event) => {
  console.log(`Key ${event.key} ${event.type} by ${event.modifiedBy}`);
});
```

## Consensus Algorithms

### Simple Majority
Requires 50% + 1 votes. Fast but can be split.

### Super Majority
Requires 66% + 1 votes. More conservative, reduces contentious decisions.

### Unanimous
Requires 100% agreement. Use for critical security decisions.

### Confidence-Weighted
Votes weighted by agent confidence and reputation. Best for heterogeneous swarms.

### BFT-Tolerant
Byzantine fault tolerant. Tolerates `f` faulty agents where `n >= 3f + 1`.

## Role Definitions

| Role | Can Propose | Can Vote | Can Execute | Priority |
|------|-------------|----------|-------------|----------|
| **Coordinator** | ✅ | ✅ | ❌ | 1.2 |
| **Strategist** | ✅ | ✅ | ❌ | 1.1 |
| **Executor** | ✅ | ✅ | ✅ | 1.0 |
| **Critic** | ❌ | ✅ | ❌ | 1.15 |
| **Researcher** | ✅ | ✅ | ✅ | 1.0 |
| **Innovator** | ✅ | ✅ | ❌ | 0.9 |
| **Communicator** | ✅ | ✅ | ❌ | 1.0 |
| **Monitor** | ✅ | ✅ | ❌ | 1.05 |
| **Arbiter** | ❌ | ✅ | ❌ | 1.25 |

## Conflict Resolution

### Detection
Conflicts are detected when:
- Proposal reaches "disputed" status (tie vote)
- Agents explicitly signal disagreement
- Deadlock in consensus

### Strategies
1. **Mediation**: Structured negotiation over multiple rounds
2. **Arbitration**: Binding decision by designated arbiter
3. **Compromise**: Merge conflicting proposals or alternate access
4. **Escalation**: Hand off to human for unresolvable conflicts

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/swarms` | Create swarm |
| GET | `/api/swarms` | List swarms |
| GET | `/api/swarms/:id` | Get swarm |
| POST | `/api/swarms/:id/join` | Add agent |
| POST | `/api/swarms/:id/leave` | Remove agent |
| POST | `/api/swarms/:id/proposals` | Create proposal |
| POST | `/api/swarms/:id/proposals/:pid/vote` | Vote |
| POST | `/api/swarms/:id/blackboard` | Write to blackboard |
| GET | `/api/swarms/:id/health` | Health check |
| GET | `/api/swarms/:id/metrics` | Swarm metrics |

## React Hooks

```typescript
import { useSwarm, useSwarmProposals, useBlackboard } from "@/modules/agents/hooks/use-swarm";

// Manage swarm
const { swarm, createProposal, vote } = useSwarm("swarm-id");

// Track proposals
const { proposals, activeCount } = useSwarmProposals("swarm-id");

// Blackboard access
const { data, write, subscribe } = useBlackboard("swarm-id", "namespace");
```

## Testing

```bash
# Run swarm tests
pnpm test server/domain/agents/core/swarm/consensus.service.test.ts
```

## Best Practices

1. **Minimum 3 agents** for robust consensus
2. **Mix roles** - don't have all executors or all critics
3. **Use confidence-weighted** for heterogeneous agent capabilities
4. **Set reasonable timeouts** - 30s default, longer for complex decisions
5. **Monitor health** - check swarm health dashboard regularly
6. **Handle conflicts gracefully** - have escalation path ready

## Metrics to Monitor

- Consensus acceptance rate (target: >70%)
- Average consensus time (target: <30s)
- Conflict escalation rate (target: <10%)
- Agent participation rate (target: >80%)
- Blackboard contention (keys with frequent concurrent writes)

## Future Enhancements

- Dynamic role reassignment based on performance
- Machine learning for optimal consensus algorithm selection
- Predictive conflict detection
- Cross-swarm collaboration protocols
- Human-in-the-loop optimization
