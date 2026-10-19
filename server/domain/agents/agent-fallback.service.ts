/**
 * Agent Fallbacks — deterministic limp mode, codified at synthesis time.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * Deterministic fallbacks already existed in this codebase, but as per-agent
 * hardcode inside the public chat route: `if (deployment.slug ===
 * "rescue-dispatcher")`, `if (deployment.slug === "service-bot")`. Two problems
 * with that shape:
 *
 *   1. It does not generalize. Every new agent starts with zero fallbacks and
 *      hangs under an AI outage until somebody hand-writes another branch.
 *   2. Its failure direction is inverted. When the deterministic branch threw,
 *      it fell *through* to the LLM agent loop — escalating into the thing that
 *      was already broken, turning a fast error into a multi-minute hang.
 *
 * So this service makes a fallback a property of *being an agent*: derived
 * automatically from what the agent already declares, stored on the deployment,
 * and consulted before the model on every degraded turn.
 *
 * ─── What gets derived ──────────────────────────────────────────────────────
 * Nothing here guesses, and nothing here is authored by hand. Routes come from
 * declarations the agent already carries:
 *
 *   formManifest       -> serve_form    (render a form the agent already owns)
 *   allowedPipelineIds -> run_pipeline  (the nonce already names the pipeline)
 *   allowedTools       -> invoke_tool   (read-safe, zero-required-arg tools only)
 *   always             -> static_reply  (terminal, honest)
 *
 * The invoke_tool constraint is the important safety property: with no model in
 * the loop there is nothing to decide *which* arguments a call should carry, so
 * only tools that need no arguments and mutate nothing are eligible. A degraded
 * agent can tell you what it knows; it cannot be tricked into acting.
 */
