import { createLogger } from "@server/utils/logger.js";
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";
import { ToolContext } from "../../tools/v1/capabilities/types.js";
import { tryFixJson } from "../../../../shared/utils/jsonUtils.js";
import type { AIClient } from "@domain/ai/core/ai-client.service.js";
import type { AiConfig } from "@domain/ai/core/ai-config-resolver.js";
import type { ForgeOptions } from "../app-forge.service.js";
import type { BuildTask } from "./forge-plan.service.js";
import { UI_ARCHITECT_PROMPT } from "./forge-design-specialists.js";
import { withAiTimeout, sleep } from "./forge-utils.js";

const logger = createLogger("ForgeTaskRunner");

export class ForgeTaskRunnerService {
    async executeSingleTask(
        task: BuildTask,
        taskOptions: {
            options: ForgeOptions;
            requiredFeatures: string;
            uiPalette: any;
            visionDirectives: string;
            blueprintSlug?: string;
        },
        aiCtx: {
            client: AIClient;
            resolvedAiConfig: AiConfig;
            tools: any[];
            allTools: any[];
            stitchInstructions: string;
            cachedContentName: string | undefined;
            maxTaskTurns: number;
        },
        state: {
            generatedFiles: Record<string, string>;
            completedTaskIds: Set<string>;
            emitLog: (m: string, l?: any) => Promise<void>;
            traceContext?: TraceContext;
        }
    ): Promise<{
        success: boolean;
        taskFiles?: Record<string, string>;
        stitchProjectId?: string;
    }> {
        const { options, requiredFeatures, uiPalette, visionDirectives, blueprintSlug } = taskOptions;
        const { client, resolvedAiConfig, tools, allTools, stitchInstructions, cachedContentName, maxTaskTurns } = aiCtx;
        const { generatedFiles, completedTaskIds, emitLog, traceContext } = state;
        
        const allFilesAccelerated = task.files.every(f => generatedFiles[f]);
        if (allFilesAccelerated && task.files.length > 0) {
            await emitLog(`[Task ${task.id}] Skipping   all target files already fulfilled by Slot-Fill.`, 'success');
            return { success: true, taskFiles: {}, stitchProjectId: undefined };
        }

        await emitLog(`[Task ${task.id}] Parallel Drafting: ${task.title}...`, 'info');

        const POLYGLOT_PROMPT_OVERRIDES: Record<string, string> = {
            'go-backend': `You are a senior Go (Golang) backend engineer. You are generating code for a Go/Gin REST API service.
- ONLY generate Go source files (.go), go.mod, and Dockerfile. Do NOT generate any .ts, .tsx, .js, .css, or Next.js files.
- File output MUST be a JSON object mapping file paths (e.g. "main.go", "handlers/users.go") to their full Go source content.
- Use proper Go package declarations, idiomatic error handling, and structured logging.
- For API endpoints: use github.com/gin-gonic/gin. For database: use standard sql or sqlx. Keep dependencies in go.mod.
- Do NOT use React, Next.js, TailwindCSS, or any frontend tooling.`,
            'python-backend': `You are a senior Python backend engineer. You are generating code for a Python/FastAPI REST API service.
- ONLY generate Python source files (.py), requirements.txt, and Dockerfile. Do NOT generate any .ts, .tsx, .js, .css, or Next.js files.
- File output MUST be a JSON object mapping file paths (e.g. "main.py", "routers/users.py") to their full Python source content.
- Use FastAPI with Pydantic v2 models, async/await patterns, and dependency injection.
- For database: use SQLAlchemy (async) or Tortoise ORM. List all deps in requirements.txt.
- Do NOT use React, Next.js, TailwindCSS, or any frontend tooling.`,
            'java-backend': `You are a senior Java backend engineer. You are generating code for a Java/Spring Boot REST API service.
- ONLY generate Java source files (.java), pom.xml, and Dockerfile. Do NOT generate any .ts, .tsx, .js, .css, or Next.js files.
- File output MUST be a JSON object mapping file paths (e.g. "src/main/java/com/app/Application.java") to their full Java source content.
- Use Spring Boot 3.x, Spring Data JPA, and Spring Security where applicable.
- Follow standard Maven project layout. Add all new dependencies to pom.xml.
- Do NOT use React, Next.js, TailwindCSS, or any frontend tooling.`,
        };
        const polyglotOverride = blueprintSlug ? POLYGLOT_PROMPT_OVERRIDES[blueprintSlug] : undefined;
        const effectiveSystemPrompt = polyglotOverride ?? (UI_ARCHITECT_PROMPT + stitchInstructions);

        const taskContext = {
            currentTask: task,
            completedTasks: Array.from(completedTaskIds),
            existingFiles: Object.keys(generatedFiles),
            globalRequirements: options.description,
            featureSpec: requiredFeatures,
            uiPalette: polyglotOverride ? undefined : uiPalette,
            visionDirectives: polyglotOverride ? undefined : visionDirectives,
            blueprintSlug,
        };

        let messages: any[] = [{ 
            role: "user", 
            content: `You are now executing Task ID: ${task.id} (${task.title}).
DESCRIPTION: ${task.description}
TARGET FILES: ${task.files.join(", ")}
BLUEPRINT: ${blueprintSlug || 'spa'}

CONTEXT:
${JSON.stringify(taskContext, null, 2)}

INSTRUCTIONS:
1. Deliver the code for the target files as a single JSON object.
2. If you need to use Stitch tools, do so first and then provide the final code.
3. Only generate files relevant to THIS task.
4. For web UI files, assemble the interface from the injected Oddjob Component Gallery. Prefer @domain-ui/packaged/* blocks and @/components/ui/* primitives; never substitute raw unstyled controls for available gallery components.
` 
        }];
        
        let turns = 0;
        let taskOutputRaw = "";
        let stitchProjectId: string | undefined = undefined;

        while (turns < maxTaskTurns) {
            turns++;
            const result = await executeWithBackoff(client, resolvedAiConfig, {
                model: resolvedAiConfig.model,
                systemPrompt: effectiveSystemPrompt,
                messages,
                tools: polyglotOverride ? undefined : (tools.length > 0 ? tools : undefined),
                maxTokens: 8192,
                cachedContentName: polyglotOverride ? undefined : cachedContentName,
                multiTokenPrediction: polyglotOverride ? undefined : { preferred: true },
            }, {}, 5, emitLog);

            if (!result.success || (!result.output && !result.metadata?.toolCalls)) {
                break;
            }

            if (result.metadata?.toolCalls) {
                const modelParts: any[] = [];
                if (result.output) modelParts.push({ text: result.output });
                result.metadata.toolCalls.forEach((tc: any) => modelParts.push({ functionCall: tc }));
                messages.push({ role: "model", content: modelParts });

                for (const tc of result.metadata.toolCalls) {
                    const targetTool = allTools.find(t => t.name === tc.name);
                    if (targetTool) {
                        try {
                            const toolResult = await targetTool.execute(tc.args || {}, {
                                named: {}, positional: {}, organizationId: options.organizationId, missionId: options.oddjobMissionId, ...traceContext
                            } as ToolContext);
                            
                            if (tc.name === 'stitch_create_project' && toolResult) {
                                const data = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                                stitchProjectId = data.projectId || data.id || stitchProjectId;
                            }

                            messages.push({
                                role: "tool",
                                content: [{ functionResponse: { name: tc.name, response: typeof toolResult === 'string' ? { content: toolResult } : toolResult } }]
                            });
                        } catch (e: any) {
                            messages.push({
                                role: "tool",
                                content: [{ functionResponse: { name: tc.name, response: { error: e.message } } }]
                            });
                        }
                    }
                }
            } else {
                taskOutputRaw = result.output?.trim() || "";
                break;
            }
        }

        const tryParseTaskOutput = (raw: string): Record<string, string> | null => {
            const trimmed = raw.trim();
            let jsonStr: string | null = null;
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) jsonStr = trimmed;
            else if (trimmed.startsWith('```')) {
                const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (match) jsonStr = match[1].trim();
            } else {
                const objMatch = trimmed.match(/(\{[\s\S]*\})/);
                if (objMatch) jsonStr = objMatch[1];
            }
            if (!jsonStr) return null;
            const fixed = tryFixJson(jsonStr);
            if (!fixed) return null;
            try { return JSON.parse(fixed.fixed); } catch { return null; }
        };

