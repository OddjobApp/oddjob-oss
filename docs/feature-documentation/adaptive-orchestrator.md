# Adaptive Orchestrator

## Overview

The Adaptive Orchestrator integrates all 4 advanced AI capabilities into a unified execution layer. It intelligently coordinates ReAct Reflection, Multi-Agent Swarming, Meta-Cognitive Planning, and Tool Discovery to solve complex tasks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Adaptive Orchestrator                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Meta-     │  │   Tool      │  │  Reflection │             │
│  │ Cognitive   │──│ Discovery   │──│   Loop      │             │
│  │   Planning  │  │             │  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                                    │                  │
│         │         ┌─────────────┐            │                  │
│         └────────►│   Swarm     │◄───────────┘                  │
│                   │ Consensus   │                               │
│                   └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              [Single Agent]     [Agent Collective]
```

## Key Features

- **Unified API**: Single endpoint for all advanced capabilities
- **Intelligent Orchestration**: Automatically selects best capabilities for task
- **Cross-Capability Learning**: Results from one capability inform others
- **Adaptive Configuration**: Change settings mid-execution
- **Preset Modes**: Pre-configured strategies for common scenarios

## Quick Start

### Basic Execution

```typescript
import { adaptiveOrchestrator } from "@domain/agents/core/adaptive-orchestrator.service.js";

const result = await adaptiveOrchestrator.execute(
  "agent-1",                    // agent ID
  1,                           // organization ID
  {
    description: "Analyze Q3 sales data and identify trends",
    goal: "Generate sales trend analysis report",
    complexity: "high",
  },
  {
    enableReflection: true,
    enableMetaCognitive: true,
    enableToolDiscovery: true,
    enableSwarming: false,       // Enable for complex multi-step tasks
  }
);

console.log(result.success);      // true
console.log(result.quality);      // 0.92
console.log(result.reflections);  // ReflectionResult[]
console.log(result.strategiesUsed); // ["chain_of_thought"]
console.log(result.toolsUsed);     // ["data_query", "trend_analyzer"]
```

### Using Presets

```typescript
// Fast execution - minimal verification
const fast = await adaptiveOrchestrator.execute(agentId, orgId, task, {
  enableReflection: false,
  enableMetaCognitive: false,
});

// Thorough analysis - maximum verification
const thorough = await adaptiveOrchestrator.execute(agentId, orgId, task, {
  enableReflection: true,
  reflectionStrategies: ["factual", "logical", "consistency", "hallucination"],
  enableMetaCognitive: true,
});

// Collaborative - multi-agent swarming
const collaborative = await adaptiveOrchestrator.execute(agentId, orgId, task, {
  enableReflection: true,
  enableSwarming: true,
  swarmSize: 5,
  consensusAlgorithm: "confidence_weighted",
});
```

### API Usage

```bash
# Execute with adaptive capabilities
curl -X POST /api/adaptive/execute \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-1",
    "task": {
      "description": "Analyze customer feedback",
      "goal": "Identify top issues",
      "complexity": "medium"
    },
    "config": {
      "enableReflection": true,
      "enableMetaCognitive": true,
      "enableToolDiscovery": true
    }
  }'

