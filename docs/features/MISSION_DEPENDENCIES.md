# Mission Dependencies System

## Overview

The Mission Dependencies System enables complex multi-mission workflows by allowing missions to depend on each other. It supports sequential execution, fan-out, fan-in, and dependency graphs with cycle detection.

## Purpose

- **Sequential execution** - Mission B waits for Mission A
- **Fan-out** - One mission triggers multiple parallel missions
- **Fan-in** - Multiple missions must complete before next starts
- **Workflow orchestration** - Define complex mission pipelines
- **Dependency visualization** - Graph view of mission relationships

## Architecture

### Dependency Types

1. **Sequential** - Linear chain: A → B → C
2. **Fan-out** - One triggers many: A → [B, C, D]
3. **Fan-in** - Many complete before next: [A, B] → C
4. **Any-of** - Any dependency satisfied triggers next
5. **All-of** - All dependencies must be satisfied

### Dependency Conditions

- **completed** - Target finished (any status)
- **succeeded** - Target completed successfully
- **failed** - Target failed (useful for error handling)
- **any** - Any non-pending status

### Workflow Execution

```
Data Collection (A)
    ↓
Data Processing (B) ← depends on A:succeeded
    ↓
Analysis (C) ← depends on B:succeeded
    ↓
Report Generation (D) ← depends on C:succeeded
```

## MCP Tools

### add_mission_dependency
Create a dependency between missions.

**Input:**
```json
{
  "sourceMissionId": 200,
  "targetMissionId": 100,
  "type": "sequential",
  "condition": "succeeded"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "id": "dep_1713742800000_abc123",
    "sourceMissionId": 200,
    "targetMissionId": 100,
    "type": "sequential",
    "condition": "succeeded",
    "createdAt": "2024-04-21T10:30:00Z"
  }
}
```

### remove_mission_dependency
Remove a dependency.

**Input:**
```json
{
  "dependencyId": "dep_1713742800000_abc123"
}
```

### get_mission_dependencies
Get dependencies for a mission.

**Input:**
```json
{
  "missionId": 200
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "missionId": 200,
    "dependsOn": [
      {
        "id": "dep_123",
        "sourceMissionId": 200,
        "targetMissionId": 100,
        "type": "sequential",
        "condition": "succeeded"
      }
    ],
    "dependedBy": [
      {
        "id": "dep_456",
        "sourceMissionId": 300,
        "targetMissionId": 200,
        "type": "sequential",
        "condition": "completed"
      }
    ],
    "totalDependencies": 1,
    "totalDependents": 1
  }
}
```

### get_dependency_graph
Get full dependency graph with cycle detection.

**Input:**
```json
{
  "missionIds": [100, 200, 300]
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "missions": [
      { "missionId": 100, "name": "Data Collection", "status": "completed", "dependencies": [], "dependents": ["dep_123"] },
      { "missionId": 200, "name": "Data Processing", "status": "pending", "dependencies": ["dep_123"], "dependents": ["dep_456"] },
      { "missionId": 300, "name": "Analysis", "status": "pending", "dependencies": ["dep_456"], "dependents": [] }
    ],
    "edges": [
      { "id": "dep_123", "source": 200, "target": 100, "type": "sequential", "condition": "succeeded" },
      { "id": "dep_456", "source": 300, "target": 200, "type": "sequential", "condition": "completed" }
    ],
    "cycles": [],
    "hasCycles": false
  }
}
```

### check_dependencies_satisfied
Check if a mission is ready to run.

**Input:**
```json
{
  "missionId": 200
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "satisfied": true,
    "readyToRun": true,
    "blocking": [],
    "details": [
      {
        "dependency": { "id": "dep_123", ... },
        "targetStatus": "succeeded",
        "satisfied": true
      }
    ]
  }
}
```

### get_execution_order
Get topological sort for mission execution.

**Input:**
```json
{
  "missionIds": [100, 200, 300, 400]
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "order": [100, 200, 400, 300],
    "possible": true,
    "canExecute": true,
    "blocking": []
  }
}
```

### create_mission_workflow
Create a complex workflow with multiple dependencies.

**Input:**
```json
{
  "name": "ETL Pipeline",
  "definition": [
    { "missionId": 100 },
    { "missionId": 200, "dependsOn": [100], "type": "sequential", "condition": "succeeded" },
    { "missionId": 300, "dependsOn": [100], "type": "sequential", "condition": "succeeded" },
    { "missionId": 400, "dependsOn": [200, 300], "type": "fan_in", "condition": "all_of" }
  ]
}
```

### get_mission_workflows
Get all defined workflows.

## Usage

### Basic Dependency

```typescript
import { missionDependenciesService } from "./mission-dependencies.service.js";

// Mission 200 waits for Mission 100 to succeed
const dep = await missionDependenciesService.addDependency(
    200,    // source: waits/triggers
    100,    // target: must complete first
    'sequential',
    'succeeded'
);
```

### Fan-Out Pattern

```typescript
// When Mission A succeeds, trigger B, C, and D in parallel
await missionDependenciesService.addDependency(200, 100, 'fan_out', 'succeeded');
await missionDependenciesService.addDependency(300, 100, 'fan_out', 'succeeded');
await missionDependenciesService.addDependency(400, 100, 'fan_out', 'succeeded');
```