        if (taskOutputRaw) {
            const parsed = tryParseTaskOutput(taskOutputRaw);
            if (parsed) return { success: true, taskFiles: parsed, stitchProjectId };

            await emitLog(`[Task ${task.id}] Response not valid JSON, requesting correction...`, 'warn');
            messages.push({ role: "model", content: taskOutputRaw });
            messages.push({
                role: "user",
                content: "Your previous response was not valid JSON. Return ONLY a JSON object mapping filename to file content, with no prose, markdown, or code fences."
            });

            try {
                const retryResult = await executeWithBackoff(client, resolvedAiConfig, {
                    model: resolvedAiConfig.model,
                    systemPrompt: effectiveSystemPrompt,
                    messages,
                    maxTokens: resolvedAiConfig.maxTokens ?? 8192,
                    cachedContentName: polyglotOverride ? undefined : cachedContentName
                }, {}, 2, emitLog);

                if (retryResult.success && retryResult.output) {
                    const retryParsed = tryParseTaskOutput(retryResult.output.trim());
                    if (retryParsed) {
                        await emitLog(`[Task ${task.id}] Correction retry succeeded.`, 'success');
                        return { success: true, taskFiles: retryParsed, stitchProjectId };
                    }
                }
            } catch (retryErr: any) {
                await emitLog(`[Task ${task.id}] Correction retry failed: ${retryErr.message}`, 'warn');
            }
        }
        return { success: false, stitchProjectId };
    }
}

