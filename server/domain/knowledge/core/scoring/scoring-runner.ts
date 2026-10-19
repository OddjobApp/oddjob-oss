
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { scoringService } from "@domain/knowledge/core/scoring/scoring.service.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { scoringEvents } from "@shared/schema/index.js";
import { interventionAgentService } from "@domain/knowledge/core/scoring/intervention-agent.service.js";

const logger = createLogger("ScoringRunner");
const CACHE_KEY_SCORES = "scoring:scores:"; // + userId

export const scoringRunner = {
    async start() {
        logger.info("Starting Scoring Runner...");
        // Listen to all events, filter internally
        eventStream.on("*", this.handleEvent.bind(this));
    },

    async handleEvent(event: any) {
        // Filter for UI interactions or specific tracked events
        // assuming 'ui_interaction' type for clicks, hovers etc.
        // assuming 'navigation' type for page views
        const relevantTypes = ['ui_interaction', 'navigation', 'user_action'];
        const agentTypes = ['agent_tool_call', 'agent_response', 'agent_run_complete'];

        // Bail before touching the database on events this runner does not score.
        // It subscribes to "*", so without this every event published anywhere on the
        // platform cost a scoringService.listRules() query — the relevance checks
        // below ran only AFTER that lookup.
        if (!relevantTypes.includes(event.eventType) && !agentTypes.includes(event.eventType)) {
            return;
        }

        const userId = event.context?.userId || event.payload?.userId;
        const sessionId = event.context?.sessionId || event.payload?.sessionId || 'unknown';

        if (!userId && !sessionId) return; // Need some identifier

        try {
            const allRules = await scoringService.listRules();

            // UI interaction rules
            if (relevantTypes.includes(event.eventType)) {
                const activeUiRules = allRules.filter((r: any) =>
                    r.enabled && r.ruleType === 'ui_interaction'
                );
                for (const rule of activeUiRules) {
                    if (this.matches(rule, event)) {
                        await this.applyRule(rule, userId, sessionId, event);
                    }
                }
            }

            // Agent evaluation rules — fire on agent lifecycle events
            if (agentTypes.includes(event.eventType)) {
                const agentRules = allRules.filter((r: any) =>
                    r.enabled && r.ruleType === 'agent_evaluation'
                );
                for (const rule of agentRules) {
                    if (this.matchesAgentEvent(rule, event)) {
                        await this.applyRule(rule, userId, sessionId, event);
                    }
                }
            }
        } catch (e) {
            logger.error("Error processing scoring event", e);
        }
    },

    matchesAgentEvent(rule: any, event: any): boolean {
        const p = event.payload || {};

        // Match on tool name if rule specifies it
        if (rule.elementId && rule.elementId !== p.toolName) return false;

        // Match on job/pipeline context
        if (rule.page && rule.page !== (p.jobType || p.jobId?.toString())) return false;

        // Match on outcome if rule specifies (success/error)
        if (rule.activity && rule.activity !== p.status) return false;

        return true;
    },

    matches(rule: any, event: any): boolean {
        const p = event.payload || {};

        // Activity Match (Required)
        // Map event types to activity codes if needed, or assume payload.activity matches rule.activity
        // e.g. rule.activity = 'click', payload.activity = 'click'
        if (rule.activity && rule.activity !== p.activity) return false;

        // Page Match (Level 1)
        if (rule.page && rule.page !== p.page) return false;

        // Page State Match (Level 2)
        if (rule.pageState && rule.pageState !== p.pageState) return false;

        // Card Match (Level 3)
        if (rule.card && rule.card !== p.card) return false;

        // Element Type Match (Level 4)
        if (rule.elementType && rule.elementType !== p.elementType) return false;

        // Element ID Match (Level 5)
        if (rule.elementId && rule.elementId !== p.elementId) return false;

        return true;
    },

    async applyRule(rule: any, userId: string | number | undefined, sessionId: string, event?: any) {
        logger.debug(`Rule Matched: ${rule.name}`, { userId, vector: rule.vector, points: rule.weight });

        // 1. Log the Scoring Event
        const prospectId = event?.context?.prospectProfileId || event?.payload?.prospectProfileId || null;
        try {
            await db.insert(scoringEvents).values({
                sessionId: String(sessionId),
                eventType: 'rule_match',
                ruleId: rule.id,
                actionType: rule.triggeredAction?.type || 'log_only',
                actionConfig: rule.triggeredAction?.config || {},
                vectorState: { [rule.vector]: rule.weight },
                confidence: 1.0,
                location: rule.page || 'global',
                ...(prospectId ? { prospectId } : {}),
            });
        } catch (e) {
            logger.error("Failed to insert scoring event", e);
        }

        // 2. Update Accumulated Score (Vector)
        // using Redis for fast, ephemeral state
        const subjectId = userId ? `u:${userId}` : `s:${sessionId}`;
        const key = CACHE_KEY_SCORES + subjectId;
        const redis = getRedisClient();

        // Increment score
        const newScoreStr = await redis.hincrbyfloat(key, rule.vector, rule.weight || 0);
        const newScore = parseFloat(newScoreStr);

        // 3. Check Thresholds
        await this.checkThresholds(subjectId, rule.vector, newScore, sessionId, event);
    },

    async checkThresholds(subjectId: string, vector: string, currentScore: number, sessionId: string, event?: any) {
        // Fetch thresholds for this vector
        const allThresholds = await scoringService.listThresholds();
        const activeThresholds = allThresholds.filter((t: any) =>
            t.enabled &&
            t.vector === vector
        );

        for (const threshold of activeThresholds) {
            if (this.meetsCondition(currentScore, threshold.operator, threshold.thresholdValue)) {
                // Check Cooldown
                const cooldownKey = `scoring:cooldown:${threshold.id}:${subjectId}`;
                const redis = getRedisClient();
                const inCooldown = await redis.exists(cooldownKey);

                if (!inCooldown) {
                    await this.triggerIntervention(threshold, subjectId, sessionId, currentScore, event);

                    // Set Cooldown
                    if (threshold.cooldownMs && threshold.cooldownMs > 0) {
                        await redis.set(cooldownKey, '1', 'PX', threshold.cooldownMs);
                    }
                }
            }
        }
    },

    meetsCondition(score: number, operator: string, value: number): boolean {
        switch (operator) {
            case '>': return score > value;
            case '>=': return score >= value;
            case '<': return score < value;
            case '<=': return score <= value;
            case '=': return score === value;
            default: return false;
        }
    },

    async triggerIntervention(threshold: any, subjectId: string, sessionId: string, score: number, event?: any) {
        logger.info(`Threshold Triggered: ${threshold.name}`, { subjectId, score });

        // Log the raw threshold trigger
        await db.insert(scoringEvents).values({
            sessionId: String(sessionId),
            eventType: 'threshold_trigger',
            thresholdId: threshold.id,
            actionType: threshold.triggeredAction?.type || 'alert',
            actionConfig: threshold.triggeredAction?.config || {},
            vectorState: { [threshold.vector]: score },
            confidence: 1.0,
            location: event?.payload?.page || 'scoring-runner'
        });

        // ── Route through InterventionAgent for evaluation ──
        const userId = subjectId.startsWith('u:') ? subjectId.substring(2) : undefined;

        // Build SCORE snapshot from Redis for context
        let vectorState: Record<string, number> = { [threshold.vector]: score };
        try {
            const redis = getRedisClient();
            const raw = await redis.hgetall(`${CACHE_KEY_SCORES}${subjectId}`);
            if (raw) {
                vectorState = Object.fromEntries(
                    Object.entries(raw).map(([k, v]) => [k, parseFloat(v as string)])
                );
            }
        } catch { /* non-critical */ }

        let decision;
        try {
            decision = await interventionAgentService.evaluate({
                thresholdId: threshold.id,
                thresholdName: threshold.name,
                vector: threshold.vector,
                score,
                thresholdValue: threshold.thresholdValue,
                sessionId: String(sessionId),
                userId,
                action: threshold.triggeredAction,
                vectorState,
                location: event?.payload?.page || event?.context?.page,
            });
        } catch (e) {
            logger.error("[ScoringRunner] Agent evaluation threw, firing raw intervention", e);
            // Fallback: fire original action as-is
            decision = {
                fire: true,
                title: threshold.name,
                description: threshold.triggeredAction?.config?.message || `${threshold.vector}-score threshold reached.`,
                priority: 'medium',
                confidence: 0.5,
            };
        }

        if (!decision.fire) {
            logger.info(`[ScoringRunner] Agent suppressed intervention for ${threshold.name}`);
            return;
        }

        // Publish the enriched intervention event to the UI
        await eventStream.publish('intervention.triggered', {
            interventionId: `${threshold.id}-${Date.now()}`,
            memoryId: decision.memoryId,
            thresholdId: threshold.id,
            vector: threshold.vector,
            score,
            title: decision.title || threshold.name,
            description: decision.description || threshold.triggeredAction?.config?.message,
            aiPrompt: decision.aiPrompt,
            rationale: decision.rationale,
            priority: decision.priority || 'medium',
            confidence: decision.confidence,
            sessionId,
            userId,
            // Keep original action for useScoringActionExecutor compatibility
            action: threshold.triggeredAction,
        }, {
            source: 'scoring-runner'
        });
    }
};


