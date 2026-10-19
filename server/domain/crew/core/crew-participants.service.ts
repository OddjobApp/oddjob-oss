/**
 * Crew Participants Service
 *
 * Who — which humans — belongs to a crew room.
 *
 * The room was previously single-user by accident rather than design: the
 * transcript could already represent several people (crew_turns.speaker_type
 * 'user' with a free-text speaker_name), but nothing recorded membership and
 * every human turn was labelled "You".
 *
 * Access is layered on what already exists rather than invented:
 *   - the room is org-scoped, and getUserOrgContext resolves the caller's org;
 *   - the room is Project Space scoped, and withProjectScope applies the read
 *     gate before a request reaches here;
 *   - so an invite only has to check that the invitee is in the same org.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    crewParticipants,
    crewSessions,
    crewTurns,
    crewBreakouts,
    crewAttachments,
    userOrgs,
    users,
    orgs,
} from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import type { CrewParticipantRecord, CrewParticipantRole, CrewSessionRecord } from "@shared/schema/crew.js";

const logger = createLogger("CrewParticipantsService");

export interface ParticipantView {
    userId: string;
    username: string;
    displayName: string;
    role: CrewParticipantRole;
    joinedAt: Date | null;
}

export interface RoomResourceCounts {
    apps: number;
    documents: number;
    forms: number;
    breakouts: number;
}

export interface RoomSummary {
    sessionKey: string;
    title: string | null;
    status: "active" | "archived";
    role: CrewParticipantRole;
    projectId: number | null;
    activeTopic: string | null;
    participantCount: number;
    attachmentCount: number;
    resourceCounts: RoomResourceCounts;
    isBreakout: boolean;
    parentSessionId: number | null;
    updatedAt: Date | null;
    /** The room's organization: a client listing several orgs pins each room's org from this. */
    organizationId: number;
}

/** A room in a cross-organization list, named by its organization. */
export interface OrgRoomSummary extends RoomSummary {
    organizationName: string | null;
}

/** Prefers a real name, falling back to the username. */
export function displayNameFor(user: {
    username: string;
    firstName?: string | null;
    lastName?: string | null;
}): string {
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username;
}

