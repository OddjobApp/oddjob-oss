# CREW Room Feature Recommendations

> **Recommendation Date:** August 2026  
> **Purpose:** Strategic recommendations for enhancing CREW Room capabilities

---

## Executive Summary

CREW Room is a production-ready multi-agent discussion system with unique competitive advantages. With the implementation of **Tier 3.5 Governed Proposals**, **Same-Room Turn Injection**, and **Smart Re-Engagement Deep-Linking**, CREW bridges the gap between deliberation and execution while maintaining strict default-deny safety guarantees.

**Implemented Capabilities:**
- In-room agent task proposals across 6 domains (`propose_scenario_simulation`, `propose_spatial_analysis`, `propose_calculation_eval`, `propose_security_audit`, `propose_knowledge_ingestion`, `propose_cycle_draft`, `propose_research_mission`).
- 1-click Human-in-the-Loop approval cards with requester permission inheritance.
- Same-room synthetic turn presentation under the proposing agent's identity (`injectTaskCompletionTurn`).
- Deep-linked out-of-room re-engagement (`/crew/:sessionKey?highlightTurn=<id>&focus=<kind>`) with smooth auto-scroll and attention pulse animation.

---

## Short-Term Recommendations (Next 30-90 Days)

### 1. CREW Proposal Tier (High Priority)

**Problem:** CREW cannot propose missions, cycles, or tool activations due to write restrictions.

**Solution:** Add CREW-specific proposal tools that create approval-gated proposals.

**Implementation:**
```typescript
// New tools in capability-discovery.ts
propose_cycle_from_crew: {
  name: "propose_cycle_from_crew",
  description: "Propose creating a cycle based on crew consensus. Creates a draft cycle requiring human approval.",
  parameters: z.object({
    cycleName: z.string(),
    blueprintIds: z.array(z.string()),
    reason: z.string(),
    consensusLevel: z.number(),
  }),
  sideEffects: ["database"],
  approvalPolicy: {
    rationale: "Cycle creation requires human approval before execution.",
  },
  execute: async (params, context) => {
    // Create draft cycle in pending_approval state
    // Link to crew session for audit trail
    // Return proposal ID for approval UI
  }
}

propose_mission_from_crew: {
  name: "propose_mission_from_crew",
  description: "Propose launching a mission based on crew consensus. Creates a mission proposal requiring human approval.",
  parameters: z.object({
    missionId: z.number(),
    reason: z.string(),
    inputs: z.record(z.any()),
    consensusLevel: z.number(),
  }),
  sideEffects: ["database"],
  approvalPolicy: {
    rationale: "Mission launch requires human approval.",
  },
  execute: async (params, context) => {
    // Create mission proposal linked to crew session
    // Include consensus score in proposal metadata
    // Return proposal ID for approval UI
  }
}
```

**Benefits:**
- CREW can propose actions without executing them
- Maintains safety through human approval gates
- Enables end-to-end workflow assistance
- Audit trail links proposals to crew discussions

**Effort:** 2-3 weeks

---

### 2. CREW + Copilot Handoff (High Priority)

**Problem:** CREW cannot execute actions even after reaching consensus.

**Solution:** Implement handoff mechanism from CREW to single agent with write permissions.

**Implementation:**
```typescript
// New tool in crew-tools.service.ts
handoff_to_copilot: {
  name: "handoff_to_copilot",
  description: "Hand off a crew consensus plan to the copilot for execution. The copilot has write permissions to execute approved actions.",
  parameters: z.object({
    plan: z.object({
      title: z.string(),
      steps: z.array(z.object({
        description: z.string(),
        tool: z.string(),
        parameters: z.record(z.any()),
      })),
    }),
    reason: z.string(),
  }),
  sideEffects: ["queue-message"],
  execute: async (params, context) => {
    // Send handoff signal to copilot via event bus
    // Include crew session ID for traceability
    // Copilot executes plan with write permissions
  }
}
```

