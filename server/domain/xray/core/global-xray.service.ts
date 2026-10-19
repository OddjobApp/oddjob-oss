
import { createLogger } from "@server/utils/logger.js";
import { codeGraphService } from "./code-graph.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";

const logger = createLogger("GlobalXRay");

export interface CommunityInsight {
    communityId: string;
    name: string;
    description: string;
    files: string[];
    mainEntryPoints: string[];
    dependencies: string[];
}

export interface GlobalCodebaseMap {
    slug: string;
    overview: string;
    communities: CommunityInsight[];
    architectureScore: number;
}

export const globalXRayService = {
    /**
     * Generate a global map of the codebase using GraphRAG principles (Community Summarization).
     */
    async generateGlobalMap(slug: string, organizationId?: number): Promise<GlobalCodebaseMap> {
        logger.info(`[GlobalXRay] Generating global map for ${slug}`);
        
        // 1. Fetch the raw graph
        const graph = await codeGraphService.queryGraph(slug);
        
        if (graph.nodes.length === 0) {
            return {
                slug,
                overview: "Codebase is empty or not yet indexed.",
                communities: [],
                architectureScore: 0
            };
        }

        // 2. Clustering (Simple directory-based for now, as it's the natural community in code)
        const communityMap = new Map<string, string[]>();
        for (const node of graph.nodes) {
            if (node.kind === "code_file") {
                const dir = node.filePath.split('/').slice(0, -1).join('/') || "root";
                const files = communityMap.get(dir) ?? [];
                files.push(node.name);
                communityMap.set(dir, files);
            }
        }

        // 3. Summarization (Map-Reduce)
        // Only analyse the top communities by file count — skip trivial directories
        // and cap at MAX_COMMUNITIES to bound LLM cost regardless of codebase size.
        const MAX_COMMUNITIES = 12;
        const CONCURRENCY = 4;
        const MIN_FILES = 2; // skip single-file dirs — not worth an LLM call

        const sortedCommunities = [...communityMap.entries()]
            .filter(([, files]) => files.length >= MIN_FILES)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, MAX_COMMUNITIES);

        logger.info(`[GlobalXRay] Summarising ${sortedCommunities.length} communities (of ${communityMap.size} total) for ${slug}`);

        // Run in parallel batches of CONCURRENCY to avoid serial N-call bottleneck
        const insights: CommunityInsight[] = [];

        for (let i = 0; i < sortedCommunities.length; i += CONCURRENCY) {
            const batch = sortedCommunities.slice(i, i + CONCURRENCY);

            const batchResults = await Promise.all(batch.map(async ([dir, files]) => {
                const communityNodes = graph.nodes.filter(n => files.includes(n.name));
                const nodeSummary = communityNodes.slice(0, 20).map(n => `- ${n.name} (${n.kind})`).join('\n');

                const prompt = `
                    Analyze this directory/module in an application: "${dir}"
                    Files and Symbols:
                    ${nodeSummary}

                    Provide a concise technical summary (2-3 sentences) of what this module handles.
                    Identify possible entry points and dependencies based on names.
                    Format as JSON: { "description": "...", "mainEntryPoints": ["..."], "dependencies": ["..."] }
                `;

                try {
                    const parsed = await systemAiService.generateJson(prompt, 'copilot') as Record<string, any>;
                    return {
                        communityId: dir,
                        name: dir === "root" ? "Main Application" : dir.split('/').pop() || dir,
                        description: parsed.description ?? "Application module.",
                        files: files.slice(0, 10),
                        mainEntryPoints: parsed.mainEntryPoints ?? [],
                        dependencies: parsed.dependencies ?? [],
                    } as CommunityInsight;
                } catch (err) {
                    logger.warn(`[GlobalXRay] Failed to summarise community ${dir}`, { err });
                    return {
                        communityId: dir,
                        name: dir === "root" ? "Main Application" : dir.split('/').pop() || dir,
                        description: "Module containing core application logic.",
                        files: files.slice(0, 10),
                        mainEntryPoints: [],
                        dependencies: [],
                    } as CommunityInsight;
                }
            }));

            insights.push(...batchResults);
        }

        // 4. Global Synthesis (Reduce)
        const globalPrompt = `
            We have an application called "${slug}". Here are its main modules:
            ${insights.map(i => `- ${i.name}: ${i.description}`).join('\n')}
            
            Provide a high-level architectural overview of this application (what kind of app is it, how does data flow?).
            Assign an architecture score (0-100) based on modularity and clear separation of concerns.
            Format as JSON: { "overview": "...", "architectureScore": 85 }
        `;

        let overview = "Standard web application.";
        let architectureScore = 70;

        try {
            const globalParsed = await systemAiService.generateJson(globalPrompt, 'copilot');
            overview = globalParsed.overview;
            architectureScore = globalParsed.architectureScore;
        } catch (err) {
            logger.error(`Global synthesis failed for ${slug}:`, err);
        }

        return {
            slug,
            overview,
            communities: insights,
            architectureScore
        };
    }
};
