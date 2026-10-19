/**
 * Skill Governance Service
 *
 * Manages the review lifecycle, approval gates, and decision execution
 * for imported AI skills in accordance with Oddjob governance protocols.
 */

import { db } from "@server/database_service.js";
import {
    skillReviews,
    type SkillReview,
    type InsertSkillReview,
    type SkillReviewStatus,
} from "@shared/schema/skill-integration.js";
import { SkillDecisionEngine, type SkillEvaluationInput } from "./skill-decision-engine.js";
import { SkillAugmentationService } from "./skill-augmentation.service.js";
import { eq, and, desc } from "drizzle-orm";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";

export interface SubmitSkillReviewInput {
    organizationId: number;
    skillId?: number | null;
    skillName: string;
    skillDescription?: string | null;
    sourceUrl?: string | null;
    sourcePlatform?: string;
    extractedPersona?: string | null;
    extractedCapabilities?: string[];
    extractedTools?: string[];
    securityReport?: any;
    submittedBy?: string;
}

export interface ReviewDecisionInput {
    organizationId: number;
    reviewId: number;
    reviewerId: string;
    action: "approve" | "reject" | "augment";
    targetAgentCardId?: number | null;
    reviewNotes?: string;
}

export class SkillGovernanceService {
    /**
     * Submit an imported or analyzed skill for intelligent evaluation and governance review.
     */
    static async submitSkillForReview(input: SubmitSkillReviewInput): Promise<SkillReview> {
        const { organizationId } = input;

        // Evaluate skill against org agents
        const evalInput: SkillEvaluationInput = {
            name: input.skillName,
            description: input.skillDescription,
            persona: input.extractedPersona,
            capabilities: input.extractedCapabilities || [],
            tools: input.extractedTools || [],
            securityReport: input.securityReport,
        };

        const evalResult = await SkillDecisionEngine.analyzeForOrganization(evalInput, organizationId);

        const riskLevel = input.securityReport?.riskLevel || "medium";

        const [reviewRecord] = await db
            .insert(skillReviews)
            .values({
                organizationId,
                skillId: input.skillId ?? null,
                skillName: input.skillName,
                skillDescription: input.skillDescription ?? null,
                sourceUrl: input.sourceUrl ?? null,
                sourcePlatform: input.sourcePlatform ?? "custom",
                extractedPersona: input.extractedPersona ?? null,
                extractedCapabilities: input.extractedCapabilities || [],
                extractedTools: input.extractedTools || [],
                status: "pending",
                decisionRecommendation: evalResult.overallRecommendation,
                compatibilityScore: evalResult.compatibilityScore,
                scoringBreakdown: evalResult.scoringBreakdown,
                targetAgentCardId: evalResult.targetAgentCardId,
                topMatches: evalResult.topMatches,
                securityReport: input.securityReport ?? null,
                riskLevel,
                submittedBy: input.submittedBy ?? "system",
            })
            .returning();

        return reviewRecord;
    }

    /**
     * Process an operator or governor decision on a pending skill review.
     */
    static async processDecision(input: ReviewDecisionInput): Promise<{
        review: SkillReview;
        augmentationResult?: any;
    }> {
        const { organizationId, reviewId, reviewerId, action, reviewNotes } = input;

        const [review] = await db
            .select()
            .from(skillReviews)
            .where(and(eq(skillReviews.id, reviewId), eq(skillReviews.organizationId, organizationId)))
            .limit(1);

        if (!review) {
            throw new NotFoundError(`Skill Review ${reviewId} not found`);
        }

        if (review.status === "approved" || review.status === "augmented" || review.status === "rejected") {
            throw new BadRequestError(`Skill Review ${reviewId} is already completed with status: ${review.status}`);
        }

        if (action === "reject") {
            const [updated] = await db
                .update(skillReviews)
                .set({
                    status: "rejected",
                    reviewerId,
                    reviewNotes: reviewNotes ?? "Rejected during governance review",
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(skillReviews.id, reviewId))
                .returning();

            return { review: updated };
        }

        const targetAgentId = input.targetAgentCardId ?? review.targetAgentCardId;

        // If augmenting an agent card
        if (action === "augment" || (action === "approve" && targetAgentId)) {
            if (!targetAgentId) {
                throw new BadRequestError("Target Agent Card ID is required to augment an agent");
            }

            const augResult = await SkillAugmentationService.augmentAgentCard({
                organizationId,
                agentCardId: targetAgentId,
                skillId: review.skillId,
                reviewId: review.id,
                capabilitiesToAdd: review.extractedCapabilities as string[],
                toolsToAdd: review.extractedTools as string[],
                appliedBy: reviewerId,
            });

            const [updated] = await db
                .update(skillReviews)
                .set({
                    status: "augmented",
                    targetAgentCardId: targetAgentId,
                    reviewerId,
                    reviewNotes: reviewNotes ?? "Augmentation approved and applied to Agent Card",
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(skillReviews.id, reviewId))
                .returning();

            return { review: updated, augmentationResult: augResult };
        }

        // Standard approval
        const [updated] = await db
            .update(skillReviews)
            .set({
                status: "approved",
                reviewerId,
                reviewNotes: reviewNotes ?? "Approved",
                reviewedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(skillReviews.id, reviewId))
                .returning();

        return { review: updated };
    }

    /**
     * List skill reviews for an organization.
     */
    static async listReviews(
        organizationId: number,
        filterStatus?: SkillReviewStatus
    ): Promise<SkillReview[]> {
        if (filterStatus) {
            return db
                .select()
                .from(skillReviews)
                .where(and(eq(skillReviews.organizationId, organizationId), eq(skillReviews.status, filterStatus)))
                .orderBy(desc(skillReviews.createdAt));
        }

        return db
            .select()
            .from(skillReviews)
            .where(eq(skillReviews.organizationId, organizationId))
            .orderBy(desc(skillReviews.createdAt));
    }
}
