import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, missions, cycleStrategicAudits } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { createLogger } from "@server/utils/logger.js";


import { searchService } from "@domain/knowledge/core/search/search-service.js";

const logger = createLogger("StrategicSentinel");

/**
 * Strategic Sentinel
 * 
 * Monitors the alignment between a Cycle's institutional objective and the 
 * actual tactical output of its agents. Detects "Strategic Drift" and
 * triggers autonomous governance actions (Pause, Pivot, or Alert).
 */
export class StrategicSentinelService {
    
    /**
     * Analyzes a cycle's current alignment based on recent mission traces.
     */
    static async auditCycleAlignment(cycleId: number): Promise<{
        alignmentScore: number; // 0-100
        driftReason?: string;
        isCriticalDrift: boolean;
    }> {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) throw new Error(`Cycle ${cycleId} not found`);

        // 1. Collect recent mission traces for this cycle
        const recentRuns = await db.select({
            name: missions.name,
            objective: missions.objective,
            trace: missionRuns.dynamicTrace,
            status: missionRuns.status
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .where(and(eq(missionRuns.cycleId, cycleId), eq(missionRuns.status, 'completed')))
        .orderBy(desc(missionRuns.createdAt))
        .limit(5);

        if (recentRuns.length === 0) {
            return { alignmentScore: 100, isCriticalDrift: false };
        }

        // 2. Synthesize the "Tactical Reality" from agent traces
        const tacticalSummary = recentRuns.map(r => 
            `Mission: ${r.name}\nGoal: ${r.objective}\nResult Trace: ${JSON.stringify(r.trace).substring(0, 500)}...`
        ).join('\n\n---\n\n');

        // 2.5 Semantic Search for Historical Baselines (GraphRAG Integration)
        let historicalContext = "No relevant historical missions found.";
        try {
            const searchResults = await searchService.executeHybridSearch(
                cycle.objective || "mission objective",
                cycle.organizationId,
                { maxResults: 3 }
            );
            
            const historicalMissions = searchResults.filter(r => r.type === 'mission' || r.type === 'document' || r.type === 'node').slice(0, 3);
            if (historicalMissions.length > 0) {
                historicalContext = historicalMissions.map(m => `Reference [${m.type} - ${m.title}]: ${m.description}`).join('\n');
            }
        } catch (e) {
            logger.warn(`[Sentinel] GraphRAG context retrieval failed: ${e}`);
        }

        // 3. Ask AI to evaluate the Alignment
        const prompt = `
            You are the ODDJOB STRATEGIC SENTINEL.
            
            INSTITUTIONAL OBJECTIVE:
            "${cycle.objective}"

            HISTORICAL GraphRAG BASELINES (Similar Past References):
            ${historicalContext}
            
            TACTICAL REALITY (Recent Mission Traces):
            ${tacticalSummary}
            
            TASK:
            Compare the Institutional Objective against the Tactical Reality, using the Historical Baselines as a reference for expected semantic trajectory.
            Determine if the agents are drifting away from the primary goal (e.g., getting distracted by side-tasks, hallucinating progress, or entering irrelevant loops).
            
            Return a JSON object:
            {
                "alignmentScore": 0-100,
                "analysis": "Brief explanation of the score, comparing against historical baseline if available",
                "isCriticalDrift": boolean,
                "suggestedAction": "CONTINUE" | "PAUSE_FOR_REVIEW" | "PIVOT"
            }
        `;

        try {
            const result = await systemAiService.generateJson(prompt, 'auditor');
            if (!result) throw new Error("Sentinel analysis returned no result");
            
            // 4. Persist findings to cycle strategic audits table
            await db.insert(cycleStrategicAudits).values({
                cycleId,
                alignmentScore: result.alignmentScore,
                analysis: result.analysis,
                suggestedAction: result.suggestedAction,
                isCriticalDrift: result.isCriticalDrift,
                metadata: {
                    historicalBaseline: historicalContext.substring(0, 1000)
                }
            });

            // 5. Update Cycle Outcome Metrics (Denormalized for quick access)
            const metrics = {
                ...(cycle.outcomeMetrics as any || {}),
                alignmentScore: result.alignmentScore,
                lastAuditAt: new Date().toISOString()
            };

            await db.update(operationalCycles)
                .set({ outcomeMetrics: metrics })
                .where(eq(operationalCycles.id, cycleId));

            if (result.isCriticalDrift) {
                logger.warn(`[Sentinel] CRITICAL DRIFT detected in Cycle ${cycleId}: ${result.analysis}`);
                // Auto-pause the cycle if drift is critical
                await db.update(operationalCycles)
                    .set({ status: 'paused' })
                    .where(eq(operationalCycles.id, cycleId));
            }

            return {
                alignmentScore: result.alignmentScore,
                driftReason: result.analysis,
                isCriticalDrift: result.isCriticalDrift
            };

        } catch (error) {
            logger.error(`[Sentinel] Audit failed for Cycle ${cycleId}:`, error);
            return { alignmentScore: 100, isCriticalDrift: false };
        }
    }

    /**
     * Heartbeat Fiscal Check
     * Terminates active missions if the cycle budget is exceeded.
     */
    static async enforceFiscalGuardrails(cycleId: number) {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        const currentSpend = parseFloat(String(cycle.currentSpendUsd || 0));
        const budgetLimit = parseFloat(String(cycle.budgetLimitUsd || 0));

        if (currentSpend >= budgetLimit && budgetLimit > 0) {
            logger.error(`[Sentinel] FISCAL BREACH: Cycle ${cycleId} exceeded budget ($${currentSpend} / $${cycle.budgetLimitUsd}). Terminating active missions.`);
            
            // 1. Pause the cycle
            await db.update(operationalCycles)
                .set({ status: 'paused' })
                .where(eq(operationalCycles.id, cycleId));

            // 2. Kill all active runs in this cycle
            await db.update(missionRuns)
                .set({ status: 'failed', failureReason: 'FISCAL_BREACH: Budget Limit Exceeded' })
                .where(and(eq(missionRuns.cycleId, cycleId), eq(missionRuns.status, 'active')));
        }
    }

}

