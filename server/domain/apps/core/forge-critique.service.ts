import { createLogger } from "@server/utils/logger.js";
import { tryFixJson } from "../../../../shared/utils/jsonUtils.js";
import type { AIClient } from "@domain/ai/core/ai-client.service.js";
import type { AiConfig } from "@domain/ai/core/ai-config-resolver.js";
import type { ForgeOptions } from "../app-forge.service.js";
import { UI_DESIGNER_PROMPT, UI_CRITIQUE_PROMPT } from "./forge-design-specialists.js";
import { forgeSpecialistService } from "./forge-specialist.service.js";
import { executeWithBackoff } from "./forge-task-runner.service.js";

const logger = createLogger("ForgeCritique");

export class ForgeCritiqueService {
    async runDesignAndCritiquePasses(
        generatedFiles: Record<string, string>,
        options: ForgeOptions,
        resolvedAiConfig: AiConfig,
        client: AIClient,
        stitchInstructions: string,
        requiredFeatures: string,
        emitLog: (m: string, l?: any) => Promise<void>
    ): Promise<{ generatedFiles: Record<string, string>; lastCritiqueScore: number }> {
        const designStyleCtx = (options as any).designStyleContext || "";
        let lastCritiqueScore = 100;

        await emitLog("Running parallel Designer and Critique passes...", 'info');

        const [designerResult, critiqueResultSettled] = await Promise.allSettled([
            forgeSpecialistService.runDesignerPass(
                generatedFiles,
                options.description,
                designStyleCtx,
                stitchInstructions,
                options.organizationId,
                emitLog
            ),
            (async () => {
                const critiqueFileManifest = Object.entries(generatedFiles).map(([name, content]) => ({
                    file: name,
                    lines: (content as string).split("\n").length,
                    preview: (content as string).slice(0, 400),
                }));

                return executeWithBackoff(client, resolvedAiConfig, {
                    model: resolvedAiConfig.model,
                    systemPrompt: UI_CRITIQUE_PROMPT,
                    messages: [{
                        role: "user",
                        content: JSON.stringify({
                            originalRequirements: options.description,
                            requiredFeatures,
                            generatedFiles: critiqueFileManifest,
                        })
                    }],
                    requestType: "json",
                    responseType: "json",
                    maxTokens: 4096,
                }, {}, 5, emitLog);
            })()
        ]);

        if (designerResult.status === 'fulfilled') {
            generatedFiles = designerResult.value;
            await emitLog("Designer phase complete. Premium visual layer applied.", 'success');
        } else {
            await emitLog(`Designer pass failed (non-fatal): ${designerResult.reason?.message}`, 'warn');
        }

        if (critiqueResultSettled.status === 'fulfilled') {
            const critiqueResult = critiqueResultSettled.value;
            await emitLog("Quality Critique: Scoring aesthetic and functional completeness...", 'info');

            if (critiqueResult.success && critiqueResult.output) {
                const critiqueRaw = critiqueResult.output.replace(/```json/g, "").replace(/```/g, "").trim();
                try {
                    const fixResult = tryFixJson(critiqueRaw);
                    const critique = JSON.parse(fixResult ? fixResult.fixed : critiqueRaw);
                    const score = typeof critique.aestheticScore === 'number' ? critique.aestheticScore : 100;
                    lastCritiqueScore = score;
                    await emitLog(`Quality score: ${score}/100. Defects: ${(critique.defects || []).length}`, score >= 80 ? 'success' : 'warn');

                    if (score < 80 && critique.refinementDirectives) {
                        await emitLog("Score below 80   running targeted refinement...", 'info');
                        const _dsCtx2 = (options as any).designStyleContext || "";
                        const _activeDP2 = _dsCtx2
                            ? `${UI_DESIGNER_PROMPT}\n\n${_dsCtx2}\n\nRULE: The DESIGN IDENTITY block above OVERRIDES all default dark/glassmorphism directives.`
                            : UI_DESIGNER_PROMPT;
                        const refineFileList = Object.keys(generatedFiles);
                        const refineResult = await executeWithBackoff(client, resolvedAiConfig, {
                            model: resolvedAiConfig.model,
                            systemPrompt: _activeDP2,
                            messages: [{
                                role: "user",
                                content: JSON.stringify({
                                    instruction: "The app scored below 80/100 in quality review. Return ONLY the files that need to change as a JSON object { filename: newContent }.",
                                    critiqueScore: score,
                                    defects: critique.defects,
                                    refinementDirectives: critique.refinementDirectives,
                                    existingFiles: refineFileList,
                                })
                            }],
                            maxTokens: 8192,
                        }, {}, 5, emitLog);

                        if (refineResult.success && refineResult.output) {
                            const refineRaw = refineResult.output.trim();
                            const jsonMatch4 = refineRaw.match(/\{[\s\S]*\}/);
                            if (jsonMatch4) {
                                try {
                                    const fixResult2 = tryFixJson(jsonMatch4[0]);
                                    const refined = JSON.parse(fixResult2 ? fixResult2.fixed : jsonMatch4[0]);
                                    let refineCount = 0;
                                    for (const [k, v] of Object.entries(refined)) {
                                        if (typeof v === 'string') {
                                            generatedFiles[k] = v;
                                            refineCount++;
                                        }
                                    }
                                    await emitLog(`Refinement applied to ${refineCount} file(s).`, 'success');
                                } catch (refineParseErr: any) {
                                    await emitLog(`Refinement JSON unparseable   skipping refinement pass: ${refineParseErr.message}`, 'warn');
                                }
                            }
                        }
                    }
                } catch (innerCritiqueErr: any) {
                    await emitLog(`Critique refinement error (non-fatal): ${innerCritiqueErr.message}`, 'warn');
                }
            }
        } else {
            await emitLog(`Critique pass failed (non-fatal): ${critiqueResultSettled.reason?.message}`, 'warn');
        }

        return { generatedFiles, lastCritiqueScore };
    }
}

export const forgeCritiqueService = new ForgeCritiqueService();
