# Meta-Cognitive Planning System

## Overview

The Meta-Cognitive Planning System enables agents to plan their own reasoning strategies, monitor their cognitive processes during execution, and adapt strategies based on task characteristics and past performance.

## Key Capabilities

- **Strategy Selection**: Choose optimal reasoning approaches based on task analysis
- **Cognitive Planning**: Create execution plans with checkpoints and adaptation rules
- **Real-time Monitoring**: Detect cognitive issues (fatigue, confusion, overload)
- **Adaptive Execution**: Switch strategies mid-task when needed
- **Learning**: Improve strategy selection from outcomes

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Task Execution                     │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────────┐       ┌──────────┐
   │ Planner │◄─────►│  Monitor   │◄─────►│  Adapt   │
   │         │       │  (real-time)│       │  (rules) │
   └─────────┘       └──────────────┘       └──────────┘
        │                                              
        ▼                                              
   ┌──────────────────────────────────────────────┐    
   │              Reasoning Strategies             │    
   │  Chain of Thought • Tree of Thoughts •        │    
   │  First Principles • Systems Thinking • ...    │    
   └──────────────────────────────────────────────┘    
```

## Quick Start

### Creating a Cognitive Plan

```typescript
import { metaCognitivePlanner } from "@domain/agents/core/meta-cognitive";

const plan = await metaCognitivePlanner.createPlan(
  "agent-1",           // agent ID
  "task-123",          // task ID
  {                    // task characteristics
    description: "Analyze customer feedback data",
    complexity: "high",
    domain: "analytics",
    hasStructuredData: true,
    requiresCreativity: false,
    hasTimeConstraint: false,
    riskLevel: "medium",
    novelty: "familiar"
  },
  {                    // context (optional)
    availableTools: ["data_query", "sentiment_analysis"],
    deadlineMs: 60000
  }
);

console.log(plan.selectedStrategy);  // "inductive" or other
console.log(plan.reasoning);         // Why this strategy was chosen
console.log(plan.estimatedSteps);    // Predicted step count
```

### Monitoring During Execution

```typescript
import { cognitiveMonitor } from "@domain/agents/core/meta-cognitive";

// Start monitoring
cognitiveMonitor.startMonitoring("agent-1", 5); // 5-minute window

// During execution, record metrics
await cognitiveMonitor.recordMetrics("agent-1", {
  processingLatencyMs: 5000,
  coherenceScore: 0.85,
  confidenceEstimate: 0.8,
  contextUtilization: 0.6,
  toolCallFrequency: 5,
  errorRate: 0,
  repetitionScore: 0.1
});

// Check cognitive health
const health = cognitiveMonitor.getCognitiveHealth("agent-1");
console.log(health.status);       // "healthy" | "degraded" | "critical"
console.log(health.score);        // 0-1
console.log(health.recommendations);
```

### Adaptive Execution

```typescript
// Check if adaptation needed at checkpoint
const adaptation = metaCognitivePlanner.checkAdaptationNeeded(
  plan.id,
  currentStep,  // 3
  {
    timeSpentMs: 45000,
    verificationFailures: 1,
    confidence: 0.6
  }
);

if (adaptation.adapt) {
  console.log(`Switching to ${adaptation.suggestedStrategy}`);
  await metaCognitivePlanner.adaptPlan(plan.id, adaptation.suggestedStrategy);
}
```

### Completing and Learning

```typescript
await metaCognitivePlanner.completePlan(plan.id, {
  success: true,
  actualSteps: 5,
  actualTimeMs: 60000,
  quality: 0.9,
  lessons: [
    "Data preprocessing was key",
    "Initial assumption about format was wrong"
  ]
});

