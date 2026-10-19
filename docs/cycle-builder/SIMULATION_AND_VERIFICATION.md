# Cycle Blueprint Simulation & Pre-Flight Verification Engine

## Overview

The Oddjob Cycle Blueprint Builder features a deterministic **Pre-Flight Simulation & Verification Engine** that validates operational cycle drafts before they can be staged, created, or published as revisions.

Rather than relying on static estimates or non-validating ticker animations, the engine executes comprehensive static topological analysis, port-to-port data contract typing, cross-studio availability probing, Monte Carlo cost/latency intervals, and cryptographic proof certificate generation.

---

## Architecture & Endpoints

### 1. Pre-Flight Simulation API
- **Endpoint**: `POST /api/cycle-builder/drafts/simulate`
- **Controller/Service**: [cycle-builder-drafts.ts](../../server/routes/cycle-builder-drafts.ts) -> `simulateDefinition(definition)`
- **Capabilities**:
  - **DAG Acyclicity**: Kahn's topological sort detects circular dependencies, dead ends, and unreachable branches.
  - **Port-to-Port Data Contract Verification**: Verifies that every input port on a phase has an upstream data edge, resource binding, or cycle input. Validates schema and primitive types (`string`, `number`, `boolean`, `object`, `array`).
  - **Unfulfilled Input Detection**: Flags mandatory phase inputs that lack a valid data source.
  - **Milestone & Branch Audit**: Validates approval timeout fallbacks and conditional branch reachability.
  - **Monte Carlo P50 / P95 Envelopes**: Grounded duration (hours), token counts, and USD cost bounds based on phase types, tool payloads, and blueprint models.
  - **Deterministic Proof Certificate**: Generates a SHA-256 hash certificate with timestamp, readiness score (0–100), and status (`VERIFIED` / `ACTION_REQUIRED` / `BLOCKED`).

```typescript
export interface CycleSimulation {
  feasible: boolean;
  totalDurationHours: number;
  durationHoursBounds: { p50: number; p95: number };
  totalCost: number;
  costBounds: { p50: number; p95: number };
  estimatedTokens: number;
  tokenBounds: { p50: number; p95: number };
  criticalPath: string[];
  bottlenecks: string[];
  readinessScore: number;
  proofCertificate: {
    hash: string;
    timestamp: string;
    status: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
    readinessScore: number;
  };
  contractAudit: {
    valid: boolean;
    contractMismatches: Array<{
      edgeId: string;
      sourcePhaseId: string;
      targetPhaseId: string;
      sourcePortKey: string;
      targetPortKey: string;
      sourceType: string;
      targetType: string;
    }>;
    unfulfilledInputs: Array<{
      phaseId: string;
      phaseName: string;
      portKey: string;
      expectedType: string;
    }>;
  };
}
```

---

## Multi-Studio Readiness Probing

Before a draft can advance its readiness state to `test: "passed"`, the server probes all referenced studio resources across the organization:

### 1. Workbench App Studio
- Verifies that `phase.appStep.deploymentId` references an active, published deployment in `appDeployments`.
- Confirms release references (`releaseRef`) and launch routes (`launchHref`).

### 2. Form Studio
- Verifies that `form_agent` resource bindings correspond to active, non-archived jobs in the `jobs` table with `type = 'form_agent'`.

### 3. Signal Studio & Data Pipelines
- Verifies that `pipeline_output` resource bindings correspond to active, non-archived pipelines in the `pipelines` table.

### 4. Prediction Studio
- Confirms that prediction phases declare valid target objectives and confidence thresholds (`0.0 <= threshold <= 1.0`).

### 5. Contract Integrity
- Verifies that the draft achieves `readinessScore >= 90` with zero blocking contract mismatches or unfulfilled required inputs.

---

## Immutable Studio Release Manifest

When a draft is converted into an active cycle (`POST /api/cycle-builder/drafts/:id/create-cycle`) or published as a revision (`POST /api/cycle-builder/drafts/:id/publish-revision`), an immutable **Studio Manifest** is compiled and embedded into `operationalCycles.metadata.studioManifest`:

```json
{
  "compiledAt": "2026-10-01T07:15:00.000Z",
  "readinessScore": 98,
  "proofHash": "a1b2c3d4e5f67890...",
  "participatingStudios": ["workbenchApps", "formAgents", "pipelineOutputs", "predictionTargets"],
  "workbenchApps": [
    {
      "phaseId": "phase-dispatch",
      "deploymentId": 14,
      "appId": 3,
      "releaseRef": "v2.4.0",
      "launchHref": "/apps/rescue-dispatch"
    }
  ],
  "formAgents": [
    {
      "resourceKey": "res-intake",
      "jobId": 42,
      "label": "Incident Intake Form"
    }
  ],
  "pipelineOutputs": [
    {
      "resourceKey": "res-stream",
      "pipelineId": 9,
      "label": "Telemetry Aggregator"
    }
  ],
  "predictionTargets": [
    {
      "phaseId": "phase-risk",
      "target": "escalation_probability",
      "threshold": 0.85
    }
  ]
}
```

---

## Visual Flow Canvas Stepper Debugger

The visual authoring canvas ([VisualFlowCanvas.tsx](../../client/src/modules/operations/components/VisualFlowCanvas.tsx)) includes an interactive pre-flight debugger:
- `⏮ SkipBack`: Steps backward through the topological critical path.
- `▶ Play / ⏸ Pause`: Automatically simulates execution progression with realistic node heartbeat timings.
- `⏭ SkipForward`: Manually advances to the next execution step.
- `⟲ Reset`: Returns simulation state to node zero.
- **Typed Data Edge Rendering**: Displays port-to-port connections as curved dashed cyan vectors with port key badges (`source.portKey ➔ target.portKey`).
