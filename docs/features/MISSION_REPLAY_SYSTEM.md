# Mission Replay System

## Overview

The Mission Replay System enables developers and operators to debug, analyze, and recover mission executions by replaying missions from specific checkpoints. This feature provides comprehensive observability into mission execution history.

## Features

### 1. Replay History Retrieval
View complete checkpoint history for any mission run, including:
- Blackboard state snapshots at each checkpoint
- Timestamp and sequence information
- User who created the checkpoint
- Reason for checkpoint creation
- Elapsed time since mission start

### 2. Checkpoint-Based Replay
Create a new mission run starting from any previous checkpoint:
- Preserve execution context
- Optionally modify parameters
- Dry-run mode for testing
- Link to original run for traceability

### 3. Mission Run Comparison
Compare two mission runs to identify:
- Divergence points
- Differences in execution paths
- Checkpoint-by-checkpoint diff
- Execution strategy variations

### 4. Execution Heatmap
Analyze mission performance:
- Time spent per phase (PLANNING, EXECUTING, CRITIQUING)
- Tool execution times
- Total duration breakdown
- Checkpoint frequency

## MCP Tools

### get_mission_replay_history
Retrieve checkpoint history for a mission run.

**Input:**
```json
{
  "missionRunId": 123
}
```

**Output:**
```json
{
  "success": true,
  "missionRunId": 123,
  "missionName": "Data Analysis Mission",
  "checkpoints": [
    {
      "checkpointId": 456,
      "sequenceNumber": 1,
      "timestamp": "2026-04-21T20:30:00Z",
      "changedBy": "orchestrator",
      "changeReason": "checkpoint:pre_tool_search",
      "blackboardSnapshot": { "phase": "PLANNING", ... },
      "elapsedMinutes": 5
    }
  ],
  "totalCheckpoints": 5
}
```

### replay_mission_from_checkpoint
Create a replay run from a specific checkpoint.

**Input:**
```json
{
  "missionRunId": 123,
  "checkpointId": 456,
  "modifyParameters": { "searchQuery": "updated keywords" },
  "dryRun": false
}
```

**Output:**
```json
{
  "success": true,
  "replayRunId": 789,
  "originalRunId": 123,
  "stepsReplayed": 0,
  "message": "Replay started from checkpoint 456"
}
```

### compare_mission_runs
Compare two mission runs to find differences.

**Input:**
```json
{
  "runIdA": 123,
  "runIdB": 456
}
```

**Output:**
```json
{
  "success": true,
  "areIdentical": false,
  "divergencePoint": {
    "stepIndex": 3,
    "checkpointA": 111,
    "checkpointB": 222,
    "divergedField": "lastToolRun",
    "valueA": "search",
    "valueB": "write_file",
    "reasonA": "checkpoint:search_results",
    "reasonB": "checkpoint:file_output"
  }
}
```

### get_mission_execution_heatmap
Get time analysis for mission execution.

**Input:**
```json
{
  "missionRunId": 123
}
```

**Output:**
```json
{
  "success": true,
  "totalDurationMinutes": 15.5,
  "phaseBreakdown": {
    "PLANNING": 3.2,
    "EXECUTING": 10.1,
    "CRITIQUING": 2.2
  },
  "toolBreakdown": {
    "search": 1.5,
    "write_file": 8.3,
    "analyze": 5.7
  },
  "checkpointCount": 12
}
```

## Architecture

### Service: mission-replay.service.ts

```typescript
export const missionReplayService = {
  getReplayHistory(missionRunId: number): Promise<ReplayHistory>
  replayFromCheckpoint(originalRunId: number, checkpointId: number, userId: string, options: ReplayOptions): Promise<ReplayResult>
  compareRuns(runIdA: number, runIdB: number): Promise<ComparisonResult>
  getExecutionHeatmap(missionRunId: number): Promise<HeatmapResult>
}
```

### Data Flow

1. **Mission Execution** → Checkpoints saved to `missionBlackboardHistory`
2. **Replay Request** → Load checkpoint context
3. **Replay Run Creation** → New run with parent reference
4. **Execution** → Uses checkpoint blackboard as initial state
5. **Comparison** → Diff checkpoint sequences

## Use Cases

### Debugging Failed Missions
```typescript
// 1. Get history to see where it failed
const history = await missionReplayService.getReplayHistory(failedRunId);

// 2. Find last successful checkpoint
const lastGoodCheckpoint = history.checkpoints.findLast(cp => 
  cp.blackboardSnapshot.last_tool_status !== 'error'
);

// 3. Replay from that checkpoint
const replay = await missionReplayService.replayFromCheckpoint(
  failedRunId,
  lastGoodCheckpoint.checkpointId,
  userId,
  { modifyParameters: { retryWithFix: true } }
);
```

### Performance Analysis
```typescript
// Compare two similar missions
const comparison = await missionReplayService.compareRuns(runA, runB);

if (comparison.divergencePoint) {
  console.log(`Runs diverged at step ${comparison.divergencePoint.stepIndex}`);
  console.log(`Run A used: ${comparison.divergencePoint.valueA}`);
  console.log(`Run B used: ${comparison.divergencePoint.valueB}`);
}

// Get heatmap for slow mission
const heatmap = await missionReplayService.getExecutionHeatmap(slowRunId);
console.log(`Time in EXECUTING phase: ${heatmap.phaseBreakdown.EXECUTING} minutes`);
```

### Testing Parameter Changes
```typescript
// Dry run with modified parameters
const dryRun = await missionReplayService.replayFromCheckpoint(
  originalRunId,
  checkpointId,
  userId,
  { 
    modifyParameters: { aiModel: "gpt-4" },
    dryRun: true 
  }
);

// If dry run looks good, execute for real
if (dryRun.success) {
  const realRun = await missionReplayService.replayFromCheckpoint(...);
}
```

## Database Schema

### missionBlackboardHistory
```sql
CREATE TABLE mission_blackboard_history (
  id SERIAL PRIMARY KEY,
  mission_id INTEGER REFERENCES missions(id),
  mission_run_id INTEGER REFERENCES mission_runs(id),
  blackboard JSONB,
  changed_by TEXT,
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Testing

Test file: `server/domain/mission/tests/mission-replay.service.test.ts`

Run tests:
```bash
npm test -- mission-replay.service.test.ts
```

## Future Enhancements

- [ ] Visual replay timeline in UI
- [ ] Interactive step-through debugging
- [ ] Parameter sensitivity analysis
- [ ] A/B testing framework for mission variations
- [ ] Export replay as video/gif
