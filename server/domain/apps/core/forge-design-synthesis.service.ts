import { createLogger } from "@server/utils/logger.js";
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";
import { ToolContext } from "../../tools/v1/capabilities/types.js";
import { withAiTimeout } from "./forge-utils.js";
import type { AIClient } from "@domain/ai/core/ai-client.service.js";
import type { AiConfig } from "@domain/ai/core/ai-config-resolver.js";

const logger = createLogger("ForgeDesignSynthesis");

export class ForgeDesignSynthesisService {
    async resolveStitchDesignTokens(mcpSvc: any, organizationId?: number, traceContext?: TraceContext): Promise<string> {
        const FALLBACK = `
DESIGN SYSTEM: Sovereign Intelligence (Fallback Defaults)
- Background (surface): #131313
- Surface Container Low: #1c1b1b
- Surface Container: #201f1f
- Surface Container High: #2a2a2a
- Primary (Aureate Gold): #f3ca50
- Primary Container: #d5af37
- On Primary: #3d2f00
- On Surface: #e5e2e1
- Outline Variant: #4d4635
- Headline Font: Space Grotesk (Bold Italic Uppercase)
- Body Font: Manrope
- Label Font: Space Grotesk (Uppercase Tracking)
- Roundness: ROUND_FOUR (0.25rem corners for precision-milled feel)
- NO 1px solid borders for structure   use background color shifts
- Glassmorphism: surface_variant at 60% opacity, backdrop-blur 24px for floating panels
`;

        try {
            const allTools = mcpSvc.getAllTools ? mcpSvc.getAllTools() : [];
            const getProj = allTools.find((t: any) => t.name === 'stitch_get_project');
            const listProj = allTools.find((t: any) => t.name === 'stitch_list_projects');

            if (!getProj || !listProj) return FALLBACK;

            const listRaw = await listProj.execute({}, { named: {}, positional: {}, organizationId, ...traceContext } as ToolContext);
            const listData = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw;
            const projects = listData?.projects || [];

            const match = projects[0];

            if (!match) return FALLBACK;

            const projectId = match.name.split('/').pop();
            const projRaw = await getProj.execute({ name: `projects/${projectId}` }, { named: {}, positional: {}, organizationId, ...traceContext } as ToolContext);
            const projData = typeof projRaw === 'string' ? JSON.parse(projRaw) : projRaw;

            if (!projData?.designTheme) return FALLBACK;

            const theme = projData.designTheme;
            const colors = theme.namedColors || {};
            const strategy = (projData.designMd || "").slice(0, 1500);

            return `
DESIGN SYSTEM: "${projData.title || projectId}" (Live from Stitch)

STRATEGY:
${strategy}

SEMANTIC COLOR TOKENS (use these exact hex values):
${Object.entries(colors).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

TYPOGRAPHY:
- Headline: ${theme.headlineFont || 'SPACE_GROTESK'} (Bold, Italic, Uppercase)
- Body: ${theme.bodyFont || 'MANROPE'}
- Label: ${theme.labelFont || 'SPACE_GROTESK'} (Uppercase, Wide Tracking)

ROUNDNESS: ${theme.roundness || 'ROUND_FOUR'}
`;
        } catch {
            return FALLBACK;
        }
    }

