import { Router } from "express";
import { CYCLE_BUILDER_SCHEMA_VERSION, cycleBuilderDraftSchema } from "@shared/schema/index.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { CycleManagerService } from "@domain/mission/core/cycle-manager.service.js";
import { cycleBuilderDraftService } from "@domain/mission/core/cycle-builder-draft.service.js";
import { requireCycleWrite } from "@server/middleware/cycle-permissions.js";

const router = Router();

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid draft id");
  return id;
}

async function ownedDraft(id: number, req: any) {
  const context = await getUserOrgContext(req);
  if (!context.organizationId) return { context, draft: null };
  const draft = await cycleBuilderDraftService.findDraft(
    { organizationId: context.organizationId, userId: context.userId, isSuperAdmin: context.isSuperAdmin },
    id,
  );
  return { context, draft };
}

/**
 * Re-run readiness on the server before a draft becomes a live cycle.
 *
 * `readiness.test` lives in the stored definition, which PATCH /drafts/:id
 * writes from the client, so a stored "passed" proves nothing. The probe is
 * also the only check that the app deployments, form agents and pipelines a
 * draft names belong to this org — trusting the flag let a client skip it and
 * build a cycle around another tenant's resources.
 */
async function serverReadiness(definition: any, organizationId: number) {
  const { ready, errors } = await probeDraftReadiness(definition, organizationId);
  return ready ? null : errors;
}

function runtimeBlueprintsFor(definition: any) {
  return definition.phases.map((phase: any) => ({
    id: phase.id,
    name: phase.name,
    objective: phase.objective,
    type: phase.type,
    dependencies: definition.dependencyEdges.filter((edge: any) => edge.targetPhaseId === phase.id).map((edge: any) => ({
      blueprintName: definition.phases.find((candidate: any) => candidate.id === edge.sourcePhaseId)?.name,
      type: edge.type,
      offset: edge.offset,
    })),
    config: { ...phase.config, appStep: phase.appStep, inputs: phase.inputs, outputs: phase.outputs },
    dataFlows: definition.dataEdges.filter((edge: any) => edge.source.kind === "phase_output" && edge.target.phaseId === phase.id).map((edge: any) => ({
      sourceBlueprint: definition.phases.find((candidate: any) => candidate.id === edge.source.phaseId)?.name,
      sourceOutputKey: edge.source.portKey,
      targetInputKey: edge.target.portKey,
    })),
    pauseAtMilestone: phase.type === "milestone" ? phase.milestone.pauseForApproval : false,
  }));
}

function blueprintRowsFor(cycleId: number, definition: any) {
  return definition.phases.map((phase: any) => ({
    cycleId, name: phase.name, objective: phase.objective, type: phase.type,
    estimatedDays: Math.max(0, Math.ceil(phase.estimatedDuration.value / (phase.estimatedDuration.unit === "days" ? 1 : 24))),
    dependencies: definition.dependencyEdges.filter((edge: any) => edge.targetPhaseId === phase.id).map((edge: any) => ({
      blueprintName: definition.phases.find((candidate: any) => candidate.id === edge.sourcePhaseId)?.name,
      type: edge.type,
      offset: edge.offset,
    })),
    config: { ...phase.config, appStep: phase.appStep, inputs: phase.inputs, outputs: phase.outputs },
    metadata: {
      groupId: phase.groupId,
      outcomeEdges: definition.outcomeEdges.filter((edge: any) => edge.sourcePhaseId === phase.id),
      dataEdges: definition.dataEdges.filter((edge: any) => edge.target.phaseId === phase.id),
    },
  }));
}

function cycleValuesFor(definition: any) {
  const scheduling = definition.cycle.scheduling;
  return {
    name: definition.cycle.name,
    description: definition.cycle.description,
    objective: definition.cycle.objective,
    timezone: definition.cycle.timezone,
    priority: definition.cycle.priority,
    budgetLimitUsd: definition.cycle.budgetLimitUsd?.toFixed(2),
    tokenLimit: definition.cycle.tokenLimit,
    requiresApproval: definition.cycle.requiresApproval ? 1 : 0,
    recurrence: scheduling?.mode ?? "once",
    nextRunAt: scheduling?.nextRunAt ? new Date(scheduling.nextRunAt) : null,
  };
}

function compileStudioManifest(definition: any) {
  const workbenchApps = (definition.phases || [])
    .filter((phase: any) => phase.appStep)
    .map((phase: any) => ({
      phaseId: phase.id,
      phaseName: phase.name,
      appId: phase.appStep.appId,
      appName: phase.appStep.appName,
      deploymentId: phase.appStep.deploymentId,
      releaseRef: phase.appStep.releaseRef,
      mode: phase.appStep.mode,
      launchHref: phase.appStep.launchHref,
    }));

  const formAgents = (definition.resources || [])
    .filter((res: any) => res.type === "form_agent")
    .map((res: any) => ({
      resourceId: res.id,
      key: res.key,
      label: res.label,
      referenceId: res.binding?.referenceId,
      provider: res.binding?.provider,
    }));

  const pipelineOutputs = (definition.resources || [])
    .filter((res: any) => res.type === "pipeline_output")
    .map((res: any) => ({
      resourceId: res.id,
      key: res.key,
      label: res.label,
      referenceId: res.binding?.referenceId,
    }));

  const predictionTargets = (definition.phases || [])
    .filter((phase: any) => phase.type === "prediction")
    .map((phase: any) => ({
      phaseId: phase.id,
      phaseName: phase.name,
      target: phase.prediction?.target,
      confidenceThreshold: phase.prediction?.confidenceThreshold,
      lowConfidenceBehavior: phase.prediction?.lowConfidenceBehavior,
    }));

  return {
    compiledAt: new Date().toISOString(),
    studiosInvolved: [
      workbenchApps.length > 0 ? "app_builder" : null,
      formAgents.length > 0 ? "form_studio" : null,
      pipelineOutputs.length > 0 ? "signal_studio" : null,
      predictionTargets.length > 0 ? "prediction_studio" : null,
    ].filter(Boolean),
    workbenchApps,
    formAgents,
    pipelineOutputs,
    predictionTargets,
  };
}