**Benefits:**
- CREW discusses and reaches consensus
- Copilot executes with write permissions
- Maintains CREW safety model
- Enables end-to-end workflows

**Effort:** 1-2 weeks

---

### 3. Beliefs Service Production Graduation (Medium Priority)

**Problem:** Beliefs Service is at Beta maturity, limiting theory-of-mind capabilities.

**Solution:** Graduate Beliefs Service to Production with additional validation.

**Implementation:**
- Add production-grade monitoring and alerting
- Implement belief revision tracking dashboard
- Add calibration accuracy metrics to agent cards
- Create belief conflict resolution UI

**Benefits:**
- Enables theory-of-mind measurement
- Improves agent understanding of other agents
- Provides unique competitive differentiation

**Effort:** 2-3 weeks

---

### 4. CREW Plan Execution UI (Medium Priority)

**Problem:** Supervisor generates plans but no UI exists to execute them.

**Solution:** Add plan execution UI that converts supervisor plans into actions.

**Implementation:**
```typescript
// New component: CrewPlanExecutor.tsx
interface CrewPlanExecutorProps {
  sessionId: number;
  plan: {
    title: string;
    steps: CrewPlanStep[];
  };
  consensusLevel: number;
}

// Each step has:
// - Description
// - Suggested owner (agent)
// - Execute button (triggers handoff or proposal)
// - Skip button (mark as not applicable)
```

**Benefits:**
- Converts supervisor plans into actionable items
- Enables human-in-the-loop execution
- Provides visibility into crew recommendations

**Effort:** 2-3 weeks

---

## Medium-Term Recommendations (3-6 Months)

### 5. Dynamic Speaker Selection (High Priority)

**Problem:** MAX_SPEAKERS_PER_ROUND = 3 is static, regardless of discussion complexity.

**Solution:** Implement dynamic speaker selection based on topic complexity and agent affinity.

**Implementation:**
```typescript
// In crew-orchestrator.service.ts
function calculateOptimalSpeakerCount(
  topicComplexity: number,
  agentAffinityScores: number[],
  consensusLevel: number
): number {
  // More speakers for complex topics
  // More speakers when affinity scores are close (multiple qualified agents)
  // Fewer speakers when consensus is already high
  const baseSpeakers = 3;
  const complexityMultiplier = Math.min(topicComplexity / 0.5, 2);
  const affinitySpread = Math.max(...agentAffinityScores) - Math.min(...agentAffinityScores);
  const affinityBonus = affinitySpread < 0.2 ? 1 : 0;
  const consensusPenalty = consensusLevel > 80 ? -1 : 0;
  
  return Math.max(1, Math.min(5, baseSpeakers * complexityMultiplier + affinityBonus + consensusPenalty));
}
```

**Benefits:**
- More efficient discussions (fewer speakers for simple topics)
- Better coverage for complex topics (more speakers)
- Reduced latency for high-consensus discussions

**Effort:** 3-4 weeks

---

### 6. Cross-Crew Learning (High Priority)

**Problem:** Crew conclusions are isolated to individual sessions, no cross-session learning.

**Solution:** Enable knowledge sharing across related crew discussions.

**Implementation:**
```typescript
// New service: crew-cross-learning.service.ts
export class CrewCrossLearningService {
  async findRelatedSessions(
    orgId: number,
    topic: string,
    projectId: number | null
  ): Promise<CrewSessionRecord[]> {
    // Find sessions with similar topics
    // Use semantic similarity on activeTopic field
    // Respect project scoping
  }
  
  async injectRelatedConclusions(
    sessionId: number,
    relatedSessions: CrewSessionRecord[]
  ): Promise<void> {
    // Inject conclusions from related sessions as context
    // Weight by recency and consensus level
    // Mark as "cross-crew knowledge" in transcript
  }
}
```

**Benefits:**
- Crews learn from previous discussions
- Reduces repetition of debates
- Improves decision quality over time

**Effort:** 4-5 weeks

---

### 7. CREW Templates (Medium Priority)

