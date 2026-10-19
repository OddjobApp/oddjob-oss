# ReAct with Reflection & Self-Correction

## Overview

The ReAct (Reasoning + Acting) with Reflection system extends Oddjob's agent orchestration with explicit verification steps and self-correction loops. Agents now verify their own outputs, detect hallucinations, and retry with adjusted approaches before returning results to users.

## Key Capabilities

1. **Explicit Reflection Steps** - Agent pauses to verify reasoning before proceeding
2. **Self-Correction Loops** - Auto-retry with adjusted approach on low confidence
3. **Confidence Calibration** - Numerical confidence scores trigger verification thresholds
4. **Error Pattern Recognition** - Learn from past mistakes to correct proactively
5. **Structured Verification** - Multiple verification strategies (factual, logical, consistency)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT EXECUTION FLOW                          │
└─────────────────────────────────────────────────────────────────┘

[1] Thought Generation
    ↓
[2] Action Selection
    ↓
[3] EXECUTE ACTION
    ↓
[4] OBSERVATION
    ↓
[5] REFLECTION STEP (NEW) ←──┐
    ├─ Self-Evaluation       │
    ├─ Confidence Scoring    │
    ├─ Verification Checks   │
    ↓                        │
[6] Confidence ≥ Threshold? ─┤
    ├─ YES → Continue        │
    └─ NO  → CORRECT & RETRY─┘
         ├─ Adjust approach
         ├─ Fix errors
         └─ Retry from step [2]
```

## Verification Strategies

### 1. Factual Verification
- Cross-reference with knowledge store
- Check against retrieved documents
- Validate external API responses

### 2. Logical Consistency
- Detect contradictions in reasoning chain
- Verify cause-effect relationships
- Check mathematical/logical soundness

### 3. Output Validation
- Schema validation for structured outputs
- Type checking for generated code
- Format verification

### 4. Hallucination Detection
- Source attribution verification
- Confidence threshold on unverified claims
- Uncertainty quantification

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `reflectionEnabled` | `true` | Enable reflection steps |
| `confidenceThreshold` | `0.7` | Minimum confidence to proceed (0-1) |
| `maxReflectionDepth` | `3` | Maximum retry attempts per step |
| `verificationStrategies` | `["factual", "logical"]` | Which checks to run |
| `autoRetryOnLowConfidence` | `true` | Automatically retry or escalate |

## Database Schema

### reflection_logs
Tracks all reflection and correction attempts:

```sql
- id: serial
- missionRunId: integer (FK)
- stepId: string
- originalOutput: jsonb
- reflectionResult: jsonb
  - confidenceScore: number
  - verificationResults: array
  - issuesDetected: array
- correctionAttempted: boolean
- correctedOutput: jsonb (nullable)
- retryCount: integer
- resolution: enum ['passed', 'corrected', 'escalated', 'failed']
- createdAt: timestamp
```

### reflection_patterns
Learned patterns for proactive correction:

```sql
- id: serial
- organizationId: integer (FK)
- patternType: enum ['hallucination', 'logic_error', 'factual_incorrect']
- triggerSignature: string (hashed pattern)
- correctionStrategy: jsonb
- successRate: decimal
- timesApplied: integer
```

## API Endpoints

### `POST /api/agents/:missionRunId/reflect`
Manually trigger reflection on current state.

**Request:**
```json
{
  "stepId": "step-123",
  "output": "...",
  "verificationStrategies": ["factual", "logical"]
}
```

**Response:**
```json
{
  "confidenceScore": 0.85,
  "passed": true,
  "verifications": [
    { "strategy": "factual", "passed": true, "details": "..." },
    { "strategy": "logical", "passed": true, "details": "..." }
  ]
}
```

### `GET /api/agents/:missionRunId/reflections`
Get reflection history for a mission.

### `GET /api/agents/reflection-stats`
Get organization-wide reflection statistics.

## React Hook

```typescript
import { useReflection } from "@domain/agents/hooks/use-reflection";

