# Execution Flow Visualizer

## Overview

Capture and visualize agent execution as interactive flow diagrams. Shows every step, decision, reflection, tool call, and adaptation in real-time.

## Features

- **Real-time Visualization**: Watch execution as it happens
- **Interactive Diagrams**: Click nodes for details
- **Playback Mode**: Replay execution step-by-step
- **Multiple Formats**: Export as Mermaid, Graphviz DOT, or JSON
- **Event Types**: Steps, decisions, reflections, corrections, tool calls, errors
- **Statistics**: Track execution metrics automatically

## Quick Start

### Start a Flow

```typescript
import { executionFlowService } from "@domain/agents/core/execution-visualizer";

const flow = executionFlowService.startFlow(
  "session-123",     // session ID
  "agent-1",         // agent ID
  1,                 // organization ID
  { layout: "vertical", showDetails: true }
);
```

### Record Events

```typescript
// Record a step
executionFlowService.recordStep(sessionId, {
  label: "Analyze customer feedback",
  description: "Processing sentiment data",
  strategy: "chain_of_thought"
});

// Record a reflection
executionFlowService.recordReflection(sessionId, {
  issuesFound: 2,
  confidence: 0.75,
  passed: false
});

// Record a correction
executionFlowService.recordCorrection(sessionId, {
  success: true,
  strategy: "retry_with_context"
});

// Record a tool call
executionFlowService.recordToolCall(sessionId, {
  toolName: "sentiment_analyzer",
  success: true,
  durationMs: 1500
});

// Record a decision
executionFlowService.recordDecision(sessionId, {
  label: "Is sentiment positive?",
  choice: "yes",
  confidence: 0.85
});
```

### Complete the Flow

```typescript
executionFlowService.completeFlow(sessionId, {
  success: true,
  output: { sentiment: "positive", score: 0.92 }
});
```

### Export Diagram

```typescript
// Mermaid format (for web display)
const mermaid = executionFlowService.exportFlow(flow.id, "mermaid");

// Graphviz DOT (for PDF/PNG)
const dot = executionFlowService.exportFlow(flow.id, "dot");

// JSON (for analysis)
const json = executionFlowService.exportFlow(flow.id, "json");
```

## API Usage

```bash
# Start flow
curl -X POST /api/execution-flow/start \
  -d '{"sessionId":"sess-1","agentId":"agent-1","layout":"vertical"}'

# Record step
curl -X POST /api/execution-flow/sess-1/step \
  -d '{"label":"Analyze data","strategy":"chain_of_thought"}'

# Record reflection
curl -X POST /api/execution-flow/sess-1/reflection \
  -d '{"issuesFound":1,"confidence":0.8,"passed":false}'

# Complete flow
curl -X POST /api/execution-flow/sess-1/complete \
  -d '{"success":true}'

# Export as Mermaid
curl /api/execution-flow/FLOW_ID/export?format=mermaid
```

## Node Types

| Type | Description | Color |
|------|-------------|-------|
| `start` | Execution start | Green |
| `step` | Regular execution step | Blue |
| `decision` | Branching decision | Purple |
| `reflection` | Self-reflection checkpoint | Yellow |
| `correction` | Self-correction | Blue |
| `tool_call` | External tool invocation | Violet |
| `swarm_vote` | Multi-agent vote | Cyan |
| `consensus` | Consensus reached | Green |
| `adaptation` | Strategy change | Orange |
| `error` | Error occurred | Red |
| `end` | Execution end | Green/Red |

## React Component

```typescript
import { ExecutionFlowVisualizer } from "@/modules/agents/components";

function AgentExecutionPage() {
  return (
    <ExecutionFlowVisualizer
      flowId="flow-123"
      autoRefresh={true}
    />
  );
}
```

### Component Features

- **Live Updates**: Auto-refresh during execution
- **Interactive Nodes**: Click for details
- **Playback Mode**: Step through execution
- **Download**: Export in multiple formats
- **Statistics**: View execution metrics

## Mermaid Output Example

```mermaid
flowchart TD
    node-0([Start]):::start --> node-1[Analyze customer feedback]
    node-1 --> node-2{Reflection 2 issues}
    node-2 --> node-3[Self-Correction]:::correction
    node-3 --> node-4[sentiment_analyzer]:::tool_call
    node-4 --> node-5([Success]):::end
    
    classDef start fill:#22c55e
    classDef end fill:#22c55e
    classDef error fill:#f59e0b
    classDef decision fill:#8b5cf6
```

## Statistics Tracked

- **totalSteps**: Total execution steps
- **totalDurationMs**: Total time
- **reflections**: Number of reflections
- **corrections**: Number of corrections applied
- **toolCalls**: External tool invocations
- **adaptations**: Strategy changes
- **errors**: Errors encountered

## Layout Options

| Layout | Description |
|--------|-------------|
| `horizontal` | Left-to-right flow |
| `vertical` | Top-to-bottom flow |
| `auto` | Automatic grid layout |

## Integration with Other Capabilities

The visualizer integrates with all 4 advanced capabilities:

```typescript
// Reflection system
reflectionService.reflect({ stepId, output });
executionFlowService.recordReflection(sessionId, {
  issuesFound: result.issues.length,
  confidence: result.confidenceScore,
  passed: result.passed
});

// Meta-cognitive planning
metaCognitivePlanner.adaptPlan(planId, newStrategy);
executionFlowService.recordAdaptation(sessionId, {
  fromStrategy: oldStrategy,
  toStrategy: newStrategy,
  reason: "Low confidence detected"
});

// Swarm consensus
swarmCoordinator.vote(swarmId, agentId, proposalId, "yes");
executionFlowService.recordSwarmVote(sessionId, {
  proposalId,
  agentId,
  vote: "yes",
  confidence: 0.85
});
```

## Best Practices

1. **Start Early**: Begin flow at session start
2. **Record Everything**: Every step, reflection, tool call
3. **Add Descriptions**: Makes diagrams more readable
4. **Use Metadata**: Attach useful context to nodes
5. **Complete Always**: Even on errors, mark flow complete

## Troubleshooting

### Diagram Not Rendering
- Check Mermaid syntax validity
- Ensure container element exists
- Check browser console for errors

### Missing Nodes
- Verify all events are recorded
- Check session ID consistency
- Review flow status

### Performance Issues
- Limit auto-refresh interval
- Use pagination for large flows
- Export instead of displaying

## Future Enhancements

1. **Real-time Collaboration**: Multiple users viewing same flow
2. **3D Visualization**: Three.js powered 3D graphs
3. **Heat Maps**: Show performance bottlenecks
4. **Diff Mode**: Compare two execution flows
5. **Voice Narration**: Audio walkthrough of execution
