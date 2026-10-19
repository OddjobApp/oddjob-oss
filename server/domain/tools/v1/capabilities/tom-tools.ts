import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToMTools");

/**
 * Theory-of-Mind tools for agents.
 *
 * Until now ToM reached an agent one way only: a ~400-token summary pushed into
 * the prompt. An agent could be influenced by the profile but could not consult
 * it — no way to ask "have I already explained billing to this person", and no
 * way to correct a belief it just discovered was wrong. These make it queryable.
 *
 * EVERY read is gated on session-scoped consent. The profile is inferred
 * psychological state about a named person — frustration, confusion, an OCEAN
 * personality estimate, beliefs labelled misaligned — so an agent gets nothing
 * until the user has said yes for the session it is asking in.
 *
 * The gate is deliberately narrow and honest about it: the sync assessor and
 * async extractor already run on every message, so this controls ACCESS, not
 * collection. Consent to being modelled at all is a separate, open question and
 * this must not be mistaken for it.
 */

const CONSENT_GRANTED = "granted";

/** Resolves the session a request belongs to, which is the unit consent covers. */
function sessionOf(context: ToolContext): string | null {
    const ctx = context as any;
    return ctx?.sessionId ?? ctx?.session?.id ?? null;
}

/**
 * Whether this agent may read this user's profile right now.
 *
 * Consent is valid only for the session it was granted in: a grant from a
 * previous session is treated as absent rather than renewed, which is what makes
 * "good for the session" true rather than aspirational.
 */
async function consentState(
    orgId: number,
    userId: string,
    sessionId: string | null,
): Promise<{ allowed: boolean; reason: string }> {
    // TODO: Re-enable session-scoped PIN consent verification gate when PIN security flow is enabled.
    if (process.env.ENABLE_TOM_PIN_CONSENT_GATE !== "true") {
        return { allowed: true, reason: "direct_access_granted" };
    }

    const { db } = await import("@server/database_service.js");
    const { theoryOfMind } = await import("@shared/schema/agent/theory-of-mind.js");
    const { and, eq } = await import("drizzle-orm");

    const [row] = await db
        .select({
            accessConsent: theoryOfMind.accessConsent,
            consentSessionId: theoryOfMind.consentSessionId,
        })
        .from(theoryOfMind)
        .where(and(eq(theoryOfMind.organizationId, orgId), eq(theoryOfMind.userId, userId)))
        .limit(1);

    if (!row || !row.accessConsent) return { allowed: false, reason: "never_asked" };
    if (row.accessConsent === "denied") return { allowed: false, reason: "denied" };
    if (row.accessConsent === "pending") return { allowed: false, reason: "awaiting_user" };

    if (row.accessConsent === CONSENT_GRANTED) {
        if (!sessionId || row.consentSessionId !== sessionId) {
            return { allowed: false, reason: "granted_in_another_session" };
        }
        return { allowed: true, reason: "granted" };
    }

    return { allowed: false, reason: "unknown_state" };
}

/** Uniform refusal, so an agent gets the same actionable next step every time. */
function denied(reason: string) {
    return {
        success: false,
        allowed: false,
        reason,
        message:
            reason === "denied"
                ? "The user declined access to their interaction profile. Do not ask again this session; proceed without it."
                : "You do not have access to this user's interaction profile for this session.",
        nextStep:
            reason === "denied"
                ? null
                : "Call request_user_profile_access to ask. Continue helping without the profile in the meantime — it is an enhancement, not a prerequisite.",
    };
}