**Problem:** No way to pre-configure crew compositions for common scenarios.

**Solution:** Add crew templates for common use cases.

**Implementation:**
```typescript
// New table: crew_templates
export const crewTemplates = pgTable("crew_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  agentCardIds: jsonb("agent_card_ids").$type<number[]>().notNull(),
  useCase: text("use_case"), // e.g., "security_review", "deployment_planning"
  projectId: integer("project_id"), // Optional project scoping
  createdAt: timestamp("created_at").defaultNow(),
});

// Pre-built templates:
// - Security Review: Security Auditor, Compliance Officer, Backend Developer
// - Deployment Planning: DevOps Engineer, Backend Developer, QA Engineer
// - Architecture Review: Backend Developer, Frontend Developer, Data Engineer
// - Incident Response: Crisis Commander, DevOps Engineer, Security Auditor
```

**Benefits:**
- Faster crew setup for common scenarios
- Consistent agent compositions
- Best practice sharing

**Effort:** 2-3 weeks

---

### 8. CREW Analytics Dashboard (Medium Priority)

**Problem:** No visibility into crew performance and effectiveness.

**Solution:** Add analytics dashboard for crew metrics.

**Metrics to Track:**
- Average consensus level per session
- Average rounds to consensus
- Agent contribution frequency
- Belief revision frequency
- Calibration accuracy per agent
- Plan execution rate
- Issue resolution rate

**Implementation:**
```typescript
// New page: CrewAnalyticsDashboard.tsx
interface CrewMetrics {
  totalSessions: number;
  averageConsensus: number;
  averageRoundsToConsensus: number;
  agentContributions: Map<string, number>;
  beliefRevisions: number;
  calibrationAccuracy: Map<string, number>;
  planExecutionRate: number;
  issueResolutionRate: number;
}
```

**Benefits:**
- Measure crew effectiveness
- Identify underperforming agents
- Optimize crew compositions
- Track improvement over time

**Effort:** 3-4 weeks

---

## Long-Term Recommendations (6-12 Months)

### 9. Self-Improving Triage (High Priority)

**Problem:** Current triage is heuristic and model-free, may miss edge cases.

**Solution:** Train ML model for substance scoring based on historical data.

**Implementation:**
```typescript
// New service: crew-triage-ml.service.ts
export class CrewTriageMLService {
  async trainSubstanceModel(
    orgId: number,
    historicalSessions: CrewSessionRecord[]
  ): Promise<void> {
    // Use historical sessions as training data
    // Features: message length, question marks, domain nouns, @mentions
    // Labels: whether full crew discussion was valuable (measured by consensus level, plan execution)
    // Train lightweight classifier
  }
  
  async assessSubstance(message: string): Promise<number> {
    // Use trained model for scoring
    // Fall back to heuristic if model unavailable
  }
}
```

**Benefits:**
- More accurate triage decisions
- Adapts to organization-specific patterns
- Reduces false positives/negatives

**Effort:** 6-8 weeks

---

### 10. Agent Specialization Auto-Inference (Medium Priority)

**Problem:** Archetypes are manually assigned, may not match actual agent behavior.

**Solution:** Automatically infer optimal archetypes from agent performance.

**Implementation:**
```typescript
// New service: crew-specialization-inference.service.ts
export class CrewSpecializationInferenceService {
  async inferOptimalArchetype(
    agentCardId: number,
    performanceHistory: AgentPerformanceRecord[]
  ): Promise<string> {
    // Analyze agent's historical contributions
    // Features: consensus improvement, plan execution success, belief accuracy
    // Map to optimal archetype based on performance patterns
  }
  
  async suggestArchetypeChange(
    agentCardId: number
  ): Promise<{ current: string; suggested: string; reason: string }> {
    // Compare current archetype to inferred optimal
    // Provide rationale for change
  }
}
```

**Benefits:**
- Agents perform better with matched archetypes
- Continuous improvement of crew effectiveness
- Data-driven archetype assignment

**Effort:** 4-5 weeks

