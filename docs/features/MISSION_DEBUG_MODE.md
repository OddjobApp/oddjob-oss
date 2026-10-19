# Mission Debug Mode

## Overview

Mission Debug Mode provides step-through debugging capabilities for mission execution, allowing developers and operators to pause, inspect, and modify mission state at runtime.

## Purpose

- **Debug complex mission flows** by stepping through execution
- **Inspect mission state** at any point in execution
- **Modify variables mid-flight** to test scenarios
- **Set breakpoints** on tools, phases, or conditions
- **Trace execution** with fine-grained control

## Features

### 1. Debug Sessions
Start a debug session for any active mission run:
```typescript
await missionDebugService.startDebugSession(missionRunId, {
    autoPauseOnStart: true
});
```

### 2. Breakpoints
Set breakpoints to automatically pause execution:
- **Tool Call**: Pause before specific tool execution
- **Phase Change**: Pause when mission phase changes
- **Blackboard Update**: Pause when specific key changes
- **Condition**: Pause when custom condition is met

```typescript
await missionDebugService.addBreakpoint(missionRunId, {
    type: 'tool_call',
    target: 'file_write',
    enabled: true
});
```

### 3. Step Controls
- **Step Over**: Execute next action, don't dive into sub-calls
- **Step Into**: Dive into tool execution details
- **Step Out**: Finish current scope and pause
- **Continue**: Run until next breakpoint

### 4. State Inspection
Inspect current mission state when paused:
```typescript
const state = await missionDebugService.inspect(missionRunId, missionContext);
// Returns: blackboard, variables, call stack, phase, etc.
```

### 5. Variable Modification
Modify blackboard variables during pause:
```typescript
await missionDebugService.modifyVariable(
    missionRunId,
    'blackboard.searchQuery',
    'new search terms'
);
```

## MCP Tools

### start_mission_debug_session
Start debugging a mission run.

**Input:**
```json
{
  "missionRunId": 123,
  "autoPauseOnStart": true
}
```

**Output:**
```json
{
  "success": true,
  "sessionId": "corr_abc123_1713742800000",
  "status": "paused",
  "breakpoints": []
}
```

### pause_mission
Manually pause execution.

### resume_mission
Resume from pause.

### step_mission
Execute with step control.

**Input:**
```json
{
  "missionRunId": 123,
  "stepType": "over"  // or "into", "out"
}
```

### inspect_mission_state
View current state.

**Output:**
```json
{
  "success": true,
  "blackboard": { ... },
  "phase": "EXECUTING",
  "cycleCount": 5,
  "lastToolRun": "search",
  "variables": [
    { "name": "searchQuery", "value": "test", "type": "string" }
  ],
  "callStack": ["breakpoint:bp_123"],
  "canModify": true
}
```

### modify_mission_variable
Change a variable during pause.

**Input:**
```json
{
  "missionRunId": 123,
  "path": "blackboard.searchQuery",
  "value": "new value"
}
```

### add_mission_breakpoint
Add a breakpoint.

**Input:**
```json
{
  "missionRunId": 123,
  "type": "tool_call",
  "target": "file_write",
  "enabled": true
}
```

### remove_mission_breakpoint
Remove a breakpoint.

## Architecture

### mission-debug.service.ts
Core service providing:
- Debug session management
- Breakpoint matching
- Step mode control
- State inspection
- Variable modification

### Integration Points
- **dynamic-orchestrator.service.ts**: Checks `shouldPause()` before each tool call
- **mission-run.service.ts**: Access to mission context for inspection
- **event-stream.service.ts**: Publishes debug events

## Debug Session Lifecycle

```
Start Session → Active → [Breakpoint/Step/Pause] → Paused → [Resume/Step] → Active → Terminate
```

## Usage Example

```typescript
// 1. Start debugging
await missionDebugService.startDebugSession(123, { 
    autoPauseOnStart: true 
});

// 2. Add breakpoints
await missionDebugService.addBreakpoint(123, {
    type: 'tool_call',
    target: 'write_file'
});

// 3. Resume execution
await missionDebugService.resume(123);

// ... mission runs until breakpoint hit ...

// 4. Inspect state
const state = await missionDebugService.inspect(123, currentContext);
console.log(`Current phase: ${state.phase}`);

// 5. Modify variable
await missionDebugService.modifyVariable(
    123, 
    'blackboard.fileContent', 
    'updated content'
);

// 6. Step through
await missionDebugService.stepOver(123);

// 7. End debugging
await missionDebugService.terminateDebugSession(123);
```

## Testing

Test file: `server/domain/mission/tests/mission-debug.service.test.ts`

Run tests:
```bash
npm test -- mission-debug.service.test.ts
```

## Events

Debug mode publishes these events:
- `mission.debug_session_started`
- `mission.debug_paused`
- `mission.debug_resumed`
- `mission.debug_variable_modified`
- `mission.debug_session_ended`

All events include:
- `correlationId`: Debug session correlation
- `missionRunId`: Target mission run
- `timestamp`: Event time

## Implementation Details

### In-Memory Sessions
Debug sessions are stored in-memory (Map). For production with multiple workers, consider:
- Redis-backed session storage
- Shared state across workers
- WebSocket for real-time debug UI

### Breakpoint Matching
Breakpoint matching happens in `shouldPause()`:
1. Check step mode first
2. Evaluate each enabled breakpoint
3. Return first match

### Variable Modification
Uses dot-notation paths:
- `blackboard.key` → `blackboard['key']`
- `nested.object.value` → `nested['object']['value']`

## Future Enhancements

- [ ] UI: Visual debugger with breakpoints, watch variables
- [ ] UI: Call stack visualization
- [ ] Conditional breakpoints with complex expressions
- [ ] Watch expressions that evaluate on each pause
- [ ] Debug history replay
- [ ] Multi-mission debugging