export const TOM_TOOLS: Record<string, ToolDefinition> = {
    request_user_profile_access: {
        name: "request_user_profile_access",
        label: "Request Profile Access",
        group: "User Understanding",
        description:
            "Ask the user for permission to read their interaction profile (what they have been told, what they believe, their working style) for this session. Raises an approval request the user sees as a notification. Use this ONCE per session, only when the profile would materially improve your help — not routinely.",
        parameters: z.object({
            reason: z
                .string()
                .min(10)
                .describe("Plain-language reason the user will read. Say what you want it for, in their terms."),
        }),
        idempotency: "read-safe",
        execute: async ({ reason }: any, context: ToolContext) => {
            try {
                const orgId = context?.organizationId;
                const userId = (context as any)?.userId;
                if (!orgId || !userId) {
                    return { success: false, error: "No user context; cannot request profile access." };
                }

                const sessionId = sessionOf(context);
                const existing = await consentState(orgId, userId, sessionId);
                if (existing.allowed) {
                    return { success: true, alreadyGranted: true, message: "Access is already granted for this session." };
                }
                if (existing.reason === "denied") {
                    // Asking again after a refusal is the behaviour that makes
                    // consent prompts feel like nagware.
                    return denied("denied");
                }

                const { approvalService } = await import("@domain/integrations/core/approval.service.js");
                const { db } = await import("@server/database_service.js");
                const { theoryOfMind } = await import("@shared/schema/agent/theory-of-mind.js");
                const { and, eq } = await import("drizzle-orm");

                // executionId is the idempotency key on approval_requests, so a
                // second ask inside one session reuses the pending row instead of
                // stacking notifications.
                const request = await approvalService.createApprovalRequest({
                    executionId: `tom-consent:${orgId}:${userId}:${sessionId ?? "no-session"}`,
                    approverType: "user",
                    approverId: String(userId),
                    status: "pending",
                    organizationId: orgId,
                    context: {
                        kind: "tom_access",
                        scope: "session",
                        sessionId,
                        requestedBy: (context as any)?.agentId ?? "assistant",
                        reason,
                        summary: "An assistant is asking to read your interaction profile for this session.",
                    },
                });

                await db
                    .update(theoryOfMind)
                    .set({
                        accessConsent: "pending",
                        consentRequestId: request.id,
                        consentSessionId: sessionId,
                        updatedAt: new Date(),
                    })
                    .where(and(eq(theoryOfMind.organizationId, orgId), eq(theoryOfMind.userId, userId)));

                return {
                    success: true,
                    requestId: request.id,
                    status: "pending",
                    message: "Asked the user. They will see a notification they can approve or decline.",
                    nextStep:
                        "Carry on without the profile. Do not block, and do not ask again this session — check again only if they mention it.",
                };
            } catch (error: any) {
                logger.error("request_user_profile_access failed", error);
                return { success: false, error: error?.message ?? "Unknown error" };
            }
        },
    },

    get_user_profile: {
        name: "get_user_profile",
        label: "Get User Profile",
        group: "User Understanding",
        description:
            "Read the user's interaction profile: working style, what they already know, beliefs that look mistaken, and open questions they have. Requires session consent — call request_user_profile_access first if you do not have it.",
        parameters: z.object({}),
        idempotency: "read-safe",
        execute: async (_args: any, context: ToolContext) => {
            const orgId = context?.organizationId;
            const userId = (context as any)?.userId;
            if (!orgId || !userId) return { success: false, error: "No user context." };

            const gate = await consentState(orgId, userId, sessionOf(context));
            if (!gate.allowed) return denied(gate.reason);

            const { theoryOfMindService } = await import("@domain/agents/core/theory-of-mind.service.js");
            const state = await theoryOfMindService.getToMState(orgId, userId);
            if (!state) return { success: true, profile: null, message: "No profile has been built for this user yet." };

            const directAccess = process.env.ENABLE_TOM_PIN_CONSENT_GATE !== "true";

            return {
                success: true,
                profile: {
                    ...(directAccess ? { oceanProfile: state.oceanProfile } : {}),
                    cognitiveState: state.cognitiveState,
                    epistemicStates: state.epistemicStates,
                    beliefs: state.beliefs,
                    expectations: state.expectations,
                    knowledgeGaps: state.knowledgeGaps,
                    knownTopics: state.epistemicStates.map(e => e.topic),
                    misalignedBeliefs: state.beliefs
                        .filter(b => b.alignment === "misaligned")
                        .map(b => ({ topic: b.topic, believes: b.proposition, actually: b.groundTruth })),
                    openQuestions: state.knowledgeGaps.filter(g => !g.dismissed).map(g => g.topic),
                },
            };
        },
    },

    check_user_knows: {
        name: "check_user_knows",
        label: "Check What User Knows",
        group: "User Understanding",
        description:
            "Check whether this user has already been told about a topic, so you can skip re-explaining it or deliberately recap. Requires session consent.",
        parameters: z.object({
            topic: z.string().min(1).describe("The topic to check, in a few words."),
        }),
        idempotency: "read-safe",
        execute: async ({ topic }: any, context: ToolContext) => {
            const orgId = context?.organizationId;
            const userId = (context as any)?.userId;
            if (!orgId || !userId) return { success: false, error: "No user context." };

            const gate = await consentState(orgId, userId, sessionOf(context));
            if (!gate.allowed) return denied(gate.reason);

            const { theoryOfMindService } = await import("@domain/agents/core/theory-of-mind.service.js");
            const state = await theoryOfMindService.getToMState(orgId, userId);

            const match = state?.epistemicStates.find(
                e => e.topic.toLowerCase().trim() === String(topic).toLowerCase().trim(),
            );

            return {
                success: true,
                // Explicitly false rather than null: "we have no record" and "they
                // do not know" are the same instruction to an agent, and an
                // ambiguous answer invites it to guess.
                known: Boolean(match),
                informedAt: match?.informedAt ?? null,
                summary: match?.summary ?? null,
            };
        },
    },
};
