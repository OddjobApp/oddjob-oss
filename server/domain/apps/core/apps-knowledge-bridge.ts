/**
 * Apps Knowledge Bridge
 * 
 * Registers applications created via App Forge into the Knowledge Graph,
 * making them discoverable as organizational assets.
 * 
 * Quick Win: Transform apps into searchable, reusable knowledge entities
 */

import { db } from "@server/database_service.js";
import { apps, knowledgeNodes, knowledgeEdges, knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { longTermMemoryService } from "@domain/agents/core/long-term-memory.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("AppsKnowledgeBridge");

export interface AppKnowledgeRegistration {
    appId: number;
    name: string;
    slug: string;
    blueprint?: string;
    techStack: string[];
    components: string[];
    features: string[];
    createdBy: string;
    organizationId: number;
}

export const appsKnowledgeBridge = {
    /**
     * Register an app to the knowledge graph.
     * Called automatically when an app is successfully created via Forge.
     */
    async registerApp(appId: number): Promise<{
        success: boolean;
        nodeId?: number;
        componentIds?: number[];
        message?: string;
    }> {
        try {
            // 1. Fetch app details
            const [app] = await db
                .select()
                .from(apps)
                .where(eq(apps.id, appId))
                .limit(1);

            if (!app) {
                return { success: false, message: "App not found" };
            }

            // Skip if already registered
            const existing = await this.findExistingAppNode(appId, assertOrgId(app.organizationId));
            if (existing) {
                // Update existing instead of creating new
                return await this.updateAppKnowledge(app, existing.id);
            }

            // 2. Extract tech stack and features from app
            const techStack = this.extractTechStack(app);
            const components = this.extractComponents(app);
            const features = this.extractFeatures(app);

            // 3. Find or create Apps topic
            const topicId = await this.ensureAppsTopic(assertOrgId(app.organizationId));

            // 4. Create main app node
            const appResults = await db.insert(knowledgeNodes).values({
                organizationId: assertOrgId(app.organizationId),
                knowledgeTopicId: topicId,
                label: 'Application',
                name: app.name,
                data: {
                    appId: app.id,
                    slug: app.slug,
                    description: app.description,
                    blueprint: app.blueprint,
                    techStack,
                    components: components.map(c => c.name),
                    features,
                    createdBy: app.createdBy,
                    createdAt: app.createdAt?.toISOString(),
                    updatedAt: app.updatedAt?.toISOString(),
                    registrationSource: 'apps_knowledge_bridge',
                },
                verificationStatus: 'verified',
            }).returning();

            const appNode = appResults[0];
            const createdNodeIds: number[] = [appNode.id];

            // 5. Create component nodes and link them
            const componentNodeIds = await this.createComponentNodes(app, appNode.id, topicId, components);
            createdNodeIds.push(...componentNodeIds);

            // 6. Create tech stack nodes
            const techNodeIds = await this.createTechStackNodes(app, appNode.id, topicId, techStack);
            createdNodeIds.push(...techNodeIds);

            // 7. Store to long-term memory for unified queries
            await this.storeAppMemory(app, techStack, features);

            logger.info(`[AppsKnowledgeBridge] Registered app ${appId} as knowledge node ${appNode.id} with ${createdNodeIds.length - 1} related nodes`);

            return {
                success: true,
                nodeId: appNode.id,
                componentIds: createdNodeIds.slice(1),
                message: `Created ${createdNodeIds.length} knowledge nodes`,
            };

        } catch (err: any) {
            logger.error(`[AppsKnowledgeBridge] Failed to register app ${appId}: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Create component nodes and link them to the app.
     */
    async createComponentNodes(
        app: typeof apps.$inferSelect,
        appNodeId: number,
        topicId: number,
        components: Array<{ name: string; type: string; tech: string[]; features: string[] }>
    ): Promise<number[]> {
        const createdNodeIds: number[] = [];
        for (const component of components) {
            const componentResults = await db.insert(knowledgeNodes).values({
                organizationId: assertOrgId(app.organizationId),
                knowledgeTopicId: topicId,
                label: 'Component',
                name: `${app.name}: ${component.name}`,
                data: {
                    appId: app.id,
                    componentName: component.name,
                    componentType: component.type,
                    tech: component.tech,
                    features: component.features,
                    source: 'app_component',
                },
                verificationStatus: 'verified',
            }).returning();

            const componentNode = componentResults[0];
            createdNodeIds.push(componentNode.id);

            // Link component to app
            await db.insert(knowledgeEdges).values({
                sourceId: appNodeId,
                targetId: componentNode.id,
                relation: 'PART_OF', // Use standard relation
                organizationId: assertOrgId(app.organizationId),
                data: { componentType: component.type, originalLabel: 'HAS_COMPONENT' },
            });
        }
        return createdNodeIds;
    },

    /**
     * Create tech stack nodes and link them to the app.
     */
    async createTechStackNodes(
        app: typeof apps.$inferSelect,
        appNodeId: number,
        topicId: number,
        techStack: string[]
    ): Promise<number[]> {
        const createdNodeIds: number[] = [];
        for (const tech of techStack) {
            // Check if tech node already exists
            const [existingTech] = await db
                .select({ id: knowledgeNodes.id })
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, assertOrgId(app.organizationId)),
                        eq(knowledgeNodes.label, 'Technology'),
                        eq(knowledgeNodes.name, tech)
                    )
                )
                .limit(1);

            let techNodeId: number;

            if (existingTech) {
                techNodeId = existingTech.id;
            } else {
                const results = await db.insert(knowledgeNodes).values({
                    organizationId: assertOrgId(app.organizationId),
                    knowledgeTopicId: topicId,
                    label: 'Technology',
                    name: tech,
                    data: {
                        name: tech,
                        type: this.classifyTech(tech),
                        usageCount: 1,
                    },
                    verificationStatus: 'verified',
                }).returning();
                techNodeId = results[0].id;
                createdNodeIds.push(techNodeId);
            }

            // Link app to tech
            await db.insert(knowledgeEdges).values({
                sourceId: appNodeId,
                targetId: techNodeId,
                relation: 'RELIES_ON', // Use standard relation
                organizationId: assertOrgId(app.organizationId),
                data: { originalLabel: 'USES_TECHNOLOGY' },
            });
        }
        return createdNodeIds;
    },

    /**
     * Update existing app knowledge node.
     */
    async updateAppKnowledge(
        app: typeof apps.$inferSelect,
        existingNodeId: number
    ): Promise<{ success: boolean; nodeId: number; message?: string }> {
        try {
            const techStack = this.extractTechStack(app);
            const components = this.extractComponents(app);
            const features = this.extractFeatures(app);

            await db.update(knowledgeNodes)
                .set({
                    name: app.name,
                    data: {
                        appId: app.id,
                        slug: app.slug,
                        description: app.description,
                        blueprint: app.blueprint,
                        techStack,
                        components: components.map(c => c.name),
                        features,
                        createdBy: app.createdBy,
                        createdAt: app.createdAt?.toISOString(),
                        updatedAt: app.updatedAt?.toISOString(),
                        lastSynced: new Date().toISOString(),
                        registrationSource: 'apps_knowledge_bridge',
                    },
                    updatedAt: new Date(),
                })
                .where(eq(knowledgeNodes.id, existingNodeId));

            logger.info(`[AppsKnowledgeBridge] Updated app knowledge node ${existingNodeId}`);

            return { success: true, nodeId: existingNodeId, message: "Updated existing node" };

        } catch (err: any) {
            logger.error(`[AppsKnowledgeBridge] Failed to update app knowledge: ${err.message}`);
            return { success: false, nodeId: existingNodeId, message: err.message };
        }
    },

    /**
     * Find similar apps in the knowledge graph.
     */
    async findSimilarApps(
        targetAppId: number,
        organizationId: number
    ): Promise<Array<{ appId: number; name: string; similarity: number; sharedTech: string[] }>> {
        try {
            // Get target app
            const [targetApp] = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, organizationId),
                        eq(knowledgeNodes.label, 'Application'),
                        sql`${knowledgeNodes.data}->>'appId' = ${targetAppId.toString()}`
                    )
                )
                .limit(1);

            if (!targetApp) return [];

            const targetData = targetApp.data as any;
            const targetTech = new Set(targetData?.techStack || []);

            // Get all other apps
            const otherApps = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, organizationId),
                        eq(knowledgeNodes.label, 'Application'),
                        sql`${knowledgeNodes.data}->>'appId' != ${targetAppId.toString()}`
                    )
                );

            // Calculate similarity
            const similarities = otherApps.map(app => {
                const data = app.data as any;
                const tech = data?.techStack || [];
                const sharedTech = tech.filter((t: string) => targetTech.has(t));
                const similarity = targetTech.size > 0 ? sharedTech.length / targetTech.size : 0;

                return {
                    appId: data?.appId,
                    name: app.name,
                    similarity: Math.round(similarity * 100) / 100,
                    sharedTech,
                };
            });

            return similarities
                .filter(s => s.similarity > 0.3) // At least 30% tech overlap
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 5);

        } catch (err: any) {
            logger.error(`[AppsKnowledgeBridge] Failed to find similar apps: ${err.message}`);
            return [];
        }
    },

    /**
     * Get apps by technology (e.g., "show me all React apps").
     */
    async getAppsByTechnology(tech: string, organizationId: number): Promise<Array<{ appId: number; name: string; slug: string }>> {
        try {
            const apps = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, organizationId),
                        eq(knowledgeNodes.label, 'Application'),
                        sql`${knowledgeNodes.data}->'techStack' ? ${tech}`
                    )
                )
                .orderBy(desc(knowledgeNodes.createdAt));

            return apps.map(a => {
                const data = a.data as any;
                return {
                    appId: data?.appId,
                    name: a.name,
                    slug: data?.slug,
                };
            });

        } catch (err: any) {
            logger.error(`[AppsKnowledgeBridge] Failed to get apps by tech: ${err.message}`);
            return [];
        }
    },

    /**
     * Find existing knowledge node for an app.
     */
    async findExistingAppNode(appId: number, organizationId: number): Promise<typeof knowledgeNodes.$inferSelect | null> {
        const [existing] = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'Application'),
                    sql`${knowledgeNodes.data}->>'appId' = ${appId.toString()}`
                )
            )
            .limit(1);

        return existing || null;
    },

    /**
     * Ensure Apps topic exists.
     */
    async ensureAppsTopic(organizationId: number): Promise<number> {
        const [existing] = await db
            .select({ id: knowledgeTopics.id })
            .from(knowledgeTopics)
            .where(
                and(
                    eq(knowledgeTopics.organizationId, organizationId),
                    eq(knowledgeTopics.name, 'Applications')
                )
            )
            .limit(1);

        if (existing) return existing.id;

        const [topic] = await db.insert(knowledgeTopics).values({
            organizationId,
            name: 'Applications',
            description: 'Applications created via App Forge and their components',
            createdBy: 'apps-knowledge-bridge',
        }).returning();

        return topic.id;
    },

    /**
     * Extract tech stack from app data.
     */
    extractTechStack(app: typeof apps.$inferSelect): string[] {
        const tech: string[] = [];
        const config = app.config as any;

        // From blueprint
        if (app.blueprint) {
            const blueprintTech = this.blueprintToTech(app.blueprint);
            tech.push(...blueprintTech);
        }

        // From config
        if (config?.dependencies) {
            tech.push(...Object.keys(config.dependencies));
        }

        if (config?.devDependencies) {
            tech.push(...Object.keys(config.devDependencies));
        }

        // From pages/components if available
        if (config?.pages) {
            config.pages.forEach((page: any) => {
                if (page.imports) tech.push(...page.imports);
            });
        }

        return [...new Set(tech)].slice(0, 20); // Deduplicate and limit
    },

    /**
     * Map blueprint to common technologies.
     */
    blueprintToTech(blueprint: string): string[] {
        const blueprintMap: Record<string, string[]> = {
            'react-app': ['React', 'JavaScript', 'HTML', 'CSS'],
            'nextjs': ['Next.js', 'React', 'TypeScript', 'Node.js'],
            'chat-assistant': ['React', 'AI', 'Streaming'],
            'analytics-dashboard': ['React', 'Charts', 'Data Visualization'],
            'crud-app': ['React', 'REST API', 'Database'],
            'api': ['Node.js', 'Express', 'REST'],
            'spa': ['React', 'Single Page App'],
            'pwa': ['React', 'PWA', 'Service Worker'],
            'rescue-dispatch': ['React', 'Real-time', 'WebSocket'],
            'mission-supervisor': ['React', 'State Management', 'Complex UI'],
        };

        return blueprintMap[blueprint] || ['Unknown'];
    },

    /**
     * Extract components from app structure.
     */
    extractComponents(app: typeof apps.$inferSelect): Array<{ name: string; type: string; tech: string[]; features: string[] }> {
        const components: Array<{ name: string; type: string; tech: string[]; features: string[] }> = [];
        const config = app.config as any;

        // Extract from pages
        if (config?.pages) {
            config.pages.forEach((page: any, idx: number) => {
                components.push({
                    name: page.name || `Page ${idx + 1}`,
                    type: 'page',
                    tech: page.imports || [],
                    features: this.extractFeaturesFromPage(page),
                });
            });
        }

        // Extract from components
        if (config?.components) {
            config.components.forEach((comp: any, idx: number) => {
                components.push({
                    name: comp.name || `Component ${idx + 1}`,
                    type: 'component',
                    tech: comp.imports || [],
                    features: comp.features || [],
                });
            });
        }

        return components;
    },

    /**
     * Extract features from app configuration.
     */
    extractFeatures(app: typeof apps.$inferSelect): string[] {
        const features: string[] = [];
        const config = app.config as any;

        // From pages
        if (config?.pages) {
            config.pages.forEach((page: any) => {
                features.push(...this.extractFeaturesFromPage(page));
            });
        }

        // From capabilities
        if (config?.capabilities) {
            features.push(...config.capabilities);
        }

        // From description
        if (app.description) {
            // Extract key nouns as features
            const keywords = app.description.match(/\b\w{4,}\b/g) || [];
            features.push(...keywords.slice(0, 5));
        }

        return [...new Set(features)].slice(0, 10);
    },

    /**
     * Extract features from a page configuration.
     */
    extractFeaturesFromPage(page: any): string[] {
        const features: string[] = [];

        if (page.blocks) {
            page.blocks.forEach((block: any) => {
                if (block.type) features.push(block.type);
                if (block.component) features.push(block.component);
            });
        }

        if (page.route) features.push(`Route: ${page.route}`);
        if (page.layout) features.push(`Layout: ${page.layout}`);

        return features;
    },

    /**
     * Classify a technology type.
     */
    classifyTech(tech: string): string {
        const techLower = tech.toLowerCase();

        if (techLower.includes('react') || techLower.includes('vue') || techLower.includes('angular')) {
            return 'frontend-framework';
        }
        if (techLower.includes('node') || techLower.includes('express') || techLower.includes('fastify')) {
            return 'backend-framework';
        }
        if (techLower.includes('database') || techLower.includes('postgres') || techLower.includes('mongo')) {
            return 'database';
        }
        if (techLower.includes('ui') || techLower.includes('component') || techLower.includes('design')) {
            return 'ui-library';
        }
        if (techLower.includes('api') || techLower.includes('rest') || techLower.includes('graphql')) {
            return 'api';
        }

        return 'other';
    },

    /**
     * Store app info to long-term memory for unified queries.
     */
    async storeAppMemory(
        app: typeof apps.$inferSelect,
        techStack: string[],
        features: string[]
    ): Promise<void> {
        const content = `Application "${app.name}" (${app.slug}) created with ${techStack.join(', ')}. ` +
            `Features: ${features.join(', ')}. ` +
            `Blueprint: ${app.blueprint || 'custom'}.`;

        await longTermMemoryService.remember({
            organizationId: assertOrgId(app.organizationId),
            userId: app.createdBy || undefined,
            type: 'fact',
            content,
            key: `app-${app.id}`,
            importance: 7,
            metadata: {
                appId: app.id,
                slug: app.slug,
                blueprint: app.blueprint,
                techStack,
                features,
                source: 'apps_knowledge_bridge',
            },
        });
    },

    /**
     * Sync all unregistered apps to knowledge graph (batch operation).
     */
    async syncAllApps(organizationId?: number): Promise<{ processed: number; errors: number; new: number; updated: number }> {
        let conditions = [];
        if (organizationId) {
            conditions.push(eq(apps.organizationId, organizationId));
        }

        const allApps = await db
            .select()
            .from(apps)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .limit(100);

        let processed = 0;
        let errors = 0;
        let new_ = 0;
        let updated = 0;

        for (const app of allApps) {
            try {
                const result = await this.registerApp(app.id);
                processed++;

                if (result.success) {
                    if (result.message?.includes('Updated')) {
                        updated++;
                    } else {
                        new_++;
                    }
                } else {
                    errors++;
                }
            } catch (err: any) {
                logger.error(`[AppsKnowledgeBridge] Failed to sync app ${app.id}: ${err.message}`);
                errors++;
            }
        }

        logger.info(`[AppsKnowledgeBridge] Synced ${processed} apps: ${new_} new, ${updated} updated, ${errors} errors`);

        return { processed, errors, new: new_, updated };
    },

    /**
     * Get app statistics for knowledge graph.
     */
    async getStats(organizationId: number): Promise<{
        totalApps: number;
        byBlueprint: Record<string, number>;
        byTech: Record<string, number>;
        topComponents: string[];
    }> {
        const appNodes = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'Application')
                )
            );

        const stats = {
            totalApps: appNodes.length,
            byBlueprint: {} as Record<string, number>,
            byTech: {} as Record<string, number>,
            topComponents: [] as string[],
        };

        const componentCounts: Record<string, number> = {};

        appNodes.forEach(node => {
            const data = node.data as any;

            // Blueprint counts
            if (data?.blueprint) {
                stats.byBlueprint[data.blueprint] = (stats.byBlueprint[data.blueprint] || 0) + 1;
            }

            // Tech counts
            if (data?.techStack) {
                data.techStack.forEach((tech: string) => {
                    stats.byTech[tech] = (stats.byTech[tech] || 0) + 1;
                });
            }

            // Component counts
            if (data?.components) {
                data.components.forEach((comp: string) => {
                    componentCounts[comp] = (componentCounts[comp] || 0) + 1;
                });
            }
        });

        // Top components
        stats.topComponents = Object.entries(componentCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name]) => name);

        return stats;
    },
};

export default appsKnowledgeBridge;