---

### 11. Federated Crew Discussions (Medium Priority)

**Problem:** Crew discussions are isolated to single organization.

**Solution:** Enable cross-organization crew rooms for shared challenges.

**Implementation:**
```typescript
// New table: crew_federated_sessions
export const crewFederatedSessions = pgTable("crew_federated_sessions", {
  id: serial("id").primaryKey(),
  primaryOrgId: integer("primary_org_id").notNull(),
  participantOrgIds: jsonb("participant_org_ids").$type<number[]>().notNull(),
  topic: text("topic").notNull(),
  status: text("status").$type<"active" | "archived">().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Use cases:
// - Industry-wide security discussions
// - Shared compliance challenges
// - Open source project governance
```

**Benefits:**
- Network effects across organizations
- Collective intelligence on shared challenges
- New revenue model (federated crew subscriptions)

**Effort:** 8-10 weeks

---

### 12. CREW + Decision Intelligence Integration (High Priority)

**Problem:** CREW cannot assist with event source configuration and subscription creation.

**Solution:** Integrate CREW with Decision Intelligence for crew-based rule creation.

**Implementation:**
```typescript
// New tools in crew-tools.service.ts
propose_subscription_from_crew: {
  name: "propose_subscription_from_crew",
  description: "Propose creating a signal subscription based on crew consensus. Creates a draft subscription requiring human approval.",
  parameters: z.object({
    eventSourceId: z.number(),
    ruleTemplate: z.string(),
    parameters: z.record(z.any()),
    reason: z.string(),
    consensusLevel: z.number(),
  }),
  sideEffects: ["database"],
  approvalPolicy: {
    rationale: "Subscription creation requires human approval.",
  },
  execute: async (params, context) => {
    // Create draft subscription in pending state
    // Link to crew session for audit trail
    // Return proposal ID for approval UI
  }
}

propose_event_source_from_crew: {
  name: "propose_event_source_from_crew",
  description: "Propose adding a new event source based on crew consensus. Creates a draft event source requiring human approval.",
  parameters: z.object({
    sourceType: z.enum(["api", "rss", "webhook", "internal"]),
    configuration: z.record(z.any()),
    reason: z.string(),
    consensusLevel: z.number(),
  }),
  sideEffects: ["database"],
  approvalPolicy: {
    rationale: "Event source creation requires human approval.",
  },
  execute: async (params, context) => {
    // Create draft event source in pending state
    // Link to crew session for audit trail
    // Return proposal ID for approval UI
  }
}
```

**Benefits:**
- CREW can assist with Decision Intelligence setup
- Crew-based rule creation for complex scenarios
- Multi-agent perspective on signal configuration

**Effort:** 3-4 weeks

---

## Integration Recommendations

### 13. CREW + Creation Studio Stage Gating (High Priority)

**Problem:** CREW discussions may drift from current Creation Studio stage.

**Solution:** Enhance stage gating to redirect discussions when off-track.

**Implementation:**
```typescript
// In crew-supervisor.service.ts
interface StageGatingOutput {
  status: "on_track" | "redirect_needed" | "stage_ready";
  activeStageId?: string;
  redirectReason?: string;
  suggestedAction?: string;
}

// When redirect_needed:
// - Supervisor provides redirect reason
// - Suggests action to get back on track
// - Crew focuses on active unblocked stage
```

**Benefits:**
- Keeps discussions focused on current stage
- Reduces wasted discussion time
- Improves Creation Studio workflow efficiency

**Effort:** 2-3 weeks

---

### 14. CREW + Knowledge Graph Bidirectional Flow (Medium Priority)

**Problem:** Knowledge flows from KG to CREW, but CREW insights don't flow back efficiently.

**Solution:** Enhance CREW Learning Service to write back more structured knowledge.

