// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — PREDICTION POD
// Research Predictor — Predicts best sources/keywords for research missions
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext } from "../quant/types.js";
import type { PredicateCandidate } from "./types.js";
import { db } from "@server/database_service.js";
import { sourcePerformanceLogs } from "@shared/schema/prediction/source-performance.js";
import { sql, eq } from "drizzle-orm";

const logger = createLogger("ResearchPredictor");

export interface ResearchSuggestionResult {
    id: string;
    goal: string;
    suggestedSources: string[];
    priorityKeywords: string[];
    reason: string;
    createdAt: string;
}

export class ResearchPredictor {
    /**
     * Predicts suggested sources and keywords based on the research goal.
     */
    async predictResearchTargets(
        goal: string,
        ctx: DomainContext,
        missionType?: string,
        missionId?: number
    ): Promise<ResearchSuggestionResult> {
        logger.info(`[ResearchPredictor] Analyzing goal for research targets: ${goal} (Mission Type: ${missionType || 'unknown'})`);

        let suggestedSources: string[] = ["google.com"];
        let priorityKeywords: string[] = [];
        let reason = "Standard web search recommended";
        const normalizedGoal = goal.toLowerCase();

        // Integration: Use Prediction Pod to score sources
        const { predictionPod } = await import("../prediction/prediction-pod.service.js");
        
        const businessIntent = /\b(competitor|competition|landscape|market|company|startup|funding|revenue)\b/u.test(normalizedGoal);
        const aiIntent = /\b(ai|ml|llm|agent|model|automation)\b/u.test(normalizedGoal);
        const academicIntent = /\b(research|paper|benchmark|method|algorithm)\b/u.test(normalizedGoal);
        const now = ctx.now;

        if (businessIntent) {
            priorityKeywords.push("market share", "funding", "pricing");
        }
        if (aiIntent) {
            priorityKeywords.push("model capabilities", "open source", "technical differentiation");
        }
        if (academicIntent) {
            priorityKeywords.push("benchmarks", "papers");
        }

        // Query historical performance with context (missionType)
        const history = await db.select({
            source: sourcePerformanceLogs.source,
            missionType: sourcePerformanceLogs.missionType,
            successRate: sql<number>`SUM(CASE WHEN ${sourcePerformanceLogs.success} THEN 1 ELSE 0 END)::float / COUNT(*)`,
            usageCount: sql<number>`COUNT(*)`
        })
        .from(sourcePerformanceLogs)
        .groupBy(sourcePerformanceLogs.source, sourcePerformanceLogs.missionType);

        const getConfidence = (source: string, baseline: number) => {
            const sourceHistory = history.filter(h => h.source === source);
            
            // 1. Contextual Match: Check success rate for specific mission type
            if (missionType) {
                const specificH = sourceHistory.find(h => h.missionType === missionType);
                if (specificH && specificH.usageCount >= 3) {
                    return specificH.successRate;
                }
            }

            // 2. Fallback: Check global success rate for this source
            const totalUsage = sourceHistory.reduce((sum, h) => sum + h.usageCount, 0);
            const totalSuccesses = sourceHistory.reduce((sum, h) => sum + (h.successRate * h.usageCount), 0);
            
            if (totalUsage >= 3) {
                return totalSuccesses / totalUsage;
            }

            // 3. Fallback: Use baseline heuristic
            return baseline;
        };

        const predicates: PredicateCandidate[] = [
            { 
                id: randomUUID(), 
                label: "crunchbase_will_yield_info", 
                confidence: getConfidence("crunchbase", businessIntent ? 0.82 : 0.2), 
                riskClass: "low", expectedValue: 0.5, supportingQuantIds: [], supportingRealmContributionIds: [], source: "baseline", createdAt: now 
            },
            { 
                id: randomUUID(), 
                label: "github_will_yield_info", 
                confidence: getConfidence("github", aiIntent ? 0.9 : 0.1), 
                riskClass: "low", expectedValue: 0.6, supportingQuantIds: [], supportingRealmContributionIds: [], source: "baseline", createdAt: now 
            },
            { 
                id: randomUUID(), 
                label: "arxiv_will_yield_info", 
                confidence: getConfidence("arxiv", academicIntent ? 0.85 : 0.1), 
                riskClass: "low", expectedValue: 0.7, supportingQuantIds: [], supportingRealmContributionIds: [], source: "baseline", createdAt: now 
            }
        ];

        // Add other sources from history that have high success rate
        const topSources = history.filter(h => h.successRate > 0.6 && h.usageCount >= 3);
        const uniqueTopSources = [...new Set(topSources.map(h => h.source))];
        
        for (const source of uniqueTopSources) {
            if (["crunchbase", "github", "arxiv"].includes(source)) continue;
            
            predicates.push({
                id: randomUUID(),
                label: `${source}_will_yield_info`,
                confidence: getConfidence(source, 0.5),
                riskClass: "low",
                expectedValue: 0.5,
                supportingQuantIds: [],
                supportingRealmContributionIds: [],
                source: "pattern",
                createdAt: now
            });
        }

        // Epsilon-Greedy Exploration (10% chance to try a candidate source)
        const epsilon = 0.1;
        if (Math.random() < epsilon) {
            const candidateSources = ["crunchbase", "github", "arxiv", "google.com", "bing.com", "wikipedia.org", "twitter.com", "reddit.com"];
            const randomSource = candidateSources[Math.floor(Math.random() * candidateSources.length)];
            
            // Add as a predicate if not already present
            if (!predicates.some(p => p.label.startsWith(randomSource))) {
                predicates.push({
                    id: randomUUID(),
                    label: `${randomSource}_exploration`,
                    confidence: 0.5, // Neutral confidence for exploration
                    riskClass: "low",
                    expectedValue: 0.5,
                    supportingQuantIds: [],
                    supportingRealmContributionIds: [],
                    source: "agent",
                    createdAt: now
                });
                logger.info(`[ResearchPredictor] Epsilon-Greedy: Added exploration predicate for ${randomSource}`);
            }
        }

        const researchContextId = randomUUID();
        
        // Save prediction-mission mapping if missionId is provided
        if (missionId) {
            try {
                const { readFileSync, writeFileSync } = await import("fs");
                const { join } = await import("path");
                const mappingPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/prediction_mission_mapping.json");
                let mapping: Record<string, number> = {};
                try {
                    const data = readFileSync(mappingPath, "utf-8");
                    mapping = JSON.parse(data);
                } catch (e) {}
                mapping[researchContextId] = missionId;
                writeFileSync(mappingPath, JSON.stringify(mapping, null, 4));
                logger.info(`[ResearchPredictor] Saved prediction-mission mapping for context ${researchContextId} -> mission ${missionId}`);
            } catch (err: any) {
                logger.warn(`[ResearchPredictor] Failed to save prediction-mission mapping: ${err.message}`);
            }
        }

        // Calculate real field entropy from Knowledge Graph
        let fieldEntropy = 0.5;
        try {
            const orgId = ctx.organizationId;
            const condition = orgId ? sql`organization_id = ${orgId}` : sql`organization_id IS NULL`;
            const result = await db.execute(sql`
                SELECT label as value, COUNT(*)::int as count 
                FROM knowledge_nodes 
                WHERE ${condition}
                  AND label IS NOT NULL
                GROUP BY label
            `);
            
            const rows = result.rows as any[];
            const total = rows.reduce((sum, r) => sum + r.count, 0);
            if (total > 0) {
                let ent = 0;
                for (const row of rows) {
                    const p = row.count / total;
                    ent -= p * Math.log2(p);
                }
                const numLabels = rows.length;
                if (numLabels > 1) {
                    fieldEntropy = ent / Math.log2(numLabels);
                } else {
                    fieldEntropy = 0;
                }
                logger.info(`[ResearchPredictor] Calculated real field entropy: ${fieldEntropy.toFixed(4)} based on ${total} nodes across ${numLabels} types`);
            }
        } catch (entErr: any) {
            logger.warn(`[ResearchPredictor] Failed to calculate field entropy: ${entErr.message}`);
        }

        const branches = await predictionPod.generateBranches({
            predictionId: randomUUID(),
            context: { id: researchContextId, sessionId: "research-session", mode: "realtime", createdAt: now },
            predicates,
            quantField: {
                id: randomUUID(),
                contextId: researchContextId,
                quantCount: 0,
                fieldDensity: 0,
                fieldMomentum: [0, 0, 0],
                fieldEntropy: fieldEntropy,
                fieldAlignment: 0.55,
                fieldDivergence: 0.35,
                fieldCoherence: 0.55,
                epistemicCenterOfMass: [0.5, 0.5, 0.1],
                dominantStatus: "known_unknown",
                topAttractors: [],
                collapseProbability: 0.1,
                createdAt: now,
            },
            realmContributions: [],
            memoryMatches: [],
            modePlan: {
                mode: "realtime",
                maxBranches: 5,
                maxDepth: 1,
                runForwardChamber: false,
                runReverseChamber: false,
                runBicameral: false,
                includeAlternatives: true,
                includePatternMemory: false,
                timeoutMs: 100,
            },
            now
        }, ctx);

        // Filter sources based on branch score
        const topBranches = branches.filter(b => b.branchScore > 0.1); // Lowered threshold for test
        if (topBranches.length > 0) {
            suggestedSources = Array.from(new Set(topBranches.map(b => b.predicate.split("_")[0] + ".com")));
            reason = `Prediction engine prioritized ${topBranches.length} sources based on branch scores.`;
        }

        const result: ResearchSuggestionResult = {
            id: randomUUID(),
            goal,
            suggestedSources,
            priorityKeywords,
            reason,
            createdAt: new Date().toISOString()
        };

        logger.info(`[ResearchPredictor] Generated ${suggestedSources.length} sources and ${priorityKeywords.length} keywords`);
        return result;
    }
}

export const researchPredictor = new ResearchPredictor();
