/**
 * CREW Meeting Scheduler & Multi-Participant Coordination Service
 *
 * Coordinates meeting scheduling between human users and AI agents, provides
 * interactive candidate slot voting, generates RFC 5545 .ics calendar invites,
 * syncs with Project Space calendars (project_events), and autonomously provisions
 * CREW group discussion sessions at the scheduled time.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    crewMeetingSchedules,
    crewSessions,
    crewMembers,
    crewTurns,
    projectEvents,
    type CrewMeetingScheduleRecord,
    type CrewTurnRecord,
} from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { crewStreamService } from "./crew-stream.service.js";
import { crewSupervisorService } from "./crew-supervisor.service.js";
import { schedulerQueue } from "@server/domain/schedules/infrastructure/scheduler-worker.js";

const logger = createLogger("CrewMeetingSchedulerService");

export interface CandidateSlot {
    id: string;
    startsAt: string; // ISO String
    endsAt: string;   // ISO String
    votes: string[];  // userIds
}

export interface RequestedAttendee {
    id: string;
    type: "user" | "agent";
    name: string;
    email?: string;
    status: "invited" | "accepted" | "declined";
}

export interface ProposeMeetingParams {
    projectId?: number;
    title: string;
    agenda?: string;
    hostUserId: string;
    candidateSlots: Array<{ id?: string; startsAt: string; endsAt: string }>;
    requestedAttendees: Array<{ id: string; type: "user" | "agent"; name: string; email?: string }>;
    reminderMinutesBefore?: number;
}

export class CrewMeetingSchedulerService {
    /**
     * Proposes a new multi-participant meeting and generates an interactive scheduling poll card.
     */
    async proposeMeeting(
        orgId: number,
        params: ProposeMeetingParams,
    ): Promise<{ schedule: CrewMeetingScheduleRecord; artifact: any }> {
        const candidateSlots: CandidateSlot[] = params.candidateSlots.map((s, idx) => ({
            id: s.id || `slot-${idx + 1}-${Date.now()}`,
            startsAt: new Date(s.startsAt).toISOString(),
            endsAt: new Date(s.endsAt).toISOString(),
            votes: [],
        }));

        // AI Agents automatically accept invitations; host user is also marked accepted.
        const attendees: RequestedAttendee[] = params.requestedAttendees.map((a) => ({
            id: a.id,
            type: a.type,
            name: a.name,
            email: a.email,
            status: a.type === "agent" || a.id === params.hostUserId ? "accepted" : "invited",
        }));

        const [schedule] = await db
            .insert(crewMeetingSchedules)
            .values({
                organizationId: orgId,
                projectId: params.projectId ?? null,
                title: params.title,
                agenda: params.agenda ?? null,
                status: "proposed",
                hostUserId: params.hostUserId,
                candidateSlots,
                requestedAttendees: attendees,
                reminderMinutesBefore: params.reminderMinutesBefore ?? 15,
            })
            .returning();

        const artifact = {
            tool: "propose_meeting_schedule",
            payload: {
                type: "crew_scheduling_poll",
                scheduleId: schedule.id,
                title: schedule.title,
                agenda: schedule.agenda,
                hostUserId: schedule.hostUserId,
                candidateSlots: schedule.candidateSlots,
                requestedAttendees: schedule.requestedAttendees,
                status: schedule.status,
            },
        };

        logger.info(`Proposed meeting schedule #${schedule.id}: "${schedule.title}"`);
        return { schedule, artifact };
    }

    /**
     * Records a vote for a candidate slot by a user or participant.
     */
    async voteSlot(
        orgId: number,
        scheduleId: number,
        userId: string,
        slotId: string,
    ): Promise<CrewMeetingScheduleRecord> {
        const [schedule] = await db
            .select()
            .from(crewMeetingSchedules)
            .where(
                and(
                    eq(crewMeetingSchedules.id, scheduleId),
                    eq(crewMeetingSchedules.organizationId, orgId),
                ),
            )
            .limit(1);

        if (!schedule) {
            throw new Error(`Meeting schedule #${scheduleId} not found in organization ${orgId}`);
        }

        const slots = (schedule.candidateSlots || []) as CandidateSlot[];
        const updatedSlots = slots.map((s) => {
            const votes = new Set(s.votes || []);
            if (s.id === slotId) {
                votes.add(userId);
            } else {
                // If single-choice voting is preferred, remove from others
                votes.delete(userId);
            }
            return {
                ...s,
                votes: Array.from(votes),
            };
        });

        const attendees = (schedule.requestedAttendees || []) as RequestedAttendee[];
        const updatedAttendees = attendees.map((a) =>
            a.id === userId ? { ...a, status: "accepted" as const } : a,
        );

        const [updated] = await db
            .update(crewMeetingSchedules)
            .set({
                candidateSlots: updatedSlots,
                requestedAttendees: updatedAttendees,
                updatedAt: new Date(),
            })
            .where(eq(crewMeetingSchedules.id, scheduleId))
            .returning();

        return updated;
    }

    /**
     * Confirms the selected time slot, logs the event to Project Calendar,
     * enqueues the BullMQ auto-provisioning launch job, and returns the confirmation artifact.
     */
    async confirmMeeting(
        orgId: number,
        scheduleId: number,
        slotId: string,
        hostUserId: string,
    ): Promise<{ schedule: CrewMeetingScheduleRecord; artifact: any; icsContent: string }> {
        const [schedule] = await db
            .select()
            .from(crewMeetingSchedules)
            .where(
                and(
                    eq(crewMeetingSchedules.id, scheduleId),
                    eq(crewMeetingSchedules.organizationId, orgId),
                ),
            )
            .limit(1);

        if (!schedule) {
            throw new Error(`Meeting schedule #${scheduleId} not found`);
        }

        const slots = (schedule.candidateSlots || []) as CandidateSlot[];
        const chosenSlot = slots.find((s) => s.id === slotId) || slots[0];
        if (!chosenSlot) {
            throw new Error(`Candidate slot "${slotId}" not found in schedule #${scheduleId}`);
        }

        let bullmqJobId: string | null = null;
        const startTime = new Date(chosenSlot.startsAt);
        const delayMs = Math.max(0, startTime.getTime() - Date.now());

        // Enqueue delayed meeting launch job via BullMQ scheduler
        try {
            if (schedulerQueue) {
                const job = await schedulerQueue.add(
                    "scheduled-crew-meeting-launch",
                    { scheduleId: schedule.id, organizationId: orgId },
                    { delay: delayMs, removeOnComplete: true },
                );
                bullmqJobId = String(job.id);
            }
        } catch (queueErr) {
            logger.warn(`Could not enqueue BullMQ delayed job for meeting #${schedule.id}: ${queueErr}`);
        }

        // Insert into project_events if project-scoped
        if (schedule.projectId) {
            try {
                await db.insert(projectEvents).values({
                    projectId: schedule.projectId,
                    organizationId: orgId,
                    title: `Scheduled Meeting: ${schedule.title}`,
                    description: `Confirmed CREW multi-participant meeting. Agenda: ${schedule.agenda || "General Sync"}. [Meeting Schedule #${schedule.id}]`,
                    kind: "milestone",
                    severity: "Medium",
                    startsAt: new Date(chosenSlot.startsAt),
                    endsAt: new Date(chosenSlot.endsAt),
                    createdBy: hostUserId || schedule.hostUserId,
                });
            } catch (eventErr) {
                logger.warn(`Failed to insert projectEvent for scheduled meeting: ${eventErr}`);
            }
        }

        const [updated] = await db
            .update(crewMeetingSchedules)
            .set({
                status: "confirmed",
                confirmedSlot: { startsAt: chosenSlot.startsAt, endsAt: chosenSlot.endsAt },
                bullmqJobId,
                updatedAt: new Date(),
            })
            .where(eq(crewMeetingSchedules.id, scheduleId))
            .returning();

        const icsContent = this.generateIcs(updated);

        const artifact = {
            tool: "confirm_meeting_schedule",
            payload: {
                type: "crew_meeting_confirmed",
                scheduleId: updated.id,
                title: updated.title,
                agenda: updated.agenda,
                confirmedSlot: updated.confirmedSlot,
                requestedAttendees: updated.requestedAttendees,
                icsDownloadUrl: `/api/crew/schedules/${updated.id}/ics`,
                status: "confirmed",
            },
        };

        logger.info(`Confirmed meeting schedule #${schedule.id} for ${chosenSlot.startsAt}`);
        return { schedule: updated, artifact, icsContent };
    }

    /**
     * Generates a standard RFC 5545 iCalendar (.ics) string.
     */
    generateIcs(schedule: CrewMeetingScheduleRecord): string {
        const slot = schedule.confirmedSlot || (schedule.candidateSlots as CandidateSlot[])?.[0];
        const start = slot?.startsAt ? new Date(slot.startsAt) : new Date();
        const end = slot?.endsAt ? new Date(slot.endsAt) : new Date(start.getTime() + 45 * 60 * 1000);

        const formatIcsDate = (d: Date) =>
            d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

        const attendees = (schedule.requestedAttendees as RequestedAttendee[]) || [];
        const attendeeLines = attendees
            .filter((a) => a.email)
            .map((a) => `ATTENDEE;CN=${a.name};ROLE=REQ-PARTICIPANT:mailto:${a.email}`)
            .join("\r\n");

        return [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Oddjob//CREW Autonomous Meeting Scheduler//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:REQUEST",
            "BEGIN:VEVENT",
            `UID:oddjob-meeting-${schedule.id}@oddjob.app`,
            `DTSTAMP:${formatIcsDate(new Date())}`,
            `DTSTART:${formatIcsDate(start)}`,
            `DTEND:${formatIcsDate(end)}`,
            `SUMMARY:${schedule.title.replace(/\n/g, " ")}`,
            `DESCRIPTION:${(schedule.agenda || "CREW Discussion").replace(/\n/g, "\\n")}`,
            `ORGANIZER;CN=CREW Supervisor:mailto:supervisor@oddjob.app`,
            attendeeLines,
            "STATUS:CONFIRMED",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
            .filter(Boolean)
            .join("\r\n");
    }

    /**
     * Autonomously provisions a CREW discussion room when a scheduled meeting starts.
     */
    async launchScheduledMeeting(
        scheduleId: number,
    ): Promise<{ sessionKey: string; turn: CrewTurnRecord }> {
        const [schedule] = await db
            .select()
            .from(crewMeetingSchedules)
            .where(eq(crewMeetingSchedules.id, scheduleId))
            .limit(1);

        if (!schedule) {
            throw new Error(`Schedule #${scheduleId} not found for autonomous launch`);
        }

        const sessionKey = `crew-sched-${schedule.id}-${Date.now()}`;
        const [session] = await db
            .insert(crewSessions)
            .values({
                sessionKey,
                organizationId: schedule.organizationId,
                projectId: schedule.projectId,
                title: schedule.title,
                activeTopic: schedule.agenda || schedule.title,
                status: "active",
            })
            .returning();

        // Seed invited AI agents into the room roster
        const attendees = (schedule.requestedAttendees || []) as RequestedAttendee[];
        const agentAttendees = attendees.filter((a) => a.type === "agent");
        for (const agent of agentAttendees) {
            const agentCardId = Number(agent.id);
            if (!isNaN(agentCardId)) {
                await db
                    .insert(crewMembers)
                    // crew_members is (session_id, agent_card_id) only — it carries
                    // neither an organization nor a role. The org is on the session,
                    // and the extra keys here made this insert unbuildable.
                    .values({
                        sessionId: session.id,
                        agentCardId,
                    })
                    .onConflictDoNothing();
            }
        }

        // Post opening supervisor turn outlining agenda and attendees
        const [openingTurn] = await db
            .insert(crewTurns)
            .values({
                sessionId: session.id,
                organizationId: schedule.organizationId,
                speakerType: "supervisor",
                speakerName: crewSupervisorService.name,
                content: `👋 **Welcome to the scheduled meeting: ${schedule.title}**\n\n**Agenda:**\n${schedule.agenda || "Open collaboration and sync."}\n\n**Participants:**\n${attendees.map((a) => `- ${a.name} (${a.type === "agent" ? "AI Specialist" : "User"})`).join("\n")}`,
                round: 1,
                topic: schedule.agenda || schedule.title,
                intent: "scheduled_meeting_start",
            })
            .returning();

        // Update schedule status to launched
        await db
            .update(crewMeetingSchedules)
            .set({
                status: "launched",
                createdSessionKey: sessionKey,
                updatedAt: new Date(),
            })
            .where(eq(crewMeetingSchedules.id, scheduleId));

        logger.info(`Autonomously launched scheduled meeting #${schedule.id} in room ${sessionKey}`);
        return { sessionKey, turn: openingTurn };
    }

    /**
     * Retrieves a meeting schedule by ID.
     */
    async getSchedule(orgId: number, scheduleId: number): Promise<CrewMeetingScheduleRecord | null> {
        const [schedule] = await db
            .select()
            .from(crewMeetingSchedules)
            .where(
                and(
                    eq(crewMeetingSchedules.id, scheduleId),
                    eq(crewMeetingSchedules.organizationId, orgId),
                ),
            )
            .limit(1);

        return schedule || null;
    }
}

export const crewMeetingSchedulerService = new CrewMeetingSchedulerService();
