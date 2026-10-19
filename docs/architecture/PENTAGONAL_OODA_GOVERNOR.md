# Pentagonal OODA Governor Architecture

**Document Version**: 1.0  
**Date**: May 5, 2026  
**Status**: Design Complete / Implementation In Progress  
**Author**: AI Assistant  

---

## Executive Summary

The Pentagonal OODA Governor extends Oddjob's existing 4-phase OODA (Observe-Orient-Decide-Act) loop with a **5th phase: Synthesize/Conclude**. This addition creates a continuous learning cycle that improves mission outcomes through post-action analysis, knowledge capture, and strategic refinement.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PENTAGONAL OODA LOOP                          │
│                                                                  │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│    │ OBSERVE │───▶│ ORIENT  │───▶│ DECIDE  │───▶│   ACT   │    │
│    │         │    │         │    │         │    │         │    │
│    │•Read    │    │•Analyze │    │•Select  │    │•Execute │    │
│    │•Monitor │    │•Progress│    │•Safety  │    │•Dispatch│    │
│    │•Collect │    │•Blockers│    │•Tactics │    │•HIL Req │    │
│    └─────────┘    └─────────┘    └─────────┘    └─────────┘    │
│                                                        │         │
│                                                        ▼         │
│                                               ┌─────────────┐   │
│                                               │ SYNTHESIZE  │   │
│                                               │  /CONCLUDE  │   │
│                                               │             │   │
│                                               │•Analyze    │   │
│                                               │•Learn      │   │
│                                               │•Update     │   │
│                                               │•Archive    │   │
│                                               └──────┬──────┘   │
│                                                      │           │
│                                                      └──────────▶│
│                                                           (Loop) │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Five Phases

### Phase 1: OBSERVE (Existing)
**Purpose**: Gather intelligence from the mission environment

**Inputs**:
- Mission blackboard state
- Active agent health metrics
- Budget consumption data
- Tool execution results
- Human feedback (if HIL)

**Outputs**:
- Structured observation report
- Anomaly detection flags
- Data completeness assessment

**Implementation**: `dynamic-orchestrator.service.ts` - `observePhase()`

---

### Phase 2: ORIENT (Existing)
**Purpose**: Contextualize observations against mission objectives

**Inputs**:
- Observation report
- Mission objective/intent
- Historical context (previous cycles)
- Budget constraints
- Rules of Engagement

**Outputs**:
- Situational assessment
- Progress calculation (% complete)
- Blocker identification
- Strategy adjustment recommendations

**Implementation**: `orchestration/thinking.service.ts` - `determineNextAction()`

---

### Phase 3: DECIDE (Existing)
**Purpose**: Select optimal tactic with governance oversight

**Inputs**:
- Oriented situational assessment
- Available tactics inventory
- Risk assessment
- Budget impact estimates

**Outputs**:
- Selected tactic
- Execution parameters
- Risk acceptance (or HIL request)
- Rollback plan (for speculative execution)

**Implementation**: `orchestration/governance.service.ts` - `checkRisk()`

---

### Phase 4: ACT (Existing)
**Purpose**: Execute decided tactic and capture results

**Inputs**:
- Decision artifact
- Execution context
- Tool parameters
- Agent assignments

**Outputs**:
- Execution results
- Success/failure status
- Generated artifacts
- Updated blackboard

**Implementation**: `orchestration/execution.service.ts` - `executeAction()`

---

### Phase 5: SYNTHESIZE/CONCLUDE (NEW) ⭐
**Purpose**: Post-action analysis, learning, and knowledge capture

**Inputs**:
- Action execution results
- Mission objective
- Expected vs actual outcomes
- Resource consumption data
- Error patterns (if failure)

**Outputs**:
- Outcome analysis report
- Success/failure root cause
- Strategy effectiveness score
- Knowledge graph updates
- Institutional memory recording
- Mission completion determination

**Implementation**: NEW `synthesis-governor.service.ts`

---

## Synthesize/Conclude Phase Details

