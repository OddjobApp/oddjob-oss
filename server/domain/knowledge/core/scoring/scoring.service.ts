/**
 * Scoring Service
 * 
 * Business logic layer for scoring rules, thresholds, interventions, and templates.
 * Separates domain logic from HTTP handling.
 * 
 * Refactored from server/routes/scoring.ts
 */

import { db } from "@server/database_service.js";
import {
    scoringRules, scoreThresholds, scoringInterventions, scoringRuleTemplates,
    NewScoringRule, NewScoreThreshold, NewScoringIntervention, NewScoringRuleTemplate
} from "@shared/schema/index.js";
import { eq, desc, sql } from "drizzle-orm";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ForbiddenError } from "@server/utils/errors.js";

const logger = createLogger("ScoringService");

// ============================================================================
// TYPES
// ============================================================================

export type CreateRuleInput = Omit<NewScoringRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
export type UpdateRuleInput = Partial<CreateRuleInput>;

export type CreateThresholdInput = Omit<NewScoreThreshold, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
export type UpdateThresholdInput = Partial<CreateThresholdInput>;

export type CreateInterventionInput = Omit<NewScoringIntervention, 'id' | 'createdAt'>;
export type UpdateInterventionInput = Partial<CreateInterventionInput>;

export type CreateTemplateInput = Omit<NewScoringRuleTemplate, 'id' | 'createdAt' | 'createdBy'>;
export type UpdateTemplateInput = Partial<CreateTemplateInput>;

// ============================================================================
// CACHE KEYS
// ============================================================================

export const CACHE_KEYS = {
    RULES: 'scoring:rules',
    THRESHOLDS: 'scoring:thresholds',
    INTERVENTIONS: 'scoring:interventions'
};

// ============================================================================
// SEED TEMPLATES
// ============================================================================

const SEED_TEMPLATES = [
    {
        name: 'Rage Click Detection',
        description: 'Detects rapid, frustrated clicking on elements.',
        icon: 'MousePointerClick',
        isSystem: true,
        config: {
            activity: 'click',
            vector: 'S',
            weight: 3.0,
            priority: 'high',
            activityModifier: 1.5,
            triggeredAction: {
                type: 'concierge_prompt',
                config: {
                    hint: 'User detected rage clicking',
                    suggestedMessage: 'I noticed you clicking repeatedly. Is something not working?'
                }
            }
        }
    },
    {
        name: 'Dead Click',
        description: 'Clicks on generic elements that might look interactive but aren\'t.',
        icon: 'XCircle',
        isSystem: true,
        config: {
            activity: 'click',
            vector: 'S',
            weight: 1.5,
            priority: 'medium',
            elementType: 'div'
        }
    },
    {
        name: 'Confusion Loop',
        description: 'Rapid navigation between pages indicating lost user.',
        icon: 'RefreshCw',
        isSystem: true,
        config: {
            activity: 'navigate_next',
            vector: 'S',
            weight: 2.0,
            priority: 'medium',
            activityModifier: 1.5
        }
    },
    {
        name: 'Successful Completion',
        description: 'User successfully submits a form or completes a flow.',
        icon: 'CheckCircle',
        isSystem: true,
        config: {
            activity: 'submit',
            vector: 'O',
            weight: 5.0,
            priority: 'medium',
            pageState: 'success_state',
            triggeredAction: {
                type: 'confetti',
                config: { duration: 3000 }
            }
        }
    },
    {
        name: 'Feature Discovery',
        description: 'User hovers over a key card or element for inspection.',
        icon: 'FastForward',
        isSystem: true,
        config: {
            activity: 'hover_2s',
            vector: 'R',
            weight: 1.0,
            priority: 'low',
            triggeredAction: {
                type: 'tooltip',
                config: { message: 'Did you know you can configure this?' }
            }
        }
    },
    {
        name: 'Error Encountered',
        description: 'User hits an error state or validation failure.',
        icon: 'AlertTriangle',
        isSystem: true,
        config: {
            activity: 'error_state',
            vector: 'S',
            weight: 4.0,
            priority: 'high',
            triggeredAction: {
                type: 'concierge_prompt',
                config: {
                    hint: 'User encountered an error',
                    suggestedMessage: 'I see an error occurred. How can I help fix this?'
                }
            }
        }
    }
];

