# CREW Flow Studio & Co-Creation Engine

## Overview

Oddjob's CREW rooms allow human operators and collaborative AI agents to co-design, simulate, and refine multi-step automation flows. 

Rather than confining workflow authoring to text prompts or static text tables, CREW Flow Studio couples conversational deliberation with an **interactive topological DAG canvas**, **deterministic pre-flight verification**, **multi-agent review lenses**, and a **step-through simulation debugger**.

---

## Architectural Components

```
┌──────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ CREW Chat Stream                     │ Flow Studio Rail (ModularAssemblyPuzzleRail)                │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ • TurnRow & Agent Chat               │ • FlowStudioPod (Canvas / List Switcher)                    │
│ • FlowCreateProposalCard             │ • Pre-Flight Readiness HUD (0-100 Score, Proof Badge)       │
│   - Verified status badge            │ • Step-Through Debugger (⏮ Step, ▶ Play, ⏭ Forward, ⟲ Reset) │
│   - P50/P95 runtime & cost bounds    │ • Inbound/Outbound Mock Payload Inspector                   │
│   - Multi-agent review lenses        │ • Contextual Transformation Chips (+ Fallback, + Gate)      │
│   - "Inspect Canvas" action button   │ • Multi-Agent Persona Lenses (Security, FinOps, SRE)        │
│   - Anchored "Create flow" trigger   │ • "Promote to Cycle Blueprint" Bridge                       │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

### 1. In-Chat Proposal Card ([FlowCreateProposalCard.tsx](../../client/src/components/agent-chat/FlowCreateProposalCard.tsx))
When an agent or supervisor executes `propose_flow`, the card renders directly in the room with:
- **Flow Metadata**: Name, natural language objective, and ordered step list.
- **Pre-Flight Status Badge**: Displays `VERIFIED (N%)` or `ACTION REQUIRED` computed from DAG acyclicity and contract checks.
- **Monte Carlo Estimates**: Displays P50/P95 runtime duration and cost expectations (`P50: ~14s / $0.02`).
- **CREW Persona Reviews**: Displays badges for **Security**, **FinOps**, **SRE**, and **Domain**. Clicking any badge opens the agent's audit findings.
- **Inspect Canvas Action**: Launches the flow directly in the right rail ([FlowStudioPod.tsx](../../client/src/modules/flows/FlowStudioPod.tsx)) with one click.
- **Create Flow Confirmation**: Sends an exact anchored confirmation message (`Create flow "flownew_...".`), preventing drift between what was reviewed and what is persisted.

### 2. Interactive Flow Studio Pod ([FlowStudioPod.tsx](../../client/src/modules/flows/FlowStudioPod.tsx))
Mounted in the studio side-rail ([CrewRightRailPortal.tsx](../../client/src/components/agent-chat/CrewRightRailPortal.tsx)), providing:
- **Canvas vs. List View Toggle**: Displays either a visual DAG graph with port connections and job icons or a detailed sequential list.
- **Pre-Flight Readiness HUD**: Shows the real-time readiness score (0–100), audit checklist drawer, and Monte Carlo intervals.
- **Interactive Simulation Debugger**:
  - `⏮ Step Back`, `▶ Play / Pause`, `⏭ Step Forward`, `⟲ Reset`.
  - While stepping, an inspector drawer renders mock input data, evaluates condition expressions (`if (score > 70) ➔ TRUE`), and validates downstream data port exports (`$outputName`).
- **Contextual Transformation Chips**: Selecting a step displays one-click quick actions:
  - `+ Fallback`: Prompts the room to add an error handling or retry policy.
  - `🛡️ Approval Gate`: Prompts the room to insert a human-in-the-loop review step.
  - `⚡ Add Guard`: Prompts the room to add a condition expression.
  - `Discuss in Chat`: Bridges context back into the conversation composer.
- **Multi-Agent Review Lenses**:
  - 🛡️ **Security**: Checks for unvetted external scripts or missing authentication.
  - 💰 **FinOps**: Flags unbatched LLM calls or high inference token steps.
  - ⏱️ **SRE / Resilience**: Analyzes single points of failure and missing retry policies.
  - 🎯 **Domain**: Validates organizational business logic.
  - Each lens provides a 1-click *"Apply Suggested Fix"* action chip.
- **Bridge to Operational Cycles**: A *"Promote to Cycle"* button converts the flow into an Operational Cycle Blueprint ([CycleBlueprintBuilder.tsx](../../client/src/modules/operations/pages/CycleBlueprintBuilder.tsx)).

---

## Tool Contracts & Data Structures

### `shared/flow-studio-crew.ts`
Defines the canonical types shared between server-side drafting, room turn history, and frontend components:

```typescript
export interface FlowStepProposal {
  jobId: number;
  jobName: string;
  jobType: string;
  outputName?: string;
  conditionExpression?: string;
  onError?: "stop" | "continue";
  status?: "ready" | "needs_scaffolding";
  scaffoldStudio?: "form" | "prediction" | "app" | "media" | "signal" | "hil" | "job";
  estimatedDurationSec?: number;
  estimatedCostUsd?: number;
}

export interface FlowCreateProposal {
  proposalId: string;
  name: string;
  instruction: string;
  steps: FlowStepProposal[];
  summary: string[];
  checks: string[];
  readinessScore?: number;
  proofStatus?: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
  bounds?: {
    durationP50: number;
    durationP95: number;
    costP50: number;
    costP95: number;
  };
  reviewPerspectives?: FlowReviewPerspective[];
  dataEdges?: FlowDataEdge[];
}
```

### `server/domain/tools/v1/capabilities/flow-studio-tools.ts`
The `propose_flow` tool automatically:
1. Resolves steps against the organization's existing registered jobs.
2. Infers data edges connecting step output ports (`$outputName`) to downstream condition expressions.
3. Generates multi-agent review perspectives (Security, FinOps, SRE, Domain).
4. Computes P50/P95 durations and costs.
5. Calculates the deterministic readiness score and proof status.
