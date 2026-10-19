/**
 * Granola notes in CREW rooms: private until the person shares a meeting.
 *
 * No room is readable by one person only. A room outside a project opens for
 * any org member with its key, and a project room for anyone who can read the
 * project, which includes every org admin even for a private project. So inside
 * a room a Granola search reaches only the person who asked: the agent learns
 * how many meetings matched and nothing else, and the room gets a card holding
 * no meeting data that, in that person's browser only, lists their matches
 * from their own account. A meeting's notes enter the room when they press
 * Share, as a turn from them; agents read shared meetings from that snapshot,
 * never live, so a second person's question never reaches into their account.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { crewSessions, crewTurns, users } from "@shared/schema/index.js";
import { ForbiddenError, NotFoundError } from "@server/utils/errors.js";

/** Artifact tool name for a meeting shared into a room. */
export const GRANOLA_SHARE_TOOL = "granola_share";
/** Rich payload type of the private results card. */
export const GRANOLA_PRIVATE_RESULTS = "granola_private_results";

type CrewSessionRow = typeof crewSessions.$inferSelect;

export async function findRoom(organizationId: number, sessionKey: string): Promise<CrewSessionRow | null> {
    const [room] = await db
        .select()
        .from(crewSessions)
        .where(and(eq(crewSessions.organizationId, organizationId), eq(crewSessions.sessionKey, sessionKey)))
        .limit(1);
    return room ?? null;
}

/**
 * The same gate the room routes apply (authorizeRoom): the room is in the
 * caller's org, and a project room needs read access to its project.
 */
export async function authorizeRoomForUser(
    ctx: { organizationId: number; userId: string; isSuperAdmin?: boolean; isOrgAdmin?: boolean },
    sessionKey: string,
): Promise<CrewSessionRow> {
    const room = await findRoom(ctx.organizationId, sessionKey);
    if (!room) throw new NotFoundError(`Room not found: "${sessionKey}".`);
    if (room.projectId !== null) {
        const { projectService } = await import("@domain/projects/core/project.service.js");
        try {
            await projectService.getProject({
                organizationId: ctx.organizationId,
                userId: ctx.userId,
                isSuperAdmin: !!ctx.isSuperAdmin,
                isOrgAdmin: !!ctx.isOrgAdmin,
            } as any, room.projectId);
        } catch {
            throw new ForbiddenError("You cannot open this room.");
        }
    }
    return room;
}

export interface SharedMeeting {
    meetingId: string;
    sharedBy: string | null;
    turnId: number;
    item: Record<string, unknown>;
}

/** Meetings shared into a room, newest share first; the snapshot each was shared with. */
export async function sharedMeetings(sessionId: number, meetingIds?: string[]): Promise<SharedMeeting[]> {
    const turns = await db
        .select({ id: crewTurns.id, userId: crewTurns.userId, artifacts: crewTurns.artifacts })
        .from(crewTurns)
        .where(and(
            eq(crewTurns.sessionId, sessionId),
            sql`${crewTurns.artifacts} @> ${JSON.stringify([{ tool: GRANOLA_SHARE_TOOL }])}::jsonb`,
        ))
        .orderBy(sql`${crewTurns.id} DESC`);
    const wanted = meetingIds ? new Set(meetingIds) : null;
    const seen = new Set<string>();
    const out: SharedMeeting[] = [];
    for (const turn of turns) {
        for (const artifact of (turn.artifacts ?? []) as any[]) {
            if (artifact?.tool !== GRANOLA_SHARE_TOOL) continue;
            for (const item of artifact.payload?.items ?? []) {
                const id = String(item?.meetingId ?? item?.id ?? "");
                if (!id || seen.has(id) || (wanted && !wanted.has(id))) continue;
                seen.add(id);
                out.push({ meetingId: id, sharedBy: turn.userId ?? null, turnId: turn.id, item });
            }
        }
    }
    return out;
}

/**
 * Share one of the caller's meetings into a room they can open: its notes are
 * posted as a turn from them, and become what the room's agents read. Sharing
 * the same meeting twice returns the first share.
 */
export async function shareMeetingIntoRoom(
    ctx: { organizationId: number; userId: string; isSuperAdmin?: boolean; isOrgAdmin?: boolean },
    sessionKey: string,
    meetingId: string,
): Promise<{ shared: true; turnId: number | null; alreadyShared?: true }> {
    const room = await authorizeRoomForUser(ctx, sessionKey);
    const already = await sharedMeetings(room.id, [meetingId]);
    if (already.length) return { shared: true, turnId: already[0].turnId, alreadyShared: true };

    const { getGranolaForContext } = await import("./service.js");
    const { workspaceResultPayload } = await import("@domain/crew/core/crew-workspace-results.js");
    const { client } = await getGranolaForContext(ctx);
    const payload = workspaceResultPayload("granola_get_meeting", await client.getMeetings([meetingId]), { meeting_ids: [meetingId] });
    const item = payload?.items.find((i) => i.id === meetingId);
    if (!payload || !item) throw new NotFoundError("That meeting was not found in your Granola account.");

    const { crewRepository } = await import("@domain/crew/core/crew-repository.js");
    const { crewStreamService } = await import("@domain/crew/core/crew-stream.service.js");
    const { crewParticipantsService, displayNameFor } = await import("@domain/crew/core/crew-participants.service.js");
    const [person] = await db
        .select({ username: users.username, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
    const displayName = person ? displayNameFor(person) : "Someone";

    await crewParticipantsService.ensureParticipant(room.id, ctx.organizationId, ctx.userId);
    const when = item.meetingDate ? ` (${String(item.meetingDate).slice(0, 10)})` : "";
    const turn = await crewRepository.postTurn(ctx.organizationId, room.id, {
        speakerType: "user",
        speakerName: displayName,
        userId: ctx.userId,
        content: `Shared Granola notes: **${item.title}**${when}`,
        artifacts: [{ tool: GRANOLA_SHARE_TOOL, payload: { ...payload, title: "Shared Granola meeting", items: [item] } }],
    });
    await crewStreamService.publish({
        type: "turn",
        organizationId: ctx.organizationId,
        sessionKey: room.sessionKey,
        actor: ctx.userId,
        payload: { speakerType: "user" },
    });
    return { shared: true, turnId: (turn as { id?: number } | null)?.id ?? null };
}
