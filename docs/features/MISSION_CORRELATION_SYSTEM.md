# Mission Correlation System

## Overview

The Mission Correlation System provides distributed tracing capabilities for mission execution, enabling end-to-end visibility across services, components, and execution boundaries.

## Purpose

- **Trace mission execution** across all services
- **Correlate logs** from different components
- **Debug distributed issues** by following the correlation chain
- **Analyze performance** across the execution path

## Architecture

### Correlation ID Format
```
corr_<uuid16>_<timestamp>[:component_<timestamp>]*

Examples:
- corr_a1b2c3d4e5f67890_1713742800000 (root)
- corr_a1b2c3d4e5f67890_1713742800000:tool_call_1713742805000 (child)
```

### Components

#### 1. mission-correlation.service.ts
Core service providing:
- Correlation ID generation
- Context propagation via AsyncLocalStorage
- Structured logging with correlation
- Child context creation for sub-operations

#### 2. Integration Points
- **mission-run.service.ts**: Initialize correlation on run creation
- **dynamic-orchestrator.service.ts**: Track correlation through AI cycles
- **rolling-wave-orchestrator.service.ts**: Track correlation through waves
- **event-stream.service.ts**: Propagate correlation in events

## Usage

### Basic Correlation Tracking

```typescript
import { missionCorrelationService, correlatedLog } from "./mission-correlation.service.js";

// Initialize correlation for new mission
const context = missionCorrelationService.initializeMissionContext(
  missionId,
  missionRunId
);

// Run with correlation context
await missionCorrelationService.runWithContext(context, async () => {
  // All code here has access to correlation context
  correlatedLog.info("MyComponent", "Starting operation");
  
  // Do work...
  
  correlatedLog.info("MyComponent", "Operation complete");
});
```

### Child Context for Tool Calls

```typescript
// Create child correlation for sub-operation
const result = await missionCorrelationService.withChildContext(
  "tool_call",
  { missionId, missionRunId },
  async (childContext) => {
    // Child context has extended correlation ID
    correlatedLog.info("ToolExecutor", "Executing tool", {
      toolName: "search"
    });
    
    return await executeTool(toolName, args);
  }
);
```

### Structured Logging

```typescript
// All logs include correlation ID automatically
correlatedLog.info("MissionRunService", "Checkpoint saved", {
  missionRunId: 123,
  checkpointId: 456
});

// Output: [corr_a1b2c3d4...] Checkpoint saved { missionRunId: 123, ... }
```

## Database Schema

### missionRuns.missionContext
```json
{
  "_correlation": {
    "correlationId": "corr_a1b2c3d4e5f67890_1713742800000",
    "startedAt": "2026-04-21T20:30:00.000Z"
  }
}
```

### missionBlackboardHistory
```json
{
  "_checkpoint": {
    "checkpointedAt": "2026-04-21T20:35:00.000Z",
    "reason": "checkpoint:pre_tool_search",
    "changedBy": "orchestrator",
    "correlationId": "corr_a1b2c3d4e5f67890_1713742800000:tool_call_1713742805000"
  }
}
```

## Event Stream Integration

Events automatically include correlation metadata:

```typescript
await eventStream.publish('mission.checkpoint', {
  missionRunId: 123,
  checkpointId: 456
}, {
  correlationId: missionCorrelationService.getCorrelationId(),
  missionId: 789,
  missionRunId: 123
}, 'mission');
```

## Querying by Correlation

### Find all logs for a mission
```sql
SELECT * FROM logs 
WHERE message LIKE '[corr_abc123%]%' 
ORDER BY timestamp;
```

### Find all events for correlation
```sql
SELECT * FROM events 
WHERE metadata->>'correlationId' LIKE 'corr_abc123%'
ORDER BY created_at;
```

### Find child operations
```sql
SELECT * FROM mission_blackboard_history
WHERE (blackboard->'_checkpoint'->>'correlationId') LIKE 'corr_abc123:%'
ORDER BY created_at;
```

## Implementation Details

### AsyncLocalStorage
Uses Node.js AsyncLocalStorage for thread-local context propagation:
- Context persists through async operations
- No manual passing required
- Automatic cleanup on completion

### Correlation Chain
```
Root: corr_abc123_1713742800000
  └─ Tool Call: corr_abc123_1713742800000:tool_call_1713742805000
      └─ API Request: corr_abc123_...:tool_call_...:api_request_1713742806000
```

## Testing

```typescript
import { missionCorrelationService } from "./mission-correlation.service.js";

describe("MissionCorrelationService", () => {
  it("should generate unique correlation IDs", () => {
    const id1 = missionCorrelationService.generateCorrelationId();
    const id2 = missionCorrelationService.generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^corr_/);
  });

  it("should create child correlations", () => {
    const parent = missionCorrelationService.initializeMissionContext(1, 1);
    const childId = missionCorrelationService.createChildCorrelation(parent, "tool");
    expect(childId).toContain(parent.correlationId);
    expect(childId).toContain(":tool_");
  });

  it("should track correlation through async operations", async () => {
    const context = missionCorrelationService.initializeMissionContext(1, 1);
    
    await missionCorrelationService.runWithContext(context, async () => {
      const current = missionCorrelationService.getCurrentContext();
      expect(current?.correlationId).toBe(context.correlationId);
    });
  });
});
```

## Future Enhancements

- [ ] UI: Filter logs/events by correlation ID
- [ ] OpenTelemetry integration for external tracing
- [ ] Correlation visualization (tree view)
- [ ] Performance metrics aggregation by correlation
- [ ] Cross-service correlation propagation
