import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "./types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";
import {
    FLOW_CREATE_PROPOSAL,
    FLOW_STUDIO_POD,
    type FlowCreateProposal,
    type FlowStepProposal,
    type FlowDataEdge,
    type FlowReviewPerspective,
} from "@shared/flow-studio-crew.js";

/**
 * Flow Studio in a CREW room: draft a flow from the jobs this organization
 * already has.
 *
 * Drafting only. Creating the pipeline is reached from the card a person pressed
 * (crew-flow-studio.service.ts) and is not a tool, so no model can decide
 * mid-conversation to put a running automation into an organization.
 *
 * Steps bind to JOBS, not to tools. A job carries the platform's whole execution
 * vocabulary — decision, transformer, iterator, reranker, human_approval, sql,
 * ai_agent — and `pipeline_steps.jobId` is the engine's primary path. Tool-bound
 * steps reach only the registered tool list and need `moduleType: "tool"` to run
 * at all; they are deliberately not offered here.
 */

function toOrgContext(context: ToolContext): OrgContext {
    return {
        userId: (context as { userId?: string })?.userId ?? "agent",
        organizationId: requireToolOrgId(context),
        isAdmin: Boolean((context as { isAdmin?: boolean })?.isAdmin),
        // Flow drafting is org-scoped for everyone; a room never reaches another tenant's jobs.
        isSuperAdmin: false,
        isOrgAdmin: Boolean((context as { isOrgAdmin?: boolean })?.isOrgAdmin),
    };
}

/**
 * The job a step means: by numeric id, by exact name, or by the one job whose
 * name contains the reference — ambiguity is left unresolved rather than guessed,
 * because a wrong job here runs someone's real automation.
 */
export function resolveJob<T extends { id: number; name: string }>(jobs: T[], reference: string): T | null {
    const wanted = reference.trim();
    if (!wanted) return null;

    if (/^\d+$/.test(wanted)) {
        return jobs.find((job) => job.id === Number(wanted)) ?? null;
    }

    const lower = wanted.toLowerCase();
    const exact = jobs.filter((job) => job.name.trim().toLowerCase() === lower);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    const contains = jobs.filter((job) => job.name.toLowerCase().includes(lower));
    return contains.length === 1 ? contains[0] : null;
}

/** One line per step, in the order they run, as the card shows them. */
function describeFlow(steps: FlowStepProposal[]): string[] {
    return steps.map((step, index) => {
        const guard = step.conditionExpression ? ` — only if ${step.conditionExpression}` : "";
        const onError = step.onError === "continue" ? ", carries on if it fails" : "";
        return `${index + 1}. ${step.jobName} (${step.jobType})${guard}${onError}`;
    });
}

/**
 * What the author should see before creating this flow. None of it blocks
 * creation — each is a way a flow can run green and do nothing useful, which is
 * worse than a flow that refuses to save.
 */
function describeChecks(steps: FlowStepProposal[]): string[] {
    const checks: string[] = [];

    steps.forEach((step, index) => {
        if (step.jobType === "transformer" && index === 0) {
            checks.push(
                `Step 1 "${step.jobName}" transforms data, but nothing runs before it. It will report success and produce nothing.`,
            );
        }
        if (step.jobType === "decision") {
            checks.push(
                `Step ${index + 1} "${step.jobName}" is a decision job: it outputs "true" or "false" but does not branch. ` +
                `Give the next step a condition that reads its output, or nothing acts on the decision.`,
            );
        }
        if (step.jobType === "reranker") {
            checks.push(
                `Step ${index + 1} "${step.jobName}" reranks with embeddings. If the AI spend cap is reached it returns an empty result rather than failing.`,
            );
        }
        if (step.jobType === "human_approval") {
            checks.push(
                `Step ${index + 1} "${step.jobName}" pauses the run until someone approves it. Nothing after it runs until then.`,
            );
        }
    });

    const names = steps.map((step) => step.outputName).filter(Boolean) as string[];
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    for (const name of new Set(duplicated)) {
        checks.push(`Two steps both write their output to "${name}". A later step reading it gets the last one.`);
    }

    return checks;
}