function cycleMetadataFor(definition: any, existing: Record<string, any> = {}) {
  return {
    ...existing,
    source: definition.source,
    trigger: definition.cycle.trigger,
    tags: definition.cycle.tags,
    notificationPolicy: definition.cycle.notificationPolicy,
    follow_up_cycle_template_id: definition.cycle.followUpCycleTemplateId ?? null,
    timeUnit: definition.cycle.timeUnit,
    resource_answers: definition.cycle.resourceAnswers,
    scheduling: definition.cycle.scheduling,
    blueprints: runtimeBlueprintsFor(definition),
    studioManifest: compileStudioManifest(definition),
  };
}

import crypto from "crypto";

export interface ContractMismatch {
  edgeId: string;
  sourcePhase: string;
  targetPhase: string;
  sourcePort: string;
  targetPort: string;
  sourceType: string;
  targetType: string;
  issue: string;
}

export interface UnfulfilledInput {
  phaseId: string;
  phaseName: string;
  portKey: string;
  expectedType: string;
  required: boolean;
}

export interface ProofCertificate {
  status: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
  score: number;
  verifiedAt: string;
  checks: {
    dagAcyclicity: "PASSED" | "FAILED";
    dataContracts: "PASSED" | "FAILED" | "SKIPPED";
    inputFulfillment: "PASSED" | "FAILED";
    executionReadiness: "PASSED" | "WARNING" | "FAILED";
    branchIntegrity: "PASSED" | "WARNING";
    budgetCompliance: "PASSED" | "FAILED";
  };
  proofHash: string;
}