### 5.1 Analysis Step
```typescript
interface SynthesisAnalysis {
  // Did we achieve the objective?
  objectiveMet: boolean;
  confidenceScore: number; // 0.0 - 1.0
  
  // How well did we perform?
  performanceMetrics: {
    budgetEfficiency: number;    // Actual vs estimated cost
    timeEfficiency: number;      // Actual vs estimated time
    qualityScore: number;        // Output quality assessment
  };
  
  // What happened?
  executionTrace: ExecutionStep[];
  deviationAnalysis: Deviation[]; // Where did we deviate from plan?
}
```

### 5.2 Learning Step
```typescript
interface SynthesisLearning {
  // What worked?
  successfulStrategies: Strategy[];
  
  // What didn't work?
  failedApproaches: FailedAttempt[];
  
  // What would we do differently?
  recommendedAdjustments: Adjustment[];
  
  // Pattern recognition
  detectedPatterns: Pattern[];
  
  // Knowledge to capture
  keyInsights: Insight[];
}
```

### 5.3 Knowledge Capture Step
```typescript
interface KnowledgeCapture {
  // Update knowledge graph
  newNodes: KnowledgeNode[];
  newEdges: KnowledgeEdge[];
  
  // Record in institutional memory
  institutionalMemory: {
    missionPattern: MissionPattern;
    successFactors: string[];
    failureFactors: string[];
  };
  
  // Update agent skills (if applicable)
  skillImprovements: SkillUpdate[];
}
```

### 5.4 Conclusion Step
```typescript
interface SynthesisConclusion {
  // Should we continue, retry, or conclude?
  recommendation: 'continue' | 'retry' | 'conclude' | 'escalate';
  
  // If continuing: what adjustments?
  nextCycleAdjustments: Adjustment[];
  
  // If concluding: final deliverables
  finalOutputs: Deliverable[];
  
  // Mission completion status
  completionStatus: 'success' | 'partial' | 'failure';
  
  // Post-mission actions
  postMissionActions: PostMissionAction[];
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PENTAGONAL OODA GOVERNOR                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐                                                  │
│  │    INPUT     │  Mission Objective + Initial Context             │
│  └──────┬───────┘                                                  │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   OBSERVE    │───▶│   ORIENT     │───▶│   DECIDE     │          │
│  │              │    │              │    │              │          │
│  │ • Blackboard │    │ • Progress   │    │ • Tactic      │          │
│  │ • Health     │    │ • Blockers   │    │ • Safety      │          │
│  │ • Results    │    │ • Budget     │    │ • Risk        │          │
│  └──────────────┘    └──────────────┘    └──────┬───────┘          │
│                                                   │                 │
│                                                   ▼                 │
│                                          ┌──────────────┐          │
│                                          │     ACT      │          │
│                                          │              │          │
│                                          │ • Execute    │          │
│                                          │ • Capture    │          │
│                                          │ • Update BB  │          │
│                                          └──────┬───────┘          │
│                                                 │                   │
│                                                 ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SYNTHESIZE/CONCLUDE                       │   │
│  │                                                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │   │
│  │  │ ANALYZE  │─▶│  LEARN   │─▶│  CAPTURE │─▶│ CONCLUDE │   │   │
│  │  │          │  │          │  │          │  │          │   │   │
│  │  │•Outcome  │  │•Patterns│  │•Knowledge│  │•Decision │   │   │
│  │  │•Metrics  │  │•Insights│  │•Memory   │  │•Status   │   │   │
│  │  │•Deviations│  │•Adjust  │  │•Skills   │  │•Next     │   │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                      │
│              ┌──────────────┼──────────────┐                      │
│              │              │              │                       │
│              ▼              ▼              ▼                       │
│       ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
│       │ CONTINUE │   │  CONCLUDE│   │ ESCALATE │                  │
│       │ (Loop)   │   │ (Finish) │   │ (Human)  │                  │
│       └──────────┘   └──────────┘   └──────────┘                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### With Existing Systems

| System | Integration | Purpose |
|--------|-------------|---------|
| **Dynamic Orchestrator** | Extends OODA cycle | Adds 5th phase to existing loop |
| **Knowledge Graph** | Writes synthesis results | Captures mission patterns |
| **Institutional Memory** | Records outcomes | Long-term learning |
| **ML Strategy Predictor** | Provides feedback | Improves tactic selection |
| **Governance Service** | Validates conclusions | Ensures compliance |
| **Reasoning Router** | Complex analysis | Deep outcome analysis |

### Data Flow

```
Mission Run ──▶ Dynamic Orchestrator ──▶ [OODA Cycle]
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │  SYNTHESIZE     │
                                    │  • Analyze      │
                                    │  • Learn        │
                                    │  • Capture      │
                                    │  • Conclude     │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
            ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
            │   Continue   │         │  Conclude    │         │   Escalate   │
            │   (Loop)     │         │  (Complete)  │         │   (HIL)      │
            └──────────────┘         └──────────────┘         └──────────────┘
                    │                        │                        │
                    ▼                        ▼                        ▼
            Knowledge Graph           Mission Status            Approval Request
            (Patterns)                (completed/failed)        (Human Review)
