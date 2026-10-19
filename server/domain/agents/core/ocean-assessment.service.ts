import { db } from "@server/database_service.js";
import { theoryOfMind, type OceanProfile } from "@shared/schema/agent/theory-of-mind.js";
import { theoryOfMindService } from "./theory-of-mind.service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("OceanAssessment");

export interface InteractionSignal {
    messageLength?: number;
    hasStructuredFormatting?: boolean; // markdown lists, code blocks
    isExploratoryQuestion?: boolean;   // "what if", "how could we", "explore"
    isDirectCommand?: boolean;          // "do X", "run Y", "fix Z"
    riskToleranceSignal?: "low" | "medium" | "high"; // from HIL approvals
    sentimentTone?: "frustrated" | "neutral" | "collaborative" | "urgent";
}

export interface OceanSteeringDirective {
    oceanProfile: OceanProfile;
    communicationDirectives: string[];
    guidanceText: string;
}

export const oceanAssessmentService = {
    /**
     * Analyze an incoming interaction signal and incrementally update the user's OCEAN profile.
     */
    async assessAndCalibrate(
        organizationId: number,
        userId: string,
        signal: InteractionSignal
    ): Promise<OceanProfile | null> {
        if (!organizationId || !userId) return null;

        try {
            const tomRecord = await theoryOfMindService.getToMState(organizationId, userId);
            const current = tomRecord?.oceanProfile ?? {
                openness: 0.5,
                conscientiousness: 0.5,
                extraversion: 0.5,
                agreeableness: 0.5,
                neuroticism: 0.5,
                confidence: 10,
                observationCount: 0,
                lastCalibratedAt: null,
            };

            let deltaO = 0;
            let deltaC = 0;
            let deltaE = 0;
            let deltaA = 0;
            let deltaN = 0;

            // Signal 1: Exploratory vs Direct Command
            if (signal.isExploratoryQuestion) {
                deltaO += 0.05; // Openness
                deltaE += 0.02; // Extraversion
            }
            if (signal.isDirectCommand) {
                deltaC += 0.04; // Conscientiousness
                deltaO -= 0.02;
            }

            // Signal 2: Message structure
            if (signal.hasStructuredFormatting) {
                deltaC += 0.05; // High Conscientiousness
            }

            // Signal 3: Risk Tolerance in HIL
            if (signal.riskToleranceSignal === "high") {
                deltaO += 0.05;
                deltaN -= 0.05; // Low Neuroticism
            } else if (signal.riskToleranceSignal === "low") {
                deltaN += 0.05; // Higher caution/neuroticism
                deltaC += 0.03;
            }

            // Signal 4: Sentiment
            if (signal.sentimentTone === "frustrated") {
                deltaN += 0.06;
                deltaA -= 0.03;
            } else if (signal.sentimentTone === "collaborative") {
                deltaA += 0.05;
                deltaE += 0.03;
            }

            // Apply dampening based on observation count (learning rate decay)
            const obsCount = current.observationCount + 1;
            const alpha = Math.max(0.05, 0.3 / Math.sqrt(obsCount));

            const clamp = (v: number) => Math.min(1.0, Math.max(0.0, v));

            const updatedProfile: OceanProfile = {
                openness: clamp(current.openness + deltaO * alpha),
                conscientiousness: clamp(current.conscientiousness + deltaC * alpha),
                extraversion: clamp(current.extraversion + deltaE * alpha),
                agreeableness: clamp(current.agreeableness + deltaA * alpha),
                neuroticism: clamp(current.neuroticism + deltaN * alpha),
                confidence: Math.min(100, current.confidence + 2),
                observationCount: obsCount,
                lastCalibratedAt: new Date().toISOString(),
            };

            // Save updated OCEAN profile into Theory of Mind DB record
            await db
                .update(theoryOfMind)
                .set({
                    oceanProfile: updatedProfile,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(theoryOfMind.organizationId, organizationId),
                        eq(theoryOfMind.userId, userId)
                    )
                );

            return updatedProfile;
        } catch (err: any) {
            logger.error(`Failed to calibrate OCEAN profile for user ${userId}`, err);
            return null;
        }
    },

    /**
     * Generate Adaptive Communication Steering Directives based on user's OCEAN profile.
     */
    generateSteeringDirectives(profile: OceanProfile): OceanSteeringDirective {
        const directives: string[] = [];

        // Conscientiousness
        if (profile.conscientiousness >= 0.65) {
            directives.push("Provide structured, step-by-step verification steps and clear execution parameters.");
        } else if (profile.conscientiousness <= 0.35) {
            directives.push("Keep responses concise and high-level; avoid overly verbose administrative breakdowns.");
        }

        // Openness
        if (profile.openness >= 0.65) {
            directives.push("Offer creative architectural options, innovative alternatives, and conceptual insights.");
        } else if (profile.openness <= 0.35) {
            directives.push("Focus strictly on standard, proven patterns and immediate practical requirements.");
        }

        // Extraversion
        if (profile.extraversion >= 0.65) {
            directives.push("Use an engaging, collaborative tone suited for iterative brainstorming.");
        } else if (profile.extraversion <= 0.35) {
            directives.push("Maintain a direct, precise tone focused on objective data.");
        }

        // Neuroticism / Calmness
        if (profile.neuroticism >= 0.65) {
            directives.push("Be explicit, reassuring, and proactively highlight safety mechanisms and rollback paths.");
        } else if (profile.neuroticism <= 0.35) {
            directives.push("Execute with direct confidence; concise status updates are preferred over detailed reassurances.");
        }

        // Agreeableness
        if (profile.agreeableness >= 0.65) {
            directives.push("Maintain a supportive, polite, and aligned posture.");
        } else if (profile.agreeableness <= 0.35) {
            directives.push("Prioritize direct factual accuracy over conversational diplomacy.");
        }

        if (directives.length === 0) {
            directives.push("Maintain a balanced, professional, and clear communication style.");
        }

        return {
            oceanProfile: profile,
            communicationDirectives: directives,
            guidanceText: directives.join(" "),
        };
    }
};
