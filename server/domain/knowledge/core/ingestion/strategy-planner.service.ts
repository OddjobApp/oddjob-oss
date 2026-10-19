/**
 * Strategy Planner Service
 *
 * Generates a GatheringStrategy that determines which Source Collectors to invoke,
 * in what order, and with what parameters — based on the classified research subject,
 * existing Knowledge Graph context, and user-provided options.
 *
 * Uses an LLM call to intelligently plan collector invocations, then validates
 * and enforces structural invariants (ordering, limits, diversity rules).
 *
 * @module ingestion/strategy-planner
 */

import { createLogger } from "@server/utils/logger.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import type {
  ClassifiedInput,
  CollectorInvocation,
  GatheringStrategy,
  ResearchSubjectInput,
  SourceCollectorType,
} from "./types.js";
import { developmentProviderKey, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("StrategyPlanner");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Default maximum sources when not specified */
const DEFAULT_MAX_SOURCES = 20;

/** Default token budget when not specified */
const DEFAULT_TOKEN_BUDGET = 500_000;

/** Default timeout per collector invocation in ms */
const DEFAULT_COLLECTOR_TIMEOUT = 60_000;

/** Maximum time allowed for strategy generation in ms */
const STRATEGY_GENERATION_TIMEOUT_MS = 30_000;

/** All available collector types */
const ALL_COLLECTOR_TYPES: SourceCollectorType[] = [
  "web_scraper",
  "academic_search",
  "api_documentation_parser",
  "code_repository_scanner",
  "document_parser",
];

// ─── Service ───────────────────────────────────────────────────────────────────

export const strategyPlannerService = {
  /**
   * Generate a gathering strategy for the given classified input.
   *
   * Queries the Knowledge Graph for existing entities related to the subject,
   * then uses an LLM to plan which collectors to invoke and in what order.
   * Enforces structural invariants: maxSources limit, priority ordering,
   * URL-first rule, and topic diversity requirements.
   *
   * @param classifiedInput - The classified and validated research subject
   * @param orgContext - Organization context for scoping KG queries
   * @param options - Research configuration (maxSources, tokenBudget, enabledCollectors)
   * @returns A complete GatheringStrategy ready for execution
   * @throws Error if strategy generation exceeds 30-second timeout
   */
  async generateStrategy(
    classifiedInput: ClassifiedInput,
    orgContext: OrgContext,
    options: ResearchSubjectInput
  ): Promise<GatheringStrategy> {
    const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const enabledCollectors = options.enabledCollectors ?? ALL_COLLECTOR_TYPES;

    logger.info("Generating gathering strategy", {
      type: classifiedInput.type,
      subject: classifiedInput.normalizedValue,
      maxSources,
      tokenBudget,
      enabledCollectors,
    });

    // Enforce 30-second timeout on the entire strategy generation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STRATEGY_GENERATION_TIMEOUT_MS);

    try {
      // Step 1: Query KG for existing entities related to the subject
      const existingEntityCount = await queryExistingEntities(
        classifiedInput,
        orgContext
      );

      // Step 2: Generate collector invocations via LLM
      const rawInvocations = await planCollectorInvocations(
        classifiedInput,
        enabledCollectors,
        maxSources,
        tokenBudget,
        existingEntityCount,
        controller.signal
      );

      // Step 3: Validate and enforce invariants
      const collectors = enforceStrategyInvariants(
        rawInvocations,
        classifiedInput,
        enabledCollectors,
        maxSources
      );

      // Step 4: Build the strategy object
      const strategy: GatheringStrategy = {
        id: crypto.randomUUID(),
        researchSubject: classifiedInput,
        collectors,
        maxSources,
        tokenBudget,
        existingEntityCount,
        createdAt: new Date().toISOString(),
      };

      logger.info("Strategy generated successfully", {
        strategyId: strategy.id,
        collectorCount: collectors.length,
        existingEntityCount,
        types: [...new Set(collectors.map((c) => c.collectorType))],
      });

      return strategy;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        logger.error("Strategy generation timed out (>30s)", {
          subject: classifiedInput.normalizedValue,
        });
        throw new Error(
          "Strategy generation timed out. Try a simpler or more specific subject."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Query the Knowledge Graph for existing entities related to the research subject.
 * Falls back to 0 if the query fails (degraded mode).
 */
async function queryExistingEntities(
  classifiedInput: ClassifiedInput,
  orgContext: OrgContext
): Promise<number> {
  try {
    const { searchNodesSemantically } = await import(
      "../graph/graph-service.js"
    );

    const query =
      classifiedInput.type === "url"
        ? classifiedInput.normalizedValue
        : classifiedInput.normalizedValue;

    const existingNodes = await searchNodesSemantically(query, orgContext, 50);
    return existingNodes.length;
  } catch (error: unknown) {
    // Degraded mode: if KG query fails, proceed with 0 existing entities
    logger.warn("Failed to query Knowledge Graph for existing entities, proceeding with 0", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Use an LLM to plan which collectors to invoke and in what order.
 */
async function planCollectorInvocations(
  classifiedInput: ClassifiedInput,
  enabledCollectors: SourceCollectorType[],
  maxSources: number,
  tokenBudget: number,
  existingEntityCount: number,
  signal: AbortSignal
): Promise<CollectorInvocation[]> {
  try {
    const { systemAiService } = await import(
      "@domain/ai/core/system-ai.service.js"
    );
    const { AIClientFactory } = await import(
      "@domain/ai/core/ai-client.service.js"
    );

    const config = (await systemAiService.getAiConfig("copilot")) || {
      provider: "google",
      model: "gemini-2.0-flash",
    };

    const aiClient = AIClientFactory.getClient({
      provider: config.provider,
    } as any);

    const apiKey =
      config.apiKey ||
      (config.provider === "google"
        ? await resolveOrgGeminiKey(null)
        : developmentProviderKey("openai")) ||
      "";

    if (!apiKey) {
      logger.warn("No API key for strategy planning, using heuristic fallback");
      return buildHeuristicInvocations(
        classifiedInput,
        enabledCollectors,
        maxSources
      );
    }

    const systemPrompt = buildStrategySystemPrompt();
    const userPrompt = buildStrategyUserPrompt(
      classifiedInput,
      enabledCollectors,
      maxSources,
      tokenBudget,
      existingEntityCount
    );

    const res = await aiClient.execute(
      {
        model: config.model,
        systemPrompt,
        userPrompt,
        provider: config.provider as any,
        requestType: "json",
      } as any,
      userPrompt,
      apiKey
    );

    if (!res.success || !res.output) {
      logger.warn("LLM strategy planning returned no output, using heuristic fallback");
      return buildHeuristicInvocations(
        classifiedInput,
        enabledCollectors,
        maxSources
      );
    }

    // Parse the LLM response
    const cleanOutput = res.output.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanOutput);

    if (!Array.isArray(parsed.invocations) || parsed.invocations.length === 0) {
      logger.warn("LLM returned empty invocations, using heuristic fallback");
      return buildHeuristicInvocations(
        classifiedInput,
        enabledCollectors,
        maxSources
      );
    }

    // Map LLM output to CollectorInvocation objects
    return parsed.invocations.map(
      (inv: any, index: number): CollectorInvocation => ({
        id: crypto.randomUUID(),
        collectorType: inv.collectorType as SourceCollectorType,
        query: inv.query || classifiedInput.normalizedValue,
        priority: inv.priority ?? index + 1,
        estimatedYield: clampYield(inv.estimatedYield ?? 0.5),
        timeout: inv.timeout ?? DEFAULT_COLLECTOR_TIMEOUT,
        metadata: inv.metadata,
      })
    );
  } catch (error: unknown) {
    if (signal.aborted) throw new Error("Strategy generation aborted");

    logger.warn("LLM strategy planning failed, using heuristic fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return buildHeuristicInvocations(
      classifiedInput,
      enabledCollectors,
      maxSources
    );
  }
}

/**
 * Build the system prompt for the LLM strategy planner.
 */
function buildStrategySystemPrompt(): string {
  return `You are a Research Strategy Planner. Given a research subject, you plan which source collectors to invoke and in what order to gather comprehensive information.

You output ONLY valid JSON with the following structure:
{
  "invocations": [
    {
      "collectorType": "web_scraper" | "academic_search" | "api_documentation_parser" | "code_repository_scanner" | "document_parser",
      "query": "The search query or URL to pass to this collector",
      "priority": <number, lower = execute first>,
      "estimatedYield": <number 0.0-1.0, how relevant this source is expected to be>,
      "timeout": <number in ms, default 60000>,
      "metadata": <optional object with collector-specific config>
    }
  ]
}

Rules:
- Order invocations by priority (ascending).
- Assign estimatedYield based on how likely the collector is to return relevant results.
- For URL subjects: the first invocation MUST be web_scraper targeting that exact URL.
- For topic subjects: include at least 2 different collector types for diversity.
- Do not exceed the maxSources limit in total invocations.
- Only use collectors from the enabled list.
- Tailor search queries to be effective for each collector type.`;
}

/**
 * Build the user prompt for the LLM strategy planner.
 */
function buildStrategyUserPrompt(
  classifiedInput: ClassifiedInput,
  enabledCollectors: SourceCollectorType[],
  maxSources: number,
  tokenBudget: number,
  existingEntityCount: number
): string {
  return `Plan a research gathering strategy for the following:

Subject Type: ${classifiedInput.type}
Subject Value: ${classifiedInput.normalizedValue}
Original Input: ${classifiedInput.value}

Constraints:
- Maximum sources: ${maxSources}
- Token budget: ${tokenBudget}
- Enabled collectors: ${JSON.stringify(enabledCollectors)}
- Existing KG entities for this subject: ${existingEntityCount}

${classifiedInput.type === "url" ? "IMPORTANT: The first invocation MUST be web_scraper targeting this exact URL." : "IMPORTANT: Include at least 2 different collector types for comprehensive coverage."}

${existingEntityCount > 0 ? `Note: There are already ${existingEntityCount} entities in the Knowledge Graph related to this subject. Focus on finding NEW information not already captured.` : ""}

Return your strategy as JSON.`;
}

/**
 * Build a heuristic-based strategy when LLM is unavailable.
 */
function buildHeuristicInvocations(
  classifiedInput: ClassifiedInput,
  enabledCollectors: SourceCollectorType[],
  maxSources: number
): CollectorInvocation[] {
  const invocations: CollectorInvocation[] = [];

  if (classifiedInput.type === "url") {
    // URL input: start with web scraper targeting the URL directly
    if (enabledCollectors.includes("web_scraper")) {
      invocations.push({
        id: crypto.randomUUID(),
        collectorType: "web_scraper",
        query: classifiedInput.normalizedValue,
        priority: 1,
        estimatedYield: 0.95,
        timeout: DEFAULT_COLLECTOR_TIMEOUT,
      });
    }

    // Add supplementary collectors for context around the URL
    const supplementary: Array<{
      type: SourceCollectorType;
      yield: number;
    }> = [
      { type: "academic_search", yield: 0.4 },
      { type: "api_documentation_parser", yield: 0.3 },
      { type: "code_repository_scanner", yield: 0.3 },
    ];

    let priority = 2;
    for (const s of supplementary) {
      if (invocations.length >= maxSources) break;
      if (enabledCollectors.includes(s.type)) {
        invocations.push({
          id: crypto.randomUUID(),
          collectorType: s.type,
          query: classifiedInput.value,
          priority: priority++,
          estimatedYield: s.yield,
          timeout: DEFAULT_COLLECTOR_TIMEOUT,
        });
      }
    }
  } else {
    // Topic input: distribute across multiple collector types
    const topicCollectors: Array<{
      type: SourceCollectorType;
      yield: number;
    }> = [
      { type: "web_scraper", yield: 0.8 },
      { type: "academic_search", yield: 0.75 },
      { type: "code_repository_scanner", yield: 0.6 },
      { type: "api_documentation_parser", yield: 0.5 },
      { type: "document_parser", yield: 0.4 },
    ];

    let priority = 1;
    for (const tc of topicCollectors) {
      if (invocations.length >= maxSources) break;
      if (enabledCollectors.includes(tc.type)) {
        invocations.push({
          id: crypto.randomUUID(),
          collectorType: tc.type,
          query: classifiedInput.normalizedValue,
          priority: priority++,
          estimatedYield: tc.yield,
          timeout: DEFAULT_COLLECTOR_TIMEOUT,
        });
      }
    }
  }

  return invocations;
}

/**
 * Enforce all structural invariants on the generated invocations:
 * - Filter to only enabled collector types
 * - Cap at maxSources
 * - For URL inputs: ensure first invocation is web_scraper targeting the URL
 * - For topic inputs: ensure at least 2 distinct collector types
 * - Order by ascending priority
 * - Clamp estimatedYield to [0, 1]
 */
function enforceStrategyInvariants(
  invocations: CollectorInvocation[],
  classifiedInput: ClassifiedInput,
  enabledCollectors: SourceCollectorType[],
  maxSources: number
): CollectorInvocation[] {
  // Filter to only enabled collector types
  let filtered = invocations.filter((inv) =>
    enabledCollectors.includes(inv.collectorType)
  );

  // Enforce URL-first rule
  if (classifiedInput.type === "url") {
    const urlScraperIndex = filtered.findIndex(
      (inv) =>
        inv.collectorType === "web_scraper" &&
        inv.query === classifiedInput.normalizedValue
    );

    if (urlScraperIndex > 0) {
      // Move to front
      const [urlScraper] = filtered.splice(urlScraperIndex, 1);
      urlScraper.priority = 0;
      filtered.unshift(urlScraper);
    } else if (urlScraperIndex === -1 && enabledCollectors.includes("web_scraper")) {
      // Insert at front if missing
      filtered.unshift({
        id: crypto.randomUUID(),
        collectorType: "web_scraper",
        query: classifiedInput.normalizedValue,
        priority: 0,
        estimatedYield: 0.95,
        timeout: DEFAULT_COLLECTOR_TIMEOUT,
      });
    }
  }

  // Enforce topic diversity: at least 2 distinct collector types
  if (classifiedInput.type === "topic") {
    const distinctTypes = new Set(filtered.map((inv) => inv.collectorType));
    if (distinctTypes.size < 2 && enabledCollectors.length >= 2) {
      // Find a collector type not yet included
      const missingType = enabledCollectors.find(
        (t) => !distinctTypes.has(t)
      );
      if (missingType) {
        filtered.push({
          id: crypto.randomUUID(),
          collectorType: missingType,
          query: classifiedInput.normalizedValue,
          priority: filtered.length + 1,
          estimatedYield: 0.5,
          timeout: DEFAULT_COLLECTOR_TIMEOUT,
        });
      }
    }
  }

  // Sort by ascending priority
  filtered.sort((a, b) => a.priority - b.priority);

  // Re-assign priority sequentially to avoid gaps
  filtered.forEach((inv, index) => {
    inv.priority = index + 1;
  });

  // Clamp estimatedYield to [0, 1]
  filtered.forEach((inv) => {
    inv.estimatedYield = clampYield(inv.estimatedYield);
  });

  // Cap at maxSources
  if (filtered.length > maxSources) {
    filtered = filtered.slice(0, maxSources);
  }

  return filtered;
}

/**
 * Clamp a yield value to [0, 1] range.
 */
function clampYield(value: number): number {
  if (typeof value !== "number" || isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
