import { createLogger } from "@server/utils/logger.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { type OrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("ForgeMemory");

export interface AppPattern {
    appType: string;
    description: string;
    architecturalDirectives: string;
    codeHighlights: Record<string, string>;
}

export const forgeMemoryService = {
    /**
     * Stores a high-fidelity app architecture as a "Golden Pattern" in the Knowledge Engine.
     */
    async learnPattern(
        slug: string,
        appType: string,
        description: string,
        files: Record<string, string>,
        orgContext: OrgContext
    ): Promise<void> {
        logger.info(`Learning pattern from forge: ${slug} (${appType})`);

        try {
            // Find or create the "App Architecture Patterns" topic
            const topics = await knowledgeService.listTopics(orgContext);
            let topic = topics.find(t => t.name === "App Architecture Patterns");
            
            if (!topic) {
                // Topic creation utility missing in basic service, but we can creating nodes with label 'AppPattern'
                logger.info("Target topic not found, creating ad-hoc Knowledge Node...");
            }

            // Create a Knowledge Node for this pattern
            await knowledgeService.createNode({
                name: `${appType} Architecture: ${slug}`,
                label: "AppPattern",
                description: `High-fidelity pattern for ${appType}. ${description}`,
                properties: {
                    appType,
                    forgeSlug: slug,
                    files: Object.keys(files).slice(0, 5), // Only store filenames in metadata
                },
                metadata: {
                    architecturalDirectives: this.extractDirectives(files),
                },
                sourceType: "app-forge",
                sourceRef: slug,
                confidenceScore: 0.95,
            }, orgContext);

            logger.info("Pattern successfully committed to memory.");
        } catch (err: any) {
            logger.error(`Failed to learn pattern: ${err.message}`);
        }
    },

    /**
     * Queries the Knowledge Engine for patterns similar to the requested app type.
     */
    async queryPatterns(appType: string, orgContext: OrgContext): Promise<AppPattern[]> {
        logger.info(`Querying memory for '${appType}' patterns...`);

        try {
            const nodes = await knowledgeService.searchNodes(orgContext, {
                label: "AppPattern",
                query: appType,
                limit: 3
            });

            return nodes.map(node => ({
                appType: (node.data as any).appType || appType,
                description: (node as any).data?.description || "",
                architecturalDirectives: (node as any).metadata?.architecturalDirectives || "",
                codeHighlights: {}, // Full code retrieval would be too large for prompt context
            }));
        } catch (err: any) {
            logger.error(`Failed to query patterns: ${err.message}`);
            return [];
        }
    },

    /**
     * Extracts "Design Directives" from source code to teach future agents.
     * Covers chart usage, animation patterns, component decomposition, and hooks.
     */
    extractDirectives(files: Record<string, string>): string {
        const allContent = Object.values(files).join("\n");
        const index = files["pages/index.tsx"] || files["src/pages/index.tsx"] || "";
        const directives: string[] = [];

        // Chart patterns
        if (allContent.includes("recharts")) {
            const charts = ["LineChart", "BarChart", "AreaChart", "PieChart", "RadarChart", "ScatterChart"]
                .filter(c => allContent.includes(c));
            if (charts.length > 0) directives.push(`CHARTS: Uses recharts — ${charts.join(", ")}.`);
        }

        // Animation patterns
        if (allContent.includes("framer-motion")) {
            const hasStagger = allContent.includes("staggerChildren");
            const hasMountAnim = allContent.includes("initial={{ opacity: 0");
            directives.push(`ANIMATIONS: framer-motion${hasStagger ? " with stagger" : ""}${hasMountAnim ? " + mount transitions" : ""}.`);
        }

        // Architecture patterns
        const componentFiles = Object.keys(files).filter(k => k.startsWith("components/") && k.endsWith(".tsx"));
        if (componentFiles.length > 0) directives.push(`COMPONENTS: Decomposed — ${componentFiles.map(f => f.split("/").pop()).join(", ")}.`);

        const pageFiles = Object.keys(files).filter(k => k.startsWith("pages/") && k.endsWith(".tsx") && !k.includes("_app") && !k.includes("_document"));
        if (pageFiles.length > 1) directives.push(`MULTI-PAGE: ${pageFiles.map(f => f.split("/").pop()).join(", ")}.`);

        const apiFiles = Object.keys(files).filter(k => k.startsWith("pages/api/"));
        if (apiFiles.length > 0) directives.push(`API ROUTES: ${apiFiles.map(f => f.split("/").pop()).join(", ")}.`);

        // Hooks and patterns
        if (index.includes("useState")) directives.push("STATE: React useState for interactivity.");
        if (index.includes("useEffect")) directives.push("EFFECTS: useEffect for data fetching.");
        if (allContent.includes("framer-motion")) directives.push("VIBE: Premium glassmorphism dark glass UI.");

        // Imports top-line summary
        const lines = index.split('\n');
        const imports = lines.filter((l: string) => l.startsWith('import')).slice(0, 6).join(', ');
        if (imports) directives.push(`IMPORTS: ${imports}`);

        return directives.length > 0
            ? directives.join(" | ")
            : "Standard Next.js Architecture with Tailwind CSS.";
    }
};