```

---

## Implementation Plan

### Phase 1: Core Synthesis Service (Week 2)
- [ ] Create `synthesis-governor.service.ts`
- [ ] Implement `analyzeOutcome()` method
- [ ] Implement `captureKnowledge()` method
- [ ] Implement `determineConclusion()` method
- [ ] Add tests for synthesis logic

### Phase 2: Dynamic Orchestrator Integration (Week 2)
- [ ] Extend `processMissionCycle()` to call synthesis
- [ ] Add synthesis phase to OODA loop
- [ ] Update trace logging for 5th phase
- [ ] Handle synthesis outcomes (continue/conclude/escalate)

### Phase 3: Knowledge Integration (Week 3)
- [ ] Connect to Knowledge Graph for pattern storage
- [ ] Connect to Institutional Memory service
- [ ] Implement pattern detection algorithms
- [ ] Add feedback loop to Strategy ML Predictor

### Phase 4: UI & Monitoring (Week 3)
- [ ] Add synthesis metrics to Mission Dashboard
- [ ] Create Synthesis Trace view in UI
- [ ] Add pattern visualization
- [ ] Document API endpoints

---

## Benefits

### Immediate Benefits
1. **Better Mission Outcomes**: Post-action analysis catches issues before next cycle
2. **Knowledge Accumulation**: Every mission contributes to organizational learning
3. **Pattern Recognition**: System learns what works and what doesn't
4. **Improved Estimation**: Budget/time predictions improve over time

### Strategic Benefits
1. **Autonomous Improvement**: System gets smarter with every mission
2. **Reduced Human Oversight**: Better decisions mean less HIL needed
3. **Institutional Memory**: Knowledge persists beyond individual missions
4. **Competitive Advantage**: Only platform with 5-phase cognitive loop

---

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Mission Success Rate | 85% | 92% |
| Knowledge Captured | 0 patterns/mission | 3+ patterns/mission |
| Estimation Accuracy | ±40% | ±15% |
| HIL Escalations | 20% | 10% |
| Synthesis Latency | N/A | <5s |

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Synthesis adds latency | Medium | Parallel processing, caching |
| Over-analysis | Medium | Configurable depth levels |
| Storage growth | Low | Pattern deduplication, retention policies |
| Wrong conclusions | High | Confidence thresholds, human validation |

---

## Related Documents

- `DYNAMIC_MISSIONS_OODA_LOOP.md` - Original 4-phase OODA documentation
- `EMERGING_AI_CAPABILITIES.md` - Reasoning Router and MCP Client
- `ODDJOB_STRATEGIC_ROADMAP_2026.md` - Strategic context

---

*This architecture document provides the foundation for implementing the Pentagonal OODA Governor. Implementation details are in the corresponding service files.*
