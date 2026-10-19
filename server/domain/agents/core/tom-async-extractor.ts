/**
 * Theory of Mind — Async Extractor (BullMQ Consumer)
 *
 * Deep belief/expectation extraction via background queue processing.
 * Makes a single bounded LLM call (systemAiService 'auditor') to extract
 * structured ToM updates from recent conversation context.
 *
 * Target: ≤5s end-to-end including LLM latency.
 * Retry: 2 attempts with exponential backoff (2s, 4s).
 * Budget: capped at 100 extractions per org per day via Redis counter.
 */

import { Worker, Queue } from "bullmq";
import { getRedisOptions, nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { registerWorker, ensureShutdownHandlers } from "@server/utils/graceful-shutdown.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import {
    theoryOfMindService,
    occWrite,
} from "./theory-of-mind.service.js";
import type {
    TheoryOfMindRecord,
    Belief,
    Expectation,
    KnowledgeGap,
    EpistemicEntry,
    OceanProfile,
} from "@shared/schema/agent/theory-of-mind.js";

ensureShutdownHandlers();

const logger = createLogger("ToMAsyncExtractor");
const QUEUE_NAME = "tom-extraction";
const BUDGET_CAP_PER_ORG_PER_DAY = 100;
const MAX_CONVERSATION_CHARS = 8000; // ~2000 tokens at 4 chars/token
const OCEAN_DAMPENING = 0.1;

const connectionOpts = { ...getRedisOptions(), maxRetriesPerRequest: null };

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ExtractionJob {
    organizationId: number;
    userId: string;
    userMessage: string;
    agentResponse?: string;
    conversationTail: Array<{ role: string; content: string }>;
    sessionId: string;
}

export interface ExtractionResult {
    beliefs: Array<Omit<Belief, 'alignment' | 'pinned'>>;
    expectations: Array<Omit<Expectation, 'status'>>;
    knowledgeGaps: Array<Omit<KnowledgeGap, 'dismissed' | 'closedAt'>>;
    epistemicUpdates: Array<Omit<EpistemicEntry, 'confidence'>>;
    oceanSignals?: Partial<OceanProfile>;
}

// ─── Budget Control ─────────────────────────────────────────────────────────

function budgetKey(orgId: number): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `tom:budget:${orgId}:${date}`;
}

async function checkBudget(orgId: number): Promise<boolean> {
    try {
        const key = budgetKey(orgId);
        const current = await redis.get(key);
        const count = current ? parseInt(current, 10) : 0;
        return count < BUDGET_CAP_PER_ORG_PER_DAY;
    } catch (err: any) {
        logger.warn(`[ToMExtractor] Budget check failed: ${err.message}. Allowing extraction.`);
        return true; // Fail-open: allow if Redis is down
    }
}

async function incrementBudget(orgId: number): Promise<void> {
    try {
        const key = budgetKey(orgId);
        const count = await redis.incr(key);
        // Set TTL of 25 hours on first increment (ensures key expires even across day boundaries)
        if (count === 1) {
            await redis.expire(key, 25 * 60 * 60);
        }
    } catch (err: any) {
        logger.warn(`[ToMExtractor] Budget increment failed: ${err.message}`);
    }
}

// ─── Conversation Truncation ────────────────────────────────────────────────