import { db } from "@server/database_service.js";
import { agentDeployments } from "@shared/schema/index.js";
import type {
    AgentDeployment,
    AgentFallbackManifest,
    FallbackRoute,
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentFallbackService");

const MANIFEST_VERSION = 1 as const;

/**
 * Tool-name prefixes that read rather than write. Used only as a secondary
 * gate — a tool must ALSO take no required arguments to become a route.
 */
const READ_PREFIXES = ["list_", "get_", "search_", "read_", "find_", "check_", "describe_", "discover_"];

export interface FallbackResolution {
    /** The response body to send, already shaped like a normal agent turn. */
    response: string;
    route: FallbackRoute;
    /** True when the response is a rendered input_request rather than prose. */
    isForm: boolean;
}

export interface DerivationInput {
    slug: string;
    title: string;
    formManifest: Record<string, { pipelineName: string; fields: any[] }> | null;
    allowedPipelineIds: number[] | null;
    allowedTools: string[] | null;
}

/** Turn a pipeline/form name into keyword triggers for offline matching. */
function keywordsFor(name: string): string[] {
    const stop = new Set(["the", "a", "an", "and", "or", "for", "of", "to", "with", "pipeline", "process"]);
    return Array.from(
        new Set(
            name
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(w => w.length > 2 && !stop.has(w)),
        ),
    ).slice(0, 8);
}

/**
 * A zod schema is "argument-free" when every field is optional, so the tool can
 * be invoked with `{}` and still be valid. Non-object schemas are rejected —
 * we cannot know what a bare scalar means without a model to decide.
 */
function takesNoRequiredArgs(schema: unknown): boolean {
    if (!(schema instanceof z.ZodObject)) return false;
    try {
        const shape = (schema as z.ZodObject<any>).shape;
        return Object.values(shape).every((field: any) => typeof field?.isOptional === "function" && field.isOptional());
    } catch {
        return false;
    }
}

export const agentFallbackService = {
    /**
     * Build the manifest from an agent's declarations. Pure — no I/O — so the
     * derivation rules can be unit-tested without a database or tool registry.
     */
    buildManifest(input: DerivationInput, toolRegistry: Record<string, any> = {}): AgentFallbackManifest {
        const routes: FallbackRoute[] = [];

        // 1. Form submissions. Highest priority: the client already told us
        //    which pipeline to run via the nonce, so there is nothing to infer.
        //    One route covers every pipeline the agent is allowed to run.
        if ((input.allowedPipelineIds?.length ?? 0) > 0 || Object.keys(input.formManifest ?? {}).length > 0) {
            routes.push({
                kind: "run_pipeline",
                id: "submission",
                match: { onFormSubmission: true },
                source: "derived",
            });
        }

        // 2. Forms the agent already owns, keyed by the words in their names.
        for (const [formId, entry] of Object.entries(input.formManifest ?? {})) {
            if (!entry?.fields?.length) continue;
            routes.push({
                kind: "serve_form",
                id: `form:${formId}`,
                match: { keywords: keywordsFor(entry.pipelineName || formId) },
                formId,
                source: "derived",
            });
        }

        // 3. Read-safe, argument-free tools.
        for (const toolName of input.allowedTools ?? []) {
            const def = toolRegistry[toolName];
            if (!def) continue;

            const explicitlyReadSafe = def.idempotency === "read-safe";
            const looksReadOnly = READ_PREFIXES.some(p => toolName.startsWith(p));
            const lowRisk = def.riskLevel !== "high";
            const noApproval = !def.approvalPolicy?.requiresApproval;

            if (!(explicitlyReadSafe || looksReadOnly) || !lowRisk || !noApproval) continue;
            if (!takesNoRequiredArgs(def.parameters)) continue;

            routes.push({
                kind: "invoke_tool",
                id: `tool:${toolName}`,
                match: { keywords: keywordsFor(def.label || toolName) },
                tool: toolName,
                params: {},
                source: "derived",
            });
        }

        // 4. Terminal. Always last, always present — an agent is never left with
        //    nothing to say, which is the whole point of limp mode.
        routes.push({
            kind: "static_reply",
            id: "terminal",
            match: { always: true },
            message:
                `AI assist for ${input.title} is temporarily offline, so I can't answer free-form questions right now. ` +
                `Structured actions are still working — submitting a form or running a saved workflow will go through normally.`,
            source: "derived",
        });

        return {
            version: MANIFEST_VERSION,
            generatedAt: new Date().toISOString(),
            degradedNotice: "Answered without AI assist — the model backend is currently unavailable.",
            routes,
        };
    },

    /**
     * Derive and persist the manifest for a deployment. Called on every deploy
     * so the manifest tracks the agent's current permissions rather than drifting.
     */
    async derive(deploymentId: number): Promise<AgentFallbackManifest> {
        const [deployment] = await db
            .select()
            .from(agentDeployments)
            .where(eq(agentDeployments.id, deploymentId))
            .limit(1);
        if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

        let toolRegistry: Record<string, any> = {};
        try {
            const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
            toolRegistry = getAgentTools();
        } catch (err: any) {
            // A missing registry costs us invoke_tool routes but must not block
            // the far more important form/pipeline routes.
            logger.warn(`Tool registry unavailable while deriving fallbacks for ${deploymentId}: ${err.message}`);
        }

        const manifest = this.buildManifest(
            {
                slug: deployment.slug,
                title: deployment.title,
                formManifest: (deployment.formManifest as any) ?? {},
                allowedPipelineIds: deployment.allowedPipelineIds ?? [],
                allowedTools: deployment.allowedTools ?? [],
            },
            toolRegistry,
        );

        await db
            .update(agentDeployments)
            .set({ fallbackManifest: manifest, updatedAt: new Date() })
            .where(eq(agentDeployments.id, deploymentId));

        logger.info(`Derived ${manifest.routes.length} fallback routes for deployment ${deploymentId} (${deployment.slug})`);
        return manifest;
    },

    /** Pick the first route whose match predicate accepts this turn. */
    selectRoute(
        manifest: AgentFallbackManifest | null | undefined,
        message: string,
        opts: { isFormSubmission: boolean },
    ): FallbackRoute | null {
        const routes = manifest?.routes;
        if (!routes?.length) return null;

        const lower = (message || "").toLowerCase();

        // Form submissions bind to their dedicated route and never fall to
        // keyword matching — the nonce is authoritative.
        if (opts.isFormSubmission) {
            return routes.find(r => r.match.onFormSubmission) ?? routes.find(r => r.match.always) ?? null;
        }

        const keyworded = routes.filter(r => !r.match.onFormSubmission && r.match.keywords?.length);
        let best: { route: FallbackRoute; hits: number } | null = null;
        for (const route of keyworded) {
            const hits = route.match.keywords!.filter(k => lower.includes(k)).length;
            if (hits > 0 && (!best || hits > best.hits)) best = { route, hits };
        }
        if (best) return best.route;

        return routes.find(r => r.match.always) ?? null;
    },

    /**
     * Execute a route. No model call on any path.
     *
     * Returns null only when there is genuinely nothing to serve, which lets the
     * caller decide between an error and a live-model attempt.
     */
    async resolve(
        deployment: AgentDeployment,
        message: string,
        ctx: {
            sessionId: string | number;
            userId: string;
            organizationId: number;
            isFormSubmission: boolean;
            pipelineExecution?: { nonce?: string; inputData?: Record<string, any> };
        },
    ): Promise<FallbackResolution | null> {
        const manifest = deployment.fallbackManifest as AgentFallbackManifest | null;
        const route = this.selectRoute(manifest, message, { isFormSubmission: ctx.isFormSubmission });
        if (!route) return null;

        try {
            switch (route.kind) {
                case "serve_form":
                    return await this._serveForm(deployment, route, ctx);
                case "run_pipeline":
                    return await this._runPipeline(deployment, route, ctx);
                case "invoke_tool":
                    return await this._invokeTool(deployment, route, ctx);
                case "static_reply":
                default:
                    return {
                        response: route.message || "AI assist is temporarily offline.",
                        route,
                        isForm: false,
                    };
            }
        } catch (err: any) {
            // A failed fallback degrades to the terminal reply. It must never
            // re-enter the model path — that inversion is the bug this service
            // exists to remove.
            logger.warn(`Fallback route ${route.id} failed for ${deployment.slug}: ${err.message}`);
            const terminal = manifest?.routes.find(r => r.match.always);
            return {
                response:
                    terminal?.message ||
                    "AI assist is temporarily offline and this action could not be completed. Please retry shortly.",
                route: terminal ?? route,
                isForm: false,
            };
        }
    },

    async _serveForm(
        deployment: AgentDeployment,
        route: FallbackRoute,
        ctx: { sessionId: string | number },
    ): Promise<FallbackResolution> {
        const formManifest = (deployment.formManifest as any) ?? {};
        const entry = formManifest[route.formId!];
        if (!entry) throw new Error(`Form ${route.formId} is no longer in the manifest`);

        const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
        const nonce = await agentNonceService.generate(String(ctx.sessionId), route.formId!, entry.pipelineName);

        return {
            response: JSON.stringify({
                type: "input_request",
                nonce,
                pipelineName: entry.pipelineName,
                fields: entry.fields,
            }),
            route,
            isForm: true,
        };
    },

    async _runPipeline(
        deployment: AgentDeployment,
        route: FallbackRoute,
        ctx: {
            sessionId: string | number;
            userId: string;
            pipelineExecution?: { nonce?: string; inputData?: Record<string, any> };
        },
    ): Promise<FallbackResolution> {
        const nonce = ctx.pipelineExecution?.nonce;
        const inputData = ctx.pipelineExecution?.inputData ?? {};
        if (!nonce) throw new Error("Form submission carried no nonce");

        const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
        const resolved = await agentNonceService.resolve(String(ctx.sessionId), nonce);
        if (!resolved) throw new Error("Submission token expired or already used");

        // Form-agent and deterministic triage ids are not DB-backed pipelines, so
        // there is nothing this path can execute for them.
        //
        // It previously answered "Received — your submission was recorded", which
        // was not true: limp mode reached here precisely BECAUSE the handler that
        // does the recording had failed, so nothing was persisted. A cheerful
        // acknowledgement over a failed write is the same fake-success this whole
        // service exists to replace — the user walks away believing a rescue was
        // dispatched. Report the captured details and the failure honestly, and
        // make clear the request still needs to be placed.
        if (typeof resolved === "string" && (resolved.startsWith("job_") || resolved.includes(":"))) {
            return {
                response:
                    `I captured your details, but I could not complete this request — the service that ` +
                    `processes it is temporarily unavailable, so **nothing has been submitted yet**. ` +
                    `Please retry shortly, or pass these details on directly:\n\n` +
                    "```json\n" + JSON.stringify(inputData, null, 2) + "\n```",
                route,
                isForm: false,
            };
        }

        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const res = await pipelineExecutor.executePipeline(
            resolved as number,
            ctx.userId || "system-agent",
            null,
            null,
            inputData,
        );

        if (!res?.success || !res.executionId) {
            throw new Error(res?.error || "Pipeline execution did not start");
        }

        return {
            response: `Your request was submitted and is running now (execution ${res.executionId}). You'll see it update as it progresses.`,
            route,
            isForm: false,
        };
    },

    async _invokeTool(
        deployment: AgentDeployment,
        route: FallbackRoute,
        ctx: { userId: string; organizationId: number; sessionId: string | number },
    ): Promise<FallbackResolution> {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()[route.tool!];
        if (!def) throw new Error(`Tool ${route.tool} is no longer registered`);

        const output = await def.execute(route.params ?? {}, {
            named: {},
            positional: {},
            userId: ctx.userId,
            organizationId: ctx.organizationId,
            sessionId: ctx.sessionId,
            jobId: deployment.jobId,
            allowedTopicIds: deployment.allowedTopicIds,
            allowedDatasetIds: deployment.allowedDatasetIds,
            allowedPipelineIds: deployment.allowedPipelineIds,
        } as any);

        const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
        return { response: text, route, isForm: false };
    },
};