# Response:
{
  "success": true,
  "output": { "trends": [...] },
  "reflections": [...],
  "issuesCorrected": 2,
  "strategiesUsed": ["chain_of_thought"],
  "adaptations": 1,
  "cognitiveHealth": "healthy",
  "toolsUsed": ["sentiment_analyzer", "topic_extractor"],
  "totalTimeMs": 15432,
  "quality": 0.91
}
```

## Execution Phases

### Phase 1: Meta-Cognitive Planning
Selects optimal reasoning strategy based on task characteristics.

### Phase 2: Tool Discovery
Discovers or creates tools needed for the task.

### Phase 3: Swarming Setup (Optional)
If complexity is high and swarming enabled, creates agent collective.

### Phase 4: Execution with Reflection
Executes task with continuous self-correction.

### Phase 5: Post-Execution Analysis
Analyzes results and updates capability models.

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `enableReflection` | `true` | Enable ReAct self-correction |
| `reflectionStrategies` | `["factual", "logical"]` | Verification strategies |
| `enableSwarming` | `false` | Enable multi-agent consensus |
| `swarmSize` | `3` | Number of agents in swarm |
| `consensusAlgorithm` | `"confidence_weighted"` | Voting algorithm |
| `enableMetaCognitive` | `true` | Enable strategy selection |
| `strategyAdaptation` | `true` | Allow mid-task strategy changes |
| `cognitiveMonitoring` | `true` | Monitor agent cognitive state |
| `enableToolDiscovery` | `true` | Discover/create tools |
| `autoCreateTools` | `false` | Auto-create tools when needed |

## Preset Configurations

### Fast (`fast`)
- Reflection: ❌
- Meta-Cognitive: ❌
- Swarming: ❌
- Tool Discovery: ✅

Use when speed matters more than accuracy.

### Thorough (`thorough`)
- Reflection: ✅ (all strategies)
- Meta-Cognitive: ✅
- Swarming: ❌
- Tool Discovery: ✅

Use for critical analysis requiring high accuracy.

### Collaborative (`collaborative`)
- Reflection: ✅
- Meta-Cognitive: ✅
- Swarming: ✅ (5 agents)
- Tool Discovery: ✅

Use for complex problems benefiting from multiple perspectives.

### Fully Adaptive (`adaptive`)
- All capabilities enabled
- Auto-tool creation enabled
- Cross-capability learning enabled

Use when you want the system to figure out the best approach.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/adaptive/execute` | Execute task with adaptive capabilities |
| GET | `/api/adaptive/sessions/:id` | Get session status |
| PATCH | `/api/adaptive/sessions/:id/config` | Update config mid-execution |
| GET | `/api/adaptive/capabilities` | List capabilities |
| GET | `/api/adaptive/stats` | Get orchestrator stats |
| GET | `/api/adaptive/presets` | List configuration presets |

## React Integration

```typescript
import { useAdaptiveExecution } from "@/modules/agents/hooks/use-adaptive";

const { execute, result, isExecuting } = useAdaptiveExecution();

const runTask = async () => {
  const result = await execute({
    agentId: "agent-1",
    task: {
      description: "Analyze data",
      goal: "Find insights",
      complexity: "high"
    },
    preset: "thorough" // or custom config
  });
  
  console.log(`Quality: ${result.quality}`);
  console.log(`Used ${result.toolsUsed.length} tools`);
  console.log(`Corrected ${result.issuesCorrected} issues`);
};
```

## Metrics Tracked

- **Quality Score**: Overall execution quality (0-1)
- **Reflection Count**: Number of verification checks
- **Issues Corrected**: Self-corrected problems
- **Strategy Adaptations**: Mid-task strategy changes
- **Tools Discovered**: Tools found/created
- **Cognitive Health**: Agent state during execution
- **Execution Time**: Total time in milliseconds

## Cross-Capability Learning

The orchestrator learns across capabilities:

1. **Reflection → Meta-Cognitive**: Issues inform future strategy selection
2. **Tool Discovery → Reflection**: New tools get verified
3. **Swarming → Meta-Cognitive**: Swarm performance affects solo strategy
4. **Meta-Cognitive → All**: Strategy effectiveness updates all models

## Best Practices

1. **Start Simple**: Use `fast` preset, then add capabilities as needed
2. **Monitor Quality**: Track quality scores to find right balance
3. **Use Presets**: Don't manually configure unless you have specific needs
4. **Check Reflections**: Review issues found for process improvement
5. **Enable Cross-Learning**: Let capabilities improve each other

## Troubleshooting

### Low Quality Scores
- Enable more reflection strategies
- Use `thorough` preset
- Check if tools are appropriate

### Slow Execution
- Use `fast` preset
- Disable swarming for simple tasks
- Reduce reflection depth

### Too Many Corrections
- Review task descriptions for clarity
- Check if correct tools are being used
- Consider creating custom tools

## Future Enhancements

- Automatic preset selection based on task analysis
- Visual execution flow diagram
- Real-time execution monitoring UI
- A/B testing framework for configurations
- Capability effectiveness analytics