export class CrewParticipantsService {
    /**
     * Records the caller as a participant. The first person in a room owns it.
     *
     * Idempotent — re-entering a room you already belong to updates presence
     * rather than erroring.
     */
    async ensureParticipant(
        sessionId: number,
        orgId: number,
        userId: string,
        role?: CrewParticipantRole,
    ): Promise<void> {
        try {
            const existing = await db
                .select({ id: crewParticipants.id })
                .from(crewParticipants)
                .where(
                    and(
                        eq(crewParticipants.sessionId, sessionId),
                        eq(crewParticipants.userId, userId),
                    ),
                )
                .limit(1);

            if (existing.length > 0) {
                await db
                    .update(crewParticipants)
                    .set({ lastSeenAt: new Date() })
                    .where(eq(crewParticipants.id, existing[0].id));
                return;
            }

            // First participant owns the room.
            const [{ count } = { count: 0 }] = await db
                .select({ count: crewParticipants.id })
                .from(crewParticipants)
                .where(eq(crewParticipants.sessionId, sessionId))
                .limit(1);

            await db
                .insert(crewParticipants)
                .values({
                    sessionId,
                    organizationId: orgId,
                    userId,
                    role: role ?? (count ? "member" : "owner"),
                    lastSeenAt: new Date(),
                })
                .onConflictDoNothing();
        } catch (err) {
            // Presence must never break a round.
            logger.warn(
                `Failed to record participant ${userId} in session ${sessionId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }

    /** Everyone in the room, resolved to real names. */
    async list(sessionId: number): Promise<ParticipantView[]> {
        const rows = await db
            .select({ p: crewParticipants, u: users })
            .from(crewParticipants)
            .leftJoin(users, eq(crewParticipants.userId, users.id))
            .where(eq(crewParticipants.sessionId, sessionId))
            .orderBy(asc(crewParticipants.id));

        return rows.map(({ p, u }) => ({
            userId: p.userId,
            username: u?.username ?? p.userId,
            displayName: u ? displayNameFor(u) : p.userId,
            role: p.role,
            joinedAt: p.joinedAt,
        }));
    }

    async isParticipant(sessionId: number, userId: string): Promise<boolean> {
        const [row] = await db
            .select({ id: crewParticipants.id })
            .from(crewParticipants)
            .where(
                and(
                    eq(crewParticipants.sessionId, sessionId),
                    eq(crewParticipants.userId, userId),
                ),
            )
            .limit(1);
        return Boolean(row);
    }

    /**
     * Adds someone to a room by user id or username.
     *
     * The invitee must share the caller's organisation. Project Space access is
     * already enforced upstream by withProjectScope, so a room the caller could
     * not see never reaches this point.
     */
    async invite(params: {
        sessionId: number;
        orgId: number;
        invitedBy: string;
        identifier: string;
    }): Promise<{ ok: true; participant: ParticipantView } | { ok: false; error: string }> {
        const { sessionId, orgId, invitedBy, identifier } = params;

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, identifier))
            .limit(1)
            .then((rows) =>
                rows.length
                    ? rows
                    : db.select().from(users).where(eq(users.username, identifier)).limit(1),
            );

        if (!user) return { ok: false, error: `No user found matching "${identifier}".` };

        const [membership] = await db
            .select({ userId: userOrgs.userId })
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, user.id), eq(userOrgs.orgId, orgId)))
            .limit(1);
        if (!membership) {
            return { ok: false, error: `"${user.username}" is not in this organization.` };
        }

        await db
            .insert(crewParticipants)
            .values({
                sessionId,
                organizationId: orgId,
                userId: user.id,
                role: "member",
                invitedBy,
            })
            .onConflictDoNothing();

        logger.info(`Invited ${user.username} to crew session ${sessionId}`);

        return {
            ok: true,
            participant: {
                userId: user.id,
                username: user.username,
                displayName: displayNameFor(user),
                role: "member",
                joinedAt: new Date(),
            },
        };
    }

    /**
     * Every room in a Project Space, regardless of who participates.
     *
     * Visibility is already settled upstream: withProjectScope applies the
     * Project Space read gate, so a project the caller cannot see never resolves
     * and this is never reached for it.
     */
    /**
     * Enriches a batch of crew sessions with participant counts, attachment counts,
     * generated resource tallies (apps, documents, forms, breakouts), and breakout status.
     */
    private async enrichRooms(
        sessions: CrewSessionRecord[],
        roles?: Map<number, CrewParticipantRole>,
    ): Promise<RoomSummary[]> {
        if (sessions.length === 0) return [];
        const sessionIds = sessions.map((s) => s.id);

        // 1. Participant counts
        const participantCounts = new Map<number, number>();
        const allParticipants = await db
            .select({ sessionId: crewParticipants.sessionId })
            .from(crewParticipants)
            .where(inArray(crewParticipants.sessionId, sessionIds));
        for (const row of allParticipants) {
            participantCounts.set(row.sessionId, (participantCounts.get(row.sessionId) ?? 0) + 1);
        }

        // 2. Attachment counts
        const attachmentCounts = new Map<number, number>();
        try {
            const allAttachments = await db
                .select({ sessionId: crewAttachments.sessionId })
                .from(crewAttachments)
                .where(inArray(crewAttachments.sessionId, sessionIds));
            for (const row of allAttachments) {
                attachmentCounts.set(row.sessionId, (attachmentCounts.get(row.sessionId) ?? 0) + 1);
            }
        } catch {
            // Non-fatal if table not queryable
        }

        // 3. Breakout child counts
        const breakoutCounts = new Map<number, number>();
        try {
            const allBreakouts = await db
                .select({ parentSessionId: crewBreakouts.parentSessionId })
                .from(crewBreakouts)
                .where(inArray(crewBreakouts.parentSessionId, sessionIds));
            for (const row of allBreakouts) {
                breakoutCounts.set(row.parentSessionId, (breakoutCounts.get(row.parentSessionId) ?? 0) + 1);
            }
        } catch {
            // Non-fatal
        }

        // 4. Artifact resource counts from turns
        const resourceMap = new Map<number, RoomResourceCounts>();
        try {
            const turnArtifacts = await db
                .select({ sessionId: crewTurns.sessionId, artifacts: crewTurns.artifacts })
                .from(crewTurns)
                .where(inArray(crewTurns.sessionId, sessionIds));

            for (const row of turnArtifacts) {
                if (!resourceMap.has(row.sessionId)) {
                    resourceMap.set(row.sessionId, { apps: 0, documents: 0, forms: 0, breakouts: 0 });
                }
                const c = resourceMap.get(row.sessionId)!;
                const list = Array.isArray(row.artifacts) ? (row.artifacts as any[]) : [];
                for (const a of list) {
                    const tool = String(a?.tool || "").toLowerCase();
                    const type = String(a?.payload?.type || "").toLowerCase();
                    if (
                        tool.includes("app") ||
                        type.includes("app") ||
                        tool.includes("scaffold") ||
                        tool.includes("mount_builder_pod") ||
                        tool.includes("deploy_forged_app")
                    ) {
                        c.apps++;
                    } else if (
                        tool.includes("presentation") ||
                        tool.includes("word") ||
                        tool.includes("pdf") ||
                        type.includes("deck") ||
                        type.includes("presentation") ||
                        type.includes("whitepaper") ||
                        type.includes("document")
                    ) {
                        c.documents++;
                    } else if (
                        tool.includes("form") ||
                        tool.includes("intake") ||
                        type.includes("form") ||
                        type.includes("calculator")
                    ) {
                        c.forms++;
                    } else if (
                        tool.includes("breakout") ||
                        type.includes("breakout")
                    ) {
                        c.breakouts++;
                    }
                }
            }
        } catch {
            // Non-fatal
        }

        return sessions.map((s) => {
            const res = resourceMap.get(s.id) ?? { apps: 0, documents: 0, forms: 0, breakouts: 0 };
            const totalBreakouts = (breakoutCounts.get(s.id) ?? 0) + res.breakouts;
            return {
                sessionKey: s.sessionKey,
                title: s.title,
                status: s.status,
                role: (roles?.get(s.id) ?? "member") as CrewParticipantRole,
                projectId: s.projectId,
                activeTopic: s.activeTopic,
                participantCount: participantCounts.get(s.id) ?? 0,
                attachmentCount: attachmentCounts.get(s.id) ?? 0,
                resourceCounts: {
                    apps: res.apps,
                    documents: res.documents,
                    forms: res.forms,
                    breakouts: totalBreakouts,
                },
                isBreakout: Boolean(s.parentSessionId),
                parentSessionId: s.parentSessionId ?? null,
                updatedAt: s.updatedAt,
                organizationId: s.organizationId,
            };
        });
    }

    async listRoomsForProject(orgId: number, projectId: number, limit = 50): Promise<RoomSummary[]> {
        const sessions = await db
            .select()
            .from(crewSessions)
            .where(
                and(
                    eq(crewSessions.organizationId, orgId),
                    eq(crewSessions.projectId, projectId),
                ),
            )
            .orderBy(desc(crewSessions.updatedAt))
            .limit(limit);

        return this.enrichRooms(sessions);
    }

    /** Rooms this user belongs to — how an invitee finds a room they were added to. */
    async listRoomsForUser(orgId: number, userId: string, limit = 30): Promise<RoomSummary[]> {
        const rows = await db
            .select({ p: crewParticipants, s: crewSessions })
            .from(crewParticipants)
            .innerJoin(crewSessions, eq(crewParticipants.sessionId, crewSessions.id))
            .where(
                and(
                    eq(crewParticipants.userId, userId),
                    eq(crewParticipants.organizationId, orgId),
                ),
            )
            .orderBy(desc(crewSessions.updatedAt))
            .limit(limit);

        if (rows.length === 0) return [];

        const sessions = rows.map((r) => r.s);
        const roles = new Map<number, CrewParticipantRole>();
        for (const r of rows) {
            roles.set(r.s.id, r.p.role);
        }

        return this.enrichRooms(sessions, roles);
    }

    /**
     * Rooms the user is in across every organization they belong to, newest
     * first. Membership is user_orgs (plus [extraOrgId], an org-admin role's
     * org): a participant row left behind in an org the user has since left
     * lists nothing, because both the participant and the room must be in a
     * member org.
     */
    async listRoomsForUserAcrossOrgs(userId: string, extraOrgId: number | null = null, limit = 60): Promise<OrgRoomSummary[]> {
        const memberships = await db.select({ orgId: userOrgs.orgId }).from(userOrgs).where(eq(userOrgs.userId, userId));
        const orgIds = [...new Set([...memberships.map((m) => m.orgId), ...(extraOrgId != null ? [extraOrgId] : [])])];
        if (orgIds.length === 0) return [];

        const rows = await db
            .select({ p: crewParticipants, s: crewSessions })
            .from(crewParticipants)
            .innerJoin(crewSessions, eq(crewParticipants.sessionId, crewSessions.id))
            .where(
                and(
                    eq(crewParticipants.userId, userId),
                    inArray(crewParticipants.organizationId, orgIds),
                    inArray(crewSessions.organizationId, orgIds),
                    eq(crewSessions.organizationId, crewParticipants.organizationId),
                ),
            )
            .orderBy(desc(crewSessions.updatedAt))
            .limit(limit);
        if (rows.length === 0) return [];

        const roles = new Map<number, CrewParticipantRole>();
        for (const r of rows) roles.set(r.s.id, r.p.role);
        const names = new Map(
            (await db.select({ id: orgs.id, name: orgs.name }).from(orgs).where(inArray(orgs.id, orgIds)))
                .map((o) => [o.id, o.name] as const),
        );
        const rooms = await this.enrichRooms(rows.map((r) => r.s), roles);
        return rooms.map((room) => ({ ...room, organizationName: names.get(room.organizationId) ?? null }));
    }
}

export const crewParticipantsService = new CrewParticipantsService();