function truncateConversationTail(
    tail: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
    let totalChars = 0;
    const result: Array<{ role: string; content: string }> = [];

    // Walk backwards from most recent, keeping within ~2000 tokens
    for (let i = tail.length - 1; i >= 0; i--) {
        const msgChars = tail[i].content.length;
        if (totalChars + msgChars > MAX_CONVERSATION_CHARS) {
            // Include partial if we have nothing yet
            if (result.length === 0) {
                result.unshift({
                    role: tail[i].role,
                    content: tail[i].content.slice(0, MAX_CONVERSATION_CHARS),
                });
            }
            break;
        }
        totalChars += msgChars;
        result.unshift(tail[i]);
    }

    return result;
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

export function buildExtractionPrompt(
    job: ExtractionJob,
    currentState: TheoryOfMindRecord | null,
): string {
    const truncatedTail = truncateConversationTail(job.conversationTail);

    const conversationText = truncatedTail
        .map(m => `[${m.role}]: ${m.content}`)
        .join("\n");

    const existingBeliefs = currentState?.beliefs
        ?.slice(0, 5)
        .map(b => `- "${b.topic}": ${b.proposition} (confidence: ${b.confidence})`)
        .join("\n") || "None recorded.";

    const existingExpectations = currentState?.expectations
        ?.filter(e => e.status === 'active')
        .slice(0, 3)
        .map(e => `- "${e.domain}": ${e.description}`)
        .join("\n") || "None active.";

    return `You are an epistemic analyst. Analyze the following conversation excerpt to extract the user's mental model updates.

## Current Known State
Existing beliefs:
${existingBeliefs}

Active expectations:
${existingExpectations}

## Recent Conversation
${conversationText}

## Task
Extract from the conversation any NEW or UPDATED:
1. **Beliefs** — what the user stated or implied they believe to be true
2. **Expectations** — what the user expects to happen or how they expect things to work
3. **Knowledge Gaps** — topics the user seems to lack knowledge about that would help them
4. **Epistemic Updates** — information the agent communicated to the user (so we can track what they now know)
5. **OCEAN Personality Signals** — any behavioral signals indicating personality traits (openness, conscientiousness, extraversion, agreeableness, neuroticism) as values between 0.0 and 1.0

Only extract items that are clearly evidenced in the conversation. Do not speculate.
For beliefs, include the source evidence (quote or paraphrase from user).
For knowledge gaps, relate them to the user's apparent goal.

## Response Format
Return a JSON object with this exact structure:
{
  "beliefs": [{ "topic": "string", "proposition": "string", "confidence": 0-100, "sourceEvidence": "string", "observedAt": "ISO8601" }],
  "expectations": [{ "domain": "string", "description": "string", "confidence": 0-100, "triggeringContext": "string", "observedAt": "ISO8601" }],
  "knowledgeGaps": [{ "topic": "string", "relatedGoal": "string", "relevanceScore": 0-100, "detectedAt": "ISO8601" }],
  "epistemicUpdates": [{ "topic": "string", "summary": "string", "informedBy": "string", "informedAt": "ISO8601" }],
  "oceanSignals": { "openness": 0.0-1.0, "conscientiousness": 0.0-1.0, "extraversion": 0.0-1.0, "agreeableness": 0.0-1.0, "neuroticism": 0.0-1.0 }
}

Include only fields where you found evidence. Arrays can be empty. oceanSignals is optional — only include traits you have evidence for.
Return ONLY the JSON object, no markdown or commentary.`;
}

// ─── Response Validation ────────────────────────────────────────────────────

function validateExtractionResult(raw: any): ExtractionResult | null {
    if (!raw || typeof raw !== 'object') return null;

    const result: ExtractionResult = {
        beliefs: [],
        expectations: [],
        knowledgeGaps: [],
        epistemicUpdates: [],
    };

    // Validate beliefs
    if (Array.isArray(raw.beliefs)) {
        result.beliefs = raw.beliefs
            .filter((b: any) =>
                b && typeof b.topic === 'string' && typeof b.proposition === 'string'
                && typeof b.confidence === 'number' && b.confidence >= 0 && b.confidence <= 100
                && typeof b.sourceEvidence === 'string' && typeof b.observedAt === 'string',
            )
            .slice(0, 10); // Cap at 10 per extraction
    }

    // Validate expectations
    if (Array.isArray(raw.expectations)) {
        result.expectations = raw.expectations
            .filter((e: any) =>
                e && typeof e.domain === 'string' && typeof e.description === 'string'
                && typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 100
                && typeof e.triggeringContext === 'string' && typeof e.observedAt === 'string',
            )
            .slice(0, 5);
    }

    // Validate knowledge gaps
    if (Array.isArray(raw.knowledgeGaps)) {
        result.knowledgeGaps = raw.knowledgeGaps
            .filter((g: any) =>
                g && typeof g.topic === 'string' && typeof g.relatedGoal === 'string'
                && typeof g.relevanceScore === 'number' && g.relevanceScore >= 0 && g.relevanceScore <= 100
                && typeof g.detectedAt === 'string',
            )
            .slice(0, 5);
    }

    // Validate epistemic updates
    if (Array.isArray(raw.epistemicUpdates)) {
        result.epistemicUpdates = raw.epistemicUpdates
            .filter((e: any) =>
                e && typeof e.topic === 'string' && typeof e.summary === 'string'
                && typeof e.informedBy === 'string' && typeof e.informedAt === 'string',
            )
            .slice(0, 5);
    }

    // Validate OCEAN signals (optional)
    if (raw.oceanSignals && typeof raw.oceanSignals === 'object') {
        const signals: Partial<OceanProfile> = {};
        const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
        let hasAny = false;
        for (const trait of traits) {
            if (typeof raw.oceanSignals[trait] === 'number'
                && raw.oceanSignals[trait] >= 0 && raw.oceanSignals[trait] <= 1) {
                signals[trait] = raw.oceanSignals[trait];
                hasAny = true;
            }
        }
        if (hasAny) {
            result.oceanSignals = signals;
        }
    }

    return result;
}

// ─── Core Processing ────────────────────────────────────────────────────────

/**
 * Process a single extraction job via LLM call.
 * Calls systemAiService with 'auditor' role, parses structured JSON, validates.
 */
export async function processExtractionJob(job: ExtractionJob): Promise<ExtractionResult> {
    // Get current state for context
    const currentState = await theoryOfMindService.getToMState(job.organizationId, job.userId);

    // Build prompt
    const prompt = buildExtractionPrompt(job, currentState);

    // Call LLM via systemAiService (auditor role)
    const rawResponse = await systemAiService.generateJson(prompt, 'auditor');

    if (!rawResponse) {
        throw new Error("LLM returned null response for extraction");
    }

    // Validate response against schema
    const result = validateExtractionResult(rawResponse);
    if (!result) {
        throw new Error("LLM response failed schema validation");
    }

    return result;
}

// ─── OCEAN Profile Update ───────────────────────────────────────────────────

/**
 * Bayesian update with dampening factor 0.1.
 * new_score = prior_score × (1 - dampening) + observation × dampening
 * Clamp to [0, 1], increment observationCount.
 */
export function updateOceanProfile(
    current: OceanProfile,
    signals: Partial<OceanProfile>,
): OceanProfile {
    const updated = { ...current };
    const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;

    let anyUpdated = false;
    for (const trait of traits) {
        if (typeof signals[trait] === 'number') {
            const prior = current[trait];
            const observation = signals[trait]!;
            const newVal = prior * (1 - OCEAN_DAMPENING) + observation * OCEAN_DAMPENING;
            updated[trait] = Math.max(0, Math.min(1, newVal));
            anyUpdated = true;
        }
    }

    if (anyUpdated) {
        updated.observationCount = current.observationCount + 1;
        updated.lastCalibratedAt = new Date().toISOString();

        // Confidence formula: grows with observations, caps around 80-90
        // Requires 10+ observations before confidence exceeds 60
        updated.confidence = Math.min(100, Math.round(
            100 * (1 - Math.exp(-updated.observationCount / 15)),
        ));
    }

    return updated;
}

// ─── Apply Extraction ───────────────────────────────────────────────────────

/**
 * Applies extracted results to the ToM record.
 * Uses theoryOfMindService methods (which handle OCC internally).
 * Handles misalignment detection placeholder (marks as 'unverified').
 * Invalidates cache after writes.
 */
export async function applyExtraction(
    orgId: number,
    userId: string,
    result: ExtractionResult,
): Promise<void> {
    // Record beliefs (alignment defaults to 'unverified' — full knowledge graph comparison is a TODO)
    for (const belief of result.beliefs) {
        await theoryOfMindService.recordBelief(orgId, userId, belief);
    }

    // Record expectations
    for (const expectation of result.expectations) {
        await theoryOfMindService.recordExpectation(orgId, userId, expectation);
    }

    // Record epistemic updates
    for (const entry of result.epistemicUpdates) {
        await theoryOfMindService.recordEpistemicEntry(orgId, userId, entry);
    }

    // Record knowledge gaps via OCC write (no dedicated service method for adding gaps)
    if (result.knowledgeGaps.length > 0) {
        await occWrite(orgId, userId, (current) => {
            const knowledgeGaps = [...current.knowledgeGaps];
            for (const gap of result.knowledgeGaps) {
                const fullGap: KnowledgeGap = {
                    ...gap,
                    dismissed: false,
                };
                // Dedupe by topic
                const idx = knowledgeGaps.findIndex(
                    g => g.topic.toLowerCase().trim() === fullGap.topic.toLowerCase().trim(),
                );
                if (idx >= 0) {
                    // Update relevance if newer
                    knowledgeGaps[idx] = { ...knowledgeGaps[idx], relevanceScore: fullGap.relevanceScore };
                } else {
                    knowledgeGaps.push(fullGap);
                }
            }
            return { knowledgeGaps };
        });
    }

    // Update OCEAN profile if signals present
    if (result.oceanSignals) {
        await occWrite(orgId, userId, (current) => {
            const updatedOcean = updateOceanProfile(current.oceanProfile, result.oceanSignals!);
            return { oceanProfile: updatedOcean };
        });
    }

    // TODO: Misalignment detection via knowledge graph comparison.
    // For now, all beliefs are recorded as 'unverified'. Full comparison
    // against the knowledge graph service will be implemented when that
    // service is available.
}

// ─── BullMQ Worker ──────────────────────────────────────────────────────────

/**
 * Queue instance for enqueuing extraction jobs externally.
 */
export const tomExtractionQueue = new Queue(QUEUE_NAME, { connection: connectionOpts });

/**
 * Starts the BullMQ worker consuming from the `tom-extraction` queue.
 * Retry: 2 attempts with exponential backoff (2s base).
 */
export function startTomExtractionWorker() {
    logger.info(`[ToMExtractor] Starting worker on queue: ${QUEUE_NAME}`);

    const worker = new Worker(QUEUE_NAME, async (job) => {
        const data = job.data as ExtractionJob;
        const { organizationId, userId } = data;

        // Budget control: skip if org has exceeded daily cap
        const withinBudget = await checkBudget(organizationId);
        if (!withinBudget) {
            logger.info(`[ToMExtractor] Budget exceeded for org ${organizationId}, skipping extraction.`);
            return; // Silently skip — not a failure
        }

        // Increment budget counter before processing (pessimistic to avoid overrun)
        await incrementBudget(organizationId);

        // Process extraction
        const result = await processExtractionJob(data);

        // Apply results to ToM state
        await applyExtraction(organizationId, userId, result);

        logger.debug(`[ToMExtractor] Extraction complete for org=${organizationId} user=${userId}: ${result.beliefs.length} beliefs, ${result.expectations.length} expectations, ${result.knowledgeGaps.length} gaps`);
    }, {
        connection: connectionOpts,
        concurrency: 2,
        autorun: true,
    });

    worker.on("completed", (job) => {
        logger.debug(`[ToMExtractor] Job ${job.id} completed.`);
    });

    worker.on("failed", (job, err) => {
        logger.error(`[ToMExtractor] Job ${job?.id} failed: ${err.message}`);
    });

    registerWorker({ close: () => worker.close() }, "ToMExtractionWorker");
    return worker;
}

/**
 * Helper to enqueue an extraction job with the standard retry settings.
 */
export async function enqueueExtractionJob(job: ExtractionJob): Promise<void> {
    try {
        await tomExtractionQueue.add("extract", job, {
            attempts: 2,
            backoff: {
                type: "exponential",
                delay: 2000, // 2s base → 2s, 4s
            },
            removeOnComplete: true,
            removeOnFail: 50, // Keep last 50 failed jobs for debugging
        });
    } catch (err: any) {
        logger.warn(`[ToMExtractor] Failed to enqueue extraction job: ${err.message}`);
    }
}
