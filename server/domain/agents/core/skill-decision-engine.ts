/**
 * Skill Decision Engine
 *
 * Implements multi-factor compatibility scoring and intelligent decision routing
 * for external AI skills entering the Oddjob multi-agent ecosystem.
 *
 * Scoring Dimensions (0 - 100 total):
 *   1. Capability Overlap (25 pts): exact & stemmed semantic token matching
 *   2. Persona Alignment  (25 pts): persona type, topic & intent affinities
 *   3. Tool Compatibility (25 pts): tool set intersection & capacity health
 *   4. Risk Assessment    (25 pts): inverse security risk weighting
 *
 * Decision Thresholds:
 *   - 80 - 100: Augment Existing Agent
 *   - 60 - 79:  Assign to Multiple Agents / Review
 *   - 40 - 59:  Hybrid (Targeted Augmentation / Variant)
 *   - 0 - 39:   Create New Specialized Agent
 */

import { db } from "@server/database_service.js";
import { agentCards, type AgentCardRecord } from "@shared/schema/agent-cards.js";
import type {
    SkillScoringBreakdown,
    SkillAgentMatch,
    SkillDecisionRecommendation,
} from "@shared/schema/skill-integration.js";
import { eq, and } from "drizzle-orm";

export interface SkillEvaluationInput {
    name: string;
    description?: string | null;
    persona?: string | null;
    capabilities?: string[] | null;
    tools?: string[] | null;
    tags?: string[] | null;
    securityReport?: {
        riskLevel?: "low" | "medium" | "high";
        score?: number;
        findings?: { type: string; message: string; severity: string }[];
    } | null;
}

export interface SkillEvaluationResult {
    overallRecommendation: SkillDecisionRecommendation;
    topMatches: SkillAgentMatch[];
    bestMatch: SkillAgentMatch | null;
    targetAgentCardId: number | null;
    compatibilityScore: number;
    scoringBreakdown: SkillScoringBreakdown | null;
}

export class SkillDecisionEngine {
    /**
     * Stem a token to its approximate root for semantic comparison.
     */
    private static stemToken(word: string): string {
        return word
            .toLowerCase()
            .replace(/^(re|un|in|non|multi|auto)/, "")
            .replace(/(ing|tion|sion|ation|ment|able|ible|ive|ize|ise|yze|yzed|ysis|ytic|ed|es|ate|ies|s)$/, "")
            .replace(/y$/, "i");
    }

    /**
     * Compute string similarity between two capability or topic phrases
     * using stemmed tokenized Jaccard similarity.
     */
    static computeTokenSimilarity(strA: string, strB: string): number {
        const tokenize = (s: string) =>
            new Set(
                s
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, "")
                    .split(/\s+/)
                    .filter((w) => w.length > 2)
                    .map((w) => this.stemToken(w))
            );

        const setA = tokenize(strA);
        const setB = tokenize(strB);

        if (setA.size === 0 || setB.size === 0) return 0;

        let intersection = 0;
        for (const token of setA) {
            if (setB.has(token)) intersection++;
        }

        const union = setA.size + setB.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    /**
     * Dimension 1: Capability Overlap (25 pts maximum)
     */
    static scoreCapabilityOverlap(
        skillCaps: string[],
        agentCaps: string[]
    ): {
        score: number;
        matchedCapabilities: string[];
        newCapabilities: string[];
        semanticConfidence: number;
    } {
        if (!skillCaps || skillCaps.length === 0) {
            return {
                score: 5,
                matchedCapabilities: [],
                newCapabilities: [],
                semanticConfidence: 0.2,
            };
        }

        const normAgent = agentCaps.map((c) => c.toLowerCase().trim());
        const matched: string[] = [];
        const newCaps: string[] = [];
        let totalSemanticScore = 0;

        for (const cap of skillCaps) {
            const normCap = cap.toLowerCase().trim();
            // 1. Exact match
            if (normAgent.includes(normCap)) {
                matched.push(cap);
                totalSemanticScore += 1.0;
                continue;
            }

            // 2. Stemmed semantic token overlap
            let bestSim = 0;
            for (const ac of agentCaps) {
                const sim = this.computeTokenSimilarity(normCap, ac);
                if (sim > bestSim) bestSim = sim;
            }

            if (bestSim >= 0.3) {
                matched.push(cap);
                totalSemanticScore += Math.min(1.0, bestSim * 1.25);
            } else {
                newCaps.push(cap);
                totalSemanticScore += Math.max(0, bestSim);
            }
        }

        const overlapFraction = Math.min(1.0, totalSemanticScore / Math.max(1, skillCaps.length));
        const score = Math.round(overlapFraction * 25);

        return {
            score,
            matchedCapabilities: matched,
            newCapabilities: newCaps,
            semanticConfidence: Number(overlapFraction.toFixed(2)),
        };
    }

