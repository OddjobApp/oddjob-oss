/**
 * Prompt-Space Behavioral Steering — Vector Resolution Service
 *
 * Resolves a SteeringVector for each OODA cycle by composing signals from:
 *   1. Soul OCEAN traits     → behavioral dimensions
 *   2. Golden Path SOPs      → proven strategy snippets via RAG
 *   3. Human steering nudge  → explicit human directives
 *   4. Synthesis feedback     → α adjustment from last cycle's confidence
 *   5. State entropy          → current execution uncertainty
 *
 * The resolved vector is consumed by the thinking service to modulate the
 * system prompt — achieving prompt-space behavioral steering without
 * requiring access to transformer internals.
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns, knowledgeDocuments } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { OrchestrationContext } from "../../mission/core/orchestration/types.js";
import type {
  SteeringVector,
  SteeringDimension,
  SteeringConfig,
  SteeringTraceEntry,
} from "./steering-vector.types.js";
import { DEFAULT_STEERING_CONFIG } from "./steering-vector.types.js";

const logger = createLogger("SteeringVectorService");

/**
 * Maps OCEAN trait values into named behavioral dimensions.
 * Expands the 5D OCEAN vector into actionable steering dimensions.
 */
function oceanToBehavioralDimensions(oceanTraits: Record<string, number>): SteeringDimension[] {
  const now = new Date().toISOString();
  const dims: SteeringDimension[] = [];

  // Openness → creativity
  if (typeof oceanTraits.o === "number") {
    dims.push({ name: "creativity", weight: oceanTraits.o, source: "ocean", updatedAt: now });
  }
  // Conscientiousness → thoroughness
  if (typeof oceanTraits.c === "number") {
    dims.push({ name: "thoroughness", weight: oceanTraits.c, source: "ocean", updatedAt: now });
  }
  // Extraversion → verbosity (higher E → more explanatory output)
  if (typeof oceanTraits.e === "number") {
    dims.push({ name: "verbosity", weight: oceanTraits.e, source: "ocean", updatedAt: now });
  }
  // Agreeableness → compliance
  if (typeof oceanTraits.a === "number") {
    dims.push({ name: "compliance", weight: oceanTraits.a, source: "ocean", updatedAt: now });
  }
  // Neuroticism → risk_aversion (higher N → more cautious)
  if (typeof oceanTraits.n === "number") {
    dims.push({ name: "risk_aversion", weight: oceanTraits.n, source: "ocean", updatedAt: now });
  }

  return dims;
}

/**
 * Retrieves the most relevant Golden Path SOP for the given objective.
 * Returns the document ID and a compressed text snippet.
 */
async function retrieveGoldenPath(
  objective: string,
  orgId: number | null,
  maxTokens: number
): Promise<{ id: number; snippet: string } | null> {
  try {
    if (!orgId) return null;

    // Query Golden Path documents for this org, ordered by most recent
    const goldenPaths = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        textContent: knowledgeDocuments.textContent,
        createdAt: knowledgeDocuments.createdAt,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.organizationId, orgId),
          eq(knowledgeDocuments.sourceType, "golden_path")
        )
      )
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(5);

    if (goldenPaths.length === 0) return null;

    // Simple keyword overlap scoring (fast, <10ms)
    // For production, this should use embedding similarity via ragService
    const objectiveLower = objective.toLowerCase();
    const objectiveWords = new Set(
      objectiveLower
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    let bestMatch = goldenPaths[0];
    let bestScore = 0;

    for (const gp of goldenPaths) {
      const titleLower = (gp.title || "").toLowerCase();
      const contentLower = (gp.textContent || "").toLowerCase().slice(0, 2000);
      let score = 0;
      for (const word of objectiveWords) {
        if (titleLower.includes(word)) score += 3; // Title matches weight more
        if (contentLower.includes(word)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = gp;
      }
    }

    // Require minimum relevance
    if (bestScore < 2) return null;

    // Truncate to token budget (approx 4 chars per token)
    const maxChars = maxTokens * 4;
    const snippet = (bestMatch.textContent || "").slice(0, maxChars);

    return { id: bestMatch.id, snippet };
  } catch (err: any) {
    logger.warn(`[SteeringVector] Failed to retrieve Golden Path: ${err.message}`);
    return null;
  }
}

