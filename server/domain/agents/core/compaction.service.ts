import { createLogger } from "../../../utils/logger.js";
import { db } from "../../../database_service.js";
import { missions, missionRuns, jobs, agentDeployments } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";

const logger = createLogger("CompactionService");

/**
 * Compaction Service
 * Distills long mission history into permanent expertise for backing agents.
 */
export class CompactionService {
    /**
     * Compacts a completed mission session into a "Expertise Artifact".
     */
    async compactSession(missionRunId: number, backingJobId: number, orgId: number | null) {
        logger.info(`[Compaction] Reviewing mission run ${missionRunId} for job ${backingJobId}...`);

        try {
            // 1. Fetch Run History & Context
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run) return;

            const missionContext = (run.missionContext as any) || {};
            const trace = (run.dynamicTrace as any[]) || [];

            // 2. Resolve AI Brain for Compaction (Supervisor level)
            const aiConfig = await systemAiService.getAiConfig('copilot', orgId ?? undefined) || { provider: 'google', model: 'gemini-1.5-pro' };
            const client = AIClientFactory.getClient({ 
                provider: aiConfig.provider, 
                baseUrl: aiConfig.baseUrl 
            } as any);

            // 3. Draft Distillation Prompt
            const prompt = `
            You are an Agentic Memory Reviewer. Your task is to review the following mission output and distill it into "Permanent Expertise".
            
            MISSION OBJECTIVE: ${missionContext.intent}
            OUTCOME: ${missionContext.result || 'Success'}
            
            REASONING TRACE:
            ${trace.filter(t => t.type === 'system').map(t => `[${t.event}] ${t.note}`).join('\n')}
            
            TASK:
            Summarize the key strategies, successful tool chains, and conceptual findings from this run. 
            Format this as a concise "Knowledge Injection" block that can be added to the agent's system prompt to help it perform similar tasks faster next time.
            Focus on:
            - Domain specific terminology discovered.
            - Successful workflow patterns.
            - Critical constraints identified.
            
            Return ONLY the distilled knowledge block.
            `;

            logger.info(`[Compaction] Executing distillation prompt for run ${missionRunId}...`);
            const result = await client.execute({
                model: aiConfig.model,
                userPrompt: prompt,
                temperature: 0.1
            } as any, undefined, aiConfig.apiKey || "");
            logger.info(`[Compaction] Distillation result success: ${result.success}`);

            if (!result.success || !result.output) {
                logger.warn(`[Compaction] Distillation failed for run ${missionRunId}`);
                return;
            }

            const distilledKnowledge = result.output.trim();
            logger.info(`[Compaction] Distilled expertise length: ${distilledKnowledge.length}`);

            // 4. Update the Agent's CV & Legend (QMD Format)
            const [job] = await db.select().from(jobs).where(eq(jobs.id, backingJobId)).limit(1);
            logger.info(`[Compaction] Job resolution: ${job ? 'Success' : 'Failed'}`);
            if (job) {
                // Generate QMD Achievement
                const qmdAchievement = `
---
title: Mission Accomplished: ${missionContext.intent}
date: ${new Date().toISOString()}
tags: [${missionContext.tags?.join(', ') || 'autonomous-mission'}]
roi: ${missionContext.projectedRoi || 'TBD'}
---

### Objective
${missionContext.intent}

### Summary of Accomplishments
${distilledKnowledge}

### Tool Proficiency Gained
- ${trace.filter(t => t.type === 'tool').map(t => t.event).join('\n- ')}
`;

                // Update Agent CV (stored in Knowledge Graph as a QMD node)
                try {
                    const { graphService } = await import("../../knowledge/core/graph/graph-service.js");
                    await graphService.createNode({
                        name: `Achievement: ${missionContext.intent}`,
                        label: 'agent_cv_achievement',
                        properties: {
                            content: qmdAchievement,
                            missionRunId,
                            type: 'cv_achievement',
                            format: 'qmd'
                        },
                        metadata: { 
                            agentId: job.id, 
                            roi: missionContext.projectedRoi || 0,
                            scope: 'private',
                            tags: missionContext.tags || []
                        },
                        ownerId: job.id,
                        scope: 'private'
                    }, { organizationId: orgId } as any);
                    logger.info(`[Compaction] CV Node created for agent ${job.id}`);
                } catch (cvErr: any) {
                    logger.warn(`[Compaction] Failed to update agent CV: ${cvErr.message}`);
                }

                // Update the Agent's "Legend" (Soul/Identity)
                try {
                    const { SoulService } = await import("./soul.service.js");
                    await SoulService.evolveLegend(job.id, distilledKnowledge);
                    logger.info(`[Compaction] Agent ${job.id} Legend successfully evolved.`);
                } catch (soulErr: any) {
                    logger.warn(`[Compaction] Failed to evolve agent soul: ${soulErr.message}`);
                }

                // 5. Build the Memory Wiki (COMMUNAL)
                try {
                    const { knowledgeService } = await import("../../knowledge/knowledge.service.js");
                    await knowledgeService.curateLesson(missionRunId, distilledKnowledge, { 
                        organizationId: orgId,
                        userId: 'system' 
                    } as any);
                    logger.info(`[Compaction] Successfully published expertise to Memory Wiki for run ${missionRunId}`);
                } catch (wikiErr: any) {
                    logger.warn(`[Compaction] Failed to publish Wiki article: ${wikiErr.message}`);
                }

                // 6. RLAIF / DPO Preference Generation for Student LLMs
                try {
                    const { fineTuningDatasets, fineTuningPreferences } = await import("@shared/schema/training.js");
                    
                    // a) Critique the result to extract DPO Preferences
                    const critiquePrompt = `
                    You are a Master Instructor generating Direct Preference Optimization (DPO) training data for a Student LLM.
                    Analyze the following execution trace and objective.
                    Extract the core "Facts" discovered or utilized.
                    Generate a "Chosen" response (the ideal, verified Ground Truth) AND a "Rejected" response (a flawed, unsafe, or hallucinated response that a naive model might generate).
                    
                    OBJECTIVE: ${missionContext.intent}
                    OUTCOME: ${missionContext.result || 'Success'}
                    DISTILLED KNOWLEDGE: ${distilledKnowledge}
                    
                    Output valid JSON ONLY matching this schema:
                    {
                      "prompt": "The simulated user request or problem statement",
                      "chosen": "The ideal response, including a Markdown Facts Table of the key entities and relationships.",
                      "rejected": "A flawed, unsafe, or incomplete response that lacks the Facts Table or hallucinates."
                    }
                    `;
                    
                    const critiqueResult = await client.execute({
                        model: aiConfig.model,
                        userPrompt: critiquePrompt,
                        temperature: 0.3 // slightly higher for creative rejected responses
                    } as any, undefined, aiConfig.apiKey || "");
                    
                    if (critiqueResult.success && critiqueResult.output) {
                        let parsedCritique;
                        try {
                            const { safeJsonParse } = await import("@server/utils/json-repair.js");
                            parsedCritique = safeJsonParse(critiqueResult.output);
                        } catch (e) {
                            // fallback simple parse
                            const match = critiqueResult.output.match(/\{[\s\S]*\}/);
                            if (match) parsedCritique = JSON.parse(match[0]);
                        }
                        
                        if (parsedCritique?.prompt && parsedCritique?.chosen && parsedCritique?.rejected) {
                            // b) Ensure Dataset Exists
                            const datasetName = `Agent ${job.id} Specialized Dataset`;
                            let [dataset] = await db.select().from(fineTuningDatasets).where(and(eq(fineTuningDatasets.name, datasetName), eq(fineTuningDatasets.organizationId, orgId ?? 0))).limit(1);
                            
                            if (!dataset) {
                                [dataset] = await db.insert(fineTuningDatasets).values({
                                    name: datasetName,
                                    description: `Automatically generated training data for Agent ${job.id}`,
                                    organizationId: orgId
                                }).returning();
                            }
                            
                            // c) Insert the Fine-Tuning Preference (DPO Record)
                            await db.insert(fineTuningPreferences).values({
                                datasetId: dataset.id,
                                prompt: parsedCritique.prompt,
                                chosenResponse: parsedCritique.chosen,
                                rejectedResponse: parsedCritique.rejected,
                                humanConfidence: 80, // High baseline since it succeeded
                                sourceJobId: job.id
                            });
                            
                            logger.info(`[Compaction] Successfully generated and stored DPO Preference Record for Student LLM training (Agent ${job.id})`);
                        }
                    }
                } catch (exportErr: any) {
                    logger.warn(`[Compaction] Failed to process critique and export DPO dataset: ${exportErr.message}`);
                }
            }

        } catch (err: any) {
            logger.error(`[Compaction] Critical failure during review of run ${missionRunId}: ${err.message}`);
        }
    }
}

export const compactionService = new CompactionService();