function AgentDebugger() {
  const { 
    reflectOnStep, 
    isReflecting, 
    reflectionResult,
    applyCorrection 
  } = useReflection();

  const handleVerify = async (stepId: string, output: any) => {
    const result = await reflectOnStep(stepId, output);
    
    if (!result.passed && result.suggestedCorrection) {
      // Show correction suggestion to user
      setCorrectionSuggestion(result.suggestedCorrection);
    }
  };
}
```

## Integration with Agent Orchestrator

The reflection system integrates at the `AgentOrchestrator` level:

```typescript
// In agent-orchestrator.ts
async function executeStep(step: AgentStep) {
  // 1. Execute the action
  const result = await toolExecutor.execute(step.action);
  
  // 2. NEW: Reflection step
  const reflection = await reflectionService.reflect({
    stepId: step.id,
    output: result,
    context: this.missionContext,
  });
  
  // 3. Check confidence
  if (reflection.confidenceScore < CONFIDENCE_THRESHOLD) {
    // Attempt correction
    const correction = await reflectionService.correct({
      original: result,
      issues: reflection.issues,
      attempt: 1,
    });
    
    if (correction.success) {
      return correction.correctedOutput;
    } else if (correction.shouldEscalate) {
      // Escalate to human
      await this.escalateToHuman(step, reflection);
    }
  }
  
  return result;
}
```

## Example Scenarios

### Scenario 1: Hallucination Detection
```
Agent: "The database has 15,000 records from 2023."
Reflection: "I don't see a source for that claim."
Confidence: 0.3
Action: Retry with explicit query to count records
Corrected: "Querying database... Found 12,340 records from 2023."
```

### Scenario 2: Logic Error
```
Agent: "The fix is to change line 45 from '>' to '<'."
Reflection: "This contradicts the requirement 'values must exceed threshold'."
Confidence: 0.2
Action: Re-analyze requirements and provide correct fix
Corrected: "The logic is correct as is. The issue is elsewhere."
```

### Scenario 3: Factual Verification
```
Agent: "OpenAI's GPT-4 was released in March 2023."
Reflection: "Cross-referencing knowledge base..."
Confidence: 0.95
Action: None needed, confidence high
Result: Accepted
```

## Testing Strategy

### Unit Tests
- `reflection-service.test.ts` - Core reflection logic
- `verifiers/factual-verifier.test.ts` - Fact checking
- `verifiers/logical-verifier.test.ts` - Logic validation
- `correction-strategies.test.ts` - Correction approaches

### Integration Tests
- `react-reflection-flow.test.ts` - End-to-end flow
- `hallucination-detection.test.ts` - Specific scenarios

### E2E Tests
- `agent-with-reflection.test.ts` - Full agent execution

## Metrics & Observability

### Key Metrics
- `reflection_rate` - % of steps that trigger reflection
- `correction_success_rate` - % of corrections that succeed
- `avg_confidence_score` - Average confidence across reflections
- `escalation_rate` - % escalated to human
- `token_overhead` - Extra tokens used for reflection

### Dashboard Panels
- Reflection success rate over time
- Most common issues detected
- Correction strategy effectiveness
- Confidence score distribution

## Future Extensions

1. **Multi-Agent Reflection** - Agents verify each other's outputs
2. **Human-in-the-Loop Correction** - User-guided corrections feed back to model
3. **Predictive Reflection** - Skip reflection when confidence model predicts success
4. **Cross-Mission Learning** - Reflection patterns shared across missions

## Implementation Phases

### Phase 1: Core Reflection (This Implementation)
- Basic confidence scoring
- Factual verification
- Self-correction loop
- Database schema
- Unit tests

### Phase 2: Advanced Verifiers
- Logical consistency checks
- Hallucination detection
- Output schema validation
- Integration tests

### Phase 3: Learning & Optimization
- Pattern recognition
- Proactive corrections
- Human feedback integration
- E2E tests
- Performance optimization
