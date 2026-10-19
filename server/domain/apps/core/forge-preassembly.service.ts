import { createLogger } from "@server/utils/logger.js";
import { forgeMemoryService } from "./forge-memory.service.js";
import { forgeVisionService } from "./forge-vision.service.js";
import { forgeFoundationService } from "./forge-foundation.service.js";
import { forgeBlueprintService } from "./forge-blueprint.service.js";
import { documentService } from "@domain/knowledge/core/extraction/document-service.js";
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";
import type { ForgeOptions } from "../app-forge.service.js";
import type { CachedScaffold } from "./forge-codegen.service.js";
import { uiRegistryService } from "./ui-registry.service.js";

const logger = createLogger("ForgePreassembly");

export class ForgePreassemblyService {
    async resolvePreassemblyContext(
        blueprintSlug: string,
        options: ForgeOptions,
        emitLog: (m: string, l?: any) => Promise<void>,
        blueprintSnapshot: Record<string, string>,
        cachedScaffold: CachedScaffold | null,
        orgContext: any,
        traceContext?: TraceContext
    ): Promise<{
        wiringHints: string;
        memoryContext: any;
        visionDirectives: string;
        refVisualDirectives: string;
        refRagContext: string;
        codeGraphContext: string;
        uiPalette: any;
        packagedFoundations: any;
        slotsMap: Record<string, string[]>;
    }> {
        const collectionName = ((options as any).blackboard?.target_collection || (options as any).blackboard?.collection_name) as string;

        const wiringPromise = collectionName ? (async () => {
            try {
                const { forgeDataWireService } = await import("./forge-data-wire.service.js");
                const hints = await forgeDataWireService.generateWiringHints(collectionName);
                return forgeDataWireService.formatHintsForPrompt(hints);
            } catch (wireErr: any) {
                logger.warn(`Data wire hints failed: ${wireErr.message}`);
                return "";
            }
        })() : Promise.resolve("");

        await emitLog(`Architect Researching Vision & Memory for category: ${blueprintSlug}...`, 'info');
        const memoryPromise = forgeMemoryService.queryPatterns(blueprintSlug, orgContext);
        const visionPromise = forgeVisionService.researchArchitecturalVision(options.description, emitLog);
        
        const validAssetIds = (options.referenceAssetIds || []).filter(id => id && typeof id === 'number');
        const ragPromise = validAssetIds.length > 0 ? (async () => {
            await emitLog(`Resolving Reference materials: Found ${validAssetIds.length} valid assets...`, 'info');
            const [analyses, specDocs] = await Promise.all([
                forgeVisionService.analyzeMockups(validAssetIds, options.organizationId, traceContext),
                Promise.all(validAssetIds.map(async (assetId) => {
                    try {
                        const doc = await documentService.getDocumentById(assetId, orgContext);
                        if (doc.textContent && !doc.contentType?.startsWith('image/')) {
                            return `FILENAME: ${doc.title}\nCONTENT:\n${doc.textContent}`;
                        }
                    } catch {}
                    return null;
                }))
            ]);
            
            let refVisualDirectives = "";
            if (analyses.length > 0) {
                refVisualDirectives = forgeVisionService.flattenDirectives(analyses);
                await emitLog(`Visual Synthesis: Extracted design directives from ${analyses.length} mockup(s).`, 'success');
            }
            
            const filteredDocs = specDocs.filter(Boolean);
            let refRagContext = "";
            if (filteredDocs.length > 0) {
                refRagContext = filteredDocs.join("\n\n---\n\n");
                await emitLog(`RAG Context: Ingested ${filteredDocs.length} functional specification document(s).`, 'success');
            }
            return { refVisualDirectives, refRagContext };
        })() : Promise.resolve({ refVisualDirectives: "", refRagContext: "" });

        const [wiringHints, memoryContext, visionDirectives, ragResult] = await Promise.all([
            wiringPromise, memoryPromise, visionPromise, ragPromise
        ]);
        
        const refVisualDirectives = ragResult.refVisualDirectives;
        const refRagContext = ragResult.refRagContext;

        let codeGraphContext = "";
        try {
            const { podRegistry } = await import("@domain/core/infrastructure/pod-registry.service.js");
            if (podRegistry.hasPod('xray')) {
                const xray = (podRegistry as any).getPod('xray');
                const graph = await xray.queryGraph(`blueprint:${blueprintSlug}`);
                const fnNames = graph.nodes
                    .filter((n: any) => n.kind === "code_function" || n.kind === "code_method")
                    .map((n: any) => n.name)
                    .slice(0, 40);
                codeGraphContext = fnNames.length > 0
                    ? `Existing functions: ${fnNames.join(", ")}`
                    : "";
            }
        } catch {
            // xray not yet indexed   proceed without it
        }

        const uiPalette = await uiRegistryService.getUIPaletteManifest();
        const packagedFoundations = await forgeFoundationService.resolvePackagedFoundations(options.description, emitLog);
        const slotsMap = cachedScaffold?.slots || forgeBlueprintService.detectSlots(blueprintSnapshot);

        return {
            wiringHints,
            memoryContext,
            visionDirectives,
            refVisualDirectives,
            refRagContext,
            codeGraphContext,
            uiPalette,
            packagedFoundations,
            slotsMap
        };
    }
}

export const forgePreassemblyService = new ForgePreassemblyService();