**Implementation:**
```typescript
// In crew-learning.service.ts
async writeBackStructuredKnowledge(
  orgId: number,
  speakers: AgentCardRecord[],
  output: SupervisorOutput,
  topic: string,
  projectId: number | null
): Promise<WriteBackResult> {
  // Write back structured entries:
  // - Discussion consensus (with confidence)
  // - Agent positions (with revision history)
  // - Supervisor critiques (as quality signals)
  // - Plan steps (as actionable knowledge)
  // - Issue resolutions (as lessons learned)
  
  // Use knowledge graph relationships:
  // - Links between related discussions
  // - Links to source material (cited in tools)
  // - Links to executed plans
}
```

**Benefits:**
- Richer knowledge capture from crew discussions
- Better knowledge graph connectivity
- Improved future crew recall

**Effort:** 3-4 weeks

---

## Priority Matrix

| Recommendation | Priority | Impact | Effort | ROI |
|----------------|----------|--------|--------|-----|
| CREW Proposal Tier | High | High | 2-3 weeks | 9x |
| CREW + Copilot Handoff | High | High | 1-2 weeks | 10x |
| Beliefs Service Graduation | Medium | Medium | 2-3 weeks | 5x |
| CREW Plan Execution UI | Medium | Medium | 2-3 weeks | 6x |
| Dynamic Speaker Selection | High | Medium | 3-4 weeks | 4x |
| Cross-Crew Learning | High | High | 4-5 weeks | 7x |
| CREW Templates | Medium | Medium | 2-3 weeks | 5x |
| CREW Analytics Dashboard | Medium | Medium | 3-4 weeks | 4x |
| Self-Improving Triage | High | Medium | 6-8 weeks | 3x |
| Agent Specialization Inference | Medium | Medium | 4-5 weeks | 3x |
| Federated Crew Discussions | Medium | High | 8-10 weeks | 5x |
| CREW + Decision Intelligence | High | High | 3-4 weeks | 8x |
| CREW + Creation Studio | High | Medium | 2-3 weeks | 5x |
| CREW + Knowledge Graph | Medium | Medium | 3-4 weeks | 4x |

---

## Implementation Roadmap

### Phase 1 (Next 90 Days)
1. CREW Proposal Tier
2. CREW + Copilot Handoff
3. CREW Plan Execution UI
4. CREW + Creation Studio Stage Gating

### Phase 2 (3-6 Months)
5. Beliefs Service Graduation
6. Dynamic Speaker Selection
7. Cross-Crew Learning
8. CREW Templates
9. CREW + Decision Intelligence

### Phase 3 (6-12 Months)
10. CREW Analytics Dashboard
11. Self-Improving Triage
12. Agent Specialization Inference
13. CREW + Knowledge Graph Bidirectional Flow
14. Federated Crew Discussions

---

## Success Metrics

**Phase 1 Success:**
- CREW can propose cycles/missions with 80% approval rate
- Handoff to copilot executes 90% of plans successfully
- Plan execution UI reduces manual effort by 50%

**Phase 2 Success:**
- Dynamic speaker selection reduces latency by 20%
- Cross-Crew learning reduces repeated debates by 30%
- CREW templates increase setup speed by 60%

**Phase 3 Success:**
- ML triage improves accuracy by 15%
- Agent specialization improves performance by 10%
- Federated discussions enable new revenue stream

---

## Conclusion

CREW Room is a production-ready feature with unique competitive advantages. The recommended enhancements focus on bridging the gap between deliberation and execution while maintaining safety.

**Key Themes:**
1. **Proposal-based execution** - CREW proposes, human approves, system executes
2. **Dynamic optimization** - Adapt to discussion complexity and agent performance
3. **Cross-session learning** - Share knowledge across related discussions
4. **Integration** - Connect CREW to Decision Intelligence, Creation Studio, Knowledge Graph

**Expected Impact:**
- 50% reduction in manual workflow steps
- 30% improvement in decision quality
- 20% reduction in discussion latency
- New revenue streams from federated discussions

**Total Investment:** ~20-25 weeks of engineering effort across 3 phases

**ROI:** 5-10x return based on efficiency gains and new capabilities