### Fan-In Pattern

```typescript
// Mission D waits for both B and C to complete
await missionDependenciesService.addDependency(500, 200, 'fan_in', 'completed');
await missionDependenciesService.addDependency(500, 300, 'fan_in', 'completed');
```

### Check Before Starting

```typescript
async function startMission(missionId: number) {
    const check = await missionDependenciesService.checkDependenciesSatisfied(missionId);
    
    if (!check.satisfied) {
        console.log(`Waiting for dependencies:`, check.blocking);
        return { started: false, reason: 'dependencies_not_met' };
    }
    
    // Start the mission
    return await missionService.startMission(missionId);
}
```

### Trigger Dependents

```typescript
// When a mission completes, trigger its dependents
async function onMissionComplete(missionId: number, runId: number, status: string) {
    const triggers = await missionDependenciesService.triggerDependents(
        missionId,
        runId,
        status
    );
    
    for (const trigger of triggers) {
        if (trigger.triggered) {
            console.log(`Triggered mission ${trigger.newRuns?.[0]?.missionId}`);
        }
    }
}
```

### Create Workflow

```typescript
const { workflowId, dependencies, graph } = await missionDependenciesService.createWorkflow(
    "Monthly Report Pipeline",
    [
        { missionId: 100 },                                    // Extract
        { missionId: 200, dependsOn: [100] },                  // Transform
        { missionId: 300, dependsOn: [200] },                  // Load
        { missionId: 400, dependsOn: [300] },                  // Analyze
        { missionId: 500, dependsOn: [400], type: 'fan_out' }, // Distribute
    ]
);

if (graph.cycles.length > 0) {
    console.error(`Cannot create workflow with cycles:`, graph.cycles);
}
```

## Integration with Mission Runner

Modify the mission runner to check dependencies:

```typescript
// In mission-run.service.ts start method
async start(missionId: number) {
    // Check dependencies first
    const depsCheck = await missionDependenciesService.checkDependenciesSatisfied(missionId);
    
    if (!depsCheck.satisfied) {
        throw new Error(
            `Cannot start mission ${missionId}: waiting for dependencies ` +
            depsCheck.blocking.map(d => d.targetMissionId).join(', ')
        );
    }
    
    // Start the mission
    const run = await this.createRun(missionId);
    
    // Trigger dependents when complete
    run.onComplete = async (status) => {
        await missionDependenciesService.triggerDependents(missionId, run.id, status);
    };
    
    return run;
}
```

## Event Integration

Subscribe to mission events for automatic triggering:

```typescript
// Listen for mission completion
eventStream.subscribe('mission.completed', async (event) => {
    const { missionId, runId, status } = event.data;
    
    await missionDependenciesService.triggerDependents(
        missionId,
        runId,
        status
    );
});
```

## Cycle Detection

The system automatically detects circular dependencies:

```typescript
const graph = await missionDependenciesService.buildDependencyGraph([100, 200, 300]);

if (graph.cycles.length > 0) {
    console.error(`Cycles detected:`);
    for (const cycle of graph.cycles) {
        console.log(`  ${cycle.join(' → ')} → (back to start)`);
    }
}
```

## Testing

Test file: `server/domain/mission/tests/mission-dependencies.service.test.ts`

```bash
npm test -- mission-dependencies.service.test.ts
```

### Manual Testing

```typescript
// Create a simple workflow
await missionDependenciesService.addDependency(2, 1, 'sequential', 'completed');
await missionDependenciesService.addDependency(3, 2, 'sequential', 'completed');

// Check execution order
const order = missionDependenciesService.getExecutionOrder([1, 2, 3]);
console.log(order.order); // [1, 2, 3]

// Check dependencies satisfied
const check = await missionDependenciesService.checkDependenciesSatisfied(2);
console.log(check.satisfied); // depends on mission 1 status
```

## Best Practices

1. **Avoid cycles** - Always check graph for cycles before creating dependencies
2. **Use appropriate conditions** - Don't use 'failed' unless you want error handling
3. **Fan-in limits** - Keep fan-in reasonable (5-10 missions max)
4. **Document workflows** - Name workflows clearly for operators
5. **Monitor dependency chains** - Long chains increase total execution time
6. **Handle timeouts** - Set timeouts on dependency waits

## Troubleshooting

### Mission won't start
- Check `check_dependencies_satisfied` for blocking dependencies
- Verify target missions have run
- Check dependency conditions match target status

### Infinite waiting
- Check for cycles in dependency graph
- Verify missions are actually completing (not stuck)
- Check event stream is delivering completion events

### Race conditions
- Use fan_in with all_of for synchronization
- Add small delays between dependent missions
- Use correlation IDs to trace execution order

## Future Enhancements

- [ ] Visual workflow builder UI
- [ ] Time-based dependencies (wait until time X)
- [ ] Conditional dependencies (if A succeeded do B, else C)
- [ ] Parallel execution limits (max concurrent in fan-out)
- [ ] Dependency retry policies
- [ ] Workflow templates and reusable patterns
- [ ] SLA tracking for dependency chains
