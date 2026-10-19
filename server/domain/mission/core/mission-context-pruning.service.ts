
import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionContextPruning");
const TOKEN_THRESHOLD = 20000; // Prune if context exceeds ~20k tokens

export class MissionContextPruningService {
    /**
     * Examines a mission run's context and blackboard. 
     * If they exceed the healthy threshold, it compresses them into a summary.
     */
    static async pruneIfLarge(missionRunId: number): Promise<void> {
        try {
            const [run] = await db.select({
                id: missionRuns.id,
                missionId: missionRuns.missionId,
                missionContext: missionRuns.missionContext,
                blackboard: missions.blackboard,
                objective: missions.objective
            })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(eq(missionRuns.id, missionRunId))
            .limit(1);

            if (!run || !run.missionContext) return;

            const context = run.missionContext as any;
            const blackboard = run.blackboard as any || {};
            
            // 1. Calculate rough token count (4 chars/token heuristic)
            const contextStr = JSON.stringify(context);
            const blackboardStr = JSON.stringify(blackboard);
            const totalChars = contextStr.length + blackboardStr.length;
            const approxTokens = totalChars / 4;

            if (approxTokens < TOKEN_THRESHOLD) {
                logger.debug(`[Pruning] Run ${missionRunId} is healthy (~${Math.round(approxTokens)} tokens).`);
                return;
            }

            logger.info(`[Pruning] Run ${missionRunId} exceeds threshold (~${Math.round(approxTokens)} tokens). Compressing...`);

            const prompt = `You are a Mission Context Compressor. 
Your goal is to reduce the token size of a mission's memory while preserving all critical strategic state.

MISSION OBJECTIVE: ${run.objective}
CURRENT PHASE: ${context.phase}

BLACKBOARD DATA:
${blackboardStr}

HISTORY/CONTEXT:
${contextStr}

TASK:
1. Identify outdated or redundant logs/research data.
2. Summarize the progress so far into a "Synthesized History".
3. Keep all active "Instruction Nodes", "Discovered Tools", and "Pending Approvals" EXACTLY as they are.
4. Return a JSON object representing the NEW compressed state.

Return ONLY the JSON:
{
    "newBlackboard": { ... },
    "newContext": { ... }
}`;

            // 2. Use Local SLM to summarize (Offload from Cloud)
            const { LocalSLMService } = await import("../../ai/core/local-slm.service.js");
            const resultJson = await LocalSLMService.execute('summarize', prompt);

            if (resultJson) {
                try {
                    const result = JSON.parse(resultJson);
                    if (result.newBlackboard && result.newContext) {
                        await db.transaction(async (tx) => {
                            await tx.update(missionRuns)
                                .set({
                                    missionContext: result.newContext,
                                    updatedAt: new Date()
                                })
                                .where(eq(missionRuns.id, missionRunId));
                            
                            if (run.missionId) {
                                await tx.update(missions)
                                    .set({
                                        blackboard: result.newBlackboard,
                                        updatedAt: new Date()
                                    })
                                    .where(eq(missions.id, run.missionId));
                            }
                        });
                        
                        const savedTokens = approxTokens - (resultJson.length / 4);
                        logger.info(`[Pruning] Successfully compressed Run ${missionRunId} using Local SLM. Saved ~${Math.round(savedTokens)} tokens.`);
                    }
                } catch (parseErr) {
                    logger.error(`[Pruning] Failed to parse SLM output: ${resultJson}`);
                }
            }

        } catch (err: any) {
            logger.error(`[Pruning] Failed for Run ${missionRunId}: ${err.message}`);
        }
    }
}
