/**
 * Standing rooms: one CREW room per (org, source) that the system posts into.
 *
 * Something outside a conversation needs a person — an app waiting on an
 * answer, an alert nobody has looked at. Dropping it into whichever room was
 * last active makes it noise there and easy to lose; a dedicated room keyed by
 * its source gives it a history, participants and a place to discuss it.
 *
 * A room nobody takes part in is in nobody's room list, so whoever answers for
 * the source is made a participant and sent a push that opens the room.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { adminRoles, crewSessions, crewTurns, userOrgs } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { crewStreamService } from "./crew-stream.service.js";
import { crewParticipantsService } from "./crew-participants.service.js";
import { beaconRecipients } from "./crew-beacon.service.js";

const logger = createLogger("CrewStandingRooms");

type CrewSessionRow = typeof crewSessions.$inferSelect;
type CrewTurnRow = typeof crewTurns.$inferSelect;
type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface StandingRoomSpec {
    orgId: number;
    /** Stable per (org, source), so concurrent posts converge on one room. */
    sessionKey: string;
    title: string;
    activeTopic: string;
    /** The Project Space it sits in; a private project's room stays private. */
    projectId: number | null;
}

/** Path that opens a room for its org. */
export function standingRoomPath(orgId: number, sessionKey: string): string {
    return `/workspace/chat/${encodeURIComponent(sessionKey)}?orgId=${orgId}`;
}

export async function ensureStandingRoom(spec: StandingRoomSpec): Promise<CrewSessionRow | null> {
    await db
        .insert(crewSessions)
        .values({
            organizationId: spec.orgId,
            sessionKey: spec.sessionKey,
            title: spec.title,
            mode: "decide",
            activeTopic: spec.activeTopic,
            projectId: spec.projectId,
            createdBy: "system",
        })
        .onConflictDoNothing();
    const [session] = await db
        .select()
        .from(crewSessions)
        .where(and(eq(crewSessions.organizationId, spec.orgId), eq(crewSessions.sessionKey, spec.sessionKey)))
        .limit(1);
    return session ?? null;
}

export async function orgAdmins(orgId: number): Promise<string[]> {
    const admins = await db
        .select({ userId: adminRoles.userId })
        .from(adminRoles)
        .where(and(eq(adminRoles.role, "org_admin"), eq(adminRoles.organizationId, orgId)));
    return admins.map((a) => a.userId);
}

/** Whether `userId` belongs to `orgId`. Never add a non-member to a tenant's room. */
export async function isOrgMember(orgId: number, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ orgId: userOrgs.orgId })
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
        .limit(1);
    return !!row;
}

/**
 * Who answers for a room: its project's owner and user members, or — for a room
 * outside any project, or a project with nobody in it, which would otherwise
 * notify no one — the org admins plus anyone already in the room.
 */
export async function roomResponders(orgId: number, room: { id: number; projectId: number | null }): Promise<string[]> {
    if (room.projectId != null) {
        const people = await beaconRecipients(orgId, room, "");
        if (people.length > 0) return people;
    }
    const people = new Set(await orgAdmins(orgId));
    (await crewParticipantsService.list(room.id)).forEach((p) => people.add(p.userId));
    return [...people];
}

export interface RoomNotice {
    speakerName: string;
    content: string;
    artifacts?: CrewTurnRow["artifacts"];
}

/** Insert a supervisor turn into a room. Pass `tx` to make it part of a claim. */
export async function insertRoomNotice(session: CrewSessionRow, notice: RoomNotice, tx: Db | Tx = db): Promise<CrewTurnRow | null> {
    const [turn] = await tx
        .insert(crewTurns)
        .values({
            sessionId: session.id,
            organizationId: session.organizationId,
            round: 0,
            speakerType: "supervisor",
            speakerName: notice.speakerName,
            content: notice.content,
            artifacts: notice.artifacts ?? [],
            toolsUsed: [],
        })
        .returning();
    return turn ?? null;
}

/** Stream a posted turn to anyone with the room open. Call after any transaction commits. */
export function publishRoomNotice(session: CrewSessionRow, turn: CrewTurnRow): void {
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: session.organizationId,
        sessionKey: session.sessionKey,
        payload: { turn, round: turn.round },
    });
}

export interface RoomPush {
    title: string;
    body: string;
    tag: string;
    /**
     * When set, each person is pushed at most once for this (source, sourceId),
     * across processes — for sweeps that more than one worker runs.
     */
    once?: { source: string; sourceId: string | number };
}

/**
 * Make each person a participant of the room and, unless `push` is null, push
 * them a link that opens it. @returns how many were pushed (delivered, or
 * claimed when `once` is set).
 */
export async function seatAndNotify(session: CrewSessionRow, userIds: string[], push: RoomPush | null): Promise<number> {
    const { pushService } = await import("@domain/core/notifications/push.service.js");
    const url = standingRoomPath(session.organizationId, session.sessionKey);
    const payload = push && { title: push.title, body: push.body, url, tag: push.tag };
    let notified = 0;
    for (const userId of userIds) {
        await crewParticipantsService.ensureParticipant(session.id, session.organizationId, userId);
        if (!push || !payload) continue;
        try {
            if (push.once) {
                if (await pushService.sendOnce(push.once.source, push.once.sourceId, userId, payload)) notified++;
            } else if ((await pushService.sendToUser(userId, payload)) > 0) {
                notified++;
            }
        } catch (err: any) {
            logger.warn(`Push to ${userId} for room ${session.sessionKey} failed: ${err?.message ?? err}`);
        }
    }
    return notified;
}
