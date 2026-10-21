/**
 * AgentMail Thread Sync Service
 * 
 * Links AgentMail email threads to Mission contexts, enabling:
 * - Email-based mission steering (reply to steer a mission)
 * - Omnichannel conversation continuity (Slack ↔ Email)
 * - Email thread persistence in mission blackboard
 */

import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("AgentMailThreadSync");

export interface MissionThreadLink {
    missionRunId: number;
    missionId: number;
    threadId: string;
    organizationId: number;
    userEmail: string;
}

export const agentMailThreadSync = {
    /**
     * Link an AgentMail thread to a mission run.
     * Called when sending HIL emails to store the thread ID for future replies.
     */
    async linkThreadToMission(
        threadId: string,
        missionRunId: number,
        userEmail: string
    ): Promise<void> {
        try {
            // Update the mission run's context with the email thread ID
            await db.update(missionRuns)
                .set({
                    missionContext: sql`
                        COALESCE(${missionRuns.missionContext}, '{}'::jsonb) || 
                        jsonb_build_object(
                            'emailThreadId', ${threadId},
                            'emailParticipant', ${userEmail},
                            'emailLinkedAt', ${new Date().toISOString()}
                        )
                    `
                })
                .where(eq(missionRuns.id, missionRunId));

            logger.info(`[ThreadSync] Linked thread ${threadId} to mission run ${missionRunId}`);
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to link thread: ${err.message}`);
        }
    },

    /**
     * Find a mission run by AgentMail thread ID.
     * Called when receiving email replies to route them to the correct mission.
     */
    async findMissionByThreadId(threadId: string, organizationId: number): Promise<MissionThreadLink | null> {
        // A thread ID found in another organization's mission is not this inbox's reply.
        const orgId = assertOrgId(organizationId);
        try {
            // Search for mission runs with matching email thread ID
            const [run] = await db
                .select({
                    id: missionRuns.id,
                    missionId: missionRuns.missionId,
                    missionContext: missionRuns.missionContext,
                    organizationId: missions.organizationId,
                })
                .from(missionRuns)
                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(and(
                    eq(missions.organizationId, orgId),
                    sql`${missionRuns.missionContext}->>'emailThreadId' = ${threadId}`,
                ))
                .limit(1);

            if (!run) {
                logger.debug(`[ThreadSync] No mission found for thread ${threadId}`);
                return null;
            }

            const context = run.missionContext as any;
            
            return {
                missionRunId: run.id,
                missionId: run.missionId!,
                threadId,
                organizationId: assertOrgId(run.organizationId),
                userEmail: context?.emailParticipant || '',
            };
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to find mission by thread: ${err.message}`);
            return null;
        }
    },

    /**
     * Route an email reply to its linked mission as a steering command.
     * Similar to how Slack messages are routed via conversational bridge.
     */
    async routeReplyToMission(
        threadId: string,
        fromEmail: string,
        replyText: string,
        organizationId: number,
    ): Promise<{ success: boolean; missionRunId?: number; message?: string }> {
        const link = await this.findMissionByThreadId(threadId, organizationId);
        
        if (!link) {
            return { success: false, message: "No mission linked to this email thread" };
        }

        // Verify sender matches the linked participant (security)
        if (link.userEmail && link.userEmail !== fromEmail) {
            logger.warn(`[ThreadSync] Email mismatch: expected ${link.userEmail}, got ${fromEmail}`);
            return { success: false, message: "Email address doesn't match the linked mission participant" };
        }

        try {
            // Apply the reply as a steering nudge to the mission
            const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
            
            await missionRunService.checkpoint({
                missionRunId: link.missionRunId,
                missionId: link.missionId,
                missionContext: {
                    lastEmailCommand: replyText,
                    emailReplyAt: new Date().toISOString(),
                    emailReplyFrom: fromEmail,
                },
                reason: `Email reply from ${fromEmail}: ${replyText.substring(0, 100)}`,
                changedBy: fromEmail,
            });

            // Update mission status if it was waiting for input
            await db.update(missionRuns)
                .set({ 
                    status: 'active',
                    updatedAt: new Date()
                })
                .where(eq(missionRuns.id, link.missionRunId));

            // Trigger immediate cycle to process the feedback
            const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");
            await scheduleMissionWave({ 
                missionRunId: link.missionRunId, 
                userId: link.userEmail, // Using email as user identifier for tracking
                orgId: link.organizationId 
            });

            logger.info(`[ThreadSync] Routed email reply and resumed mission run ${link.missionRunId}`);
            
            return { 
                success: true, 
                missionRunId: link.missionRunId,
                message: "Reply applied to mission"
            };
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to route reply: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Get all active missions with email thread links.
     * Useful for dashboard display and cleanup.
     */
    async listLinkedMissions(organizationId?: number): Promise<MissionThreadLink[]> {
        try {
            const conditions = [
                sql`${missionRuns.missionContext}->>'emailThreadId' IS NOT NULL`
            ];

            if (organizationId) {
                conditions.push(eq(missions.organizationId, organizationId));
            }

            const runs = await db
                .select({
                    id: missionRuns.id,
                    missionId: missionRuns.missionId,
                    missionContext: missionRuns.missionContext,
                    orgId: missions.organizationId,
                })
                .from(missionRuns)
                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(and(...conditions));

            return runs.map(run => {
                const context = run.missionContext as any;
                return {
                    missionRunId: run.id,
                    missionId: run.missionId!,
                    threadId: context?.emailThreadId || '',
                    organizationId: assertOrgId(run.orgId),
                    userEmail: context?.emailParticipant || '',
                };
            });
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to list linked missions: ${err.message}`);
            return [];
        }
    },

    /**
     * Link an AgentMail thread to a CREW room session.
     */
    async linkThreadToCrewSession(
        threadId: string,
        sessionKey: string,
        recipientEmail: string,
        organizationId: number
    ): Promise<void> {
        try {
            const { crewSessions } = await import("@shared/schema/index.js");
            const [session] = await db
                .select({ id: crewSessions.id, cycleContext: crewSessions.cycleContext })
                .from(crewSessions)
                .where(and(eq(crewSessions.sessionKey, sessionKey), eq(crewSessions.organizationId, organizationId)))
                .limit(1);

            if (!session) {
                logger.warn(`[ThreadSync] Session ${sessionKey} not found for linking thread ${threadId}`);
                return;
            }

            const existingContext = (session.cycleContext as Record<string, unknown>) || {};
            const updatedContext = {
                ...existingContext,
                emailThreadId: threadId,
                emailParticipant: recipientEmail,
                emailLinkedAt: new Date().toISOString(),
            };

            await db.update(crewSessions)
                .set({ cycleContext: updatedContext as any })
                .where(eq(crewSessions.id, session.id));

            logger.info(`[ThreadSync] Linked AgentMail thread ${threadId} to CREW session ${sessionKey}`);
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to link thread to CREW session: ${err.message}`);
        }
    },

    /**
     * Find a CREW room session by AgentMail thread ID.
     */
    async findCrewSessionByThreadId(threadId: string, organizationId: number): Promise<CrewThreadLink | null> {
        // A thread ID found in another organization's room is not this inbox's reply.
        const orgId = assertOrgId(organizationId);
        try {
            const { crewSessions } = await import("@shared/schema/index.js");
            const [session] = await db
                .select({
                    id: crewSessions.id,
                    sessionKey: crewSessions.sessionKey,
                    organizationId: crewSessions.organizationId,
                    title: crewSessions.title,
                    cycleContext: crewSessions.cycleContext,
                })
                .from(crewSessions)
                .where(and(
                    eq(crewSessions.organizationId, orgId),
                    sql`${crewSessions.cycleContext}->>'emailThreadId' = ${threadId}`,
                ))
                .limit(1);

            if (!session) {
                logger.debug(`[ThreadSync] No CREW session found for thread ${threadId}`);
                return null;
            }

            const context = session.cycleContext as any;
            return {
                sessionId: session.id,
                sessionKey: session.sessionKey,
                organizationId: session.organizationId,
                threadId,
                recipientEmail: context?.emailParticipant || '',
                title: session.title,
            };
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to find CREW session by thread: ${err.message}`);
            return null;
        }
    },

    /**
     * Route an inbound email reply to its linked CREW room session.
     */
    async routeReplyToCrewSession(
        threadId: string,
        fromEmail: string,
        replyText: string,
        subject: string | undefined,
        organizationId: number,
    ): Promise<{ success: boolean; sessionKey?: string; turnId?: number; message?: string }> {
        const link = await this.findCrewSessionByThreadId(threadId, organizationId);
        if (!link) {
            return { success: false, message: "No CREW session linked to this email thread" };
        }

        try {
            const { crewTurns } = await import("@shared/schema/index.js");
            const { desc } = await import("drizzle-orm");
            const [latestTurn] = await db
                .select({ round: crewTurns.round })
                .from(crewTurns)
                .where(eq(crewTurns.sessionId, link.sessionId))
                .orderBy(desc(crewTurns.id))
                .limit(1);

            const nextRound = (latestTurn?.round ?? 0) + 1;

            const [turn] = await db
                .insert(crewTurns)
                .values({
                    sessionId: link.sessionId,
                    organizationId: link.organizationId,
                    speakerType: "user",
                    speakerName: `Inbound Email (${fromEmail})`,
                    agentCardId: null,
                    content: `📨 **Inbound Email Reply from ${fromEmail}:**\n\n${replyText}`,
                    round: nextRound,
                    toolsUsed: [],
                    artifacts: [
                        {
                            tool: "inbound_email",
                            payload: {
                                from: fromEmail,
                                subject: subject || "Re: Email Response",
                                threadId,
                                receivedAt: new Date().toISOString(),
                            },
                        },
                    ],
                })
                .returning();

            // Stream live event to browser
            const { crewStreamService } = await import("@domain/crew/core/crew-stream.service.js");
            await crewStreamService.publish({
                type: "turn",
                organizationId: link.organizationId,
                sessionKey: link.sessionKey,
                actor: `Inbound Email (${fromEmail})`,
                payload: { turn },
            });

            // Create an in-app operational notification so users outside the room are alerted to reenter
            try {
                const { xrayOperationalEvents, xrayOperationalNotifications } = await import("@shared/schema/index.js");
                const now = new Date();
                const dedupeKey = `crew-reply-${threadId}-${Date.now()}`;
                const [event] = await db
                    .insert(xrayOperationalEvents)
                    .values({
                        organizationId: link.organizationId,
                        scope: "crew_communication",
                        eventType: "inbound_email_reply",
                        severity: "info",
                        deduplicationKey: dedupeKey,
                        deduplicationBucket: new Date().toISOString().slice(0, 10),
                        evidence: {
                            fromEmail,
                            threadId,
                            sessionKey: link.sessionKey,
                            subject: subject || "Re: Email Response",
                            snippet: replyText.slice(0, 150),
                        },
                        evaluation: {
                            action: "notify_room_participants",
                            route: `/workspace/chat/${link.sessionKey}`,
                        },
                        createdAt: now,
                    })
                    .onConflictDoNothing()
                    .returning();

                if (event) {
                    await db.insert(xrayOperationalNotifications).values({
                        organizationId: link.organizationId,
                        scope: "crew_communication",
                        eventId: event.id,
                        ruleId: "inbound_email_alert",
                        severity: "info",
                        title: `📨 Email Reply from ${fromEmail}`,
                        description: `Received response in room "${link.title || link.sessionKey}": "${replyText.slice(0, 120)}${replyText.length > 120 ? '...' : ''}"`,
                        recipientRoles: ["admin", "operator", "member"],
                        status: "unread",
                        payload: {
                            sessionKey: link.sessionKey,
                            threadId,
                            fromEmail,
                            actionUrl: `/workspace/chat/${link.sessionKey}`,
                        },
                        createdAt: now,
                        updatedAt: now,
                    }).onConflictDoNothing();
                }
            } catch (err: any) {
                logger.warn(`[ThreadSync] Operational notification creation skipped: ${err.message}`);
            }

            logger.info(`[ThreadSync] Successfully routed email reply to CREW session ${link.sessionKey} (Turn #${turn.id})`);

            return {
                success: true,
                sessionKey: link.sessionKey,
                turnId: turn.id,
                message: "Reply posted to CREW room",
            };
        } catch (err: any) {
            logger.error(`[ThreadSync] Failed to route reply to CREW: ${err.message}`);
            return { success: false, message: err.message };
        }
    }
};

export interface CrewThreadLink {
    sessionId: number;
    sessionKey: string;
    organizationId: number;
    threadId: string;
    recipientEmail: string;
    title?: string | null;
}

