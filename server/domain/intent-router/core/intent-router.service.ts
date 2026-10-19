/**
 * Intent Router Classification Service
 * Classifies user prompts along Topic × Intent axes using keyword/pattern matching.
 * Provides fast (<150ms) classification for the MoE routing pipeline.
 *
 * Requirements: 8.6, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4
 */

import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import type { TopicCategory, IntentCategory } from "@shared/schema/intent-router.js";
import {
  intentClassificationLogs,
  type ClassificationResult,
  type ClassifyRequest,
} from "@shared/schema/intent-router.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";
import { classificationCacheService, ClassificationCacheService } from "./classification-cache.service.js";
import { modelResolverService, type ModelResolutionResult } from "./model-resolver.service.js";
import { db } from "@server/database_service.js";
import { llmRouterService } from "@server/domain/ai/core/llm-router.service.js";
import { theoryOfMindService } from "@server/domain/agents/core/theory-of-mind.service.js";

const logger = createLogger("IntentRouterService");

export interface CognitiveModulation {
  escalateToHuman: boolean;
  autonomyLevel: "autonomous" | "supervised" | "human_approval_required";
  recommendedPersona: "direct_concise" | "structured_clarifier" | "empathic_orchestrator" | "default";
  cognitiveSnapshot: {
    frustration: number;
    confusion: number;
    urgency: number;
    explorationVsGoal: number;
  };
  guidancePrompt: string;
}

// ============================================================================
// KEYWORD MAPS
// ============================================================================

/**
 * Topic classification keywords.
 * Each topic maps to an array of keyword patterns (lowercase).
 * Order matters for tie-breaking: first registered category wins.
 */
const TOPIC_KEYWORDS: Record<Exclude<TopicCategory, "General">, string[]> = {
  Code: [
    "code", "function", "debug", "compile", "syntax", "algorithm",
    "programming", "developer", "typescript", "javascript", "python",
    "java", "rust", "golang", "api", "endpoint", "refactor", "bug",
    "class", "interface", "module", "import", "variable", "loop",
    "array", "object", "string", "number", "boolean", "async",
    "promise", "callback", "error handling", "unit test", "test",
    "git", "commit", "branch", "merge", "deploy", "ci/cd", "docker",
    "kubernetes", "database", "sql", "query", "schema", "migration",
  ],
  "Real Estate": [
    "property", "mortgage", "lease", "tenant", "landlord", "rental",
    "real estate", "apartment", "house", "condo", "building",
    "zoning", "appraisal", "closing", "escrow", "deed",
    "commercial property", "residential", "square feet", "sqft",
    "mls", "listing", "broker", "realtor", "home inspection",
  ],
  Legal: [
    "legal", "law", "attorney", "lawyer", "contract", "clause",
    "litigation", "court", "plaintiff", "defendant", "statute",
    "regulation", "compliance", "intellectual property", "patent",
    "trademark", "copyright", "liability", "tort", "filing",
    "jurisdiction", "precedent", "brief", "deposition", "arbitration",
  ],
  Media: [
    "media", "video", "audio", "podcast", "film", "animation",
    "photography", "editing", "production", "broadcast", "streaming",
    "content creation", "social media", "youtube", "thumbnail",
    "graphic design", "illustration", "render", "vfx", "3d model",
  ],
  Finance: [
    "finance", "investment", "stock", "bond", "portfolio", "dividend",
    "revenue", "profit", "budget", "accounting", "tax", "audit",
    "cryptocurrency", "blockchain", "trading", "market", "fund",
    "asset", "liability", "balance sheet", "income statement",
    "cash flow", "roi", "interest rate", "inflation", "gdp",
  ],
  Health: [
    "health", "medical", "patient", "diagnosis", "treatment",
    "symptoms", "prescription", "therapy", "surgery", "clinical",
    "hospital", "doctor", "nurse", "pharmaceutical", "drug",
    "wellness", "nutrition", "exercise", "mental health", "vaccine",
    "disease", "chronic", "acute", "healthcare", "insurance claim",
  ],
};