    /**
     * Dimension 2: Persona Alignment (25 pts maximum)
     */
    static scorePersonaAlignment(
        skill: SkillEvaluationInput,
        agent: AgentCardRecord
    ): number {
        let pts = 0;

        const skillText = [
            skill.persona || "",
            skill.description || "",
            ...(skill.tags || []),
        ]
            .join(" ")
            .toLowerCase();

        // 1. Persona type matching (up to 10 pts)
        if (agent.personaType && skillText.includes(agent.personaType.toLowerCase())) {
            pts += 10;
        } else if (skill.persona && agent.description) {
            const sim = this.computeTokenSimilarity(skill.persona, agent.description);
            pts += Math.round(sim * 10);
        }

        // 2. Topic affinities alignment (up to 10 pts)
        const agentTopics = (agent.topicAffinities as string[]) || [];
        if (agentTopics.length > 0) {
            let matchedTopics = 0;
            for (const topic of agentTopics) {
                if (skillText.includes(topic.toLowerCase())) {
                    matchedTopics++;
                }
            }
            const topicRatio = matchedTopics / agentTopics.length;
            pts += Math.round(topicRatio * 10);
        }

        // 3. Archetype / Soul alignment (up to 5 pts)
        if (agent.soulArchetype && skillText.includes(agent.soulArchetype.toLowerCase())) {
            pts += 5;
        }

        return Math.min(25, Math.max(0, pts));
    }

    /**
     * Dimension 3: Tool Compatibility (25 pts maximum)
     */
    static scoreToolCompatibility(
        skillTools: string[],
        agentTools: string[]
    ): {
        score: number;
        matchedTools: string[];
        newTools: string[];
    } {
        if (!skillTools || skillTools.length === 0) {
            return { score: 15, matchedTools: [], newTools: [] };
        }

        const normAgentTools = (agentTools || []).map((t) => t.toLowerCase().trim());
        const matched: string[] = [];
        const newTools: string[] = [];

        for (const tool of skillTools) {
            const norm = tool.toLowerCase().trim();
            if (normAgentTools.includes(norm)) {
                matched.push(tool);
            } else {
                newTools.push(tool);
            }
        }

        const currentToolCount = agentTools?.length || 0;
        const capacityRemaining = Math.max(0, 30 - currentToolCount);

        let capacityScore = 15;
        if (capacityRemaining < newTools.length) {
            capacityScore = Math.max(0, Math.round((capacityRemaining / Math.max(1, newTools.length)) * 15));
        }

        const synergyScore = matched.length > 0 ? 10 : 5;
        const score = Math.min(25, capacityScore + synergyScore);

        return {
            score,
            matchedTools: matched,
            newTools: newTools,
        };
    }

    /**
     * Dimension 4: Risk Assessment (25 pts maximum)
     */
    static scoreRiskAssessment(securityReport?: SkillEvaluationInput["securityReport"]): number {
        if (!securityReport) return 20;

        const level = securityReport.riskLevel || "medium";
        let base = level === "low" ? 25 : level === "medium" ? 15 : 5;

        if (securityReport.findings && Array.isArray(securityReport.findings)) {
            for (const finding of securityReport.findings) {
                if (finding.severity === "high" || finding.type === "secret") {
                    base = Math.max(0, base - 5);
                }
            }
        }

        return Math.min(25, Math.max(0, base));
    }