/**
 * Retrieves the most relevant Failed Trace / Anti-Pattern for the given objective.
 * Returns the document ID and a compressed text snippet (negative priors).
 */
async function retrieveAntiPattern(
  objective: string,
  orgId: number | null,
  maxTokens: number
): Promise<{ id: number; snippet: string } | null> {
  try {
    if (!orgId) return null;

    // Query Failed Trace documents for this org, ordered by most recent
    const failedTraces = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        textContent: knowledgeDocuments.textContent,
        createdAt: knowledgeDocuments.createdAt,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.organizationId, orgId),
          eq(knowledgeDocuments.sourceType, "failed_trace")
        )
      )
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(5);

    if (failedTraces.length === 0) return null;

    const objectiveLower = objective.toLowerCase();
    const objectiveWords = new Set(
      objectiveLower
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    let bestMatch = failedTraces[0];
    let bestScore = 0;

    for (const ft of failedTraces) {
      const titleLower = (ft.title || "").toLowerCase();
      const contentLower = (ft.textContent || "").toLowerCase().slice(0, 2000);
      let score = 0;
      for (const word of objectiveWords) {
        if (titleLower.includes(word)) score += 3;
        if (contentLower.includes(word)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = ft;
      }
    }

    if (bestScore < 2) return null;

    const maxChars = maxTokens * 4;
    const snippet = (bestMatch.textContent || "").slice(0, maxChars);

    return { id: bestMatch.id, snippet };
  } catch (err: any) {
    logger.warn(`[SteeringVector] Failed to retrieve Anti-Pattern: ${err.message}`);
    return null;
  }
}