export async function executeWithBackoff(
    client: AIClient,
    config: AiConfig,
    prompt: Record<string, unknown>,
    options: any = {},
    maxRetries = 5,
    emitLog?: (m: string, l?: any) => Promise<void>
): Promise<any> {
    let attempt = 0;
    const safeEmitLog = async (msg: string, level: any = 'info') => {
        if (emitLog) await emitLog(msg, level);
        else logger.info(msg);
    };
    while (attempt <= maxRetries) {
        try {
            const result = await withAiTimeout(client.execute(prompt as any, undefined, config.apiKey ?? "") as Promise<any>, `backoff-attempt-${attempt}`);
            const errStr = JSON.stringify(result.error || "").toLowerCase();
            if (!result.success && (errStr.includes("429") || errStr.includes("resource_exhausted") || errStr.includes("too many requests"))) {
                throw new Error("429");
            }
            if (!result.success && (errStr.includes("492") || errStr.includes("too large") || errStr.includes("context_length_exceeded"))) {
                throw new Error("492");
            }
            return result;
        } catch (err: any) {
            if (err.message?.startsWith("AI_QUOTA_BUSY:") && attempt < maxRetries) {
                const wait = err.message.split(":")[1];
                await safeEmitLog(`AI Architect is currently overloaded (Queue Full). Waiting ${wait}s for slot...`, 'warn');
                await sleep(15000);
                attempt++;
            } else if (err.message === "429" && attempt < maxRetries) {
                try {
                    const { AiQuotaManager } = await import("@domain/ai/core/ai-client.service.js");
                    await AiQuotaManager.reportFailure();
                } catch (e) {}

                const delay = Math.pow(2, attempt) * 10000 + (Math.random() * 2000);
                logger.warn(`[AIBackoff] 429 Detected. Retrying in ${Math.round(delay/1000)}s... (Attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                attempt++;
            } else if (err.message === "492") {
                logger.error(`[AIBackoff] 492/Size Limit Error. Bubbling up for re-chunking.`);
                throw err;
            } else {
                throw err;
            }
        }
    }
}

export const forgeTaskRunnerService = new ForgeTaskRunnerService();