/**
 * Intent classification keywords.
 * Order matches the registered category order for tie-breaking.
 */
const INTENT_KEYWORDS: Record<Exclude<IntentCategory, "Chat">, string[]> = {
  "Image Generation": [
    "generate image", "draw", "create picture", "create image",
    "make an image", "design a logo", "illustrate", "sketch",
    "render image", "create art", "make art", "generate art",
    "create a poster", "make a graphic", "generate a photo",
    "dall-e", "midjourney", "stable diffusion", "image of",
    "picture of", "photo of", "painting of", "draw me",
  ],
  Video: [
    "create video", "generate video", "make a video", "video of",
    "animate", "animation", "motion graphics", "video editing",
    "clip", "footage", "film this", "record", "produce video",
    "video generation", "make a clip", "short video",
  ],
  "Code Execution": [
    "run this code", "execute", "run the script", "compile and run",
    "eval", "run this", "execute this", "test this code",
    "run the program", "execute the function", "run it",
    "code execution", "run my code", "execute my code",
  ],
  Analysis: [
    "analyze", "compare", "evaluate", "assess", "review",
    "summarize", "break down", "explain", "interpret",
    "what does this mean", "deep dive", "investigate",
    "research", "study", "examine", "inspect", "audit",
    "benchmark", "measure", "correlate", "trend",
  ],
  Alert: [
    "alert me", "notify", "remind me", "set alert",
    "warning", "watch for", "monitor", "trigger when",
    "alert when", "notify when", "let me know when",
    "set a reminder", "flag this", "track this",
  ],
  Search: [
    "search", "find", "look up", "lookup", "google",
    "search for", "find me", "locate", "where is",
    "how to find", "search the web", "web search",
    "find information", "look for", "search online",
  ],
  "Document Authoring": [
    "write", "draft", "compose", "author", "document",
    "sow", "statement of work", "proposal", "rfp", "rfi",
    "contract", "agreement", "msa", "nda", "sla",
    "business case", "business plan", "justification",
    "sop", "standard operating procedure", "runbook",
    "memo", "memorandum", "brief", "briefing",
    "report", "whitepaper", "white paper",
    "pitch deck", "pitch", "deck",
    "press release", "pr/faq", "prfaq",
    "architecture document", "design document", "rfc",
    "template", "outline", "scaffold",
    "scribe", "manuscript", "longform",
  ],
};

// ============================================================================
// REGISTERED CATEGORY ORDERS (for tie-breaking)
// ============================================================================

const TOPIC_ORDER: TopicCategory[] = [
  "Code", "Real Estate", "Legal", "Media", "Finance", "Health", "General",
];

const INTENT_ORDER: IntentCategory[] = [
  "Image Generation", "Video", "Code Execution", "Analysis", "Alert", "Document Authoring", "Chat", "Search",
];

// ============================================================================
// CONFIDENCE THRESHOLDS
// ============================================================================

const TOPIC_CONFIDENCE_THRESHOLD = 0.4;
const INTENT_CONFIDENCE_THRESHOLD = 0.4;

// ============================================================================
// SERVICE
// ============================================================================

export class IntentRouterService {
  /**
   * Full classification pipeline: cache check → parallel classification → agent selection → model resolution → cache write → log to DB.
   * Performance budget: <150ms for ≤2000 chars, <300ms for 2001-10000 chars.
   *
   * Requirements: 8.6, 9.4, 10.1, 10.2, 10.3, 10.4
   */
  async classify(request: ClassifyRequest): Promise<ClassificationResult> {
    const startTime = performance.now();
    const { prompt, organizationId, sessionId, bypassCache } = request;

    // Input validation
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("Prompt content is required for classification");
    }

    const promptHash = ClassificationCacheService.hashPrompt(prompt);