// ============================================================================
// SCORING SERVICE
// ============================================================================

export const scoringService = {
    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    async updateRulesCache(): Promise<void> {
        const redisClient = getRedisClient();
        const rules = await db.select().from(scoringRules).where(eq(scoringRules.enabled, true));
        await redisClient.set(CACHE_KEYS.RULES, JSON.stringify(rules));
        await redisClient.publish('config_updates', 'scoring_rules');
    },

    async updateThresholdsCache(): Promise<void> {
        const redisClient = getRedisClient();
        const thresholds = await db.select().from(scoreThresholds).where(eq(scoreThresholds.enabled, true));
        await redisClient.set(CACHE_KEYS.THRESHOLDS, JSON.stringify(thresholds));
        await redisClient.publish('config_updates', 'score_thresholds');
    },

    async updateInterventionsCache(): Promise<void> {
        const redisClient = getRedisClient();
        const interventions = await db.select().from(scoringInterventions).where(eq(scoringInterventions.enabled, true));
        await redisClient.set(CACHE_KEYS.INTERVENTIONS, JSON.stringify(interventions));
        await redisClient.publish('config_updates', 'interventions');
    },

    async refreshAllCaches(): Promise<void> {
        await this.updateRulesCache();
        await this.updateThresholdsCache();
        await this.updateInterventionsCache();
        logger.info("All scoring caches refreshed");
    },

    // ========================================================================
    // RULES
    // ========================================================================

    async listRules() {
        return db.select().from(scoringRules).orderBy(desc(scoringRules.createdAt));
    },

    async createRule(input: CreateRuleInput, userId?: number) {
        const [rule] = await db.insert(scoringRules).values({
            ...input,
            createdBy: userId ?? null,
        }).returning();
        await this.updateRulesCache();
        logger.info("Scoring rule created", { ruleId: rule.id, name: rule.name });
        return rule;
    },

    async updateRule(id: number, input: UpdateRuleInput) {
        const [rule] = await db.update(scoringRules).set({
            ...input,
            updatedAt: new Date(),
        }).where(eq(scoringRules.id, id)).returning();

        if (!rule) {
            throw new NotFoundError("Scoring rule not found");
        }

        await this.updateRulesCache();
        logger.info("Scoring rule updated", { ruleId: id });
        return rule;
    },

    async deleteRule(id: number): Promise<void> {
        await db.delete(scoringRules).where(eq(scoringRules.id, id));
        await this.updateRulesCache();
        logger.info("Scoring rule deleted", { ruleId: id });
    },

    async toggleRule(id: number, enabled: boolean) {
        const [rule] = await db.update(scoringRules).set({
            enabled,
            updatedAt: new Date(),
        }).where(eq(scoringRules.id, id)).returning();

        if (!rule) {
            throw new NotFoundError("Scoring rule not found");
        }

        await this.updateRulesCache();
        logger.info("Scoring rule toggled", { ruleId: id, enabled });
        return rule;
    },

    async copyRule(id: number, userId?: number) {
        const [original] = await db.select().from(scoringRules).where(eq(scoringRules.id, id));
        if (!original) {
            throw new NotFoundError("Rule not found");
        }

        const { id: _, createdAt: __, updatedAt: ___, ...copyData } = original;
        const [copy] = await db.insert(scoringRules).values({
            ...copyData,
            name: `${original.name} (Copy)`,
            createdBy: userId ?? null,
        }).returning();

        await this.updateRulesCache();
        logger.info("Scoring rule copied", { originalId: id, newId: copy.id });
        return copy;
    },

    // ========================================================================
    // THRESHOLDS
    // ========================================================================

    async listThresholds() {
        return db.select().from(scoreThresholds).orderBy(desc(scoreThresholds.createdAt));
    },

    async createThreshold(input: CreateThresholdInput) {
        const [threshold] = await db.insert(scoreThresholds).values(input).returning();
        await this.updateThresholdsCache();
        logger.info("Score threshold created", { thresholdId: threshold.id });
        return threshold;
    },

    async updateThreshold(id: number, input: UpdateThresholdInput) {
        const [threshold] = await db.update(scoreThresholds).set(input).where(eq(scoreThresholds.id, id)).returning();

        if (!threshold) {
            throw new NotFoundError("Score threshold not found");
        }

        await this.updateThresholdsCache();
        logger.info("Score threshold updated", { thresholdId: id });
        return threshold;
    },

    async deleteThreshold(id: number): Promise<void> {
        await db.delete(scoreThresholds).where(eq(scoreThresholds.id, id));
        await this.updateThresholdsCache();
        logger.info("Score threshold deleted", { thresholdId: id });
    },

    async toggleThreshold(id: number, enabled: boolean) {
        const [threshold] = await db.update(scoreThresholds).set({ enabled }).where(eq(scoreThresholds.id, id)).returning();

        if (!threshold) {
            throw new NotFoundError("Score threshold not found");
        }

        await this.updateThresholdsCache();
        logger.info("Score threshold toggled", { thresholdId: id, enabled });
        return threshold;
    },

    // ========================================================================
    // INTERVENTIONS
    // ========================================================================

    async listInterventions() {
        return db.select().from(scoringInterventions).orderBy(desc(scoringInterventions.createdAt));
    },

    async createIntervention(input: CreateInterventionInput) {
        const [intervention] = await db.insert(scoringInterventions).values(input).returning();
        await this.updateInterventionsCache();
        logger.info("Scoring intervention created", { interventionId: intervention.id });
        return intervention;
    },

    async updateIntervention(id: number, input: UpdateInterventionInput) {
        const [intervention] = await db.update(scoringInterventions).set(input).where(eq(scoringInterventions.id, id)).returning();

        if (!intervention) {
            throw new NotFoundError("Scoring intervention not found");
        }

        await this.updateInterventionsCache();
        logger.info("Scoring intervention updated", { interventionId: id });
        return intervention;
    },

    async deleteIntervention(id: number): Promise<void> {
        await db.delete(scoringInterventions).where(eq(scoringInterventions.id, id));
        await this.updateInterventionsCache();
        logger.info("Scoring intervention deleted", { interventionId: id });
    },

    // ========================================================================
    // TEMPLATES
    // ========================================================================

    async seedTemplates(userId?: number): Promise<void> {
        const count = await db.select({ count: sql<number>`count(*)` }).from(scoringRuleTemplates);
        if (Number(count[0].count) > 0) return;

        await db.insert(scoringRuleTemplates).values(SEED_TEMPLATES.map(t => ({
            ...t,
            createdBy: userId ?? null
        })));
        logger.info("Scoring templates seeded", { count: SEED_TEMPLATES.length });
    },

    async listTemplates(userId?: number) {
        // Auto-seed on first read if empty
        await this.seedTemplates(userId);
        return db.select().from(scoringRuleTemplates).orderBy(desc(scoringRuleTemplates.createdAt));
    },

    async createTemplate(input: CreateTemplateInput, userId?: number) {
        const [template] = await db.insert(scoringRuleTemplates).values({
            ...input,
            createdBy: userId ?? null,
        }).returning();
        logger.info("Scoring template created", { templateId: template.id, name: template.name });
        return template;
    },

    async updateTemplate(id: string, input: UpdateTemplateInput) {
        const [template] = await db.update(scoringRuleTemplates).set(input).where(eq(scoringRuleTemplates.id, id)).returning();

        if (!template) {
            throw new NotFoundError("Scoring template not found");
        }

        logger.info("Scoring template updated", { templateId: id });
        return template;
    },

    async deleteTemplate(id: string): Promise<void> {
        const [template] = await db.select().from(scoringRuleTemplates).where(eq(scoringRuleTemplates.id, id));

        if (template?.isSystem) {
            throw new ForbiddenError("Cannot delete system templates");
        }

        await db.delete(scoringRuleTemplates).where(eq(scoringRuleTemplates.id, id));
        logger.info("Scoring template deleted", { templateId: id });
    },

    // ========================================================================
    // AI DESCRIPTION GENERATION
    // ========================================================================

    async generateDescription(threshold: any, rules: any[] = []): Promise<string> {
        const { agentService } = await import("@domain/agents/agent.service.js");
        return agentService.generateScoringDescription(threshold, rules);
    },
};

export default scoringService;


