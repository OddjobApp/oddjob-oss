# CREW Room Recommendations - Detailed Analysis & Support

> **Analysis Date:** August 2026  
> **Purpose:** In-depth technical analysis, supporting evidence, and implementation details for each CREW Room recommendation

---

## Executive Summary

This document provides detailed technical analysis, supporting evidence, and implementation guidance for each CREW Room recommendation. Each recommendation includes:

- **Problem Statement** - What issue this addresses
- **Technical Solution** - How it works
- **Supporting Evidence** - Codebase analysis and data
- **Implementation Details** - Specific technical approach
- **Success Criteria** - Measurable outcomes
- **Risks & Mitigations** - Potential issues and solutions

---

## Short-Term Recommendations (Next 30-90 Days)

---

### Recommendation 1: CREW Proposal Tier

#### Problem Statement

**Current State:**
- CREW Room has DEFAULT-DENY tool access policy
- Write operations are blocked: create, update, delete, deploy, approve, etc.
- CREW cannot propose missions, cycles, or tool activations
- CREW can discuss and reach consensus but cannot initiate actions

**Evidence from Codebase:**
```typescript
// From crew-tools.service.ts
const WRITE_TOKENS = new Set([
    "create", "update", "delete", "write", "post", "send", "publish", "trigger",
    "run", "execute", "provision", "install", "deploy", "modify", "set", "add",
    "remove", "move", "upsert", "launch", "approve", "assign", "close", "merge",
    "start", "stop", "cancel", "kill", "reset", "sync", "import", "export",
    "generate", "build", "apply", "invite", "grant", "revoke",
]);

const DISQUALIFYING_SIDE_EFFECTS = new Set([
    "file-system", "email", "webhook", "container", "queue-message",
]);
```

**Impact:**
- CREW cannot assist with cycle building (cannot create/approve cycles)
- CREW cannot propose new missions or research
- CREW cannot activate new tools dynamically
- End-to-end workflow assistance is blocked

#### Technical Solution

Add CREW-specific proposal tools that create approval-gated proposals. These tools:
- Write to database but only create "draft" or "pending" states
- Require human approval before execution
- Link to crew session for audit trail
- Include consensus score in proposal metadata

**Implementation Details:**

```typescript
// New tools in server/domain/tools/v1/capabilities/crew-proposal-tools.ts
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { db } from "@server/database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";

export const CREW_PROPOSAL_TOOLS: Record<string, ToolDefinition> = {
  propose_cycle_from_crew: {
    name: "propose_cycle_from_crew",
    label: "Propose Cycle from Crew",
    group: "Crew",
    description: "Propose creating a cycle based on crew consensus. Creates a draft cycle in 'pending_approval' state requiring human approval.",
    parameters: z.object({
      cycleName: z.string().describe("Name of the proposed cycle"),
      blueprintIds: z.array(z.string()).describe("List of blueprint IDs to include"),
      reason: z.string().describe("Why this cycle should be created"),
      consensusLevel: z.number().describe("Consensus level from supervisor (0-100)"),
      sessionId: z.number().describe("Crew session ID for audit trail"),
    }),
    sideEffects: ["database"],
    idempotency: "idempotent",
    approvalPolicy: {
      rationale: "Cycle creation requires human approval before execution to ensure safety and governance.",
      requires: "org-admin",
    },
    execute: async ({ cycleName, blueprintIds, reason, consensusLevel, sessionId }, context: ToolContext) => {
      try {
        const orgId = context.organizationId;
        if (!orgId) return "Error: Organization context required.";

        // Create draft cycle in pending_approval state
        const [cycle] = await db.insert(operationalCycles).values({
          organizationId: orgId,
          name: cycleName,
          status: "pending_approval",
          priority: 5,
          metadata: {
            blueprints: blueprintIds,
            proposedBy: "crew",
            crewSessionId: sessionId,
            consensusLevel,
            reason,
            proposedAt: new Date().toISOString(),
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        return JSON.stringify({
          success: true,
          cycleId: cycle.id,
          cycleName: cycle.name,
          status: "pending_approval",
          consensusLevel,
          message: `Cycle "${cycleName}" proposed by crew (consensus: ${consensusLevel}%). Awaiting human approval.`,
          approvalUrl: `/cycles/${cycle.id}`,
        }, null, 2);
      } catch (e: any) {
        return `Failed to propose cycle: ${e.message}`;
      }
    },
  },

  propose_mission_from_crew: {
    name: "propose_mission_from_crew",
    label: "Propose Mission from Crew",
    group: "Crew",
    description: "Propose launching a mission based on crew consensus. Creates a mission proposal requiring human approval.",
    parameters: z.object({
      missionId: z.number().describe("Mission ID to launch"),
      reason: z.string().describe("Why this mission should be launched"),
      inputs: z.record(z.any()).optional().describe("Inputs the mission needs"),
      consensusLevel: z.number().describe("Consensus level from supervisor (0-100)"),
      sessionId: z.number().describe("Crew session ID for audit trail"),
    }),
    sideEffects: ["database"],
    idempotency: "idempotent",
    approvalPolicy: {
      rationale: "Mission launch requires human approval for safety and cost control.",
      requires: "org-admin",
    },
    execute: async ({ missionId, reason, inputs, consensusLevel, sessionId }, context: ToolContext) => {
      try {
        const orgId = context.organizationId;
        if (!orgId) return "Error: Organization context required.";

        const { missionProposalService } = await import("../../../mission/core/mission-proposal.service.js");
        const { proposalId, missionName } = await missionProposalService.create({
          organizationId: orgId,
          missionId,
          requestedBy: `crew-session-${sessionId}`,
          reason: `[CREW Consensus: ${consensusLevel}%] ${reason}`,
          inputs,
          metadata: {
            crewSessionId: sessionId,
            consensusLevel,
            proposedBy: "crew",
          },
        });

        return JSON.stringify({
          success: true,
          proposalId,
          missionId,
          missionName,
          consensusLevel,
          message: `Mission "${missionName}" proposed by crew (consensus: ${consensusLevel}%). Awaiting human approval.`,
          approvalUrl: `/proposals/${proposalId}`,
        }, null, 2);
      } catch (e: any) {
        return `Failed to propose mission: ${e.message}`;
      }
    },
  },

  propose_tool_activation_from_crew: {
    name: "propose_tool_activation_from_crew",
    label: "Propose Tool Activation",
    group: "Crew",
    description: "Propose activating a new tool or capability based on crew consensus. Creates a proposal requiring human approval.",
    parameters: z.object({
      toolName: z.string().describe("Name of tool to activate"),
      reason: z.string().describe("Why this tool is needed"),
      consensusLevel: z.number().describe("Consensus level from supervisor (0-100)"),
      sessionId: z.number().describe("Crew session ID for audit trail"),
    }),
    sideEffects: ["database"],
    idempotency: "idempotent",
    approvalPolicy: {
      rationale: "Tool activation requires human approval for security and governance.",
      requires: "org-admin",
    },
    execute: async ({ toolName, reason, consensusLevel, sessionId }, context: ToolContext) => {
      try {
        const orgId = context.organizationId;
        if (!orgId) return "Error: Organization context required.";

        // Create tool activation proposal
        const { toolActivationProposals } = await import("@shared/schema/tool-activation.js");
        const [proposal] = await db.insert(toolActivationProposals).values({
          organizationId: orgId,
          toolName,
          status: "pending_approval",
          reason: `[CREW Consensus: ${consensusLevel}%] ${reason}`,
          metadata: {
            crewSessionId: sessionId,
            consensusLevel,
            proposedBy: "crew",
          },
          createdAt: new Date(),
        }).returning();

        return JSON.stringify({
          success: true,
          proposalId: proposal.id,
          toolName,
          consensusLevel,
          message: `Tool "${toolName}" activation proposed by crew (consensus: ${consensusLevel}%). Awaiting human approval.`,
          approvalUrl: `/tool-proposals/${proposal.id}`,
        }, null, 2);
      } catch (e: any) {
        return `Failed to propose tool activation: ${e.message}`;
      }
    },
  },
};
```

**Integration with CREW Tools Service:**

```typescript
// In crew-tools.service.ts
// Add CREW_PROPOSAL_TOOLS to UNIVERSAL_PRESENTATION_TOOLS
// These are granted to EVERY crew agent regardless of card declaration
const UNIVERSAL_PRESENTATION_TOOLS = [
  "list_instant_app_components",
  "render_instant_app",
  "render_intake_form",
  // NEW: CREW proposal tools
  "propose_cycle_from_crew",
  "propose_mission_from_crew",
  "propose_tool_activation_from_crew",
];
```

**Supporting Evidence:**

1. **Existing Pattern:** The platform already has `propose_mission` in `capability-discovery.ts` that creates approval-gated proposals. This follows the same pattern.

2. **Safety Model:** CREW's DEFAULT-DENY policy is intentional for safety. Proposal tools maintain this by requiring human approval before execution.

3. **Audit Trail:** Linking proposals to crew sessions provides traceability and accountability.

4. **Consensus Scoring:** Including consensus level in proposal metadata helps approvers understand crew agreement level.

#### Success Criteria