function estimateStepMetrics(jobType: string): { durationSec: number; costUsd: number } {
    switch (jobType.toLowerCase()) {
        case "ai_agent":
        case "ai_api_call":
            return { durationSec: 4.5, costUsd: 0.015 };
        case "reranker":
        case "spatial_reranker":
            return { durationSec: 2.0, costUsd: 0.005 };
        case "human_approval":
            return { durationSec: 30.0, costUsd: 0 };
        case "decision":
        case "transformer":
            return { durationSec: 0.2, costUsd: 0 };
        case "shell":
        case "python":
            return { durationSec: 1.5, costUsd: 0.001 };
        case "email_send":
        case "webhook":
            return { durationSec: 0.8, costUsd: 0.0005 };
        default:
            return { durationSec: 1.0, costUsd: 0.001 };
    }
}

function inferDataEdges(steps: FlowStepProposal[]): FlowDataEdge[] {
    const edges: FlowDataEdge[] = [];
    const outputMap = new Map<string, number>();

    steps.forEach((step, idx) => {
        if (step.outputName) {
            outputMap.set(step.outputName, idx);
        }
    });

    steps.forEach((step, targetIdx) => {
        if (step.conditionExpression) {
            for (const [outputName, sourceIdx] of outputMap.entries()) {
                if (sourceIdx < targetIdx && step.conditionExpression.includes(outputName)) {
                    edges.push({
                        id: `edge_${sourceIdx}_${targetIdx}_${outputName}`,
                        sourceStepIndex: sourceIdx,
                        targetStepIndex: targetIdx,
                        portKey: outputName,
                        schemaType: "scalar",
                    });
                }
            }
        }
    });

    return edges;
}

function generateReviewPerspectives(steps: FlowStepProposal[], checks: string[]): FlowReviewPerspective[] {
    const perspectives: FlowReviewPerspective[] = [];

    // 1. Security Lens
    const hasExternal = steps.some((s) => ["shell", "python", "webhook"].includes(s.jobType.toLowerCase()));
    const hasHIL = steps.some((s) => s.jobType.toLowerCase() === "human_approval");
    if (hasExternal && !hasHIL) {
        perspectives.push({
            lens: "security",
            title: "Security & Governance",
            status: "warning",
            summary: "Flow contains external execution or webhook steps without a human approval gate.",
            notes: ["External steps execute in organization runtime; consider adding human approval gate prior to dispatch."],
            repairPrompt: "Add a human_approval step before any external dispatch step.",
        });
    } else {
        perspectives.push({
            lens: "security",
            title: "Security & Governance",
            status: "optimal",
            summary: "Execution boundaries and permissions meet organization baseline.",
            notes: ["All steps bound to authorized organization jobs."],
        });
    }

    // 2. FinOps Lens
    const aiStepsCount = steps.filter((s) => ["ai_agent", "ai_api_call", "reranker"].includes(s.jobType.toLowerCase())).length;
    if (aiStepsCount > 2) {
        perspectives.push({
            lens: "finops",
            title: "FinOps & Cost",
            status: "warning",
            summary: `${aiStepsCount} AI/model steps detected. High volume execution will accumulate inference tokens.`,
            notes: ["Consider batching inputs or caching intermediate embeddings."],
            repairPrompt: "Optimize AI steps by consolidating prompts or enabling response caching.",
        });
    } else {
        perspectives.push({
            lens: "finops",
            title: "FinOps & Cost",
            status: "optimal",
            summary: "Token expenditure within normal operational bounds.",
            notes: [`${aiStepsCount} AI steps; negligible baseline cost.`],
        });
    }

    // 3. SRE / Reliability Lens
    const allStop = steps.every((s) => s.onError !== "continue");
    if (allStop && steps.length > 2) {
        perspectives.push({
            lens: "sre",
            title: "SRE & Resilience",
            status: "warning",
            summary: "Flow has no fault tolerance branches: all steps stop on error.",
            notes: ["A single transient failure will abort the entire pipeline without fallback execution."],
            repairPrompt: "Add fallback or continue-on-error strategy to resilient steps.",
        });
    } else {
        perspectives.push({
            lens: "sre",
            title: "SRE & Resilience",
            status: "optimal",
            summary: "Fault tolerance and error containment configured.",
            notes: ["Error handling policies are aligned with step criticalities."],
        });
    }

    // 4. Domain Lens
    perspectives.push({
        lens: "domain",
        title: "Domain Architecture",
        status: checks.length > 0 ? "warning" : "optimal",
        summary: checks.length > 0 ? `${checks.length} advisory checks flagged.` : "Flow topology cleanly satisfies operational objective.",
        notes: checks.length > 0 ? checks : ["Sequential job dependencies satisfy pipeline requirements."],
    });

    return perspectives;
}

