import { db } from "@server/database_service.js";
// The table is exported as `resourceEdges`; aliased so the reads below keep
// reading as "catalog edges". The specifier also needs the .js extension the
// rest of the codebase uses, not .ts.
import { resourceEdges as resourceCatalogEdges } from "@shared/schema/resource-catalog-edges.js";
import { eq, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ResourceImpactCascadeService");

export interface ImpactedResource {
    resourceId: string;
    resourceType: string;
    relationType: string;
    hopDistance: number;
    riskCategory: "direct_consumer" | "transitive_dependency";
}

export interface ResourceImpactCascadeReport {
    targetResourceId: string;
    totalImpactedCount: number;
    impactedResources: ImpactedResource[];
    blastRadiusScore: number;
}

/**
 * Resource Impact Cascade Service:
 * Performs 2-hop downstream graph traversal across resource_catalog_edges
 * to map visual blast radius prior to modifying schema or prompt resources.
 */
export class ResourceImpactCascadeService {
    public static async getImpactCascade(organizationId: number, resourceId: string): Promise<ResourceImpactCascadeReport> {
        const impactedMap = new Map<string, ImpactedResource>();

        try {
            // 1. Direct Hop (hop 1)
            const directEdges = await db.select()
                .from(resourceCatalogEdges)
                .where(
                    or(
                        eq(resourceCatalogEdges.sourceId, resourceId),
                        eq(resourceCatalogEdges.targetId, resourceId)
                    )
                );

            const hop2Targets: string[] = [];

            for (const edge of directEdges) {
                const neighborId = edge.sourceId === resourceId ? edge.targetId : edge.sourceId;
                impactedMap.set(neighborId, {
                    resourceId: neighborId,
                    resourceType: "resource",
                    relationType: edge.relationType,
                    hopDistance: 1,
                    riskCategory: "direct_consumer"
                });
                hop2Targets.push(neighborId);
            }

            // 2. Transitive Hop (hop 2)
            for (const h1Id of hop2Targets.slice(0, 20)) {
                const h2Edges = await db.select()
                    .from(resourceCatalogEdges)
                    .where(
                        or(
                            eq(resourceCatalogEdges.sourceId, h1Id),
                            eq(resourceCatalogEdges.targetId, h1Id)
                        )
                    );

                for (const edge of h2Edges) {
                    const neighborId = edge.sourceId === h1Id ? edge.targetId : edge.sourceId;
                    if (neighborId !== resourceId && !impactedMap.has(neighborId)) {
                        impactedMap.set(neighborId, {
                            resourceId: neighborId,
                            resourceType: "resource",
                            relationType: edge.relationType,
                            hopDistance: 2,
                            riskCategory: "transitive_dependency"
                        });
                    }
                }
            }
        } catch (err: any) {
            logger.error(`[ResourceImpactCascadeService] Error computing impact graph: ${err.message}`);
        }

        const impactedResources = Array.from(impactedMap.values());
        const blastRadiusScore = Number(Math.min(1.0, impactedResources.length * 0.15).toFixed(2));

        logger.info(`[ResourceImpactCascadeService] Computed impact cascade for '${resourceId}': ${impactedResources.length} connected resources (Score: ${blastRadiusScore}).`);

        return {
            targetResourceId: resourceId,
            totalImpactedCount: impactedResources.length,
            impactedResources,
            blastRadiusScore
        };
    }
}