export function simulateDefinition(definition: any) {
  const durationHours = (phase: any) => {
    const multipliers: Record<string, number> = { minutes: 1 / 60, hours: 1, days: 24, weeks: 168 };
    return (phase.estimatedDuration?.value ?? 0) * (multipliers[phase.estimatedDuration?.unit] ?? 1);
  };

  const phases = definition.phases || [];
  const dependencyEdges = definition.dependencyEdges || [];
  const dataEdges = definition.dataEdges || [];
  const outcomeEdges = definition.outcomeEdges || [];
  const resources = definition.resources || [];
  const inputs = definition.inputs || [];

  const phaseMap = new Map<string, any>(phases.map((phase: any) => [phase.id, phase]));
  const resourceMap = new Map<string, any>(resources.map((resource: any) => [resource.id, resource]));
  const inputMap = new Map<string, any>(inputs.map((input: any) => [input.id, input]));

  // Topological critical path and cycle detection
  const incoming = new Map<string, string[]>(phases.map((phase: any) => [phase.id, []]));
  dependencyEdges.forEach((edge: any) => incoming.get(edge.targetPhaseId)?.push(edge.sourcePhaseId));
  const finish = new Map<string, number>();
  const unresolved = new Set(phases.map((phase: any) => phase.id));

  for (let pass = 0; pass < phases.length && unresolved.size; pass++) {
    for (const phase of phases) {
      if (!unresolved.has(phase.id)) continue;
      const dependencies = incoming.get(phase.id) ?? [];
      if (dependencies.some((id: string) => !finish.has(id))) continue;
      finish.set(phase.id, Math.max(0, ...dependencies.map((id: string) => finish.get(id) ?? 0)) + durationHours(phase));
      unresolved.delete(phase.id);
    }
  }

  // Detect orphan phases (if > 1 phase)
  const orphanPhases: string[] = [];
  if (phases.length > 1) {
    for (const phase of phases) {
      const hasDepIn = dependencyEdges.some((edge: any) => edge.targetPhaseId === phase.id);
      const hasDepOut = dependencyEdges.some((edge: any) => edge.sourcePhaseId === phase.id);
      const hasDataIn = dataEdges.some((edge: any) => edge.target?.phaseId === phase.id);
      const hasDataOut = dataEdges.some((edge: any) => edge.source?.kind === "phase_output" && edge.source?.phaseId === phase.id);
      const hasOutcomeIn = outcomeEdges.some((edge: any) => edge.targetPhaseId === phase.id);
      const hasOutcomeOut = outcomeEdges.some((edge: any) => edge.sourcePhaseId === phase.id);
      if (!hasDepIn && !hasDepOut && !hasDataIn && !hasDataOut && !hasOutcomeIn && !hasOutcomeOut) {
        orphanPhases.push(`Phase '${phase.name}' is completely disconnected (orphan) with no incoming or outgoing connections.`);
      }
    }
  }

  // ── Data Contract & Schema Verification ─────────────────────────────────
  const contractMismatches: ContractMismatch[] = [];
  let validContractsCount = 0;

  for (const edge of dataEdges) {
    const targetPhase = phaseMap.get(edge.target?.phaseId);
    if (!targetPhase) {
      contractMismatches.push({
        edgeId: edge.id,
        sourcePhase: edge.source?.phaseId || "unknown",
        targetPhase: edge.target?.phaseId || "unknown",
        sourcePort: edge.source?.portKey || "unknown",
        targetPort: edge.target?.portKey || "unknown",
        sourceType: "unknown",
        targetType: "unknown",
        issue: `Data edge '${edge.id}' targets non-existent phase '${edge.target?.phaseId}'.`,
      });
      continue;
    }

    const targetPort = targetPhase.inputs?.find((i: any) => i.key === edge.target?.portKey);
    if (!targetPort) {
      contractMismatches.push({
        edgeId: edge.id,
        sourcePhase: edge.source?.phaseId || "unknown",
        targetPhase: targetPhase.name,
        sourcePort: edge.source?.portKey || "unknown",
        targetPort: edge.target?.portKey || "unknown",
        sourceType: "unknown",
        targetType: "missing",
        issue: `Target phase '${targetPhase.name}' has no input port matching '${edge.target?.portKey}'.`,
      });
      continue;
    }

    if (edge.source?.kind === "phase_output") {
      const sourcePhase = phaseMap.get(edge.source.phaseId);
      if (!sourcePhase) {
        contractMismatches.push({
          edgeId: edge.id,
          sourcePhase: edge.source.phaseId,
          targetPhase: targetPhase.name,
          sourcePort: edge.source.portKey,
          targetPort: targetPort.key,
          sourceType: "unknown",
          targetType: targetPort.valueType,
          issue: `Data edge '${edge.id}' references missing source phase '${edge.source.phaseId}'.`,
        });
        continue;
      }
      const sourcePort = sourcePhase.outputs?.find((o: any) => o.key === edge.source.portKey);
      if (!sourcePort) {
        contractMismatches.push({
          edgeId: edge.id,
          sourcePhase: sourcePhase.name,
          targetPhase: targetPhase.name,
          sourcePort: edge.source.portKey,
          targetPort: targetPort.key,
          sourceType: "missing",
          targetType: targetPort.valueType,
          issue: `Source phase '${sourcePhase.name}' has no output port matching '${edge.source.portKey}'.`,
        });
        continue;
      }

      const srcType = sourcePort.valueType || "any";
      const tgtType = targetPort.valueType || "any";
      if (srcType !== "any" && tgtType !== "any" && srcType !== tgtType) {
        contractMismatches.push({
          edgeId: edge.id,
          sourcePhase: sourcePhase.name,
          targetPhase: targetPhase.name,
          sourcePort: sourcePort.key,
          targetPort: targetPort.key,
          sourceType: srcType,
          targetType: tgtType,
          issue: `Type contract incompatibility: '${sourcePhase.name}.${sourcePort.key}' (${srcType}) cannot be piped into '${targetPhase.name}.${targetPort.key}' (${tgtType}).`,
        });
        continue;
      }
      validContractsCount++;
    } else if (edge.source?.kind === "resource") {
      const res = resourceMap.get(edge.source.resourceId);
      if (!res) {
        contractMismatches.push({
          edgeId: edge.id,
          sourcePhase: edge.source.resourceId,
          targetPhase: targetPhase.name,
          sourcePort: edge.source.resourceId,
          targetPort: targetPort.key,
          sourceType: "unknown",
          targetType: targetPort.valueType,
          issue: `Data edge references unknown resource '${edge.source.resourceId}'.`,
        });
        continue;
      }
      validContractsCount++;
    } else if (edge.source?.kind === "cycle_input") {
      const inp = inputMap.get(edge.source.inputId);
      if (!inp) {
        contractMismatches.push({
          edgeId: edge.id,
          sourcePhase: edge.source.inputId,
          targetPhase: targetPhase.name,
          sourcePort: edge.source.inputId,
          targetPort: targetPort.key,
          sourceType: "unknown",
          targetType: targetPort.valueType,
          issue: `Data edge references unknown cycle input '${edge.source.inputId}'.`,
        });
        continue;
      }
      validContractsCount++;
    }
  }

  // ── Unfulfilled Required Inputs ─────────────────────────────────────────
  const unfulfilledInputs: UnfulfilledInput[] = [];
  for (const phase of phases) {
    for (const input of phase.inputs || []) {
      if (input.required) {
        const isFulfilled = dataEdges.some(
          (e: any) => e.target?.phaseId === phase.id && e.target?.portKey === input.key
        );
        if (!isFulfilled) {
          unfulfilledInputs.push({
            phaseId: phase.id,
            phaseName: phase.name,
            portKey: input.key,
            expectedType: input.valueType,
            required: true,
          });
        }
      }
    }
  }

  // ── Branch & Milestone Verification ─────────────────────────────────────
  const unhandledOutcomes: string[] = [];
  for (const phase of phases) {
    if (phase.type === "milestone" && phase.milestone?.pauseForApproval) {
      const phaseOutcomeEdges = outcomeEdges.filter((e: any) => e.sourcePhaseId === phase.id);
      const hasApproved = phaseOutcomeEdges.some((e: any) => e.outcome === "approved");
      const hasRejected = phaseOutcomeEdges.some((e: any) => e.outcome === "rejected");
      if (!hasApproved && !hasRejected && phase.milestone?.timeoutBehavior === "escalate") {
        // Handled via default escalation
      } else if (!hasRejected && phase.milestone?.timeoutBehavior !== "escalate") {
        unhandledOutcomes.push(`Milestone '${phase.name}' pauses for approval but lacks a rejection or escalation outcome path.`);
      }
    }
  }

  // ── Execution Readiness & Modeling ──────────────────────────────────────
  const missionCount = phases.filter((phase: any) => phase.type !== "milestone").length;
  const appCount = phases.filter((phase: any) => phase.appStep).length;

  let p50Tokens = 0;
  let p95Tokens = 0;
  for (const phase of phases) {
    if (phase.type === "milestone") continue;
    const configured = Number(phase.config?.estimatedTokens);
    if (configured > 0) {
      p50Tokens += configured;
      p95Tokens += Math.round(configured * 1.5);
      continue;
    }
    if (phase.appStep) {
      p50Tokens += 5_000;
      p95Tokens += 8_000;
      continue;
    }
    const promptTokens = Math.min(2_000, 400 + Math.round((phase.objective?.length || 0) / 3));
    const toolTokens = (phase.tools?.length || 0) * 350;
    const ioTokens = ((phase.inputs?.length || 0) + (phase.outputs?.length || 0)) * 200;
    const baseMissionTokens = 12_000 + promptTokens + toolTokens + ioTokens;
    p50Tokens += baseMissionTokens;
    p95Tokens += Math.round(baseMissionTokens * 1.6);
  }

  const estimatedTokens = p50Tokens > 0 ? p50Tokens : (phases.length ? 15_000 : 0);
  const blendedCostRate = 0.003;
  const estimatedCostUsd = Number(((estimatedTokens / 1_000) * blendedCostRate).toFixed(2));
  const p95CostUsd = Number(((p95Tokens / 1_000) * blendedCostRate).toFixed(2));

  const criticalDuration = Math.max(0, ...finish.values());

  const missingExecutors = phases.filter(
    (phase: any) => phase.type !== "milestone" && !phase.ownerAgentId && !phase.appStep && (!phase.tools || phase.tools.length === 0)
  );

  const risks: string[] = [
    ...(unresolved.size ? ["Dependency graph contains an unresolved cycle."] : []),
    ...orphanPhases,
    ...contractMismatches.map(m => m.issue),
    ...unfulfilledInputs.map(u => `Phase '${u.phaseName}' requires input '${u.portKey}' (${u.expectedType}), but no data edge or resource supplies it.`),
    ...unhandledOutcomes,
    ...missingExecutors.map((phase: any) => `${phase.name} has no execution owner, app, or tool.`),
    ...(definition.cycle.tokenLimit && estimatedTokens > definition.cycle.tokenLimit ? ["Estimated tokens exceed the Cycle token limit."] : []),
    ...(definition.cycle.budgetLimitUsd !== undefined && estimatedCostUsd > definition.cycle.budgetLimitUsd ? ["Estimated cost exceeds the Cycle budget limit."] : []),
  ];

  // ── Readiness Scoring & Proof of Flow ───────────────────────────────────
  let readinessScore = 100;
  if (unresolved.size > 0) readinessScore -= 40;
  readinessScore -= contractMismatches.length * 15;
  readinessScore -= unfulfilledInputs.length * 10;
  readinessScore -= orphanPhases.length * 10;
  readinessScore -= missingExecutors.length * 10;
  if (definition.cycle.budgetLimitUsd !== undefined && estimatedCostUsd > definition.cycle.budgetLimitUsd) {
    readinessScore -= 15;
  }
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  const status: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED" =
    unresolved.size > 0 || readinessScore < 50
      ? "BLOCKED"
      : readinessScore >= 85 && risks.length === 0
      ? "VERIFIED"
      : "ACTION_REQUIRED";

  const checks = {
    dagAcyclicity: (unresolved.size === 0 ? "PASSED" : "FAILED") as "PASSED" | "FAILED",
    dataContracts: (contractMismatches.length === 0 ? (dataEdges.length > 0 ? "PASSED" : "SKIPPED") : "FAILED") as "PASSED" | "FAILED" | "SKIPPED",
    inputFulfillment: (unfulfilledInputs.length === 0 ? "PASSED" : "FAILED") as "PASSED" | "FAILED",
    executionReadiness: (missingExecutors.length === 0 ? "PASSED" : "WARNING") as "PASSED" | "WARNING" | "FAILED",
    branchIntegrity: (unhandledOutcomes.length === 0 ? "PASSED" : "WARNING") as "PASSED" | "WARNING",
    budgetCompliance: ((definition.cycle.budgetLimitUsd === undefined || estimatedCostUsd <= definition.cycle.budgetLimitUsd) ? "PASSED" : "FAILED") as "PASSED" | "FAILED",
  };

  const hashContent = `${definition.id || "draft"}:${readinessScore}:${JSON.stringify(checks)}`;
  const proofHash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 16);

  const proofCertificate: ProofCertificate = {
    status,
    score: readinessScore,
    verifiedAt: new Date().toISOString(),
    checks,
    proofHash: `proof-${proofHash}`,
  };

  return {
    missionCount,
    appCount,
    milestoneCount: phases.length - missionCount,
    estimatedDurationHours: criticalDuration,
    estimatedTokens,
    estimatedCostUsd,
    withinTokenLimit: !definition.cycle.tokenLimit || estimatedTokens <= definition.cycle.tokenLimit,
    withinBudget: definition.cycle.budgetLimitUsd === undefined || estimatedCostUsd <= definition.cycle.budgetLimitUsd,
    risks,
    readinessScore,
    proofCertificate,
    contractAudit: {
      totalDataEdges: dataEdges.length,
      validContracts: validContractsCount,
      mismatches: contractMismatches,
      unfulfilledInputs,
    },
    costBounds: {
      p50: estimatedCostUsd,
      p95: p95CostUsd,
    },
    tokenBounds: {
      p50: p50Tokens,
      p95: p95Tokens,
    },
    durationHoursBounds: {
      p50: Number(criticalDuration.toFixed(1)),
      p95: Number((criticalDuration * 1.35).toFixed(1)),
    },
    assumptions: {
      defaultMissionTokens: 12_000,
      defaultAppTokens: 5_000,
      blendedCostPerThousandTokensUsd: blendedCostRate,
      durationsUseDependencyCriticalPath: true,
    },
  };
}