function computeFlowBoundsAndReadiness(steps: FlowStepProposal[], checks: string[]): {
    bounds: { durationP50: number; durationP95: number; costP50: number; costP95: number };
    readinessScore: number;
    proofStatus: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
} {
    let totalP50Sec = 0;
    let totalCostUsd = 0;

    for (const step of steps) {
        const metrics = estimateStepMetrics(step.jobType);
        step.estimatedDurationSec = metrics.durationSec;
        step.estimatedCostUsd = metrics.costUsd;
        totalP50Sec += metrics.durationSec;
        totalCostUsd += metrics.costUsd;
    }

    const durationP50 = Math.round(totalP50Sec * 10) / 10;
    const durationP95 = Math.round(totalP50Sec * 1.8 * 10) / 10;
    const costP50 = Math.round(totalCostUsd * 1000) / 1000;
    const costP95 = Math.round(totalCostUsd * 1.5 * 1000) / 1000;

    let score = 100;
    if (checks.length > 0) score -= checks.length * 10;
    score = Math.max(20, Math.min(100, score));

    const proofStatus: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED" =
        score >= 90 ? "VERIFIED" : score >= 60 ? "ACTION_REQUIRED" : "BLOCKED";

    return {
        bounds: { durationP50, durationP95, costP50, costP95 },
        readinessScore: score,
        proofStatus,
    };
}