    // 1. Cache check (skip if bypassCache is true)
    if (!bypassCache) {
      const cached = await classificationCacheService.get(sessionId, promptHash);
      if (cached) {
        // Validate that the referenced agent card is still enabled
        const agentCard = await agentCardService.getById(organizationId, cached.selectedAgentCardId);
        if (agentCard && agentCard.enabled) {
          // Cache hit with valid agent — log and return
          const latencyMs = Math.round(performance.now() - startTime);
          await this.logClassification({
            organizationId,
            sessionId,
            promptHash,
            result: { ...cached, latencyMs },
            wasCached: true,
          });
          return { ...cached, latencyMs };
        }

        // Agent disabled — invalidate this cache entry and re-classify
        await classificationCacheService.invalidate(sessionId, promptHash);
      }
    }

    // 2. Parallel classification: Topic × Intent
    const [topicResult, intentResult] = await Promise.all([
      this.classifyTopic(prompt),
      this.classifyIntent(prompt),
    ]);

    // 3. Agent selection
    const selectedAgent = await this.selectAgent(
      organizationId,
      topicResult.topic,
      intentResult.intent,
    );

    // 4. Model resolution
    const modelResolution = await modelResolverService.resolve(selectedAgent, organizationId);

    // 5. Combine confidence: arithmetic mean
    const combinedConfidence =
      Math.round(((topicResult.confidence + intentResult.confidence) / 2) * 1000) / 1000;

    const latencyMs = Math.round(performance.now() - startTime);

    // Build result
    const result: ClassificationResult = {
      topic: topicResult.topic,
      topicConfidence: topicResult.confidence,
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      combinedConfidence,
      selectedAgentCardId: selectedAgent.id,
      selectedAgentCardName: selectedAgent.name,
      resolvedModelProviderId: modelResolution.providerId,
      resolvedModelId: modelResolution.modelId,
      latencyMs,
    };

    // 6. Cache write (skip if bypassCache is true)
    if (!bypassCache) {
      await classificationCacheService.set(sessionId, promptHash, result);
    }

    // 7. Log to intentClassificationLogs table
    await this.logClassification({
      organizationId,
      sessionId,
      promptHash,
      result,
      wasCached: false,
    });

    logger.debug("Classification pipeline complete", {
      organizationId,
      sessionId,
      topic: result.topic,
      intent: result.intent,
      agentId: result.selectedAgentCardId,
      latencyMs,
    });