    /**
     * Evaluate compatibility between an input skill and a single Agent Card.
     */
    static evaluateMatch(
        skill: SkillEvaluationInput,
        agent: AgentCardRecord
    ): SkillAgentMatch {
        const skillCaps = skill.capabilities || [];
        const agentCaps = (agent.capabilities as string[]) || [];
        const skillTools = skill.tools || [];
        const agentTools = (agent.tools as string[]) || [];

        const capResult = this.scoreCapabilityOverlap(skillCaps, agentCaps);
        const personaScore = this.scorePersonaAlignment(skill, agent);
        const toolResult = this.scoreToolCompatibility(skillTools, agentTools);
        const riskScore = this.scoreRiskAssessment(skill.securityReport);

        // Core Alignment Gate: if capability overlap and persona alignment are zero,
        // the skill is unrelated; don't let tool capacity & risk alone inflate the score.
        let rawScore = capResult.score + personaScore + toolResult.score + riskScore;
        const coreAlignment = capResult.score + personaScore;
        if (coreAlignment === 0) {
            rawScore = Math.min(30, Math.round(rawScore * 0.4));
        } else if (coreAlignment < 10) {
            rawScore = Math.min(45, Math.round(rawScore * 0.7));
        }

        const totalScore = Math.min(100, Math.max(0, rawScore));

        const breakdown: SkillScoringBreakdown = {
            capabilityOverlap: capResult.score,
            personaAlignment: personaScore,
            toolCompatibility: toolResult.score,
            riskScore: riskScore,
            totalScore: totalScore,
            matchedCapabilities: capResult.matchedCapabilities,
            newCapabilities: capResult.newCapabilities,
            matchedTools: toolResult.matchedTools,
            newTools: toolResult.newTools,
            semanticConfidence: capResult.semanticConfidence,
        };

        const recommendation = this.getRecommendationForScore(totalScore);

        return {
            agentCardId: agent.id,
            agentName: agent.name,
            score: totalScore,
            breakdown,
            recommendation,
        };
    }

    /**
     * Determine recommendation action based on score thresholds.
     */
    static getRecommendationForScore(score: number): SkillDecisionRecommendation {
        if (score >= 80) return "augment_existing";
        if (score >= 60) return "assign_multiple";
        if (score >= 40) return "hybrid";
        return "create_new_agent";
    }

    /**
     * Rank all agent cards in an organization against a skill payload.
     */
    static rankAgents(
        skill: SkillEvaluationInput,
        agentList: AgentCardRecord[]
    ): SkillEvaluationResult {
        if (!agentList || agentList.length === 0) {
            return {
                overallRecommendation: "create_new_agent",
                topMatches: [],
                bestMatch: null,
                targetAgentCardId: null,
                compatibilityScore: 0,
                scoringBreakdown: null,
            };
        }

        const matches: SkillAgentMatch[] = agentList.map((agent) =>
            this.evaluateMatch(skill, agent)
        );

        matches.sort((a, b) => b.score - a.score);

        const bestMatch = matches[0] ?? null;
        const topScore = bestMatch?.score ?? 0;
        const overallRecommendation = this.getRecommendationForScore(topScore);

        return {
            overallRecommendation,
            topMatches: matches.slice(0, 5),
            bestMatch,
            targetAgentCardId: topScore >= 60 && bestMatch ? bestMatch.agentCardId : null,
            compatibilityScore: topScore,
            scoringBreakdown: bestMatch?.breakdown ?? null,
        };
    }

    /**
     * Analyze a skill payload against all agent cards for a specific organization in the DB.
     */
    static async analyzeForOrganization(
        skill: SkillEvaluationInput,
        organizationId: number
    ): Promise<SkillEvaluationResult> {
        const orgAgents = await db
            .select()
            .from(agentCards)
            .where(and(eq(agentCards.organizationId, organizationId), eq(agentCards.enabled, true)));

        return this.rankAgents(skill, orgAgents);
    }
}
