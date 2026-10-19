import { db } from "@server/database_service.js";
import { videoCritiques, type InsertVideoCritique } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";

export class VideoFeedbackService {
    /**
     * Record a critique for a specific video segment
     */
    async recordCritique(critique: InsertVideoCritique) {
        const [inserted] = await db.insert(videoCritiques)
            .values(critique)
            .returning();

        console.log(`[VideoFeedback] Recorded ${critique.rating > 0 ? 'positive' : 'negative'} feedback for video ${critique.videoId}`);
        return inserted;
    }

    /**
     * Get recent critiques for a topic to use as few-shot examples
     */
    async getCritiqueContext(topic: string, organizationId: number, limit: number = 5) {
        const results = await db.select()
            .from(videoCritiques)
            .where(
                and(
                    eq(videoCritiques.organizationId, organizationId),
                    sql`lower(${videoCritiques.topic}) = ${topic.toLowerCase()}`
                )
            )
            .orderBy(desc(videoCritiques.createdAt))
            .limit(limit);

        const positives = results.filter(r => r.rating > 0);
        const negatives = results.filter(r => r.rating < 0);

        return {
            positives: positives.map(p => ({
                videoId: p.videoId,
                reason: p.feedback || p.feedbackReason || 'Highly relevant'
            })),
            negatives: negatives.map(n => ({
                videoId: n.videoId,
                reason: n.feedback || n.feedbackReason || 'Not helpful'
            }))
        };
    }

    /**
     * Generate prompt instructions based on past feedback
     */
    async getPromptInstructions(topic: string, organizationId: number): Promise<string> {
        const { positives, negatives } = await this.getCritiqueContext(topic, organizationId);

        let instruction = "";

        if (negatives.length > 0) {
            instruction += "\nCRITICAL AVOIDANCE:\nBased on past feedback, DO NOT recommend these videos for this topic:\n";
            negatives.forEach(n => {
                instruction += `- Video ${n.videoId}: ${n.reason}\n`;
            });
        }

        if (positives.length > 0) {
            instruction += "\nHIGHLY RECOMMENDED:\nPast users found these videos very helpful for this topic:\n";
            positives.forEach(p => {
                instruction += `- Video ${p.videoId}: ${p.reason}\n`;
            });
        }

        return instruction;
    }
}

export const videoFeedbackService = new VideoFeedbackService();
export default videoFeedbackService;