export const steeringVectorService = {
  /**
   * Resolves a complete SteeringVector for the current OODA cycle.
   *
   * This is the central composition function that pulls from all steering
   * signal sources and produces a single typed vector consumed by the
   * thinking service.
   */
  async resolveSteeringVector(
    ctx: OrchestrationContext,
    config: Partial<SteeringConfig> = {}
  ): Promise<SteeringVector> {
    const cfg: SteeringConfig = { ...DEFAULT_STEERING_CONFIG, ...config };
    const now = new Date().toISOString();

    // --- 1. OCEAN Traits → Behavioral Dimensions ---
    let dimensions: SteeringDimension[] = [];
    try {
      // Try to get OCEAN traits from the app deployment (if launched via app)
      const viaAppSlug = ctx.blackboard?.viaAppSlug;
      if (viaAppSlug && ctx.orgId) {
        const { appRegistryService } = await import("../../apps/app-registry.service.js");
        const deployInfo = await appRegistryService.findDeploymentBySlug(viaAppSlug, ctx.orgId);
        if (deployInfo?.deployment?.oceanTraits) {
          dimensions = oceanToBehavioralDimensions(deployInfo.deployment.oceanTraits as Record<string, number>);
        }
      }
    } catch (err: any) {
      logger.warn(`[SteeringVector] Failed to resolve OCEAN traits: ${err.message}`);
    }

    // Fallback: add default neutral dimensions if none resolved
    if (dimensions.length === 0) {
      dimensions = [
        { name: "creativity", weight: 0.5, source: "default", updatedAt: now },
        { name: "thoroughness", weight: 0.5, source: "default", updatedAt: now },
        { name: "compliance", weight: 0.5, source: "default", updatedAt: now },
        { name: "risk_aversion", weight: 0.5, source: "default", updatedAt: now },
      ];
    }

    // --- 2. Golden Path SOP Retrieval ---
    let goldenPathId: number | undefined;
    let goldenPathSnippet: string | undefined;

    const shouldRetrieve =
      cfg.enableGoldenPathRetrieval &&
      (ctx.cycleCount <= 1 || cfg.enablePerCycleReRetrieval);

    if (shouldRetrieve) {
      // Check if we have a cached golden path from the previous cycle
      const cachedGpId = ctx.missionContext?._steeringGoldenPathId;
      const cachedGpSnippet = ctx.missionContext?._steeringGoldenPathSnippet;

      if (cachedGpId && cachedGpSnippet && !cfg.enablePerCycleReRetrieval) {
        goldenPathId = cachedGpId;
        goldenPathSnippet = cachedGpSnippet;
      } else {
        const result = await retrieveGoldenPath(ctx.objective, ctx.orgId, cfg.maxGoldenPathTokens);
        if (result) {
          goldenPathId = result.id;
          goldenPathSnippet = result.snippet;
        }
      }
    }

    // --- 2b. Failed Trace / Anti-Pattern Retrieval ---
    let antiPatternId: number | undefined;
    let antiPatternSnippet: string | undefined;

    const shouldRetrieveAntiPattern =
      cfg.enableAntiPatternRetrieval &&
      (ctx.cycleCount <= 1 || cfg.enablePerCycleReRetrieval);

    if (shouldRetrieveAntiPattern) {
      const cachedApId = ctx.missionContext?._steeringAntiPatternId;
      const cachedApSnippet = ctx.missionContext?._steeringAntiPatternSnippet;

      if (cachedApId && cachedApSnippet && !cfg.enablePerCycleReRetrieval) {
        antiPatternId = cachedApId;
        antiPatternSnippet = cachedApSnippet;
      } else {
        const result = await retrieveAntiPattern(ctx.objective, ctx.orgId, cfg.maxAntiPatternTokens);
        if (result) {
          antiPatternId = result.id;
          antiPatternSnippet = result.snippet;
        }
      }
    }

    // --- 3. Human Steering Nudge ---
    let humanNudge: string | undefined;
    try {
      const [mission] = await db
        .select({ humanSteeringNudge: missions.humanSteeringNudge })
        .from(missions)
        .where(eq(missions.id, ctx.missionId))
        .limit(1);
      if (mission?.humanSteeringNudge) {
        humanNudge = mission.humanSteeringNudge as string;
      }
    } catch (err: any) {
      logger.warn(`[SteeringVector] Failed to read humanSteeringNudge: ${err.message}`);
    }

    // --- 4. Resolve α ---
    // Priority: human override > synthesis feedback > decayed default
    let alpha = cfg.alphaDefault;

    // Check for explicit human α override
    const humanAlpha = ctx.missionContext?._steeringAlpha;
    if (typeof humanAlpha === "number" && humanAlpha >= 0 && humanAlpha <= 1) {
      alpha = humanAlpha;
    } else {
      // Apply synthesis confidence feedback from last cycle
      const lastSynthesisConfidence = ctx.missionContext?._lastSynthesisConfidence;
      if (typeof lastSynthesisConfidence === "number") {
        // Low synthesis confidence → steer harder; high → relax
        if (lastSynthesisConfidence < 0.5) {
          alpha = Math.min(1.0, alpha + 0.15);
        } else if (lastSynthesisConfidence > 0.8) {
          alpha = Math.max(0.2, alpha - 0.1);
        }
      }

      // Apply per-cycle decay (prevents stale steering lock-in)
      if (ctx.cycleCount > 1) {
        alpha = Math.max(0.1, alpha - cfg.alphaDecayPerCycle * (ctx.cycleCount - 1));
      }
    }

    // --- 5. State Entropy ---
    // Imported dynamically to avoid circular dependency
    let entropy = 0.1;
    try {
      // Use existing entropy from mission context if available, or calculate inline
      const cycleRatio = ctx.cycleCount / Math.max(1, ctx.maxCycles || 20);
      entropy = Math.min(1.0, 0.1 + cycleRatio * 0.3);
    } catch {
      // Fallback entropy
    }

    const vector: SteeringVector = {
      dimensions,
      alpha: Math.round(alpha * 100) / 100, // Round to 2 decimal places
      goldenPathId,
      goldenPathSnippet,
      antiPatternId,
      antiPatternSnippet,
      humanNudge,
      entropyAtResolution: Math.round(entropy * 1000) / 1000,
      resolvedAt: now,
    };

    logger.info(`[SteeringVector] Resolved for run ${ctx.missionRunId} cycle ${ctx.cycleCount}`, {
      alpha: vector.alpha,
      dimensionCount: vector.dimensions.length,
      hasGoldenPath: !!vector.goldenPathId,
      hasAntiPattern: !!vector.antiPatternId,
      hasHumanNudge: !!vector.humanNudge,
      entropy: vector.entropyAtResolution,
    });

    return vector;
  },

  /**
   * Builds the prompt injection block from a resolved steering vector.
   * Token budget is proportional to α.
   */
  buildSteeringBlock(vector: SteeringVector): string {
    if (vector.alpha < 0.1) return ""; // Below threshold — no steering

    const parts: string[] = [];

    // Golden Path SOP (highest-value positive injection)
    if (vector.goldenPathSnippet) {
      const effectiveMaxChars = Math.round(2000 * vector.alpha);
      parts.push(`\n## PROVEN STRATEGY (follow this approach)`);
      parts.push(vector.goldenPathSnippet.slice(0, effectiveMaxChars));
    }

    // Anti-Pattern / Failed Trace (highest-value negative constraint injection)
    if (vector.antiPatternSnippet) {
      const effectiveMaxChars = Math.round(1500 * vector.alpha);
      parts.push(`\n## PROVEN ANTI-PATTERNS (DO NOT ATTEMPT — known failure modes)`);
      parts.push(vector.antiPatternSnippet.slice(0, effectiveMaxChars));
    }

    // Behavioral dimensions as directive modifiers (only strong signals)
    const activeTraits = vector.dimensions
      .filter((d) => d.weight > 0.7 || d.weight < 0.3)
      .map((d) =>
        d.weight > 0.7
          ? `- Strongly prioritize ${d.name}`
          : `- Minimize ${d.name}`
      );
    if (activeTraits.length > 0) {
      parts.push(`\nBEHAVIORAL DIRECTIVES:`);
      parts.push(activeTraits.join("\n"));
    }

    // Human steering nudge (highest priority — always included)
    if (vector.humanNudge) {
      parts.push(`\nHUMAN DIRECTIVE (CRITICAL — override other guidance): ${vector.humanNudge}`);
    }

    return parts.length > 0 ? parts.join("\n") + "\n" : "";
  },

  /**
   * Creates a trace entry for logging steering decisions.
   */
  buildTraceEntry(vector: SteeringVector, cycle: number): SteeringTraceEntry {
    return {
      type: "steering",
      cycle,
      alpha: vector.alpha,
      dimensions: vector.dimensions.map((d) => ({ name: d.name, weight: d.weight })),
      goldenPathId: vector.goldenPathId,
      antiPatternId: vector.antiPatternId,
      hasHumanNudge: !!vector.humanNudge,
      entropy: vector.entropyAtResolution,
      timestamp: vector.resolvedAt,
    };
  },

  /**
   * Closed-loop calibration: Records critique feedback score (0-100) to adjust alpha and risk aversion.
   */
  async recordCritiqueFeedback(missionId: number, score: number, reasoning: string): Promise<void> {
    logger.info(`[SteeringVector] Recording critique feedback for mission ${missionId}: score ${score}/100`);
    const calibratedAlpha = score < 60 ? 0.85 : 0.5; // High steering intensity if low critique score
    try {
      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      await redis.setex(`steering:feedback:${missionId}`, 3600, JSON.stringify({
        score,
        reasoning: reasoning.slice(0, 300),
        calibratedAlpha,
        timestamp: new Date().toISOString(),
      }));
    } catch (err: any) {
      logger.warn(`Failed to store steering feedback in Redis: ${err.message}`);
    }
  },
};