    async runDesignSynthesisPass(
        generatedFiles: Record<string, string>,
        organizationId: number | undefined,
        aiConfig: AiConfig,
        client: AIClient,
        emitLog: (m: string, l?: any) => Promise<void>,
        traceContext?: TraceContext
    ): Promise<Record<string, string>> {
        const synthTargets = Object.keys(generatedFiles).filter(
            k => k.endsWith(".tsx") && (k.startsWith("pages/") || k.startsWith("components/"))
                && !k.includes("_app") && !k.includes("_document")
        );
        if (synthTargets.length === 0) return generatedFiles;

        await emitLog(`Design System Synthesis: Applying Stitch tokens to ${synthTargets.length} file(s) (batched)...`, 'info');
        try {
            const { mcpClientService: mcpSvc } = await import("@domain/integrations/core/mcp-client.service.js");
            const designTokens = await this.resolveStitchDesignTokens(mcpSvc, organizationId, traceContext);

            const batchedPrompt = `You are a premium UI Designer. Restyle these React/Next.js components using the exact design system tokens below.
RULES: Keep ALL logic, hooks, and data fetching intact. Only change className props and style attributes.
Use the provided palette exclusively   no generic Tailwind neutrals. Enhance with glassmorphism.

${designTokens}

Return a JSON object mapping filenames to the restyled component code:
{
  "pages/index.tsx": "// restyled code...",
  "components/Chart.tsx": "// restyled code..."
}

FILES TO RESTYLE:
${synthTargets.map(f => `\n--- FILE: ${f} ---\n${generatedFiles[f].slice(0, 2000)}`).join('\n')}`;

            const batchedResult = await withAiTimeout(client.execute({
                model: aiConfig.model,
                systemPrompt: `You are a premium UI Designer. Return ONLY valid JSON mapping file paths to restyled component code. No markdown, no explanations.`,
                userPrompt: batchedPrompt,
                requestType: "json",
                responseType: "json",
                maxTokens: 16384,
            } as any, undefined, aiConfig.apiKey ?? ""), `design-synthesis:batched`) as any;

            if (batchedResult.success && batchedResult.output) {
                let parsed: Record<string, string> = {};
                try {
                    const raw = typeof batchedResult.output === 'string'
                        ? batchedResult.output.replace(/```json/g, "").replace(/```/g, "").trim()
                        : JSON.stringify(batchedResult.output);
                    parsed = JSON.parse(raw);
                } catch (parseErr: any) {
                    await emitLog(`Batched synthesis JSON parse failed, falling back to individual processing: ${parseErr.message}`, 'warn');
                    const designSynthesisPrompt = `You are a premium UI Designer. Restyle this React/Next.js component using the exact design system tokens below. RULES: Keep ALL logic, hooks, and data fetching intact. Only change className props and style attributes. Use the provided palette exclusively   no generic Tailwind neutrals. Enhance with glassmorphism (backdrop-blur-xl, bg-white/5). Output ONLY the complete TypeScript component. No markdown, no code fences.\n\n${designTokens}`;

                    for (const synthFile of synthTargets) {
                        try {
                            const synthesisResult = await withAiTimeout(client.execute({
                                model: aiConfig.model,
                                systemPrompt: designSynthesisPrompt,
                                userPrompt: generatedFiles[synthFile],
                                requestType: "text",
                                responseType: "text",
                                maxTokens: 8192,
                            } as any, undefined, aiConfig.apiKey ?? ""), `design-synthesis:${synthFile}`) as any;

                            if (synthesisResult.success && synthesisResult.output) {
                                const themed = synthesisResult.output.replace(/```tsx?/g, "").replace(/```/g, "").trim();
                                if (themed.includes("export default") || themed.includes("export function")) {
                                    generatedFiles[synthFile] = themed;
                                }
                            }
                        } catch {
                            // Non-fatal per-file failure
                        }
                    }
                }

                let appliedCount = 0;
                for (const [filename, content] of Object.entries(parsed)) {
                    if (synthTargets.includes(filename) && typeof content === 'string') {
                        const cleaned = content.replace(/```tsx?/g, "").replace(/```/g, "").trim();
                        if (cleaned.includes("export default") || cleaned.includes("export function")) {
                            generatedFiles[filename] = cleaned;
                            appliedCount++;
                        }
                    }
                }
                await emitLog(`Design System Synthesis complete: ${appliedCount}/${synthTargets.length} files restyled (batched).`, 'success');
            }
        } catch (err: any) {
            await emitLog(`Design System Synthesis non-fatal error: ${err.message}`, 'warn');
        }
        return generatedFiles;
    }
}

export const forgeDesignSynthesisService = new ForgeDesignSynthesisService();
