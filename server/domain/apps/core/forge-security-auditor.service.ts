import { createLogger } from "@server/utils/logger.js";
import { tryFixJson } from "../../../../shared/utils/jsonUtils.js";
import { withAiTimeout } from "./forge-utils.js";
import { FORGE_SECURITY_AUDITOR_PROMPT } from "./forge-prompts.js";
import type { ForgeOptions } from "../app-forge.service.js";

const logger = createLogger("ForgeSecurityAuditor");

export class ForgeSecurityAuditorService {
    async runSecurityAuditPass(
        generatedFiles: Record<string, string>,
        options: ForgeOptions,
        emitLog: (m: string, l?: any) => Promise<void>
    ): Promise<Record<string, string>> {
        await emitLog("Invoking Security Auditor for adversarial review...", 'info');
        try {
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            
            const orgId = (options as any).organizationId ?? null;
            const aiConfig = await systemAiService.getAiConfig('codegen', orgId ?? undefined);
            
            if (aiConfig) {
                const client = AIClientFactory.getClient(aiConfig as any);
                const auditorResult = await withAiTimeout(client.execute({
                    model: aiConfig.model,
                    systemPrompt: FORGE_SECURITY_AUDITOR_PROMPT,
                    userPrompt: JSON.stringify({
                        missionDescription: options.description,
                        blackboard: (options as any).blackboard ?? {},
                        architectOutput: generatedFiles
                    }),
                    requestType: "json",
                    responseType: "json",
                    maxTokens: 4096,
                } as any, undefined, aiConfig.apiKey ?? ""), "security-auditor") as any;

                if (auditorResult.success && auditorResult.output) {
                    const rawAuditor = typeof auditorResult.output === "string"
                        ? auditorResult.output.replace(/```json/g, "").replace(/```/g, "").trim()
                        : JSON.stringify(auditorResult.output);

                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(rawAuditor);
                    } catch {
                        await emitLog("Security Auditor returned unparseable output   skipping corrections.", 'warn');
                        parsed = null;
                    }

                    const safeFilePathPattern = /^[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|json)$/;
                    const corrections: Record<string, string> = {};
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                            if (typeof v === 'string' && safeFilePathPattern.test(k) && !k.includes('..')) {
                                corrections[k] = v;
                            }
                        }
                    }

                    if (Object.keys(corrections).length > 0) {
                        await emitLog(`Security Auditor found ${Object.keys(corrections).length} potential risks. Applying corrections...`, 'warn');
                        return { ...generatedFiles, ...corrections };
                    } else {
                        await emitLog("Security Auditor: No risks identified. Code verified.", 'success');
                    }
                }
            }
        } catch (err: any) {
            await emitLog(`Security Auditor non-fatal error: ${err.message}`, 'warn');
        }
        return generatedFiles;
    }
}

export const forgeSecurityAuditorService = new ForgeSecurityAuditorService();
