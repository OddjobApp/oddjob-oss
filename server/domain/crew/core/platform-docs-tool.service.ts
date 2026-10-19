import fs from "node:fs/promises";
import path from "node:path";
import { documentationService } from "../../admin/documentation.service.js";
import { crewCacheService } from "./crew-cache.service.js";

/**
 * Platform Documentation Tool Service for CREW Agents
 *
 * Bridges CREW multi-agent rounds directly to Oddjob's live DocumentationService
 * and internal repository documentation in `docs/` and `docs/specs/`.
 * Integrated with L1/L2 multi-tier caching for sub-10ms response latency.
 */

export interface FeatureSummary {
    id: string;
    name: string;
    description: string;
    version: string;
    maintainers?: string[];
}

export class PlatformDocsToolService {
    /**
     * Searches live feature specs, API contracts, capability manifests, and UI specs.
     */
    public async searchDocumentation(query: string, organizationId: number): Promise<{ results: any[]; summary: string }> {
        const cacheKey = `docs:search:${organizationId}:${query.toLowerCase().trim()}`;
        return crewCacheService.getOrSet(cacheKey, 3600, async () => {
            try {
                const results = await documentationService.searchSpecs(query, organizationId);
                const features = await documentationService.getFeatures(organizationId);

                // Also check for matching feature names/descriptions
                const matchingFeatures = features.filter(f =>
                    f.name.toLowerCase().includes(query.toLowerCase()) ||
                    f.description.toLowerCase().includes(query.toLowerCase()) ||
                    f.id.toLowerCase().includes(query.toLowerCase())
                );

                let summary = `Found ${results.length} specification matches and ${matchingFeatures.length} matching feature modules for query: "${query}".`;
                if (matchingFeatures.length > 0) {
                    summary += `\n\n**Matching Platform Features**:\n` +
                        matchingFeatures.map(f => `• **${f.name}** (\`${f.id}\` v${f.version}): ${f.description}`).join("\n");
                }

                return {
                    results: [...results, ...matchingFeatures.map(f => ({ type: "feature", ...f }))],
                    summary,
                };
            } catch (err: any) {
                return {
                    results: [],
                    summary: `Encountered error while searching platform documentation: ${err.message}`,
                };
            }
        });
    }

    /**
     * Fetches the complete specification markdown for a specific feature or aggregate spec.
     */
    public async getFeatureSpec(featureId: string, organizationId: number): Promise<any> {
        const cacheKey = `docs:spec:${organizationId}:${featureId.toLowerCase().trim()}`;
        return crewCacheService.getOrSet(cacheKey, 3600, async () => {
            try {
                if (featureId === "api") return await documentationService.getApiSpec(organizationId);
                if (featureId === "ui") return await documentationService.getUiSpec(organizationId);
                if (featureId === "capability") return await documentationService.getCapabilitySpec(organizationId);

                return await documentationService.getFeatureSpec(featureId, organizationId);
            } catch (err: any) {
                return {
                    error: `Feature spec "${featureId}" could not be retrieved: ${err.message}`,
                };
            }
        });
    }

    /**
     * Lists all documented platform features.
     */
    public async listFeatures(organizationId: number): Promise<FeatureSummary[]> {
        try {
            const features = await documentationService.getFeatures(organizationId);
            return features.map(f => ({
                id: f.id,
                name: f.name,
                description: f.description,
                version: f.version,
                maintainers: f.maintainers,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Reads internal markdown documentation directly from the filesystem repository.
     */
    public async readInternalRepoDoc(relativeDocPath: string): Promise<{ path: string; content: string } | { error: string }> {
        try {
            // Sanitize and sandbox path to workspace docs directory
            const cleanPath = relativeDocPath.replace(/^(\.\.[\/\\])+/, "");
            const workspaceRoot = process.cwd();
            const fullPath = path.resolve(workspaceRoot, cleanPath.startsWith("docs") ? cleanPath : path.join("docs", cleanPath));

            // Separator-terminated prefix: a bare startsWith(docsRoot) also accepts a
            // sibling directory such as docs-internal/.
            const docsRoot = path.resolve(workspaceRoot, "docs");
            if (fullPath !== docsRoot && !fullPath.startsWith(docsRoot + path.sep)) {
                return { error: "Access denied. Paths must remain within the docs/ directory." };
            }

            const content = await fs.readFile(fullPath, "utf-8");
            return {
                path: cleanPath,
                content: content.slice(0, 12000), // Return up to 12k chars of structured documentation
            };
        } catch (err: any) {
            return { error: `Could not read documentation file "${relativeDocPath}": ${err.message}` };
        }
    }
}

export const platformDocsTool = new PlatformDocsToolService();
