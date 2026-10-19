import { db } from "@server/database_service.js";
import { jobs, pipelines, jobCollections, jobCollectionItems, systemSettings, missions, missionMembers } from "@shared/schema/index.js";
import { governorPolicies, governorPolicyRules, type GovernorPolicyRule } from "@shared/schema/governor.js";
import { knowledgeNodes, knowledgeTopics, knowledgeConcepts, knowledgeTopicConcepts, knowledgePolicyConstraints } from "@shared/schema/knowledge/index.js";
import { eq, and, inArray, desc, sql, or } from "drizzle-orm";

export interface GovernanceResolved {
    enabled: boolean;
    mode: 'ADVISORY' | 'AUTONOMOUS' | 'OFF';
    rules: GovernorPolicyRule[];
    source: 'job' | 'pipeline' | 'mission' | 'collection' | 'global' | 'none';
}

export const governorResolver = {
    /**
     * Resolves policies linked to semantic Concepts in the Knowledge Graph.
     */
    async resolveConceptRules(options: { jobId?: number; pipelineId?: number; missionId?: number }): Promise<GovernorPolicyRule[]> {
        return await db.transaction(async (tx: any) => {
            // 1. Find topics linked to these entities
            const topicIds: number[] = [];

            if (options.jobId || options.pipelineId) {
                const nodes = await tx.select({ topicId: knowledgeNodes.knowledgeTopicId })
                    .from(knowledgeNodes)
                    .where(or(
                        options.jobId ? eq(knowledgeNodes.externalId, options.jobId.toString()) : undefined,
                        options.pipelineId ? eq(knowledgeNodes.externalId, options.pipelineId.toString()) : undefined
                    ));
                nodes.forEach((n: any) => { if (n.topicId) topicIds.push(n.topicId); });
            }

            if (topicIds.length === 0) return [];

            // 2. Resolve Concepts -> Policies
            const rules = await tx.select({ rule: governorPolicyRules })
                .from(knowledgeTopicConcepts)
                .innerJoin(knowledgePolicyConstraints, eq(knowledgeTopicConcepts.conceptId, knowledgePolicyConstraints.conceptId))
                .innerJoin(governorPolicyRules, eq(knowledgePolicyConstraints.policyRuleId, governorPolicyRules.id))
                .where(and(
                    inArray(knowledgeTopicConcepts.topicId, topicIds),
                    eq(governorPolicyRules.isEnabled, true)
                ));

            return rules.map((r: any) => r.rule);
        });
    },

    /**
     * Resolves the effective governance mode for a job execution.
     * Priority: Job > Pipeline > Mission > Collection > Global
     */
    async resolveGovernance(options: {
        jobId?: number;
        pipelineId?: number;
        jobConfig?: any;
    }): Promise<GovernanceResolved> {
        const { jobId, pipelineId, jobConfig } = options;
        let rules: GovernorPolicyRule[] = [];

        // Helper to fetch rules if policyId exists
        const fetchRules = async (policyId?: number | null) => {
            if (!policyId) return [];
            return await db.select().from(governorPolicyRules).where(and(
                eq(governorPolicyRules.policyId, policyId),
                eq(governorPolicyRules.isEnabled, true)
            ));
        };

        // 1. Check Job Level
        // A. Config Override
        let jobGov = jobConfig?.governorSettings;
        if (jobGov && jobGov.enabled !== undefined) {
            // Config-based governance (transient) usually doesn't have a policyId, 
            // but if we wanted to support it, we'd need to pass it in jobConfig.
            // For now, assume config only controls mode.
            return {
                enabled: jobGov.enabled,
                mode: jobGov.mode || (jobGov.enabled ? 'ADVISORY' : 'OFF'),
                rules: [],
                source: 'job'
            };
        }

        // B. Database Job
        if (jobId) {
            const [job] = await db
                .select({
                    governorSettings: jobs.governorSettings,
                    governorPolicyId: jobs.governorPolicyId
                })
                .from(jobs)
                .where(eq(jobs.id, jobId))
                .limit(1);

            if (job) {
                // JSON Settings take precedence for simple on/off
                const settings = job.governorSettings as any;
                if (settings && settings.enabled !== undefined) {
                    return {
                        enabled: settings.enabled,
                        mode: settings.mode || (settings.enabled ? 'ADVISORY' : 'OFF'),
                        rules: await fetchRules(job.governorPolicyId), // Job can have BOTH simple settings AND a policy
                        source: 'job'
                    };
                }

                // If only policy ID is present, we need to decide what "enabled" means.
                // Usually presence of a policy implies enabled.
                if (job.governorPolicyId) {
                    return {
                        enabled: true,
                        mode: 'ADVISORY', // Default mode if only policy provided? Or should policy have a mode?
                        // For now, let's default to ADVISORY if a policy is attached.
                        rules: await fetchRules(job.governorPolicyId),
                        source: 'job'
                    };
                }
            }
        }

        // 2. Load Pipeline Level
        if (pipelineId) {
            const [pipeline] = await db
                .select({
                    governorSettings: pipelines.governorSettings,
                    governorPolicyId: pipelines.governorPolicyId
                })
                .from(pipelines)
                .where(eq(pipelines.id, pipelineId))
                .limit(1);

            const pipeGov = pipeline?.governorSettings as any;
            if (pipeGov && pipeGov.enabled !== undefined) {
                return {
                    enabled: pipeGov.enabled,
                    mode: pipeGov.mode || (pipeGov.enabled ? 'ADVISORY' : 'OFF'),
                    rules: await fetchRules(pipeline?.governorPolicyId),
                    source: 'pipeline'
                };
            }

            if (pipeline?.governorPolicyId) {
                return {
                    enabled: true,
                    mode: 'ADVISORY',
                    rules: await fetchRules(pipeline.governorPolicyId),
                    source: 'pipeline'
                };
            }
        }

        // 3. Load Mission Level (New!)
        if (jobId || pipelineId) {
            // Find missions this entity belongs to
            // Priority: direct membership > ...? 
            // Just take the first active mission with a policy for now.
            const entityType = jobId ? 'job' : 'pipeline';
            const entityId = jobId || pipelineId!; // One must be present

            const members = await db
                .select({
                    missionId: missionMembers.missionId
                })
                .from(missionMembers)
                .where(and(
                    eq(missionMembers.entityType, entityType),
                    eq(missionMembers.entityId, entityId),
                    eq(missionMembers.status, 'active')
                ));

            if (members.length > 0) {
                const missionIds = members.map(m => m.missionId);
                const missionsList = await db
                    .select({
                        id: missions.id,
                        governorPolicyId: missions.governorPolicyId
                    })
                    .from(missions)
                    .where(inArray(missions.id, missionIds));

                const missionWithPolicy = missionsList.find(m => m.governorPolicyId);
                if (missionWithPolicy) {
                    return {
                        enabled: true,
                        mode: 'ADVISORY',
                        rules: await fetchRules(missionWithPolicy.governorPolicyId),
                        source: 'mission'
                    };
                }
            }
        }

        // 4. Load Collection Level (Legacy/Simple)
        if (jobId) {
            const collections = await db
                .select({ governorSettings: jobCollections.governorSettings })
                .from(jobCollectionItems)
                .innerJoin(jobCollections, eq(jobCollectionItems.collectionId, jobCollections.id))
                .where(eq(jobCollectionItems.jobId, jobId));

            const collectionGov = collections.find(c => (c.governorSettings as any)?.enabled === true);
            if (collectionGov) {
                const gov = collectionGov.governorSettings as any;
                return {
                    enabled: true,
                    mode: gov.mode || 'ADVISORY',
                    rules: [],
                    source: 'collection'
                };
            }
        }

        // 5. Global Baseline
        const settingsResult = await db.select().from(systemSettings).where(eq(systemSettings.key, 'global')).limit(1);
        const globalSettings = settingsResult[0]?.settingsData as any || {};
        const globalGov = globalSettings.governorSettings || { enabled: false, mode: 'OFF' };

        // 6. Semantic Concept Policies (Overlay)
        const conceptRules = await this.resolveConceptRules({ jobId, pipelineId });
        if (conceptRules.length > 0) {
            // If concept rules exist, we ensure governance is at least ADVISORY
            return {
                enabled: true,
                mode: globalGov.mode !== 'OFF' ? globalGov.mode : 'ADVISORY',
                rules: conceptRules,
                source: 'global' // Or 'concept' if we added a new source type
            };
        }

        return {
            enabled: globalGov.enabled,
            mode: globalGov.mode || (globalGov.enabled ? 'ADVISORY' : 'OFF'),
            rules: [],
            source: 'global'
        };
    }
};