// Get insights for future planning
const insights = metaCognitivePlanner.getAgentInsights("agent-1");
console.log(insights.recommendedStrategies);
console.log(insights.avgPerformance.successRate);
```

## Reasoning Strategies

| Strategy | Best For | Complexity | Time |
|----------|----------|------------|------|
| **Chain of Thought** | Multi-step problems | Medium | Medium |
| **Tree of Thoughts** | Strategic planning | High | Slow |
| **Step by Step** | Procedural tasks | Low | Fast |
| **First Principles** | Fundamental redesign | High | Slow |
| **Systems Thinking** | Complex interdependencies | High | Slow |
| **Devil's Advocate** | Important decisions | Medium | Medium |
| **Abductive** | Root cause analysis | High | Medium |
| **Creative Brainstorm** | Idea generation | Medium | Medium |

## Cognitive Monitoring

### Detected Anomalies

- **Fatigue**: Slowing down, decreased throughput
- **Confusion**: Low coherence, poor confidence
- **Overload**: Context window near capacity
- **Stuck**: Repeated tool calls with errors
- **Rushing**: Fast responses with low quality
- **Cognitive Drift**: High repetition, off-topic

### Automatic Interventions

- `pause`: Brief pause for recovery
- `simplify`: Reduce task complexity
- `clarify`: Request task clarification
- `break`: End session, suggest break
- `switch_strategy`: Change reasoning approach
- `escalate`: Hand to human supervisor

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/meta-cognitive/plans` | Create cognitive plan |
| GET | `/api/meta-cognitive/plans/:id` | Get plan |
| POST | `/api/meta-cognitive/plans/:id/start` | Start execution |
| POST | `/api/meta-cognitive/plans/:id/complete` | Complete plan |
| POST | `/api/meta-cognitive/plans/:id/adapt` | Adapt strategy |
| GET | `/api/meta-cognitive/agents/:id/state` | Get agent state |
| GET | `/api/meta-cognitive/agents/:id/insights` | Get insights |
| POST | `/api/meta-cognitive/agents/:id/metrics` | Record metrics |
| GET | `/api/meta-cognitive/agents/:id/health` | Health check |
| POST | `/api/meta-cognitive/agents/:id/monitoring/start` | Start monitoring |
| GET | `/api/meta-cognitive/strategies` | List strategies |

## React Hooks

```typescript
import { 
  useMetaCognitivePlan, 
  useAgentCognitiveState,
  useAdaptiveExecution 
} from "@/modules/agents/hooks/use-meta-cognitive";

// Plan management
const { plan, createPlan, startPlan, completePlan } = useMetaCognitivePlan();

// Monitor agent state
const { state, health, insights, recordMetrics } = useAgentCognitiveState("agent-1");

// Full adaptive execution
const { start, recordStep, finish, adaptationNeeded } = useAdaptiveExecution("agent-1", plan?.id);
```

## Agent State

```typescript
interface AgentCognitiveState {
  confidence: number;          // 0-1, current confidence
  fatigue: number;             // 0-1, increases with use
  recentAccuracy: number;     // 0-1, last N tasks
  preferredStrategies: string[];
  successfulStrategies: Map<string, number>;
  failedStrategies: Map<string, number>;
}
```

## Strategy Selection Factors

The planner considers:
1. **Task Characteristics**: Complexity, domain, data availability
2. **Agent State**: Past success with strategies, current fatigue
3. **Time Constraints**: Deadline pressure
4. **Global Performance**: Organization-wide strategy effectiveness
5. **Personalization**: Agent's preferred strategies

## Best Practices

1. **Start Monitoring Early**: Begin monitoring at task start
2. **Record Regular Metrics**: Every step or every 5-10 seconds
3. **Set Checkpoints**: Use plan checkpoints for adaptation decisions
4. **Learn from Outcomes**: Always complete plans with quality scores
5. **Reset Fatigue**: Call `resetFatigue()` between sessions

## Metrics to Track

- Processing latency (target: <5s)
- Coherence score (target: >0.7)
- Confidence estimate (target: >0.6)
- Context utilization (keep <0.8)
- Error rate (keep <0.1)
- Repetition score (keep <0.3)

## Future Enhancements

- Machine learning for strategy prediction
- Cross-agent strategy sharing
- Automatic prompt refinement based on strategy
- Visual strategy flow diagrams
- A/B testing framework for strategies
