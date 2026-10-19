import { XRayGraph, OperationalGuide } from "./spec-compiler.js";
import { CopilotContextFilter } from "./copilot-context-filter.service.js";

export type ExecutionPhase = "observe" | "diagnose" | "improve" | "validate" | "approve" | "deploy" | "verify";

export interface CompilationContext {
    phase: ExecutionPhase;
    targetNodeId?: string;
    targetFilePath?: string;
    userId?: string;
}

export interface PhaseCompiledOutput {
    phase: ExecutionPhase;
    fingerprint: string;
    tokenWeightEst: number;
    prompt: string;
}

/**
 * Phase-Aware Prompt Compiler:
 * Filters spatial context (2-hop graph slice) and instructional context down to only what is
 * actionable for the current execution phase, achieving token efficiency (~150-350 tokens).
 */
export function compilePhasePrompt(
    graph: XRayGraph,
    guide: OperationalGuide,
    context: CompilationContext
): PhaseCompiledOutput {
    const { phase, targetNodeId, targetFilePath } = context;

    // 1. Slice Graph to ONLY 2-Hops around the Target Node if supplied
    const rawNodes = Array.isArray(graph.nodes)
        ? graph.nodes
        : Object.values(graph.nodes || {});
    
    const formattedNodes = rawNodes.map(n => ({
        id: String(n.id),
        label: n.label,
        type: n.type,
        filePath: n.filePath
    }));

    const formattedEdges = (graph.edges || []).map(e => ({
        source: String(e.source),
        target: String(e.target),
        relation: e.relation
    }));

    const localSubgraph = targetNodeId
        ? CopilotContextFilter.extractBoundedSubgraph(targetNodeId, formattedNodes, formattedEdges, 2)
        : { nodes: formattedNodes.slice(0, 5), edges: formattedEdges.slice(0, 5) };

    const scopedNodeLabels = localSubgraph.nodes.map(n => n.label);
    const criticalGaps = (guide.readinessGaps || [])
        .filter(g => g.severity === "high" || g.severity === "critical")
        .map(g => `${g.gap}: ${g.finding}`);

    // 2. Build Phase-Specific Instructions & Exclude Unrelated Rules
    let phaseInstructions = "";

    switch (phase) {
        case "observe":
        case "diagnose":
            phaseInstructions = `CURRENT PHASE: [DIAGNOSE]
- Objective: Identify root cause for performance regression or failure.
- Active Scope: Focused on node [${targetNodeId || "Root Target"}] and 2-hop dependencies.
- Rules: Do NOT edit production code yet. Formulate a root-cause hypothesis first.`;
            break;

        case "improve":
            phaseInstructions = `CURRENT PHASE: [IMPROVE]
- Objective: Generate candidate code fix or prompt adjustment.
- Active Scope File: ${targetFilePath || "Target Module"}
- Rules: Keep edits strictly within AST boundaries. Do NOT attempt production deployment.`;
            break;

        case "validate":
            phaseInstructions = `CURRENT PHASE: [VALIDATE]
- Objective: Execute shadow test pipeline and verify benchmark thresholds.
- Rules: Verify baseline benchmark metrics (>80% ROI/Pass). Zero hallucinated evidence.`;
            break;

        case "approve":
            phaseInstructions = `CURRENT PHASE: [APPROVE]
- Objective: Collect human supervisor sign-off.
- Required Roles: operations-supervisor, application-owner
- Rules: Do NOT ask plain-text questions. Emit a FormAgent / InstantApp attestation payload.`;
            break;

        case "deploy":
            phaseInstructions = `CURRENT PHASE: [DEPLOY]
- Objective: Execute controlled deployment pipeline with supervisor attestation.
- Rules: Verify deployment event payload and rollback boundary conditions.`;
            break;

        case "verify":
            phaseInstructions = `CURRENT PHASE: [VERIFY]
- Objective: Post-deployment telemetry audit window.
- Rules: Monitor zero-regression metrics for 15 minutes post-deploy.`;
            break;
    }

    // Bound scoped node labels and critical gaps to preserve strict 150t–350t token budget
    let boundedNodeLabels = scopedNodeLabels;
    let boundedCriticalGaps = criticalGaps;

    if (boundedNodeLabels.length > 8) {
        boundedNodeLabels = [...boundedNodeLabels.slice(0, 8), `+${boundedNodeLabels.length - 8} more`];
    }
    if (boundedCriticalGaps.length > 3) {
        boundedCriticalGaps = [...boundedCriticalGaps.slice(0, 3), `+${boundedCriticalGaps.length - 3} lower severity gaps`];
    }

    let compiledText = `=== SYSTEM ARCHITECTURE CONTROL PLANE ===
Phase: ${phase.toUpperCase()} | Fingerprint: ${graph.fingerprint || "local"} | Readiness: ${guide.readinessScore}/100

${phaseInstructions}

LOCAL GRAPH BOUNDARY (2-Hop Max):
- Nodes in Scope (${scopedNodeLabels.length}): ${boundedNodeLabels.join(", ") || "None"}
- Critical Readiness Gaps: ${boundedCriticalGaps.join("; ") || "None detected"}`.trim();

    let tokenWeightEst = Math.ceil(compiledText.length / 4);

    // If still exceeding 350 tokens, aggressively prune peripheral gaps
    if (tokenWeightEst > 350) {
        compiledText = `=== SYSTEM ARCHITECTURE CONTROL PLANE ===
Phase: ${phase.toUpperCase()} | Fingerprint: ${graph.fingerprint || "local"} | Readiness: ${guide.readinessScore}/100

${phaseInstructions}

LOCAL GRAPH BOUNDARY (Pruned to Budget):
- Target Node: ${targetNodeId || targetFilePath || "Primary Module"}
- Nodes in Scope: ${boundedNodeLabels.slice(0, 4).join(", ")}
- Critical Readiness Gaps: ${boundedCriticalGaps.slice(0, 1).join("; ") || "None"}`.trim();
        tokenWeightEst = Math.ceil(compiledText.length / 4);
    }

    return {
        phase,
        fingerprint: graph.fingerprint || "local",
        tokenWeightEst,
        prompt: compiledText
    };
}