router.post("/copilot/generate", requireAuth, async (req: any, res) => {
  try {
    const context = await getUserOrgContext(req);
    if (!context.organizationId) return res.status(403).json({ error: "Organization context required" });
    const current = cycleBuilderDraftSchema.parse(req.body?.definition);
    const prompt = String(req.body?.prompt ?? "").trim();
    if (!prompt) return res.status(400).json({ error: "A generation prompt is required" });
    const generated = await systemAiService.generateJson(
      `Create a Cycle graph for this request: ${prompt}
Return an object with phases and dependencyEdges. Each phase must have id, name, objective, type (mission, prediction, or milestone), estimatedDuration {value, unit}, inputs, outputs, tools, permissions, and config. Mission phases need failurePolicy. Prediction phases need prediction {target, lowConfidenceBehavior}. Milestones need zero duration and milestone {pauseForApproval,evidenceRequired,timeoutBehavior}. Dependency edges need id, sourcePhaseId, targetPhaseId, and type. Use stable lowercase IDs. Current Cycle context: ${JSON.stringify({ cycle: current.cycle, resources: current.resources, inputs: current.inputs })}`,
      "architect",
      { temperature: 0.2 },
    );
    const fallbackPhases = [
      { id: "discover", name: "Discover inputs", objective: `Collect and validate inputs for ${prompt}.`, type: "mission", failurePolicy: "fail_cycle", estimatedDuration: { value: 2, unit: "hours" }, inputs: [], outputs: [{ key: "findings", valueType: "object", required: true }], tools: [], permissions: [], config: {} },
      { id: "execute", name: "Execute work", objective: `Produce the requested operational outcome: ${prompt}.`, type: "mission", failurePolicy: "fail_cycle", estimatedDuration: { value: 1, unit: "days" }, inputs: [{ key: "findings", valueType: "object", required: true }], outputs: [{ key: "result", valueType: "object", required: true }], tools: [], permissions: [], config: {} },
      { id: "approve", name: "Review outcome", objective: "Review evidence and approve the Cycle outcome.", type: "milestone", estimatedDuration: { value: 0, unit: "hours" }, inputs: [{ key: "result", valueType: "object", required: true }], outputs: [], tools: [], permissions: [], config: {}, milestone: { pauseForApproval: true, evidenceRequired: ["result"], timeoutBehavior: "escalate" } },
    ];
    const phases = Array.isArray(generated?.phases) && generated.phases.length ? generated.phases : fallbackPhases;
    const dependencyEdges = Array.isArray(generated?.dependencyEdges) && generated.dependencyEdges.length
      ? generated.dependencyEdges
      : phases.slice(1).map((phase: any, index: number) => ({ id: `dependency-${index + 1}`, sourcePhaseId: phases[index].id, targetPhaseId: phase.id, type: "finish_to_start" }));
    const candidate = {
      ...current,
      phases: phases.map((phase: any) => ({ ...phase, groupId: phase.groupId ?? current.groups[0]?.id })),
      dependencyEdges,
      outcomeEdges: [],
      dataEdges: [],
      readiness: { validation: "unchecked", test: "not_run" },
    };
    const parsed = cycleBuilderDraftSchema.safeParse(candidate);
    if (!parsed.success) return res.status(422).json({ error: "Copilot generated an invalid graph", issues: parsed.error.issues });
    return res.json({ definition: parsed.data, generatedBy: generated ? "configured_engine" : "deterministic_fallback" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/simulate", requireAuth, async (req: any, res) => {
  const parsed = cycleBuilderDraftSchema.safeParse(req.body?.definition);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Cycle draft", issues: parsed.error.issues });
  return res.json({ simulation: simulateDefinition(parsed.data) });
});

async function reconstructDefinition(cycle: any, context: any) {
  const rows = await cycleBuilderDraftService.listBlueprints(cycle.id);
  if (rows.length === 0) throw new Error("This Cycle has no blueprints to revise.");
  const phaseIdByName = new Map(rows.map(row => [row.name, `phase-${row.id}`]));
  const phases = rows.map(row => {
    const config = (row.config as Record<string, any>) ?? {};
    const common = {
      id: `phase-${row.id}`,
      name: row.name,
      objective: row.objective,
      groupId: "legacy",
      estimatedDuration: { value: Math.max(1, row.estimatedDays ?? 1), unit: "days" as const },
      inputs: Array.isArray(config.inputs) ? config.inputs : [],
      outputs: Array.isArray(config.outputs) ? config.outputs : [],
      tools: Array.isArray(config.tools) ? config.tools : [],
      permissions: Array.isArray(config.permissions) ? config.permissions : [],
      appStep: config.appStep,
      config,
    };
    if (row.type === "milestone") return { ...common, type: "milestone" as const, estimatedDuration: { value: 0 as const, unit: "days" as const }, milestone: { pauseForApproval: true, evidenceRequired: [], timeoutBehavior: "escalate" as const } };
    if (row.type === "prediction") return { ...common, type: "prediction" as const, prediction: { target: row.objective, lowConfidenceBehavior: "manual_review" as const } };
    return { ...common, type: "mission" as const, failurePolicy: "fail_cycle" as const };
  });
  const dependencyEdges = rows.flatMap(row => ((row.dependencies as any[]) ?? []).flatMap((dependency, index) => {
    const sourcePhaseId = phaseIdByName.get(dependency.blueprintName);
    const targetPhaseId = phaseIdByName.get(row.name);
    if (!sourcePhaseId || !targetPhaseId) return [];
    return [{
      id: `dependency-${row.id}-${index}`,
      sourcePhaseId,
      targetPhaseId,
      type: dependency.type ?? "finish_to_start",
      offset: dependency.offset,
    }];
  }));
  const metadata = (cycle.metadata as Record<string, any>) ?? {};
  return cycleBuilderDraftSchema.parse({
    schemaVersion: CYCLE_BUILDER_SCHEMA_VERSION,
    id: `legacy-edit-${cycle.id}-${Date.now()}`,
    organizationId: context.organizationId,
    ownerUserId: context.userId,
    source: { type: "edit", sourceId: String(cycle.id) },
    sourceRevision: {
      cycleId: cycle.id,
      updatedAt: cycle.updatedAt.toISOString(),
      status: cycle.status,
    },
    cycle: {
      name: cycle.name,
      description: cycle.description ?? undefined,
      objective: cycle.objective,
      timezone: cycle.timezone ?? "UTC",
      trigger: metadata.trigger ?? { type: "manual" },
      priority: cycle.priority ?? 5,
      budgetLimitUsd: cycle.budgetLimitUsd ? Number(cycle.budgetLimitUsd) : undefined,
      tokenLimit: cycle.tokenLimit ?? undefined,
      requiresApproval: Boolean(cycle.requiresApproval),
      scheduling: metadata.scheduling,
      followUpCycleTemplateId: metadata.follow_up_cycle_template_id ?? null,
      timeUnit: metadata.timeUnit ?? "d",
      resourceAnswers: metadata.resource_answers ?? {},
      tags: metadata.tags ?? [],
      notificationPolicy: metadata.notificationPolicy,
    },
    groups: [{ id: "legacy", name: "Cycle phases", orchestrationHint: "mixed", order: 0 }],
    phases,
    dependencyEdges,
    outcomeEdges: [],
    dataEdges: [],
    inputs: [],
    resources: [],
    view: { activeView: "timeline", phasePositions: {}, collapsedGroupIds: [], timelineUnit: "hours" },
    readiness: { validation: "unchecked", test: "not_run" },
  });
}

router.post("/cycles/:cycleId/edit-draft", requireAuth, requireCycleWrite, async (req: any, res) => {
  try {
    const cycleId = parseId(req.params.cycleId);
    const context = await getUserOrgContext(req);
    if (!context.organizationId) return res.status(403).json({ error: "Organization context required" });
    const cycle = await cycleBuilderDraftService.findCycle(context.organizationId, cycleId);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });

    const existing = await cycleBuilderDraftService.findEditDraft(context.organizationId, context.userId, cycleId);
    if (existing && !existing.createdCycleId) return res.json({ draft: existing, sourceCycle: cycle });

    const sourceDraft = await cycleBuilderDraftService.findDraftThatBuiltCycle(context.organizationId, cycleId);
    const parsed = sourceDraft
      ? cycleBuilderDraftSchema.parse(sourceDraft.definition)
      : await reconstructDefinition(cycle, context);
    const metadata = (cycle.metadata as Record<string, any>) ?? {};
    const scheduling = metadata.scheduling ?? {
      mode: cycle.recurrence ?? "once",
      enabled: cycle.recurrence !== "once",
      timezone: cycle.timezone ?? "UTC",
      nextRunAt: cycle.nextRunAt?.toISOString() ?? null,
      overlapPolicy: "skip",
      pauseOnFailure: true,
      catchupWindowSeconds: 86_400,
      cooldownMinutes: 1,
      maxConsecutiveRuns: 25,
    };
    const definition = {
      ...parsed,
      id: `edit-${cycleId}-${Date.now()}`,
      organizationId: context.organizationId,
      ownerUserId: context.userId,
      source: { type: "edit" as const, sourceId: String(cycleId) },
      sourceRevision: {
        cycleId,
        updatedAt: cycle.updatedAt.toISOString(),
        status: cycle.status,
      },
      cycle: {
        ...parsed.cycle,
        name: cycle.name,
        description: cycle.description ?? undefined,
        objective: cycle.objective,
        timezone: cycle.timezone ?? parsed.cycle.timezone,
        priority: cycle.priority ?? parsed.cycle.priority,
        budgetLimitUsd: cycle.budgetLimitUsd ? Number(cycle.budgetLimitUsd) : undefined,
        tokenLimit: cycle.tokenLimit ?? undefined,
        requiresApproval: Boolean(cycle.requiresApproval),
        scheduling,
        followUpCycleTemplateId: metadata.follow_up_cycle_template_id ?? null,
        timeUnit: metadata.timeUnit ?? parsed.cycle.timeUnit,
        resourceAnswers: metadata.resource_answers ?? {},
        changeReason: undefined,
      },
      readiness: { validation: "unchecked" as const, test: "not_run" as const },
    };
    const draft = await cycleBuilderDraftService.insertDraft({
      organizationId: context.organizationId,
      ownerUserId: context.userId,
      sourceType: "edit",
      sourceId: String(cycleId),
      schemaVersion: definition.schemaVersion,
      definition,
      validationState: "unchecked",
    });
    return res.status(201).json({ draft, sourceCycle: cycle });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/drafts", requireAuth, async (req: any, res) => {
  const context = await getUserOrgContext(req);
  if (!context.organizationId) return res.status(403).json({ error: "Organization context required" });
  const drafts = await cycleBuilderDraftService.listDrafts({
    organizationId: context.organizationId, userId: context.userId, isSuperAdmin: context.isSuperAdmin,
  });
  res.json({ drafts });
});

router.get("/catalog/pipeline-outputs", requireAuth, async (req: any, res) => {
  const context = await getUserOrgContext(req);
  if (!context.organizationId) return res.status(403).json({ error: "Organization context required" });
  const outputs = await cycleBuilderDraftService.listPipelineOutputs(context.organizationId);
  res.json({ outputs });
});

router.post("/drafts", requireAuth, async (req: any, res) => {
  const context = await getUserOrgContext(req);
  if (!context.organizationId) return res.status(403).json({ error: "Organization context required" });
  const parsed = cycleBuilderDraftSchema.safeParse(req.body?.definition);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Cycle draft", issues: parsed.error.issues });
  const draft = await cycleBuilderDraftService.insertDraft({
    organizationId: context.organizationId, ownerUserId: context.userId, sourceType: parsed.data.source.type,
    sourceId: parsed.data.source.sourceId, schemaVersion: parsed.data.schemaVersion, definition: parsed.data,
    validationState: parsed.data.readiness.validation,
  });
  res.status(201).json({ draft });
});

router.get("/drafts/:id", requireAuth, async (req: any, res) => {
  try { const { draft } = await ownedDraft(parseId(req.params.id), req); return draft ? res.json({ draft }) : res.status(404).json({ error: "Draft not found" }); }
  catch (error: any) { return res.status(400).json({ error: error.message }); }
});

router.patch("/drafts/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseId(req.params.id); const { draft } = await ownedDraft(id, req);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (Number(req.body?.version) !== draft.version) return res.status(409).json({ error: "Draft has changed", draft });
    const parsed = cycleBuilderDraftSchema.safeParse(req.body?.definition);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Cycle draft", issues: parsed.error.issues });
    const updated = await cycleBuilderDraftService.updateDraft(draft.organizationId, id, draft.version, {
      definition: parsed.data, schemaVersion: parsed.data.schemaVersion, validationState: parsed.data.readiness.validation,
    });
    if (!updated) return res.status(409).json({ error: "Draft has changed" });
    return res.json({ draft: updated });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});

export async function probeDraftReadiness(definition: any, organizationId: number) {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Structural validation check
  if (definition.readiness?.validation !== "valid") {
    errors.push("Structural validation must pass before readiness testing.");
  }

  // 2. Data Contract & Schema Verification probe
  const simulationResult = simulateDefinition(definition);
  if (simulationResult.proofCertificate.checks.dagAcyclicity === "FAILED") {
    errors.push("Dependency graph contains an unresolved cycle.");
  }
  for (const mismatch of simulationResult.contractAudit.mismatches) {
    errors.push(mismatch.issue);
  }
  for (const unfulfilled of simulationResult.contractAudit.unfulfilledInputs) {
    errors.push(`Phase '${unfulfilled.phaseName}' requires input '${unfulfilled.portKey}' (${unfulfilled.expectedType}), but no data edge or resource supplies it.`);
  }

  // 3, 4, 5. Participating Studio Probes (Workbench Apps, Form Studio, Signal Studio / Pipelines)
  const studioErrors = await CycleManagerService.verifyStudioResources(organizationId, definition);
  errors.push(...studioErrors);

  // 6. Prediction Studio Probes
  for (const phase of (definition.phases || [])) {
    if (phase.type === "prediction") {
      if (!phase.prediction?.target?.trim()) {
        errors.push(`${phase.name}: Prediction target objective is missing.`);
      }
      if (phase.prediction?.confidenceThreshold !== undefined &&
          (phase.prediction.confidenceThreshold < 0 || phase.prediction.confidenceThreshold > 1)) {
        errors.push(`${phase.name}: Prediction confidence threshold must be between 0.0 and 1.0.`);
      }
    }
  }

  // 7. General Mission Ownership Warnings
  for (const phase of (definition.phases || [])) {
    if (phase.type !== "milestone" && !phase.appStep && phase.tools?.length === 0 && !phase.ownerAgentId) {
      warnings.push(`${phase.name}: no app, tool, or owner agent is assigned.`);
    }
  }

  return {
    ready: errors.length === 0,
    errors,
    warnings,
    simulationResult,
  };
}

router.post("/drafts/:id/readiness", requireAuth, async (req: any, res) => {
  try {
    const id = parseId(req.params.id);
    const { context, draft } = await ownedDraft(id, req);
    if (!draft || !context.organizationId) return res.status(404).json({ error: "Draft not found" });
    if (Number(req.body?.version) !== draft.version) return res.status(409).json({ error: "Draft has changed", draft });

    const parsed = cycleBuilderDraftSchema.safeParse(req.body?.definition ?? draft.definition);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Cycle draft", issues: parsed.error.issues });

    const { ready, errors, warnings } = await probeDraftReadiness(parsed.data, context.organizationId);

    const testedDefinition = {
      ...parsed.data,
      readiness: {
        ...parsed.data.readiness,
        test: ready ? ("passed" as const) : ("failed" as const),
        lastTestedAt: new Date().toISOString(),
      },
    };
    const updated = await cycleBuilderDraftService.updateDraft(context.organizationId, id, draft.version, {
      definition: testedDefinition,
      validationState: testedDefinition.readiness.validation,
    });
    if (!updated) return res.status(409).json({ error: "Draft has changed" });

    return res.status(ready ? 200 : 422).json({
      ready,
      errors,
      warnings,
      draft: updated,
      definition: testedDefinition,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/drafts/:id", requireAuth, async (req: any, res) => {
  try { const id = parseId(req.params.id); const { draft } = await ownedDraft(id, req); if (!draft) return res.status(404).json({ error: "Draft not found" }); await cycleBuilderDraftService.deleteDraft(draft.organizationId, id); return res.status(204).end(); }
  catch (error: any) { return res.status(400).json({ error: error.message }); }
});

router.post("/drafts/:id/publish-revision", requireAuth, requireCycleWrite, async (req: any, res) => {
  try {
    const id = parseId(req.params.id);
    const { context, draft } = await ownedDraft(id, req);
    if (!draft || !context.organizationId) return res.status(404).json({ error: "Draft not found" });
    if (Number(req.body?.version) !== draft.version) return res.status(409).json({ error: "Draft has changed", draft });
    if (draft.sourceType !== "edit" || !draft.sourceId) return res.status(422).json({ error: "This is not a Cycle revision draft" });
    const definition = cycleBuilderDraftSchema.parse(draft.definition);
    if (definition.readiness.validation !== "valid" || definition.readiness.test !== "passed") {
      return res.status(422).json({ error: "Validate and pass readiness before publishing this revision" });
    }
    const readinessErrors = await serverReadiness(definition, context.organizationId);
    if (readinessErrors) {
      return res.status(422).json({ error: "Readiness no longer passes; re-run readiness before publishing", errors: readinessErrors });
    }
    const sourceCycleId = Number(draft.sourceId);
    const sourceCycle = await cycleBuilderDraftService.findCycle(context.organizationId, sourceCycleId);
    if (!sourceCycle) return res.status(404).json({ error: "Source Cycle not found" });
    if (
      definition.sourceRevision &&
      sourceCycle.updatedAt.toISOString() !== definition.sourceRevision.updatedAt
    ) {
      return res.status(409).json({
        error: "The source Cycle changed after this revision draft was opened. Reopen the Cycle in the builder to merge the latest settings.",
        code: "SOURCE_CYCLE_CHANGED",
        sourceCycle,
      });
    }
    const runtimeBlueprints = runtimeBlueprintsFor(definition);
    const cycleValues = {
      ...cycleValuesFor(definition),
      blueprintCount: runtimeBlueprints.length,
    };
    const createSuccessor = !["planning", "pending_approval"].includes(sourceCycle.status);
    if (createSuccessor) {
      const revision = await cycleBuilderDraftService.createCycle(context.organizationId, id, {
        ...cycleValues,
        status: "planning",
        createdBy: context.userId,
        metadata: {
          ...cycleMetadataFor(definition),
          cycleBuilderDraftId: id,
          revisesCycleId: sourceCycleId,
          revisionOf: sourceCycleId,
          changeReason: definition.cycle.changeReason,
        },
      }, (cycleId) => blueprintRowsFor(cycleId, definition));
      return res.json({ cycle: revision, mode: "successor" as const });
    }
    const metadata = (sourceCycle.metadata as Record<string, any>) ?? {};
    const updated = await cycleBuilderDraftService.reviseCycleInPlace(context.organizationId, id, sourceCycleId, {
      ...cycleValues,
      metadata: {
        ...cycleMetadataFor(definition, metadata),
        cycleBuilderDraftId: id,
        changeReason: definition.cycle.changeReason,
        revisedAt: new Date().toISOString(),
        revisedBy: context.userId,
      },
    }, blueprintRowsFor(sourceCycleId, definition));
    return res.json({ cycle: updated, mode: "in_place" as const });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/drafts/:id/create-cycle", requireAuth, requireCycleWrite, async (req: any, res) => {
  try {
    const id = parseId(req.params.id); const { context, draft } = await ownedDraft(id, req);
    if (!draft || !context.organizationId) return res.status(404).json({ error: "Draft not found" });
    if (req.body?.version !== undefined && Number(req.body.version) !== draft.version) {
      return res.status(409).json({ error: "Draft has changed", draft });
    }
    const definition = cycleBuilderDraftSchema.parse(draft.definition);
    if (definition.readiness.validation !== "valid") return res.status(422).json({ error: "Validate the draft before creating a Cycle" });
    if (definition.readiness.test !== "passed") return res.status(422).json({ error: "Run and pass readiness testing before creating a Cycle" });
    if (draft.createdCycleId) return res.status(409).json({ error: "A Cycle was already created from this draft", cycleId: draft.createdCycleId });
    const readinessErrors = await serverReadiness(definition, context.organizationId);
    if (readinessErrors) {
      return res.status(422).json({ error: "Readiness no longer passes; re-run readiness before creating a Cycle", errors: readinessErrors });
    }
    const runtimeBlueprints = runtimeBlueprintsFor(definition);
    const cycle = await cycleBuilderDraftService.createCycle(context.organizationId, id, {
      ...cycleValuesFor(definition),
      status: "planning", createdBy: context.userId,
      blueprintCount: runtimeBlueprints.length,
      metadata: { ...cycleMetadataFor(definition), cycleBuilderDraftId: id },
    }, (cycleId) => blueprintRowsFor(cycleId, definition));
    return res.status(201).json({ cycle });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});

export default router;