- 80% of crew proposals are approved within 24 hours
- 90% of approved proposals execute successfully
- Audit trail links 100% of proposals to crew sessions
- Consensus level correlates with approval rate (higher consensus = higher approval)

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Proposal spam (too many low-quality proposals) | Medium | Medium | Add proposal rate limiting per session |
| Approval bottleneck (human can't keep up) | Medium | High | Implement proposal prioritization by consensus level |
| Proposal ambiguity (unclear what to approve) | Low | Medium | Require structured proposal templates |
| Security risk (malicious proposals) | Low | High | Strict approval gates (org-admin only) |

---

### Recommendation 2: CREW + Copilot Handoff

#### Problem Statement

**Current State:**
- CREW can discuss and reach consensus
- CREW can generate structured plans via supervisor
- CREW cannot execute actions due to read-only restrictions
- Copilot has write permissions but no CREW context

**Evidence from Codebase:**
```typescript
// From crew-supervisor.service.ts
export interface SupervisorOutput {
    // ... other fields
    plan: { title: string; steps: CrewPlanStep[] } | null;
    directive: string; // What supervisor says aloud
    nextSteps: string; // What supervisor says happens next
}

// From copilot-crew-handoff.ts (exists in codebase)
// This file suggests handoff logic is partially implemented
```

**Impact:**
- CREW plans cannot be executed automatically
- User must manually translate CREW consensus into actions
- Breaks end-to-end workflow assistance

#### Technical Solution

Implement handoff mechanism from CREW to single agent (Copilot) with write permissions. The handoff:
- Sends CREW consensus plan to Copilot via event bus
- Includes crew session ID for traceability
- Copilot executes plan with its write permissions
- Returns execution results to CREW session

**Implementation Details:**

```typescript
// New tool in crew-tools.service.ts
handoff_to_copilot: {
  name: "handoff_to_copilot",
  label: "Handoff to Copilot for Execution",
  group: "Crew",
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
    reason: z.string().describe("Why this plan should be executed"),
    sessionId: z.number().describe("Crew session ID for traceability"),
  }),
  sideEffects: ["queue-message"],
  idempotency: "idempotent",
  execute: async ({ plan, reason, sessionId }, context: ToolContext) => {
    try {
      const orgId = context.organizationId;
      if (!orgId) return "Error: Organization context required.";

      // Publish handoff event to event bus
      const { eventBus } = await import("@server/events/event-bus.js");
      await eventBus.publish("crew.handoff_to_copilot", {
        organizationId: orgId,
        sessionId,
        plan,
        reason,
        requestedBy: context.userId || "crew-supervisor",
        timestamp: new Date().toISOString(),
      });

      return JSON.stringify({
        success: true,
        message: `Plan "${plan.title}" handed off to copilot for execution. Execution results will be reported back to crew session ${sessionId}.`,
        sessionId,
        stepCount: plan.steps.length,
      }, null, 2);
    } catch (e: any) {
      return `Failed to handoff to copilot: ${e.message}`;
    }
  },
}
```

**Copilot Handler:**

```typescript
// New handler in server/handlers/crew-handoff.handler.ts
import { eventBus } from "@server/events/event-bus.js";
import { copilotService } from "@domain/copilot/copilot.service.js";

eventBus.subscribe("crew.handoff_to_copilot", async (payload) => {
  const { organizationId, sessionId, plan, reason, requestedBy } = payload;

  try {
    // Execute each step in the plan
    const results = [];
    for (const step of plan.steps) {
      const result = await copilotService.executeTool(
        organizationId,
        step.tool,
        step.parameters,
        { userId: requestedBy, sessionId }
      );
      results.push({ step: step.description, result });
    }

    // Report results back to crew session
    await eventBus.publish("crew.handoff_results", {
      sessionId,
      planTitle: plan.title,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Report failure back to crew session
    await eventBus.publish("crew.handoff_failure", {
      sessionId,
      planTitle: plan.title,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
```

**CREW Integration:**

```typescript
// In crew-supervisor.service.ts
// Modify supervisor to include handoff directive when consensus is high
async generateSupervisorOutput(transcript: SupervisorTranscriptTurn[]): Promise<SupervisorOutput> {
  // ... existing logic

  // If consensus is high (>80%) and plan exists, suggest handoff
  if (output.consensusLevel && output.consensusLevel > 80 && output.plan) {
    output.directive += `\n\n[CREW HANDOFF SUGGESTION] This plan has high consensus (${output.consensusLevel}%). Consider using handoff_to_copilot to execute these steps automatically.`;
  }

  return output;
}
```

**Supporting Evidence:**

1. **Existing File:** `.client/src/lib/copilot-crew-handoff.ts` exists, suggesting partial implementation
2. **Event Bus:** Platform already has event bus infrastructure for async communication
3. **Copilot Service:** Copilot already has write permissions and tool execution capabilities
4. **Supervisor Plans:** Supervisor already generates structured plans, this just executes them

#### Success Criteria

- 90% of handoffs execute successfully
- Average handoff execution time < 30 seconds
- 95% of execution results reported back to crew session
- Handoff reduces manual effort by 70%

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Handoff execution failure | Medium | Medium | Implement retry logic with exponential backoff |
| Copilot permission issues | Low | High | Validate permissions before handoff |
| Execution results not reported | Low | Medium | Implement timeout and fallback reporting |
| Malicious plan execution | Low | High | Require minimum consensus level for handoff (e.g., 70%) |

---

### Recommendation 3: CREW Plan Execution UI

#### Problem Statement

**Current State:**
- Supervisor generates structured plans with steps
- Plans include descriptions and optional owner assignment
- No UI exists to execute these plans
- Plans are displayed but not actionable

**Evidence from Codebase:**
```typescript
// From shared/schema/crew.ts
export interface CrewPlanStep {
    order: number;
    description: string;
    owner?: string; // Agent card name suggested to own this step
}

export const crewPlans = pgTable("crew_plans", {
    // ... fields
    steps: jsonb("steps").$type<CrewPlanStep[]>().default(sql`'[]'::jsonb`).notNull(),
    status: text("status").$type<CrewPlanStatus>().default("proposed").notNull(),
});
```

**Impact:**
- Supervisor plans are not actionable
- Users must manually implement plan steps
- Lost opportunity for automation

#### Technical Solution

Add plan execution UI that converts supervisor plans into actionable items. Each step:
- Shows description and suggested owner
- Has execute button (triggers handoff or proposal)
- Has skip button (marks as not applicable)
- Shows execution status

**Implementation Details:**

```typescript
// New component: client/src/components/crew/CrewPlanExecutor.tsx
import React, { useState } from 'react';
import { Button } from '@ui/components/button';
import { Card } from '@ui/components/card';
import { Badge } from '@ui/components/badge';
import { Check, SkipForward, Play } from 'lucide-react';

interface CrewPlanStep {
  order: number;
  description: string;
  owner?: string;
}

interface CrewPlanExecutorProps {
  sessionId: number;
  plan: {
    id: number;
    title: string;
    steps: CrewPlanStep[];
    status: 'proposed' | 'in_progress' | 'completed';
  };
  consensusLevel: number;
  onExecuteStep: (step: CrewPlanStep) => Promise<void>;
  onSkipStep: (step: CrewPlanStep) => Promise<void>;
}

export function CrewPlanExecutor({
  sessionId,
  plan,
  consensusLevel,
  onExecuteStep,
  onSkipStep,
}: CrewPlanExecutorProps) {
  const [executingStep, setExecutingStep] = useState<number | null>(null);

  const handleExecute = async (step: CrewPlanStep) => {
    setExecutingStep(step.order);
    await onExecuteStep(step);
    setExecutingStep(null);
  };

  const handleSkip = async (step: CrewPlanStep) => {
    await onSkipStep(step);
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{plan.title}</h3>
        <Badge variant={consensusLevel > 80 ? 'default' : 'secondary'}>
          Consensus: {consensusLevel}%
        </Badge>
      </div>

      <div className="space-y-3">
        {plan.steps.map((step) => (
          <div
            key={step.order}
            className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50"
          >
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
              {step.order}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{step.description}</p>
              {step.owner && (
                <p className="text-xs text-muted-foreground mt-1">
                  Suggested owner: {step.owner}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(step)}
                disabled={executingStep !== null}
              >
                <SkipForward className="w-4 h-4 mr-1" />
                Skip
              </Button>
              <Button
                size="sm"
                onClick={() => handleExecute(step)}
                disabled={executingStep === step.order}
              >
                {executingStep === step.order ? (
                  'Executing...'
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-1" />
                    Execute
                  </>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

**Integration with CREW Dashboard:**

```typescript
// In client/src/components/crew/CrewDashboard.tsx
import { CrewPlanExecutor } from './CrewPlanExecutor';

function CrewDashboard({ sessionId }: { sessionId: number }) {
  const { data: plans } = useQuery({
    queryKey: ['crew-plans', sessionId],
    queryFn: () => fetchCrewPlans(sessionId),
  });

  const executeStepMutation = useMutation({
    mutationFn: (step) => executeCrewPlanStep(sessionId, step),
  });

  return (
    <div>
      {/* ... other crew UI */}
      {plans?.map((plan) => (
        <CrewPlanExecutor
          key={plan.id}
          sessionId={sessionId}
          plan={plan}
          consensusLevel={plan.consensusLevel}
          onExecuteStep={(step) => executeStepMutation.mutateAsync(step)}
          onSkipStep={(step) => skipCrewPlanStep(sessionId, step)}
        />
      ))}
    </div>
  );
}
```

**Backend API:**

```typescript
// New route in server/domain/crew/api/crew.routes.ts
router.post('/sessions/:sessionId/plans/:planId/steps/:stepOrder/execute', async (req, res) => {
  const { sessionId, planId, stepOrder } = req.params;
  const { organizationId, userId } = req.auth;

  try {
    // Fetch the plan step
    const plan = await db.query.crewPlans.findFirst({
      where: eq(crewPlans.id, Number(planId)),
    });

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const step = plan.steps.find((s: CrewPlanStep) => s.order === Number(stepOrder));
    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    // Trigger handoff to copilot for execution
    await eventBus.publish('crew.plan_step_execute', {
      sessionId,
      planId,
      step,
      organizationId,
      userId,
    });

    res.json({ success: true, message: 'Step execution triggered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Supporting Evidence:**

1. **Plan Schema:** `crew_plans` table already exists with steps and status fields
2. **UI Components:** Platform has existing UI component library (Button, Card, Badge)
3. **React Query:** Platform uses React Query for data fetching
4. **Event Bus:** Event bus infrastructure exists for async execution

#### Success Criteria

- 80% of plan steps are executed via UI (not manual)
- Average step execution time < 10 seconds
- 95% of users report plan execution UI is useful
- Plan execution reduces manual effort by 50%

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Step execution ambiguity (unclear what execute does) | Medium | Low | Add tooltip explaining execution behavior |
| Execution failure without feedback | Medium | Medium | Show execution status and error messages |
| Plan changes during execution | Low | Medium | Lock plan during execution or handle versioning |
| Permission issues for execution | Low | High | Validate permissions before enabling execute button |

---

### Recommendation 4: Beliefs Service Graduation

#### Problem Statement

**Current State:**
- Beliefs Service is at Beta maturity (Level 3)
- Tracks agent positions and theory-of-mind calibration
- Limited production validation
- No monitoring or alerting
- No visibility into belief revision patterns

**Evidence from Codebase:**
```typescript
// From crew-beliefs.service.ts
export class CrewBeliefsService {
    // Records what agent argued this round
    async recordPositions(params: {
        orgId: number;
        projectId: number | null;
        sessionId: number;
        round: number;
        positions: StatedPosition[];
    }): Promise<{ recorded: number; reinforced: number; revised: number }>

    // Records agent's prediction of what next speaker will argue
    async recordPrediction(params: {
        orgId: number;
        sessionId: number;
        round: number;
        prediction: BeliefPredictionInput;
    }): Promise<void>

    // Scores prediction accuracy once speaker actually speaks
    async scorePrediction(params: {
        orgId: number;
        sessionId: number;
        round: number;
        subjectAgentCardId: number;
        actualPosition: string;
    }): Promise<number>
}
```

**Impact:**
- Theory-of-mind capabilities not fully utilized
- No visibility into agent understanding of other agents
- Competitive differentiation not fully realized

#### Technical Solution

Graduate Beliefs Service to Production with:
- Production-grade monitoring and alerting
- Belief revision tracking dashboard
- Calibration accuracy metrics on agent cards
- Belief conflict resolution UI

**Implementation Details:**

**Monitoring & Alerting:**

```typescript
// New service: server/domain/crew/core/crew-beliefs-monitoring.service.ts
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewBeliefsMonitoring");

export class CrewBeliefsMonitoringService {
  async getBeliefHealthMetrics(orgId: number): Promise<BeliefHealthMetrics> {
    const { db } = await import("@server/database_service.js");
    const { agentBeliefs, agentBeliefPredictions } = await import("@shared/schema/index.js");

    // Calculate belief revision rate
    const totalBeliefs = await db.select({ count: sql<number>`count(*)` })
      .from(agentBeliefs)
      .where(eq(agentBeliefs.organizationId, orgId));
    
    const revisedBeliefs = await db.select({ count: sql<number>`count(*)` })
      .from(agentBeliefs)
      .where(and(
        eq(agentBeliefs.organizationId, orgId),
        eq(agentBeliefs.status, "revised")
      ));

    const revisionRate = revisedBeliefs[0].count / Math.max(totalBeliefs[0].count, 1);

    // Calculate calibration accuracy
    const totalPredictions = await db.select({ count: sql<number>`count(*)` })
      .from(agentBeliefPredictions)
      .where(eq(agentBeliefPredictions.organizationId, orgId));

    const scoredPredictions = await db.select({ count: sql<number>`count(*)` })
      .from(agentBeliefPredictions)
      .where(and(
        eq(agentBeliefPredictions.organizationId, orgId),
        sql`${agentBeliefPredictions.accuracy} IS NOT NULL`
      ));

    const scoringRate = scoredPredictions[0].count / Math.max(totalPredictions[0].count, 1);

    // Calculate average accuracy
    const avgAccuracy = await db.select({ 
      avg: sql<number>`AVG(accuracy)` 
    })
      .from(agentBeliefPredictions)
      .where(and(
        eq(agentBeliefPredictions.organizationId, orgId),
        sql`${agentBeliefPredictions.accuracy} IS NOT NULL`
      ));

    return {
      revisionRate,
      scoringRate,
      averageAccuracy: avgAccuracy[0]?.avg || 0,
      totalBeliefs: totalBeliefs[0].count,
      totalPredictions: totalPredictions[0].count,
    };
  }

  async checkBeliefAnomalies(orgId: number): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Check for excessive revision rate (>50%)
    const metrics = await this.getBeliefHealthMetrics(orgId);
    if (metrics.revisionRate > 0.5) {
      anomalies.push({
        type: "high_revision_rate",
        severity: "warning",
        message: `Belief revision rate is ${Math.round(metrics.revisionRate * 100)}%, above 50% threshold`,
      });
    }

    // Check for low calibration accuracy (<0.6)
    if (metrics.averageAccuracy < 0.6) {
      anomalies.push({
        type: "low_calibration_accuracy",
        severity: "warning",
        message: `Average calibration accuracy is ${Math.round(metrics.averageAccuracy * 100)}%, below 60% threshold`,
      });
    }

    return anomalies;
  }
}
```

**Belief Revision Dashboard:**

```typescript
// New component: client/src/components/crew/BeliefRevisionDashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { Card } from '@ui/components/card';
import { Badge } from '@ui/components/badge';

export function BeliefRevisionDashboard({ orgId }: { orgId: number }) {
  const { data: metrics } = useQuery({
    queryKey: ['belief-metrics', orgId],
    queryFn: () => fetchBeliefMetrics(orgId),
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: anomalies } = useQuery({
    queryKey: ['belief-anomalies', orgId],
    queryFn: () => fetchBeliefAnomalies(orgId),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Belief Health Metrics</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Revision Rate</p>
            <p className="text-2xl font-bold">
              {metrics ? Math.round(metrics.revisionRate * 100) : 0}%
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Calibration Accuracy</p>
            <p className="text-2xl font-bold">
              {metrics ? Math.round(metrics.averageAccuracy * 100) : 0}%
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Beliefs</p>
            <p className="text-2xl font-bold">{metrics?.totalBeliefs || 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Predictions</p>
            <p className="text-2xl font-bold">{metrics?.totalPredictions || 0}</p>
          </div>
        </div>
      </Card>

      {anomalies && anomalies.length > 0 && (
        <Card className="p-6 border-yellow-500">
          <h3 className="text-lg font-semibold mb-4">Anomalies Detected</h3>
          <div className="space-y-2">
            {anomalies.map((anomaly) => (
              <div key={anomaly.type} className="flex items-center gap-2">
                <Badge variant={anomaly.severity === 'warning' ? 'destructive' : 'secondary'}>
                  {anomaly.severity}
                </Badge>
                <p className="text-sm">{anomaly.message}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
```

**Calibration Metrics on Agent Cards:**

```typescript
// In client/src/components/agents/AgentCard.tsx
// Add calibration accuracy badge to agent card
function AgentCard({ agent }: { agent: AgentCardRecord }) {
  const { data: calibration } = useQuery({
    queryKey: ['agent-calibration', agent.id],
    queryFn: () => fetchAgentCalibration(agent.id),
  });

  return (
    <Card>
      {/* ... existing agent card content */}
      {calibration && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">Theory-of-Mind Calibration</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary"
                style={{ width: `${calibration.accuracy * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium">
              {Math.round(calibration.accuracy * 100)}%
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
```

**Supporting Evidence:**

1. **Service Exists:** Beliefs Service is already implemented and functional
2. **Database Schema:** `agent_beliefs` and `agent_belief_predictions` tables exist
3. **Monitoring Pattern:** Platform has existing monitoring services (e.g., for cycles, missions)
4. **UI Components:** Dashboard UI patterns exist in platform

#### Success Criteria

- Belief revision rate < 50% (healthy range)
- Calibration accuracy > 70% (good theory-of-mind)
- Anomaly detection alerts fire within 1 minute of threshold breach
- 90% of agent cards show calibration metrics

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| High revision rate indicates poor agent performance | Medium | Medium | Add agent performance tuning recommendations |
| Low calibration accuracy indicates poor theory-of-mind | Medium | Medium | Add archetype adjustment suggestions |
| Monitoring overhead affects performance | Low | Low | Use efficient queries with proper indexing |
| Dashboard not used by users | Medium | Low | Add dashboard to main CREW UI, not separate page |

---

## Medium-Term Recommendations (3-6 Months)

---

### Recommendation 5: Dynamic Speaker Selection

#### Problem Statement

**Current State:**
- MAX_SPEAKERS_PER_ROUND = 3 is hardcoded
- Same number of speakers regardless of discussion complexity
- Simple topics waste resources with 3 speakers
- Complex topics may need more than 3 speakers

**Evidence from Codebase:**
```typescript
// From crew-orchestrator.service.ts
const MAX_SPEAKERS_PER_ROUND = 3;

// Speaker selection is based on affinity only
const speakers = await this.selectSpeakers(topic, intent, availableAgents);
if (speakers.length > MAX_SPEAKERS_PER_ROUND) {
  speakers.length = MAX_SPEAKERS_PER_ROUND; // Hard limit
}
```

**Impact:**
- Inefficient resource usage (too many speakers for simple topics)
- Insufficient coverage for complex topics
- Increased latency for unnecessary speakers
- Reduced discussion quality for complex topics

#### Technical Solution

Implement dynamic speaker selection based on:
- Topic complexity (semantic analysis)
- Agent affinity scores (how well agents match topic)
- Current consensus level (how close to agreement)
- Historical performance (which agents add value)

**Implementation Details:**

```typescript
// In crew-orchestrator.service.ts
interface SpeakerSelectionContext {
  topic: string;
  intent: string;
  availableAgents: AgentCardRecord[];
  currentConsensus: number | null;
  round: number;
  sessionId: number;
}

interface SpeakerSelectionResult {
  selectedAgents: AgentCardRecord[];
  reasoning: string;
  optimalCount: number;
}

class DynamicSpeakerSelector {
  async selectSpeakers(context: SpeakerSelectionContext): Promise<SpeakerSelectionResult> {
    const { topic, intent, availableAgents, currentConsensus, round } = context;

    // Step 1: Calculate topic complexity
    const complexity = await this.calculateTopicComplexity(topic, intent);

    // Step 2: Calculate affinity scores for all agents
    const affinityScores = await this.calculateAffinityScores(
      topic,
      intent,
      availableAgents
    );

    // Step 3: Calculate optimal speaker count
    const optimalCount = this.calculateOptimalSpeakerCount(
      complexity,
      affinityScores,
      currentConsensus,
      round
    );

    // Step 4: Select top agents by affinity
    const sortedAgents = availableAgents
      .map((agent) => ({
        agent,
        score: affinityScores.get(agent.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const selectedAgents = sortedAgents
      .slice(0, optimalCount)
      .map((item) => item.agent);

    // Step 5: Generate reasoning
    const reasoning = this.generateReasoning(
      complexity,
      optimalCount,
      selectedAgents,
      currentConsensus
    );

    return {
      selectedAgents,
      reasoning,
      optimalCount,
    };
  }

  private async calculateTopicComplexity(topic: string, intent: string): Promise<number> {
    // Complexity factors:
    // - Topic length (longer = more complex)
    // - Technical term density (more technical = more complex)
    // - Intent specificity (specific intents = more complex)
    // - Question complexity (nested questions = more complex)

    const text = `${topic} ${intent}`;
    const words = text.split(/\s+/).length;
    const technicalTerms = this.countTechnicalTerms(text);
    const hasNestedQuestions = /\b(why|how|what|when|where).*(why|how|what|when|where)\b/i.test(text);

    const lengthScore = Math.min(words / 50, 1); // 0-1 based on length
    const technicalScore = Math.min(technicalTerms / 5, 1); // 0-1 based on technical terms
    const nestingScore = hasNestedQuestions ? 0.3 : 0;

    return (lengthScore * 0.4) + (technicalScore * 0.4) + (nestingScore * 0.2);
  }

  private countTechnicalTerms(text: string): number {
    const technicalTerms = [
      'api', 'database', 'deployment', 'security', 'compliance',
      'architecture', 'infrastructure', 'microservices', 'kubernetes',
      'authentication', 'authorization', 'encryption', 'scalability',
    ];
    const lowerText = text.toLowerCase();
    return technicalTerms.filter(term => lowerText.includes(term)).length;
  }

  private async calculateAffinityScores(
    topic: string,
    intent: string,
    agents: AgentCardRecord[]
  ): Promise<Map<number, number>> {
    const scores = new Map<number, number>();

    for (const agent of agents) {
      // Use existing intent router for topic/intent affinity
      const { intentRouterService } = await import("@domain/intent-router/core/intent-router.service.js");
      const topicScore = await intentRouterService.scoreTopicAffinity(topic, agent.topicAffinities || []);
      const intentScore = await intentRouterService.scoreIntentAffinity(intent, agent.intentAffinities || []);

      // Combine scores (70% topic, 30% intent)
      const combinedScore = (topicScore * 0.7) + (intentScore * 0.3);
      scores.set(agent.id, combinedScore);
    }

    return scores;
  }

  private calculateOptimalSpeakerCount(
    complexity: number,
    affinityScores: Map<number, number>,
    currentConsensus: number | null,
    round: number
  ): number {
    const baseSpeakers = 3;
    const minSpeakers = 1;
    const maxSpeakers = 5;

    // Complexity multiplier: more speakers for complex topics
    const complexityMultiplier = 1 + (complexity * 1.5); // 1.0 - 2.5

    // Affinity spread: more speakers when multiple agents have similar high affinity
    const scores = Array.from(affinityScores.values());
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const affinitySpread = maxScore - minScore;
    const affinityBonus = affinitySpread < 0.3 ? 1 : 0; // Add speaker when scores are close

    // Consensus penalty: fewer speakers when consensus is already high
    const consensusPenalty = (currentConsensus && currentConsensus > 80) ? -1 : 0;

    // Round bonus: more speakers in early rounds
    const roundBonus = round <= 2 ? 1 : 0;

    const calculatedCount = baseSpeakers * complexityMultiplier + affinityBonus + consensusPenalty + roundBonus;
    const clampedCount = Math.max(minSpeakers, Math.min(maxSpeakers, Math.round(calculatedCount)));

    return clampedCount;
  }

  private generateReasoning(
    complexity: number,
    optimalCount: number,
    selectedAgents: AgentCardRecord[],
    currentConsensus: number | null
  ): string {
    const reasons = [];
    reasons.push(`Topic complexity: ${Math.round(complexity * 100)}%`);
    reasons.push(`Optimal speaker count: ${optimalCount}`);
    
    if (currentConsensus && currentConsensus > 80) {
      reasons.push(`Reduced speakers due to high consensus (${currentConsensus}%)`);
    }

    reasons.push(`Selected agents: ${selectedAgents.map(a => a.name).join(', ')}`);

    return reasons.join('. ');
  }
}
```

**Integration with Orchestrator:**

```typescript
// In crew-orchestrator.service.ts
const dynamicSpeakerSelector = new DynamicSpeakerSelector();

async runRound(params: RoundParams): Promise<RoundResult> {
  // ... existing setup

  // Use dynamic speaker selection instead of static MAX_SPEAKERS_PER_ROUND
  const selectionResult = await dynamicSpeakerSelector.selectSpeakers({
    topic: userMessage,
    intent: classifiedIntent,
    availableAgents: crewMembers,
    currentConsensus: session.consensusLevel,
    round: currentRound,
    sessionId: sessionId,
  });

  logger.info(`[CrewOrchestrator] Dynamic speaker selection: ${selectionResult.reasoning}`);

  const speakers = selectionResult.selectedAgents;

  // ... continue with round execution
}
```

**Supporting Evidence:**

1. **Intent Router Exists:** Platform already has intent router with topic/intent affinity scoring
2. **Affinity Data:** Agent cards have `topicAffinities` and `intentAffinities` fields
3. **Consensus Tracking:** `crew_sessions` table has `consensusLevel` field
4. **Round Tracking:** `crew_turns` table has `round` field

#### Success Criteria

- Dynamic selection reduces latency by 20% for simple topics
- Complex topics show 15% improvement in discussion quality
- Average speaker count varies between 1-5 based on complexity
- 90% of users report dynamic selection is appropriate

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Too few speakers for complex topics | Medium | High | Set minimum of 2 speakers for high complexity |
| Too many speakers increase latency | Medium | Medium | Set maximum of 5 speakers, monitor latency |
| Affinity scoring is inaccurate | Low | Medium | Use existing intent router (already validated) |
| Dynamic selection is unpredictable | Low | Low | Add logging and reasoning for transparency |

---

### Recommendation 6: Cross-Crew Learning

#### Problem Statement

**Current State:**
- Crew conclusions are isolated to individual sessions
- No knowledge sharing across related discussions
- Same topics may be debated repeatedly
- No cross-session learning or improvement

**Evidence from Codebase:**
```typescript
// From crew-learning.service.ts
// Only writes back to individual agent knowledge graphs
async writeBackKnowledge(
  orgId: number,
  speakers: AgentCardRecord[],
  output: SupervisorOutput,
  topic: string,
  projectId: number | null
): Promise<WriteBackResult> {
  // Writes to each agent's individual knowledge graph
  // No cross-session sharing
}
```

**Impact:**
- Repeated debates on same topics
- No organizational learning from crew discussions
- Missed opportunity for knowledge reuse
- Inefficient use of crew resources

#### Technical Solution

Enable knowledge sharing across related crew discussions:
- Find sessions with similar topics
- Inject conclusions from related sessions as context
- Weight by recency and consensus level
- Mark as "cross-crew knowledge" in transcript

**Implementation Details:**

```typescript
// New service: server/domain/crew/core/crew-cross-learning.service.ts
import { db } from "@server/database_service.js";
import { crewSessions, supervisorNotes } from "@shared/schema/index.js";
import { and, eq, desc, sql } from "drizzle-orm";
import { getEmbeddings } from "@domain/knowledge/core/rag-langchain.service.js";
import { searchQdrant } from "@server/integrations/qdrant-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewCrossLearningService");

export class CrewCrossLearningService {
  /**
   * Find sessions with similar topics using semantic search
   */
  async findRelatedSessions(
    orgId: number,
    topic: string,
    projectId: number | null,
    limit: number = 5
  ): Promise<RelatedSession[]> {
    try {
      // Use semantic search on activeTopic field
      const vector = await getEmbeddings(topic);
      if (!vector) {
        logger.warn("Embedding unavailable for cross-crew learning");
        return [];
      }

      // Search Qdrant for similar sessions
      const hits = await searchQdrant("crew_sessions", vector, {
        limit: limit * 2, // Fetch more to filter
        filter: {
          must: [
            { key: "organizationId", match: { any: [orgId] } },
            ...(projectId ? [{ key: "projectId", match: { any: [projectId] } }] : []),
          ],
        },
      });

      // Fetch full session data
      const sessionIds = hits.map(h => h.id);
      const sessions = await db
        .select()
        .from(crewSessions)
        .where(and(
          eq(crewSessions.organizationId, orgId),
          sql`${crewSessions.id} = ANY(${sessionIds})`,
          eq(crewSessions.status, "archived"), // Only archived sessions (completed)
        ))
        .orderBy(desc(crewSessions.lastRoundCompletedAt))
        .limit(limit);

      // Calculate similarity scores and weight by consensus
      const relatedSessions: RelatedSession[] = sessions.map(session => {
        const hit = hits.find(h => h.id === session.id);
        const similarity = hit?.score || 0;
        const consensusWeight = (session.consensusLevel || 0) / 100;
        const recencyWeight = this.calculateRecencyWeight(session.lastRoundCompletedAt);

        return {
          sessionId: session.id,
          topic: session.activeTopic || "Unknown",
          consensusLevel: session.consensusLevel || 0,
          completedAt: session.lastRoundCompletedAt,
          similarity,
          combinedScore: (similarity * 0.5) + (consensusWeight * 0.3) + (recencyWeight * 0.2),
        };
      });

      // Sort by combined score
      return relatedSessions.sort((a, b) => b.combinedScore - a.combinedScore);
    } catch (error) {
      logger.error("Failed to find related sessions", error);
      return [];
    }
  }

  /**
   * Calculate recency weight (more recent = higher weight)
   */
  private calculateRecencyWeight(completedAt: Date | null): number {
    if (!completedAt) return 0;

    const daysSinceCompletion = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
    
    // Exponential decay: 1.0 for today, 0.5 for 7 days, 0.25 for 14 days
    return Math.exp(-daysSinceCompletion / 7);
  }

  /**
   * Inject related session conclusions as context
   */
  async injectRelatedConclusions(
    sessionId: number,
    relatedSessions: RelatedSession[]
  ): Promise<InjectedContext[]> {
    const injectedContexts: InjectedContext[] = [];

    for (const relatedSession of relatedSessions) {
      // Fetch supervisor notes (consensus, summaries) from related session
      const notes = await db
        .select()
        .from(supervisorNotes)
        .where(and(
          eq(supervisorNotes.sessionId, relatedSession.sessionId),
          sql`${supervisorNotes.noteType} IN ('consensus', 'summary')`,
        ))
        .orderBy(desc(supervisorNotes.createdAt));

      if (notes.length > 0) {
        const consensusNote = notes.find(n => n.noteType === "consensus");
        const summaryNote = notes.find(n => n.noteType === "summary");

        injectedContexts.push({
          sessionId: relatedSession.sessionId,
          topic: relatedSession.topic,
          consensus: consensusNote?.content || null,
          summary: summaryNote?.content || null,
          consensusLevel: relatedSession.consensusLevel,
          similarity: relatedSession.similarity,
          completedAt: relatedSession.completedAt,
        });
      }
    }

    return injectedContexts;
  }

  /**
   * Format injected context for agent prompt
   */
  formatInjectedContext(contexts: InjectedContext[]): string {
    if (contexts.length === 0) return "";

    const lines = [
      "CROSS-CREW KNOWLEDGE",
      "The following conclusions were reached in related discussions:",
    ];

    for (const ctx of contexts) {
      lines.push(`\n[Session ${ctx.sessionId} - ${ctx.topic}]`);
      lines.push(`Consensus Level: ${ctx.consensusLevel}%`);
      
      if (ctx.consensus) {
        lines.push(`Consensus: ${ctx.consensus}`);
      }
      
      if (ctx.summary) {
        lines.push(`Summary: ${ctx.summary}`);
      }

      lines.push(`Similarity: ${Math.round(ctx.similarity * 100)}%`);
    }

    return lines.join("\n");
  }
}

interface RelatedSession {
  sessionId: number;
  topic: string;
  consensusLevel: number;
  completedAt: Date | null;
  similarity: number;
  combinedScore: number;
}

interface InjectedContext {
  sessionId: number;
  topic: string;
  consensus: string | null;
  summary: string | null;
  consensusLevel: number;
  similarity: number;
  completedAt: Date | null;
}
```

**Integration with Orchestrator:**

```typescript
// In crew-orchestrator.service.ts
const crewCrossLearningService = new CrewCrossLearningService();

async runRound(params: RoundParams): Promise<RoundResult> {
  // ... existing setup

  // Find related sessions for cross-crew learning
  const relatedSessions = await crewCrossLearningService.findRelatedSessions(
    orgId,
    userMessage,
    projectId,
    3 // Top 3 related sessions
  );

  // Inject related conclusions as context
  const injectedContexts = await crewCrossLearningService.injectRelatedConclusions(
    sessionId,
    relatedSessions
  );

  const crossCrewContext = crewCrossLearningService.formatInjectedContext(injectedContexts);

  // Add cross-crew context to agent prompts
  for (const agent of speakers) {
    agent.prompt = `${crossCrewContext}\n\n${agent.prompt}`;
  }

  // ... continue with round execution
}
```

**UI Integration:**

```typescript
// In client/src/components/crew/CrewTranscript.tsx
// Mark cross-crew knowledge in transcript
function CrewTranscript({ turns, injectedContexts }: { turns: CrewTurn[], injectedContexts: InjectedContext[] }) {
  return (
    <div>
      {injectedContexts.length > 0 && (
        <div className="p-4 bg-blue-50 border-l-4 border-blue-500 mb-4">
          <p className="text-sm font-medium text-blue-900">Cross-Crew Knowledge</p>
          <p className="text-xs text-blue-700">
            Conclusions from {injectedContexts.length} related discussion(s)
          </p>
        </div>
      )}
      
      {turns.map(turn => (
        <Turn key={turn.id} turn={turn} />
      ))}
    </div>
  );
}
```

**Supporting Evidence:**

1. **Semantic Search:** Platform already uses Qdrant for semantic search (knowledge graph, capability registry)
2. **Embedding Service:** `getEmbeddings` function exists and is used elsewhere
3. **Supervisor Notes:** `supervisor_notes` table already stores consensus and summaries
4. **Session Metadata:** `crew_sessions` has `activeTopic`, `consensusLevel`, `lastRoundCompletedAt`

#### Success Criteria

- Cross-crew learning reduces repeated debates by 30%
- 80% of related sessions have similarity > 0.7
- Injected context shows 15% improvement in discussion quality
- 90% of users report cross-crew knowledge is helpful

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Injected context is irrelevant | Medium | Medium | Use high similarity threshold (>0.7) |
| Old conclusions are outdated | Medium | Medium | Weight by recency, exclude sessions > 30 days old |
| Cross-project privacy violation | Low | High | Respect project scoping (only same project) |
| Too much context overwhelms agents | Low | Medium | Limit to top 3 related sessions |

---

### Recommendation 7: CREW Templates

#### Problem Statement

**Current State:**
- No way to pre-configure crew compositions
- Each crew session requires manual agent selection
- No best practice sharing for crew setups
- Inconsistent crew compositions for similar scenarios

**Evidence from Codebase:**
```typescript
// From shared/schema/crew.ts
// No crew_templates table exists
// Crew composition is manual per session
```

**Impact:**
- Time-consuming crew setup
- Inconsistent agent compositions
- No best practice sharing
- Slower onboarding for new scenarios

#### Technical Solution

Add crew templates for common use cases:
- Pre-configured agent compositions
- Use case categorization
- Project scoping
- One-click crew creation from template

**Implementation Details:**

**Database Schema:**

```sql
-- New migration: migrations/runtime/0026_crew_templates.sql
CREATE TABLE crew_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  agent_card_ids INTEGER[] NOT NULL,
  use_case TEXT, -- e.g., "security_review", "deployment_planning"
  project_id INTEGER, -- Optional project scoping
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_crew_templates_org ON crew_templates(organization_id);
CREATE INDEX idx_crew_templates_use_case ON crew_templates(use_case);
CREATE INDEX idx_crew_templates_project ON crew_templates(project_id);
```

**TypeScript Schema:**

```typescript
// In shared/schema/crew.ts
export const crewTemplates = pgTable("crew_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  agentCardIds: jsonb("agent_card_ids").$type<number[]>().notNull(),
  useCase: text("use_case"),
  projectId: integer("project_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("idx_crew_templates_org").on(table.organizationId),
  useCaseIdx: index("idx_crew_templates_use_case").on(table.useCase),
  projectIdx: index("idx_crew_templates_project").on(table.projectId),
}));

export type CrewTemplateRecord = typeof crewTemplates.$inferSelect;
```

**Pre-built Templates:**

```typescript
// In server/domain/crew/core/crew-templates.service.ts
export const PREBUILT_TEMPLATES: Array<{
  useCase: string;
  name: string;
  description: string;
  agentNames: string[];
}> = [
  {
    useCase: "security_review",
    name: "Security Review",
    description: "Standard crew for security reviews and vulnerability assessments",
    agentNames: ["Security Auditor", "Compliance Officer", "Backend Developer"],
  },
  {
    useCase: "deployment_planning",
    name: "Deployment Planning",
    description: "Standard crew for deployment planning and risk assessment",
    agentNames: ["DevOps Engineer", "Backend Developer", "QA Engineer"],
  },
  {
    useCase: "architecture_review",
    name: "Architecture Review",
    description: "Standard crew for architecture design reviews",
    agentNames: ["Backend Developer", "Frontend Developer", "Data Engineer"],
  },
  {
    useCase: "incident_response",
    name: "Incident Response",
    description: "Standard crew for incident response and remediation",
    agentNames: ["Crisis Commander", "DevOps Engineer", "Security Auditor"],
  },
  {
    useCase: "compliance_audit",
    name: "Compliance Audit",
    description: "Standard crew for compliance audits and documentation",
    agentNames: ["Compliance Officer", "Security Auditor", "Knowledge Architect"],
  },
  {
    useCase: "feature_planning",
    name: "Feature Planning",
    description: "Standard crew for feature planning and requirements analysis",
    agentNames: ["Product Manager", "Backend Developer", "Frontend Developer"],
  },
];

export class CrewTemplatesService {
  async seedPrebuiltTemplates(orgId: number): Promise<void> {
    const { db } = await import("@server/database_service.js");
    const { agentCards } = await import("@shared/schema/agent-cards.js");

    for (const template of PREBUILT_TEMPLATES) {
      // Resolve agent names to IDs
      const agentCardsRecords = await db
        .select({ id: agentCards.id })
        .from(agentCards)
        .where(and(
          eq(agentCards.organizationId, orgId),
          sql`${agentCards.name} = ANY(${template.agentNames})`,
        ));

      const agentCardIds = agentCardsRecords.map(a => a.id);

      if (agentCardIds.length === template.agentNames.length) {
        await db.insert(crewTemplates).values({
          organizationId: orgId,
          name: template.name,
          description: template.description,
          agentCardIds,
          useCase: template.useCase,
          createdBy: "system",
        });
      }
    }
  }

  async listTemplates(orgId: number, projectId?: number): Promise<CrewTemplateRecord[]> {
    const { db } = await import("@server/database_service.js");
    
    const conditions = [eq(crewTemplates.organizationId, orgId)];
    if (projectId) {
      conditions.push(eq(crewTemplates.projectId, projectId));
    }

    return await db
      .select()
      .from(crewTemplates)
      .where(and(...conditions))
      .orderBy(desc(crewTemplates.createdAt));
  }

  async createFromTemplate(
    templateId: number,
    sessionId: number,
    orgId: number
  ): Promise<void> {
    const { db } = await import("@server/database_service.js");
    const { crewMembers } = await import("@shared/schema/crew.js");

    const template = await db
      .select()
      .from(crewTemplates)
      .where(eq(crewTemplates.id, templateId))
      .limit(1);

    if (!template[0]) {
      throw new Error("Template not found");
    }

    // Add agents from template to crew session
    for (const agentCardId of template[0].agentCardIds) {
      await db.insert(crewMembers).values({
        sessionId,
        agentCardId,
        joinedAt: new Date(),
      });
    }
  }
}
```

**UI Component:**

```typescript
// New component: client/src/components/crew/CrewTemplateSelector.tsx
import { useQuery } from '@tanstack/react-query';
import { Button } from '@ui/components/button';
import { Card } from '@ui/components/card';
import { Badge } from '@ui/components/badge';

export function CrewTemplateSelector({
  orgId,
  projectId,
  onSelectTemplate,
}: {
  orgId: number;
  projectId?: number;
  onSelectTemplate: (templateId: number) => void;
}) {
  const { data: templates } = useQuery({
    queryKey: ['crew-templates', orgId, projectId],
    queryFn: () => fetchCrewTemplates(orgId, projectId),
  });

  const groupedTemplates = templates?.reduce((acc, template) => {
    const useCase = template.useCase || 'other';
    if (!acc[useCase]) acc[useCase] = [];
    acc[useCase].push(template);
    return acc;
  }, {} as Record<string, typeof templates>) || {};

  return (
    <div className="space-y-6">
      {Object.entries(groupedTemplates).map(([useCase, templates]) => (
        <div key={useCase}>
          <h3 className="text-lg font-semibold capitalize mb-3">{useCase.replace(/_/g, ' ')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {templates.map((template) => (
              <Card key={template.id} className="p-4 hover:bg-muted/50 cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium">{template.name}</h4>
                  {template.projectId && (
                    <Badge variant="secondary" className="text-xs">Project</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => onSelectTemplate(template.id)}
                >
                  Use Template
                </Button>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Supporting Evidence:**

1. **Database Pattern:** Platform uses similar pattern for other templates (e.g., mission templates)
2. **Agent Cards:** Agent cards exist and can be referenced by ID
3. **UI Components:** Platform has existing template selection UI patterns
4. **Project Scoping:** Platform already supports project scoping for resources

#### Success Criteria

- Crew templates increase setup speed by 60%
- 80% of crew sessions use templates
- Pre-built templates cover 90% of common use cases
- 90% of users report templates are useful

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Templates don't match org's agents | Medium | Medium | Auto-seed only if all required agents exist |
| Template becomes outdated | Medium | Low | Add template versioning and update notifications |
| Too many templates overwhelm users | Low | Low | Limit to top 10 most used templates |
| Template doesn't fit specific scenario | Low | Medium | Allow template customization after selection |

---

### Recommendation 8: CREW Analytics Dashboard

#### Problem Statement

**Current State:**
- No visibility into crew performance and effectiveness
- No metrics tracking for crew sessions
- No way to identify underperforming agents
- No data to optimize crew compositions

**Evidence from Codebase:**
```typescript
// No crew analytics service exists
// No dashboard component exists
// Metrics are not tracked or aggregated
```

**Impact:**
- Cannot measure crew effectiveness
- Cannot identify improvement opportunities
- Cannot optimize crew compositions
- No data-driven decision making

#### Technical Solution

Add analytics dashboard for crew metrics:
- Average consensus level per session
- Average rounds to consensus
- Agent contribution frequency
- Belief revision frequency
- Calibration accuracy per agent
- Plan execution rate
- Issue resolution rate

**Implementation Details:**

**Analytics Service:**

```typescript
// New service: server/domain/crew/core/crew-analytics.service.ts
import { db } from "@server/database_service.js";
import {
  crewSessions,
  crewTurns,
  supervisorNotes,
  crewIssues,
  agentBeliefs,
  agentBeliefPredictions,
} from "@shared/schema/index.js";
import { and, eq, desc, sql, avg, count } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewAnalyticsService");

export interface CrewMetrics {
  totalSessions: number;
  averageConsensus: number;
  averageRoundsToConsensus: number;
  agentContributions: Map<string, number>;
  beliefRevisions: number;
  calibrationAccuracy: Map<string, number>;
  planExecutionRate: number;
  issueResolutionRate: number;
}

export class CrewAnalyticsService {
  async getOrgMetrics(orgId: number, timeRange?: { start: Date; end: Date }): Promise<CrewMetrics> {
    const timeFilter = timeRange
      ? and(
          eq(crewSessions.organizationId, orgId),
          sql`${crewSessions.createdAt} >= ${timeRange.start}`,
          sql`${crewSessions.createdAt} <= ${timeRange.end}`,
        )
      : eq(crewSessions.organizationId, orgId);

    // Total sessions
    const totalSessionsResult = await db
      .select({ count: count() })
      .from(crewSessions)
      .where(timeFilter);
    const totalSessions = totalSessionsResult[0]?.count || 0;

    // Average consensus level
    const avgConsensusResult = await db
      .select({ avg: avg(crewSessions.consensusLevel) })
      .from(crewSessions)
      .where(and(timeFilter, sql`${crewSessions.consensusLevel} IS NOT NULL`));
    const averageConsensus = avgConsensusResult[0]?.avg || 0;

    // Average rounds to consensus
    const maxRoundResult = await db
      .select({ avg: avg(sql<number>`MAX(round)`).as('avg_max_round') })
      .from(crewTurns)
      .where(and(
        eq(crewTurns.organizationId, orgId),
        ...(timeRange ? [
          sql`${crewTurns.createdAt} >= ${timeRange.start}`,
          sql`${crewTurns.createdAt} <= ${timeRange.end}`,
        ] : []),
      ))
      .groupBy(crewTurns.sessionId);
    const averageRoundsToConsensus = maxRoundResult.length > 0
      ? maxRoundResult.reduce((sum, r) => sum + (r.avg_max_round || 0), 0) / maxRoundResult.length
      : 0;

    // Agent contributions
    const agentContributionsResult = await db
      .select({
        agentName: crewTurns.speakerName,
        count: count(),
      })
      .from(crewTurns)
      .where(and(
        eq(crewTurns.organizationId, orgId),
        eq(crewTurns.speakerType, "agent"),
        ...(timeRange ? [
          sql`${crewTurns.createdAt} >= ${timeRange.start}`,
          sql`${crewTurns.createdAt} <= ${timeRange.end}`,
        ] : []),
      ))
      .groupBy(crewTurns.speakerName);
    
    const agentContributions = new Map(
      agentContributionsResult.map(r => [r.agentName, r.count])
    );

    // Belief revisions
    const beliefRevisionsResult = await db
      .select({ count: count() })
      .from(agentBeliefs)
      .where(and(
        eq(agentBeliefs.organizationId, orgId),
        eq(agentBeliefs.status, "revised"),
        ...(timeRange ? [
          sql`${agentBeliefs.createdAt} >= ${timeRange.start}`,
          sql`${agentBeliefs.createdAt} <= ${timeRange.end}`,
        ] : []),
      ));
    const beliefRevisions = beliefRevisionsResult[0]?.count || 0;

    // Calibration accuracy per agent
    const calibrationAccuracyResult = await db
      .select({
        agentCardId: agentBeliefPredictions.predictorAgentCardId,
        avg: avg(agentBeliefPredictions.accuracy),
      })
      .from(agentBeliefPredictions)
      .where(and(
        eq(agentBeliefPredictions.organizationId, orgId),
        sql`${agentBeliefPredictions.accuracy} IS NOT NULL`,
        ...(timeRange ? [
          sql`${agentBeliefPredictions.createdAt} >= ${timeRange.start}`,
          sql`${agentBeliefPredictions.createdAt} <= ${timeRange.end}`,
        ] : []),
      ))
      .groupBy(agentBeliefPredictions.predictorAgentCardId);

    const calibrationAccuracy = new Map(
      calibrationAccuracyResult.map(r => [String(r.agentCardId), r.avg || 0])
    );

    // Plan execution rate
    const planExecutionRate = await this.calculatePlanExecutionRate(orgId, timeRange);

    // Issue resolution rate
    const issueResolutionRate = await this.calculateIssueResolutionRate(orgId, timeRange);

    return {
      totalSessions,
      averageConsensus,
      averageRoundsToConsensus,
      agentContributions,
      beliefRevisions,
      calibrationAccuracy,
      planExecutionRate,
      issueResolutionRate,
    };
  }

  private async calculatePlanExecutionRate(
    orgId: number,
    timeRange?: { start: Date; end: Date }
  ): Promise<number> {
    const { crewPlans } = await import("@shared/schema/crew.js");

    const timeFilter = timeRange
      ? and(
          eq(crewPlans.organizationId, orgId),
          sql`${crewPlans.createdAt} >= ${timeRange.start}`,
          sql`${crewPlans.createdAt} <= ${timeRange.end}`,
        )
      : eq(crewPlans.organizationId, orgId);

    const totalPlansResult = await db
      .select({ count: count() })
      .from(crewPlans)
      .where(timeFilter);
    const totalPlans = totalPlansResult[0]?.count || 0;

    const executedPlansResult = await db
      .select({ count: count() })
      .from(crewPlans)
      .where(and(timeFilter, eq(crewPlans.status, "accepted")));
    const executedPlans = executedPlansResult[0]?.count || 0;

    return totalPlans > 0 ? executedPlans / totalPlans : 0;
  }

  private async calculateIssueResolutionRate(
    orgId: number,
    timeRange?: { start: Date; end: Date }
  ): Promise<number> {
    const timeFilter = timeRange
      ? and(
          eq(crewIssues.organizationId, orgId),
          sql`${crewIssues.createdAt} >= ${timeRange.start}`,
          sql`${crewIssues.createdAt} <= ${timeRange.end}`,
        )
      : eq(crewIssues.organizationId, orgId);

    const totalIssuesResult = await db
      .select({ count: count() })
      .from(crewIssues)
      .where(timeFilter);
    const totalIssues = totalIssuesResult[0]?.count || 0;

    const resolvedIssuesResult = await db
      .select({ count: count() })
      .from(crewIssues)
      .where(and(timeFilter, eq(crewIssues.status, "resolved")));
    const resolvedIssues = resolvedIssuesResult[0]?.count || 0;

    return totalIssues > 0 ? resolvedIssues / totalIssues : 0;
  }
}
```

**Dashboard Component:**

```typescript
// New component: client/src/components/crew/CrewAnalyticsDashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { Card } from '@ui/components/card';
import { Badge } from '@ui/components/badge';

export function CrewAnalyticsDashboard({ orgId }: { orgId: number }) {
  const { data: metrics } = useQuery({
    queryKey: ['crew-analytics', orgId],
    queryFn: () => fetchCrewMetrics(orgId),
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Session Overview</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total Sessions</p>
            <p className="text-2xl font-bold">{metrics?.totalSessions || 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Average Consensus</p>
            <p className="text-2xl font-bold">{Math.round((metrics?.averageConsensus || 0) * 100)}%</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Avg Rounds to Consensus</p>
            <p className="text-2xl font-bold">{Math.round(metrics?.averageRoundsToConsensus || 0)}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Agent Contributions</h3>
        <div className="space-y-2">
          {Array.from(metrics?.agentContributions || []).map(([agent, count]) => (
            <div key={agent} className="flex items-center justify-between">
              <span className="text-sm">{agent}</span>
              <Badge variant="secondary">{count}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Learning & Improvement</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Belief Revisions</p>
            <p className="text-2xl font-bold">{metrics?.beliefRevisions || 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Plan Execution Rate</p>
            <p className="text-2xl font-bold">{Math.round((metrics?.planExecutionRate || 0) * 100)}%

</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Issue Resolution</h3>
        <div>
          <p className="text-sm text-muted-foreground">Resolution Rate</p>
          <p className="text-2xl font-bold">{Math.round((metrics?.issueResolutionRate || 0) * 100)}%</p>
        </div>
      </Card>
    </div>
  );
}
```

**Supporting Evidence:**

1. **Database Tables:** All required tables exist (crew_sessions, crew_turns, supervisor_notes, crew_issues, agent_beliefs, agent_belief_predictions)
2. **Query Pattern:** Platform uses similar aggregation patterns for other analytics
3. **UI Components:** Dashboard UI patterns exist in platform
4. **React Query:** Platform uses React Query for data fetching

#### Success Criteria

- Dashboard loads in < 2 seconds
- Metrics are accurate within 5% margin of error
- 90% of users report dashboard is useful
- Dashboard leads to 10% improvement in crew effectiveness

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Slow query performance | Medium | Medium | Add proper database indexes, use materialized views |
| Metrics are not actionable | Medium | Low | Add recommendations based on metrics |
| Dashboard not used | Low | Low | Add dashboard to main CREW UI, not separate page |
| Data privacy concerns | Low | Medium | Respect org scoping, no cross-org data access |

---

## Long-Term Recommendations (6-12 Months)

---

### Recommendation 9: Self-Improving Triage

#### Problem Statement

**Current State:**
- Triage is heuristic and model-free
- Uses keyword matching and rule-based scoring
- May miss edge cases or nuance
- Does not adapt to organization-specific patterns

**Evidence from Codebase:**
```typescript
// From crew-triage.service.ts
export class CrewTriageService {
  assess(message: string): TriageResult {
    // Heuristic scoring:
    // - @mention detection
    // - High-stakes verbs
    // - Pleasantries filtering
    // - Length scoring
    // - Substance markers
    // - Domain nouns
    // - Question marks
  }
}
```

**Impact:**
- May incorrectly classify messages
- Does not learn from past decisions
- Cannot adapt to organization-specific patterns
- Suboptimal resource allocation

#### Technical Solution

Train ML model for substance scoring based on historical data:
- Use historical sessions as training data
- Features: message length, question marks, domain nouns, @mentions
- Labels: whether full crew discussion was valuable (measured by consensus level, plan execution)
- Train lightweight classifier
- Fall back to heuristic if model unavailable

**Implementation Details:**

```typescript
// New service: server/domain/crew/core/crew-triage-ml.service.ts
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { crewSessions, crewTurns } from "@shared/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

const logger = createLogger("CrewTriageMLService");

export class CrewTriageMLService {
  private model: any = null;
  private modelVersion: string = "v1";

  async trainSubstanceModel(orgId: number): Promise<void> {
    try {
      // Fetch historical sessions for training
      const sessions = await db
        .select({
          sessionId: crewSessions.id,
          consensusLevel: crewSessions.consensusLevel,
          maxRound: sql<number>`MAX(${crewTurns.round})`,
        })
        .from(crewSessions)
        .innerJoin(crewTurns, eq(crewTurns.sessionId, crewSessions.id))
        .where(and(
          eq(crewSessions.organizationId, orgId),
          eq(crewSessions.status, "archived"),
          sql`${crewSessions.consensusLevel} IS NOT NULL`,
        ))
        .groupBy(crewSessions.id);

      // Extract features from user messages
      const trainingData = [];
      for (const session of sessions) {
        const userTurns = await db
          .select({ content: crewTurns.content })
          .from(crewTurns)
          .where(and(
            eq(crewTurns.sessionId, session.sessionId),
            eq(crewTurns.speakerType, "user"),
          ));

        for (const turn of userTurns) {
          const features = this.extractFeatures(turn.content);
          const label = this.calculateLabel(session.consensusLevel, session.maxRound);
          trainingData.push({ features, label });
        }
      }

      // Train lightweight classifier (e.g., logistic regression or small neural network)
      this.model = await this.trainClassifier(trainingData);
      logger.info(`[CrewTriageMLService] Trained model on ${trainingData.length} examples`);
    } catch (error) {
      logger.error("Failed to train substance model", error);
    }
  }

  private extractFeatures(message: string): number[] {
    const words = message.split(/\s+/);
    const normalized = message.toLowerCase();

    return [
      words.length / 50, // Length (normalized)
      (message.match(/\?/g) || []).length / 5, // Question marks
      this.countDomainNouns(normalized) / 10, // Domain nouns
      message.includes("@") ? 1 : 0, // @mention
      this.countSubstanceMarkers(normalized) / 10, // Substance markers
      this.countHighStakesVerbs(normalized) > 0 ? 1 : 0, // High-stakes verbs
    ];
  }

  private countDomainNouns(text: string): number {
    const domainTerms = [
      'api', 'database', 'deployment', 'security', 'compliance',
      'architecture', 'infrastructure', 'microservices', 'kubernetes',
    ];
    return domainTerms.filter(term => text.includes(term)).length;
  }

  private countSubstanceMarkers(text: string): number {
    const markers = /\b(why|how|what|when|where|explain|analyze|assess|review|evaluate|design|plan|build|fix|debug)\b/gi;
    return (text.match(markers) || []).length;
  }

  private countHighStakesVerbs(text: string): number {
    const verbs = /\b(deploy|ship|release|delete|rollback|merge|publish|execute|launch)\b/gi;
    return (text.match(verbs) || []).length;
  }

  private calculateLabel(consensusLevel: number | null, maxRound: number): number {
    // Label is 1 if discussion was valuable (high consensus, multiple rounds)
    if (!consensusLevel) return 0;
    const consensusScore = consensusLevel / 100;
    const roundScore = Math.min(maxRound / 3, 1);
    return (consensusScore * 0.7 + roundScore * 0.3) > 0.5 ? 1 : 0;
  }

  private async trainClassifier(trainingData: Array<{ features: number[]; label: number }>): Promise<any> {
    // Use a simple logistic regression or small neural network
    // For this example, we'll use a placeholder
    // In production, use TensorFlow.js or similar
    
    // Simple logistic regression implementation
    const weights = new Array(6).fill(0).map(() => Math.random() * 0.1 - 0.05);
    const learningRate = 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (const example of trainingData) {
        const prediction = this.sigmoid(
          example.features.reduce((sum, f, i) => sum + f * weights[i], 0)
        );
        const error = example.label - prediction;
        
        for (let i = 0; i < weights.length; i++) {
          weights[i] += learningRate * error * example.features[i];
        }
      }
    }

    return { weights, version: this.modelVersion };
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  async assessSubstance(message: string): Promise<number> {
    if (!this.model) {
      // Fall back to heuristic
      const { crewTriageService } = await import("./crew-triage.service.js");
      const result = crewTriageService.assess(message);
      return result.substance;
    }

    const features = this.extractFeatures(message);
    const score = this.sigmoid(
      features.reduce((sum, f, i) => sum + f * this.model.weights[i], 0)
    );

    return score;
  }

  async saveModel(orgId: number): Promise<void> {
    if (!this.model) return;

    // Save model to database or file system
    const { crewTriageModels } = await import("@shared/schema/crew-triage-models.js");
    await db.insert(crewTriageModels).values({
      organizationId: orgId,
      modelVersion: this.modelVersion,
      modelData: JSON.stringify(this.model),
      createdAt: new Date(),
    });
  }

  async loadModel(orgId: number): Promise<void> {
    const { crewTriageModels } = await import("@shared/schema/crew-triage-models.js");
    const [savedModel] = await db
      .select()
      .from(crewTriageModels)
      .where(eq(crewTriageModels.organizationId, orgId))
      .orderBy(desc(crewTriageModels.createdAt))
      .limit(1);

    if (savedModel) {
      this.model = JSON.parse(savedModel.modelData);
      this.modelVersion = savedModel.modelVersion;
      logger.info(`[CrewTriageMLService] Loaded model ${this.modelVersion}`);
    }
  }
}
```

**Integration with Triage Service:**

```typescript
// In crew-triage.service.ts
const crewTriageMLService = new CrewTriageMLService();

export class CrewTriageService {
  async assess(message: string, orgId?: number): Promise<TriageResult> {
    // Try ML model first
    if (orgId) {
      await crewTriageMLService.loadModel(orgId);
      const mlScore = await crewTriageMLService.assessSubstance(message);
      
      if (mlScore > 0) {
        const mode = mlScore >= 0.3 ? "discussion" : "conversational";
        return {
          mode,
          substance: mlScore,
          reason: "ML-based scoring",
        };
      }
    }

    // Fall back to heuristic
    return this.heuristicAssess(message);
  }

  private heuristicAssess(message: string): TriageResult {
    // ... existing heuristic logic
  }
}
```

**Supporting Evidence:**

1. **Historical Data:** `crew_sessions` and `crew_turns` tables have sufficient historical data
2. **Feature Extraction:** Existing heuristic already extracts similar features
3. **ML Infrastructure:** Platform may have ML infrastructure for other features
4. **Fallback Pattern:** Platform uses fallback patterns elsewhere (e.g., semantic search)

#### Success Criteria

- ML model improves triage accuracy by 15%
- Model trains in < 5 minutes on 1000 sessions
- Fallback to heuristic works 100% of time when model unavailable
- Model adapts to organization-specific patterns

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Insufficient training data | Medium | High | Require minimum 100 sessions before training |
| Model overfitting | Medium | Medium | Use regularization, cross-validation |
| Model degrades over time | Medium | Medium | Schedule periodic retraining (monthly) |
| ML infrastructure overhead | Low | Medium | Use lightweight model, optional feature |

---

### Recommendation 10: Agent Specialization Auto-Inference

#### Problem Statement

**Current State:**
- Archetypes are manually assigned based on card name/description
- May not match actual agent behavior
- No feedback loop from performance to archetype
- Suboptimal crew compositions

**Evidence from Codebase:**
```typescript
// From crew-persona.service.ts
function inferArchetype(card: AgentCardRecord): string {
  const text = `${card.name} ${card.description}`.toLowerCase();
  // Rule-based inference based on keywords
  if (/dispatch|emergency|incident|crisis|remediation|rescue/.test(text)) return "Crisis Commander";
  if (/deploy|pipeline|release|cab|provision|process/.test(text)) return "Process Engineer";
  // ... more rules
}
```

**Impact:**
- Agents may not perform optimally with mismatched archetypes
- No continuous improvement of crew effectiveness
- Manual archetype assignment is error-prone
- Missed opportunity for data-driven optimization

#### Technical Solution

Automatically infer optimal archetypes from agent performance:
- Analyze agent's historical contributions
- Features: consensus improvement, plan execution success, belief accuracy
- Map to optimal archetype based on performance patterns
- Provide rationale for archetype changes

**Implementation Details:**

```typescript
// New service: server/domain/crew/core/crew-specialization-inference.service.ts
import { db } from "@server/database_service.js";
import { crewTurns, supervisorNotes, agentBeliefPredictions } from "@shared/schema/index.js";
import { and, eq, sql, avg } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewSpecializationInferenceService");

export interface AgentPerformanceMetrics {
  agentCardId: number;
  totalContributions: number;
  consensusImprovement: number; // Average consensus change after agent speaks
  planExecutionSuccess: number; // Rate of plan steps executed successfully
  beliefAccuracy: number; // Average calibration accuracy
  topicAffinity: Map<string, number>; // Topics where agent performs well
}

export class CrewSpecializationInferenceService {
  async inferOptimalArchetype(
    agentCardId: number,
    orgId: number
  ): Promise<{ archetype: string; confidence: number; reason: string }> {
    const performance = await this.calculatePerformanceMetrics(agentCardId, orgId);
    
    // Map performance to archetype
    const archetypeScores = this.calculateArchetypeScores(performance);
    const topArchetype = archetypeScores.sort((a, b) => b.score - a.score)[0];

    return {
      archetype: topArchetype.archetype,
      confidence: topArchetype.score,
      reason: this.generateReasoning(performance, topArchetype),
    };
  }

  private async calculatePerformanceMetrics(
    agentCardId: number,
    orgId: number
  ): Promise<AgentPerformanceMetrics> {
    // Total contributions
    const totalContributionsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(crewTurns)
      .where(and(
        eq(crewTurns.organizationId, orgId),
        eq(crewTurns.agentCardId, agentCardId),
      ));
    const totalContributions = totalContributionsResult[0]?.count || 0;

    // Consensus improvement (average consensus change after agent speaks)
    const consensusImprovementResult = await db
      .select({
        beforeConsensus: sql<number>`LAG(${supervisorNotes.content}) OVER (ORDER BY ${supervisorNotes.createdAt})`,
        afterConsensus: supervisorNotes.content,
      })
      .from(supervisorNotes)
      .where(and(
        eq(supervisorNotes.organizationId, orgId),
        eq(supervisorNotes.noteType, "consensus"),
      ))
      .orderBy(supervisorNotes.createdAt);

    // Simplified: calculate average consensus level from sessions where agent participated
    const avgConsensusResult = await db
      .select({ avg: avg(crewSessions.consensusLevel) })
      .from(crewSessions)
      .innerJoin(crewTurns, eq(crewTurns.sessionId, crewSessions.id))
      .where(and(
        eq(crewSessions.organizationId, orgId),
        eq(crewTurns.agentCardId, agentCardId),
        sql`${crewSessions.consensusLevel} IS NOT NULL`,
      ));
    const consensusImprovement = avgConsensusResult[0]?.avg || 0;

    // Plan execution success (placeholder - would need plan execution tracking)
    const planExecutionSuccess = 0.8; // Default

    // Belief accuracy (calibration)
    const beliefAccuracyResult = await db
      .select({ avg: avg(agentBeliefPredictions.accuracy) })
      .from(agentBeliefPredictions)
      .where(and(
        eq(agentBeliefPredictions.organizationId, orgId),
        eq(agentBeliefPredictions.predictorAgentCardId, agentCardId),
        sql`${agentBeliefPredictions.accuracy} IS NOT NULL`,
      ));
    const beliefAccuracy = beliefAccuracyResult[0]?.avg || 0;

    // Topic affinity (placeholder - would need topic extraction)
    const topicAffinity = new Map<string, number>();

    return {
      agentCardId,
      totalContributions,
      consensusImprovement,
      planExecutionSuccess,
      beliefAccuracy,
      topicAffinity,
    };
  }

  private calculateArchetypeScores(
    performance: AgentPerformanceMetrics
  ): Array<{ archetype: string; score: number }> {
    const scores: Array<{ archetype: string; score: number }> = [];

    // Crisis Commander: high consensus improvement, high belief accuracy
    scores.push({
      archetype: "Crisis Commander",
      score: (performance.consensusImprovement / 100) * 0.6 + performance.beliefAccuracy * 0.4,
    });

    // Process Engineer: high plan execution success
    scores.push({
      archetype: "Process Engineer",
      score: performance.planExecutionSuccess * 0.7 + (performance.consensusImprovement / 100) * 0.3,
    });

    // Knowledge Architect: high topic affinity, high belief accuracy
    scores.push({
      archetype: "Knowledge Architect",
      score: performance.beliefAccuracy * 0.6 + (performance.consensusImprovement / 100) * 0.4,
    });

    // ... more archetypes

    return scores;
  }

  private generateReasoning(
    performance: AgentPerformanceMetrics,
    topArchetype: { archetype: string; score: number }
  ): string {
    const reasons = [];
    
    if (performance.consensusImprovement > 70) {
      reasons.push("High consensus improvement");
    }
    
    if (performance.beliefAccuracy > 0.7) {
      reasons.push("Strong theory-of-mind calibration");
    }
    
    if (performance.planExecutionSuccess > 0.8) {
      reasons.push("High plan execution success");
    }

    return `Agent shows ${reasons.join(", ")}, suggesting ${topArchetype.archetype} archetype (confidence: ${Math.round(topArchetype.score * 100)}%).`;
  }

  async suggestArchetypeChange(agentCardId: number, orgId: number): Promise<{
    current: string;
    suggested: string;
    reason: string;
    confidence: number;
  }> {
    const { agentCards } = await import("@shared/schema/agent-cards.js");
    const [agent] = await db
      .select()
      .from(agentCards)
      .where(eq(agentCards.id, agentCardId))
      .limit(1);

    if (!agent) {
      throw new Error("Agent not found");
    }

    const { crewPersonaService } = await import("./crew-persona.service.js");
    const currentArchetype = crewPersonaService.inferArchetype(agent);

    const suggested = await this.inferOptimalArchetype(agentCardId, orgId);

    return {
      current: currentArchetype,
      suggested: suggested.archetype,
      reason: suggested.reason,
      confidence: suggested.confidence,
    };
  }
}
```

**UI Component:**

```typescript
// New component: client/src/components/agents/AgentArchetypeSuggestion.tsx
import { useQuery } from '@tanstack/react-query';
import { Button } from '@ui/components/button';
import { Card } from '@ui/components/card';
import { Badge } from '@ui/components/badge';

export function AgentArchetypeSuggestion({ agentId, orgId }: { agentId: number; orgId: number }) {
  const { data: suggestion } = useQuery({
    queryKey: ['archetype-suggestion', agentId],
    queryFn: () => fetchArchetypeSuggestion(agentId, orgId),
    refetchInterval: 86400000, // Refresh daily
  });

  if (!suggestion || suggestion.current === suggestion.suggested) {
    return null;
  }

  return (
    <Card className="p-4 border-yellow-500">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium">Archetype Suggestion</h4>
        <Badge variant="secondary">{Math.round(suggestion.confidence * 100)}% confidence</Badge>
      </div>
      <p className="text-sm mb-3">{suggestion.reason}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Current:</span>
        <Badge variant="outline">{suggestion.current}</Badge>
        <span className="text-muted-foreground">→</span>
        <Badge variant="default">{suggestion.suggested}</Badge>
      </div>
      <Button size="sm" className="mt-3 w-full">
        Apply Suggestion
      </Button>
    </Card>
  );
}
```

**Supporting Evidence:**

1. **Performance Data:** `crew_turns`, `supervisor_notes`, `agent_belief_predictions` tables have performance data
2. **Archetype System:** Archetype system already exists with defined profiles
3. **Inference Pattern:** Platform uses inference patterns elsewhere (e.g., intent router)
4. **UI Components:** Suggestion UI patterns exist in platform

#### Success Criteria

- Auto-inferred archetypes improve agent performance by 10%
- 70% of archetype suggestions are accepted by users
- Confidence scores correlate with actual performance improvement
- Suggestion UI is used by 50% of orgs

#### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Insufficient performance data | Medium | High | Require minimum 50 contributions before inference |
| Archetype suggestions are wrong | Medium | Medium | Show confidence scores, require manual approval |
| Frequent archetype changes confuse users | Low | Medium | Limit changes to once per month per agent |
| Performance metrics are noisy | Medium | Low | Use smoothing, aggregate over time |

---

## Conclusion

This detailed analysis provides comprehensive technical specifications, supporting evidence, and implementation guidance for all CREW Room recommendations. Each recommendation is grounded in existing codebase patterns and infrastructure, ensuring feasibility and maintainability.

**Key Implementation Themes:**
1. **Proposal-based execution** - Maintain safety while enabling action
2. **Dynamic optimization** - Adapt to context and performance
3. **Cross-session learning** - Share knowledge across discussions
4. **Data-driven improvement** - Use metrics to optimize effectiveness

**Total Investment:** 20-25 weeks engineering effort across 3 phases

**Expected ROI:** 5-10x return based on efficiency gains, quality improvements, and new capabilities