    return result;
  }

  /**
   * Classify a prompt into exactly one TopicCategory with confidence score.
   * Rejects empty/whitespace-only prompts with a ValidationError.
   *
   * `opts.orgId` layers the org's learned vocabulary (declared topic tags
   * reinforced into learned_topic_keywords) over the static keyword map —
   * the enum itself never grows, but the words that score it do.
   */
  async classifyTopic(prompt: string, opts?: { orgId?: number }): Promise<{ topic: TopicCategory; confidence: number }> {
    // Input validation: reject empty/whitespace prompts
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("Prompt content is required for topic classification");
    }

    const normalizedPrompt = prompt.toLowerCase();
    const scores = this.computeTopicScores(normalizedPrompt);
    if (opts?.orgId != null) {
      await this.applyLearnedTopicScores(opts.orgId, normalizedPrompt, scores);
    }

    // Find the best matching topic
    let bestTopic: TopicCategory = "General";
    let bestScore = 0;

    for (const topic of TOPIC_ORDER) {
      if (topic === "General") continue;
      const score = scores.get(topic) ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    // Compute confidence as ratio of best score to prompt word count (clamped to [0, 1])
    const confidence = this.computeConfidence(bestScore, normalizedPrompt);

    // Apply threshold: if confidence < 0.4, default to "General"
    if (confidence < TOPIC_CONFIDENCE_THRESHOLD) {
      logger.debug("Topic confidence below threshold, defaulting to General", {
        originalTopic: bestTopic,
        confidence,
      });
      return { topic: "General", confidence };
    }

    logger.debug("Topic classified", { topic: bestTopic, confidence });
    return { topic: bestTopic, confidence };
  }

  /**
   * Classify a prompt into exactly one IntentCategory with confidence score.
   * Empty/whitespace prompts return "Chat" at 1.0 without classification.
   */
  async classifyIntent(prompt: string): Promise<{ intent: IntentCategory; confidence: number }> {
    // Empty/whitespace prompts: return Chat at 1.0
    if (!prompt || prompt.trim().length === 0) {
      return { intent: "Chat", confidence: 1.0 };
    }

    const normalizedPrompt = prompt.toLowerCase();
    const scores = this.computeIntentScores(normalizedPrompt);

    // Find the best matching intent, tie-break by registered order
    let bestIntent: IntentCategory = "Chat";
    let bestScore = 0;

    for (const intent of INTENT_ORDER) {
      if (intent === "Chat") continue;
      const score = scores.get(intent) ?? 0;
      // Strict greater-than ensures first-in-order wins on tie
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Compute confidence
    const confidence = this.computeConfidence(bestScore, normalizedPrompt);

    // Apply threshold: if confidence < 0.4, default to "Chat"
    if (confidence < INTENT_CONFIDENCE_THRESHOLD) {
      logger.debug("Intent confidence below threshold, defaulting to Chat", {
        originalIntent: bestIntent,
        confidence,
      });
      return { intent: "Chat", confidence };
    }

    logger.debug("Intent classified", { intent: bestIntent, confidence });
    return { intent: bestIntent, confidence };
  }

  /**
   * Select the best agent card for a given topic and intent classification.
   * Scoring: +1 if card's topicAffinities contains the topic, +1 if card's intentAffinities contains the intent.
   * Tie-break: lowest ID (earliest created).
   * Fallback: org default agent card if no card scores > 0.
   */
  async selectAgent(orgId: number, topic: TopicCategory, intent: IntentCategory): Promise<AgentCardRecord> {
    const enabledCards = await agentCardService.getEnabledForRouting(orgId);

    let bestCard: AgentCardRecord | null = null;
    let bestScore = 0;

    for (const card of enabledCards) {
      let score = 0;

      if (card.topicAffinities && card.topicAffinities.includes(topic)) {
        score += 1;
      }

      if (card.intentAffinities && card.intentAffinities.includes(intent)) {
        score += 1;
      }

      if (score > bestScore || (score === bestScore && score > 0 && card.id < (bestCard?.id ?? Infinity))) {
        bestScore = score;
        bestCard = card;
      }
    }

    // Fall back to org default if no card has score > 0
    if (bestScore === 0 || !bestCard) {
      logger.debug("No affinity match found, falling back to org default agent card", { orgId, topic, intent });
      return agentCardService.getDefault(orgId);
    }

    logger.debug("Agent selected by affinity", {
      orgId,
      topic,
      intent,
      selectedId: bestCard.id,
      selectedName: bestCard.name,
      score: bestScore,
    });

    return bestCard;
  }

  // --------------------------------------------------------------------------
  // LLM ROUTER INTEGRATION
  // --------------------------------------------------------------------------

  /**
   * Routes a request to the LLM router using the resolved model from classification.
   * After the Intent Router resolves the provider and model via ModelResolverService,
   * this method passes those values to the existing llm-router.service.ts for execution.
   *
   * Requirements: 9.3 — Pass resolved model provider and model identifier to existing LLM router
   *
   * @param classificationResult - The result from classify() containing resolved model info
   * @param messages - The messages to send to the LLM
   * @param options - Optional LLM request parameters (temperature, maxTokens, etc.)
   * @param organizationId - The organization making the request
   * @param onChunk - Optional streaming callback
   * @returns The LLM response from the resolved provider/model
   */
  async routeToLLM(
    classificationResult: ClassificationResult,
    messages: Array<{ role: string; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      jsonMode?: boolean;
    },
    organizationId?: number,
    onChunk?: (chunk: string) => void,
  ) {
    // Look up the provider's technical name from the resolution
    // We use the providerId and modelId from the classification result
    // to resolve the technical names needed by llmRouterService
    const modelResolution = await modelResolverService.resolve(
      {
        modelBindingProviderId: classificationResult.resolvedModelProviderId,
        modelBindingModelId: classificationResult.resolvedModelId,
      } as AgentCardRecord,
      organizationId ?? 0,
    );

    logger.info("Routing to LLM via resolved model binding", {
      providerName: modelResolution.providerTechnicalName,
      modelIdentifier: modelResolution.modelIdentifier,
      agentCardId: classificationResult.selectedAgentCardId,
      isFallback: modelResolution.isFallback,
    });

    // Pass to existing LLM router infrastructure with specific routing strategy
    return llmRouterService.complete(
      {
        messages,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        stream: options?.stream,
        jsonMode: options?.jsonMode,
        preferredProvider: modelResolution.providerTechnicalName,
        preferredModel: modelResolution.modelIdentifier,
        routingStrategy: "specific",
        fallbackEnabled: true,
      },
      organizationId,
      undefined, // jobId
      undefined, // jobRunId
      onChunk,
    );
  }

  /**
   * Classify a prompt and immediately route to the resolved LLM.
   * Combines classify() + routeToLLM() in a single call for convenience.
   *
   * Requirements: 9.3, 9.4
   *
   * @param request - The classification request (prompt, organizationId, sessionId)
   * @param messages - The messages to send to the LLM (typically includes the same prompt)
   * @param options - Optional LLM request parameters
   * @param onChunk - Optional streaming callback
   * @returns The classification result paired with the LLM response
   */
  async classifyAndRoute(
    request: ClassifyRequest,
    messages: Array<{ role: string; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      jsonMode?: boolean;
    },
    onChunk?: (chunk: string) => void,
  ) {
    // Step 1: Classify (this also logs the routing decision per Req 9.4)
    const classificationResult = await this.classify(request);

    // Step 2: Route to the resolved model via existing LLM router
    const llmResponse = await this.routeToLLM(
      classificationResult,
      messages,
      options,
      request.organizationId,
      onChunk,
    );

    return {
      classification: classificationResult,
      response: llmResponse,
    };
  }

  /**
   * Classify a prompt with active Theory of Mind (ToM) cognitive state modulation.
   * Evaluates user emotional load (frustration, confusion, urgency) to dynamically
   * adjust autonomy tier, suggest tailored persona, or escalate high-stakes flows to humans.
   */
  async classifyWithCognitiveState(
    request: ClassifyRequest & { userId?: string }
  ): Promise<ClassificationResult & { cognitiveModulation: CognitiveModulation }> {
    const classification = await this.classify(request);
    const { organizationId, userId } = request;

    const defaultCognitive = {
      frustration: 0,
      confusion: 0,
      urgency: 0,
      explorationVsGoal: 50,
    };

    let cognitive = defaultCognitive;
    if (userId) {
      try {
        const state = await theoryOfMindService.getCognitiveState(organizationId, userId);
        if (state) {
          cognitive = {
            frustration: state.frustration ?? 0,
            confusion: state.confusion ?? 0,
            urgency: state.urgency ?? 0,
            explorationVsGoal: state.explorationVsGoal ?? 50,
          };
        }
      } catch (err: any) {
        logger.warn(`[IntentRouter] Failed to retrieve ToM cognitive state: ${err.message}`);
      }
    }

    // Determine modulation rules
    let escalateToHuman = false;
    let autonomyLevel: "autonomous" | "supervised" | "human_approval_required" = "autonomous";
    let recommendedPersona: "direct_concise" | "structured_clarifier" | "empathic_orchestrator" | "default" = "default";
    const guidanceParts: string[] = [];

    if (cognitive.frustration >= 75 || cognitive.urgency >= 85) {
      escalateToHuman = true;
      autonomyLevel = "human_approval_required";
      recommendedPersona = "direct_concise";
      guidanceParts.push("User exhibits elevated frustration/urgency. Avoid conversational filler; provide direct solutions, highlight actions taken, and seek confirmation before mutating state.");
    } else if (cognitive.confusion >= 60) {
      autonomyLevel = "supervised";
      recommendedPersona = "structured_clarifier";
      guidanceParts.push("User exhibits high confusion. Break down next steps into numbered checklists, explain rationale clearly, and verify comprehension.");
    } else if (cognitive.explorationVsGoal >= 70) {
      recommendedPersona = "empathic_orchestrator";
      guidanceParts.push("User is in exploratory brainstorming mode. Offer divergent architectural options, trade-offs, and creative alternatives.");
    }

    const cognitiveModulation: CognitiveModulation = {
      escalateToHuman,
      autonomyLevel,
      recommendedPersona,
      cognitiveSnapshot: cognitive,
      guidancePrompt: guidanceParts.join(" "),
    };

    return {
      ...classification,
      cognitiveModulation,
    };
  }

  /**
   * Classify with cognitive state and route to LLM, automatically prepending
   * cognitive behavioral guidance to the system prompt.
   */
  async routeWithCognitiveModulation(
    request: ClassifyRequest & { userId?: string },
    messages: Array<{ role: string; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      jsonMode?: boolean;
    },
    onChunk?: (chunk: string) => void,
  ) {
    const classification = await this.classifyWithCognitiveState(request);
    
    // If guidance exists, prepend or inject system guidance
    let enrichedMessages = messages;
    if (classification.cognitiveModulation.guidancePrompt) {
      const guidance = `[BEHAVIORAL GUIDANCE - COGNITIVE LOAD]: ${classification.cognitiveModulation.guidancePrompt}`;
      const hasSystemMessage = messages.some((m) => m.role === "system");
      if (hasSystemMessage) {
        enrichedMessages = messages.map((m) =>
          m.role === "system" ? { ...m, content: `${m.content}\n\n${guidance}` } : m
        );
      } else {
        enrichedMessages = [{ role: "system", content: guidance }, ...messages];
      }
    }

    const llmResponse = await this.routeToLLM(
      classification,
      enrichedMessages,
      options,
      request.organizationId,
      onChunk,
    );

    return {
      classification,
      response: llmResponse,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE METHODS
  // --------------------------------------------------------------------------

  /**
   * Compute keyword match scores for each topic category.
   * Each matching keyword contributes 1 point.
   */
  private computeTopicScores(normalizedPrompt: string): Map<TopicCategory, number> {
    const scores = new Map<TopicCategory, number>();

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (normalizedPrompt.includes(keyword)) {
          score++;
        }
      }
      if (score > 0) {
        scores.set(topic as TopicCategory, score);
      }
    }

    return scores;
  }

  /**
   * Boost static scores with the org's learned vocabulary: declared labels
   * observed under a category (learned_topic_keywords) count as keyword hits
   * for that category. A frequently-declared label outweighs a one-off —
   * weight is the reinforcement count, capped so a noisy tag can't dominate.
   *
   * Forgetting: effective weight decays by half every 30 days since the label
   * was last seen (updated_at), and entries below 1.0 score nothing. A stray
   * one-off tag teaches briefly then fades; a label users keep declaring
   * keeps its weight topped up and persists.
   */
  private learnedKeywordsCache = new Map<number, { at: number; entries: Array<{ label: string; topic: string; weight: number; updatedAt: Date | null }> }>();
  private static readonly LEARNED_KEYWORDS_TTL_MS = 60_000;
  private static readonly LEARNED_WEIGHT_HALFLIFE_DAYS = 30;

  private async applyLearnedTopicScores(orgId: number, normalizedPrompt: string, scores: Map<TopicCategory, number>): Promise<void> {
    const entries = await this.learnedKeywordsFor(orgId);
    const now = Date.now();
    for (const entry of entries) {
      const ageDays = entry.updatedAt ? (now - entry.updatedAt.getTime()) / 86_400_000 : 0;
      const effectiveWeight = entry.weight * Math.pow(0.5, ageDays / IntentRouterService.LEARNED_WEIGHT_HALFLIFE_DAYS);
      if (effectiveWeight < 1) continue;
      const label = entry.label.toLowerCase();
      const hit = normalizedPrompt.includes(label)
        || normalizedPrompt.includes(label.replace(/\s+/g, "-"))
        || normalizedPrompt.includes(label.replace(/\s+/g, "_"));
      if (!hit) continue;
      const topic = entry.topic as TopicCategory;
      scores.set(topic, (scores.get(topic) ?? 0) + Math.min(1 + effectiveWeight, 5));
    }
  }

  private async learnedKeywordsFor(orgId: number): Promise<Array<{ label: string; topic: string; weight: number; updatedAt: Date | null }>> {
    const cached = this.learnedKeywordsCache.get(orgId);
    if (cached && Date.now() - cached.at < IntentRouterService.LEARNED_KEYWORDS_TTL_MS) return cached.entries;
    try {
      const { learnedTopicKeywords } = await import("@shared/schema/intent-router.js");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ label: learnedTopicKeywords.label, topic: learnedTopicKeywords.topic, weight: learnedTopicKeywords.weight, updatedAt: learnedTopicKeywords.updatedAt })
        .from(learnedTopicKeywords)
        .where(eq(learnedTopicKeywords.organizationId, orgId));
      this.learnedKeywordsCache.set(orgId, { at: Date.now(), entries: rows });
      return rows;
    } catch (err) {
      // Learned vocabulary is an enhancement; a read failure must not
      // break classification — fall back to the static map (or stale cache).
      logger.debug("learned topic keywords unavailable", { orgId, error: err instanceof Error ? err.message : String(err) });
      return cached?.entries ?? [];
    }
  }

  /** The org's learned vocabulary with decayed effective weight — the curation view. */
  async listLearnedKeywords(orgId: number): Promise<Array<{ id: number; label: string; topic: string; weight: number; effectiveWeight: number; updatedAt: Date | null }>> {
    const { learnedTopicKeywords } = await import("@shared/schema/intent-router.js");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(learnedTopicKeywords)
      .where(eq(learnedTopicKeywords.organizationId, orgId))
      .orderBy(desc(learnedTopicKeywords.weight));
    const now = Date.now();
    return rows.map((r) => {
      const ageDays = r.updatedAt ? (now - r.updatedAt.getTime()) / 86_400_000 : 0;
      return {
        id: r.id,
        label: r.label,
        topic: r.topic,
        weight: r.weight,
        effectiveWeight: Number((r.weight * Math.pow(0.5, ageDays / IntentRouterService.LEARNED_WEIGHT_HALFLIFE_DAYS)).toFixed(2)),
        updatedAt: r.updatedAt,
      };
    });
  }

  /** Prune a learned keyword; evicts the org's cache so scoring reflects the deletion. */
  async deleteLearnedKeyword(orgId: number, id: number): Promise<void> {
    const { learnedTopicKeywords } = await import("@shared/schema/intent-router.js");
    const { eq, and } = await import("drizzle-orm");
    await db.delete(learnedTopicKeywords)
      .where(and(eq(learnedTopicKeywords.id, id), eq(learnedTopicKeywords.organizationId, orgId)));
    this.learnedKeywordsCache.delete(orgId);
  }

  /**
   * Classifier drift report: does the classifier see each user-declared label
   * the way it classified the message the tag rode in on? For every tagged
   * intent observation we classify the label itself and compare it to the
   * turn's classified topic. Agreement means the vocabulary users declare
   * tracks what the router infers; disagreement pairs are the candidates for
   * classifier tuning — or for learning.
   */
  async topicDriftReport(orgId: number, limit = 500): Promise<{
    observations: number;
    declared: number;
    agreed: number;
    disagreed: number;
    unclassified: number;
    agreementRate: number | null;
    disagreements: Array<{ classified: string; declared: string; declaredClassifiesAs: string; count: number }>;
  }> {
    const { crewIntentObservations } = await import("@shared/schema/crew.js");
    const { eq, sql, desc } = await import("drizzle-orm");
    const rows = await db
      .select({
        classifiedTopic: crewIntentObservations.classifiedTopic,
        declaredTopics: crewIntentObservations.declaredTopics,
      })
      .from(crewIntentObservations)
      .where(sql`${crewIntentObservations.organizationId} = ${orgId} AND jsonb_array_length(${crewIntentObservations.declaredTopics}) > 0`)
      .orderBy(desc(crewIntentObservations.id))
      .limit(limit);

    let declared = 0, agreed = 0, disagreed = 0, unclassified = 0;
    const disagreementCounts = new Map<string, number>();
    for (const row of rows) {
      for (const label of row.declaredTopics ?? []) {
        declared++;
        // Classifying the label in isolation answers "what category does the
        // router think this declared topic is?" — comparing that to the turn's
        // classification measures drift without trusting the learned map,
        // which would be tautological (the tag taught it this row's topic).
        // No orgId: passing it would apply that learned map.
        const { topic } = await this.classifyTopic(label);
        if (topic === "General") {
          unclassified++;
          continue;
        }
        if (topic === row.classifiedTopic) {
          agreed++;
        } else {
          disagreed++;
          // A JSON tuple, so a label can contain any character without corrupting the key.
          const key = JSON.stringify([row.classifiedTopic, label, topic]);
          disagreementCounts.set(key, (disagreementCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const disagreements = [...disagreementCounts.entries()]
      .map(([key, count]) => {
        const [classified, declared_, declaredClassifiesAs] = JSON.parse(key) as [string, string, string];
        return { classified, declared: declared_, declaredClassifiesAs, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);
    const comparable = agreed + disagreed;
    return {
      observations: rows.length,
      declared,
      agreed,
      disagreed,
      unclassified,
      agreementRate: comparable ? agreed / comparable : null,
      disagreements,
    };
  }

  /**
   * Compute keyword match scores for each intent category.
   * Each matching keyword contributes 1 point.
   */
  private computeIntentScores(normalizedPrompt: string): Map<IntentCategory, number> {
    const scores = new Map<IntentCategory, number>();

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (normalizedPrompt.includes(keyword)) {
          score++;
        }
      }
      if (score > 0) {
        scores.set(intent as IntentCategory, score);
      }
    }

    return scores;
  }

  /**
   * Compute confidence score from keyword match count and prompt characteristics.
   * Uses a scaling formula that maps keyword hits to [0, 1]:
   *   confidence = min(1.0, matchCount / max(3, wordCount * 0.15))
   * 
   * This ensures:
   *   - Single keyword match on short prompts can yield high confidence
   *   - Longer prompts require proportionally more keyword matches
   *   - Confidence is always clamped to [0.0, 1.0]
   */
  private computeConfidence(matchCount: number, normalizedPrompt: string): number {
    if (matchCount === 0) return 0;

    const wordCount = normalizedPrompt.split(/\s+/).filter(w => w.length > 0).length;
    const denominator = Math.max(3, wordCount * 0.15);
    const confidence = Math.min(1.0, matchCount / denominator);

    return Math.round(confidence * 1000) / 1000; // Round to 3 decimal places
  }

  /**
   * Log a classification result to the intentClassificationLogs table.
   * Non-blocking: errors are logged but do not fail the classification pipeline.
   */
  private async logClassification(params: {
    organizationId: number;
    sessionId: string;
    promptHash: string;
    result: ClassificationResult;
    wasCached: boolean;
  }): Promise<void> {
    const { organizationId, sessionId, promptHash, result, wasCached } = params;
    try {
      await db.insert(intentClassificationLogs).values({
        organizationId,
        sessionId,
        promptHash,
        topic: result.topic,
        topicConfidence: result.topicConfidence,
        intent: result.intent,
        intentConfidence: result.intentConfidence,
        combinedConfidence: result.combinedConfidence,
        selectedAgentCardId: result.selectedAgentCardId,
        resolvedModelId: result.resolvedModelId,
        latencyMs: result.latencyMs,
        wasCached,
        wasOverride: false,
        overrideAgentCardId: null,
      });
    } catch (err) {
      logger.error("Failed to log classification result", {
        organizationId,
        sessionId,
        error: (err as Error).message,
      });
    }
  }
}

// Singleton instance
export const intentRouterService = new IntentRouterService();