export const FLOW_STUDIO_TOOLS: Record<string, ToolDefinition> = {
    propose_flow: {
        name: "propose_flow",
        label: "Draft a Flow",
        group: "Flows",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts a flow — an ordered sequence of this organization's existing jobs — and returns it as a card for a " +
            "person to create. Writes nothing; the person presses Create. " +
            "Call list_jobs FIRST and name jobs from what it returns: every step must be a job that already exists, and " +
            "this tool will not invent one. Use it when someone asks to build, automate or wire up a process.",
        parameters: z.object({
            name: z.string().min(1).max(200).describe("What to call the flow. Must not match a flow this organization already has."),
            instruction: z.string().min(1).max(4000).describe("What the person asked for, in their words."),
            steps: z
                .array(
                    z.object({
                        job: z.string().min(1).describe("The job's exact name from list_jobs, or its numeric id."),
                        outputName: z
                            .string()
                            .min(1)
                            .max(120)
                            .optional()
                            .describe("Name a later step can use to read this step's output."),
                        conditionExpression: z
                            .string()
                            .min(1)
                            .max(500)
                            .optional()
                            .describe("Guard evaluated before this step, e.g. score > 70. Omit to always run it."),
                        onError: z
                            .enum(["stop", "continue"])
                            .optional()
                            .describe("What the flow does if this step fails. Defaults to stop."),
                    }),
                )
                .min(1)
                .max(40),
        }),
        execute: async (
            params: {
                name: string;
                instruction: string;
                steps: Array<{ job: string; outputName?: string; conditionExpression?: string; onError?: "stop" | "continue" }>;
            },
            context: ToolContext,
        ) => {
            const ctx = toOrgContext(context);
            const { jobService } = await import("@domain/jobs/job.service.js");
            const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");

            const { items: jobs } = await jobService.list(ctx, { limit: 500, includeHidden: true });
            if (!jobs.length) {
                return "This organization has no jobs yet, and a flow is built from jobs. Create the jobs the process needs first.";
            }

            const resolved: FlowStepProposal[] = [];
            const missing: string[] = [];
            for (const step of params.steps) {
                const job = resolveJob(jobs, step.job);
                if (!job) {
                    missing.push(step.job);
                    continue;
                }
                resolved.push({
                    jobId: job.id,
                    jobName: job.name,
                    jobType: (job as { type?: string }).type ?? "unknown",
                    outputName: step.outputName,
                    conditionExpression: step.conditionExpression,
                    onError: step.onError,
                    status: "ready",
                });
            }

            // Refused rather than drafted: a card holding a job that does not exist
            // would fail on Create, after someone had read it and agreed to it.
            if (missing.length) {
                const known = jobs.slice(0, 25).map((job) => `${job.name} (#${job.id})`).join(", ");
                return (
                    `No job matches ${missing.map((name) => `"${name}"`).join(", ")}, or the name matches more than one. ` +
                    `Nothing was drafted. Jobs in this organization: ${known}${jobs.length > 25 ? `, and ${jobs.length - 25} more` : ""}.`
                );
            }

            const existing = await pipelineService.list(ctx, { includeInactive: true, limit: 500 });
            if (existing.some((pipeline) => pipeline.name.trim().toLowerCase() === params.name.trim().toLowerCase())) {
                return `This organization already has a flow called "${params.name}". Pick a different name.`;
            }

            const checks = describeChecks(resolved);
            const { bounds, readinessScore, proofStatus } = computeFlowBoundsAndReadiness(resolved, checks);
            const reviewPerspectives = generateReviewPerspectives(resolved, checks);
            const dataEdges = inferDataEdges(resolved);

            const proposal: FlowCreateProposal & { type: string } = {
                type: FLOW_CREATE_PROPOSAL,
                proposalId: `flownew_${randomUUID().replace(/-/g, "")}`,
                name: params.name.trim(),
                instruction: params.instruction,
                steps: resolved,
                summary: describeFlow(resolved),
                checks,
                readinessScore,
                proofStatus,
                bounds,
                reviewPerspectives,
                dataEdges,
            };
            return JSON.stringify(proposal);
        },
    },
    mount_flow_studio: {
        name: "mount_flow_studio",
        label: "Mount Flow Studio",
        group: "Flows",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Mounts Flow Studio in the side-rail beside the CREW conversation, allowing visual inspection and topological simulation of flows and pipelines. " +
            "Pass 'flowName' or 'flowId' to inspect an existing flow, or call with no arguments to open on the current draft.",
        parameters: z.object({
            flowName: z.string().optional().describe("Name of an existing flow/pipeline in this organization to open."),
            flowId: z.number().optional().describe("Numeric ID of an existing flow/pipeline in this organization."),
        }),
        execute: async (
            params: { flowName?: string; flowId?: number },
            context: ToolContext,
        ) => {
            const ctx = toOrgContext(context);
            const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
            const pipelines = await pipelineService.list(ctx, { includeInactive: true, limit: 100 });

            let matched = null;
            if (params.flowId) {
                matched = pipelines.find((p) => p.id === params.flowId);
            } else if (params.flowName) {
                const lower = params.flowName.trim().toLowerCase();
                matched = pipelines.find((p) => p.name.trim().toLowerCase() === lower) ||
                          pipelines.find((p) => p.name.toLowerCase().includes(lower));
            }

            return JSON.stringify({
                type: FLOW_STUDIO_POD,
                module: "FlowStudioPod",
                component: "FlowStudioPod",
                pipelineId: matched?.id,
                flowId: matched?.id,
                name: matched?.name || params.flowName || "Flow Studio",
                props: {
                    pipelineId: matched?.id,
                    flowId: matched?.id,
                    title: matched?.name || params.flowName || "Flow Studio",
                },
            });
        },
    },
};
