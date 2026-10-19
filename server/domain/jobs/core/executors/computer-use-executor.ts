import type { Job, Pipeline } from "@shared/schema/index.js";
import { orgSettings } from "@shared/schema/index.js";
import type { VariableContext } from "@server/core/variable-resolver.js";
import type { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import type { JobExecutor } from "./index.js";
import type { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { db } from "@server/database_service.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { trycuaService } from "@domain/integrations/trycua/trycua-service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { saveJobOutput } from "./executor-utils.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("ComputerUseExecutor");

// ============================================================================
// ComputerUse config shape (stored in job.config jsonb)
// ============================================================================

export interface ComputerUseConfig {
    goal: string;
    os?: "linux" | "windows" | "macos";
    sandboxName?: string;
    maxActions?: number;
    maxIterations?: number;
    credentialId?: number;
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    sessionTimeoutMs?: number;
    skillId?: string; // Maps to a ComputerUseSkill template
}

const COMPUTER_USE_TRYCUA_TOOLS = [
    "trycua_screenshot",
    "trycua_observe",       // Vision-powered observation (OCR + element detection)
    "trycua_find_element",  // Accessibility/vision target grounding
    "trycua_click",
    "trycua_type_text",
    "trycua_key_press",
    "trycua_scroll",
    "trycua_wait",
    "trycua_navigate",      // Browser navigation
    "trycua_window",        // Window management
    "trycua_file_upload",   // File operations
    "trycua_end_session",
];

const DEFAULT_SYSTEM_PROMPT = (os: string, sessionId: string) => `\
You are a computer-use agent with access to a sandboxed ${os} desktop environment.

Your active session ID is: ${sessionId}
Use this sessionId in every trycua_* tool call.

## Workflow
1. Call trycua_observe to capture screenshot, accessibility-tree data when available, visible text, controls, and warnings.
2. If you need to click by label, call trycua_find_element before clicking; prefer grounded coordinates with accessibility or vision confidence.
3. Choose the appropriate action (click, type_text, key_press, scroll, wait, navigation, or window action).
4. Execute the action.
5. Call trycua_observe again to verify the result and inspect the visual diff.
6. Repeat until the goal is complete.
7. Call trycua_end_session when done.

## Rules
- Always observe before and after actions.
- Prefer accessibility-tree or visual grounding over guessing coordinates.
- If you're uncertain, observe and re-analyze before acting.
- Do not type sensitive text unless the job explicitly authorizes it and governance permits it.
- Do not exceed the action budget.
- Call trycua_end_session when the task is complete or you cannot proceed.
`;

export class ComputerUseExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "computer_use";
    }

    async execute(
        job: Job,
        resolvedConfig: ComputerUseConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext; executionId?: number },
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig;
        const organizationId = job.organizationId!;
        const userId = context.data?.userId || "system";
        const os = config.os ?? "windows";
        const maxIterations = config.maxIterations ?? 20;

        if (!config.goal) {
            return {
                success: false,
                output: "computer_use job requires a 'goal' in config",
                status: "failed",
            };
        }

        // ── Check org trycua enablement ───────────────────────────────────────
        const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, organizationId)).limit(1);
        if (!settings?.trycuaEnabled) {
            return {
                success: false,
                output: "Trycua is not enabled for this organization. Enable it in Admin → Settings → Integrations.",
                status: "failed",
            };
        }

        // ── Resolve AI credential ─────────────────────────────────────────────
        let apiKey: string | undefined;
        let aiMetadata: Record<string, unknown>;

        if (config.credentialId) {
            const cred = await credentialsService.getForExecution(config.credentialId, organizationId);
            if (!cred) {
                return { success: false, output: `Credential ${config.credentialId} not found`, status: "failed" };
            }
            apiKey = (await resolveCredentialSecret(cred));
            aiMetadata = (cred.metadata || {}) as Record<string, unknown>;
        } else {
            const aiConfig = await systemAiService.getAiConfig("copilot", organizationId);
            if (!aiConfig?.apiKey) {
                return { success: false, output: "No AI credential configured", status: "failed" };
            }
            apiKey = aiConfig.apiKey;
            aiMetadata = { provider: aiConfig.provider, model: aiConfig.model, baseUrl: aiConfig.baseUrl };
        }

        if (!apiKey) {
            return { success: false, output: "AI API key not found", status: "failed" };
        }

        const aiClient = AIClientFactory.getClient(aiMetadata as any);

        // ── Create trycua session ─────────────────────────────────────────────
        let sessionId: string | undefined;
        try {
            const session = await trycuaService.createSession({
                organizationId,
                userId,
                requestedOs: os,
                sandboxName: config.sandboxName,
                jobId: job.id ?? undefined,
            });
            sessionId = session.id;
            logger.info("[ComputerUse] Trycua session created", { jobId: job.id, sessionId, os });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Failed to create trycua session: ${msg}`, status: "failed" };
        }

        // ── Run agent loop ────────────────────────────────────────────────────
        let agentResult: Record<string, unknown> = {};
        try {
            const { runAgentLoop } = await import("@domain/agents/agent-runner.js");

            let basePrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT(os, sessionId);
            if (config.skillId) {
                try {
                    const { getSkill, buildSkillSystemPrompt } = await import("@domain/integrations/trycua/computer-use-skills.js");
                    const skill = getSkill(config.skillId);
                    if (skill) {
                        basePrompt = buildSkillSystemPrompt(skill, config.goal, os);
                        logger.info("[ComputerUse] Using skill template", { skillId: config.skillId, skill: skill.name });
                    }
                } catch { /* fallback to default */ }
            }
            const systemPrompt = [
                basePrompt,
                `\n## Task\n${config.goal}`,
            ].join("\n");

            const allowedTools = [
                ...COMPUTER_USE_TRYCUA_TOOLS,
                ...(config.allowedTools ?? []),
            ];

            const aiApiConfig = {
                model: config.model ?? (aiMetadata.model as string) ?? "gemini-2.0-flash",
                systemPrompt,
                maxTokens: 8192,
                temperature: 0.2,
            } as any;

            const initialContext = {
                organizationId,
                userId,
                jobId: job.id,
                sessionId,
                // Inject trycua session into extra so tools can reference it
                extra: { trycuaSessionId: sessionId, trycuaOs: os },
            };

            const loopResult = await runAgentLoop(
                aiClient,
                aiApiConfig,
                config.goal,
                allowedTools,
                maxIterations,
                apiKey!,
                initialContext,
                context.traceContext,
                false,
            ) as any;

            agentResult = {
                success: loopResult.success ?? false,
                summary: loopResult.summary ?? loopResult.output,
                iterations: loopResult.iterations ?? 0,
                sessionId,
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("[ComputerUse] Agent loop failed", { jobId: job.id, sessionId, err });
            agentResult = { success: false, error: msg, sessionId };
        } finally {
            // ── Always terminate session ──────────────────────────────────────
            if (sessionId) {
                try {
                    await trycuaService.endSession(sessionId, organizationId, userId);
                    logger.info("[ComputerUse] Session terminated", { jobId: job.id, sessionId });
                } catch (err: unknown) {
                    logger.warn("[ComputerUse] Session termination failed (non-fatal)", { sessionId, err });
                }
            }
        }

        const success = Boolean(agentResult.success);
        const output = agentResult.summary ?? agentResult.error ?? "Computer use task complete";

        await saveJobOutput(job, config as any, { sessionId, ...agentResult }).catch(() => {});

        return {
            success,
            output: typeof output === "string" ? output : JSON.stringify(output),
            status: success ? "success" : "failed",
            telemetry: {
                sessionId,
                os,
                iterations: agentResult.iterations,
            },
        };
    }
}
