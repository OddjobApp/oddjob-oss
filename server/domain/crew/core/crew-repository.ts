/**
 * Crew persistence — every read and write the crew rooms make against the
 * crew_* tables.
 *
 * These 23 methods lived on CrewOrchestratorService, where they made up roughly
 * half its method count and none of its orchestration. They touch no instance
 * state (not one referenced `this`), so they are plain queries that happened to
 * hang off the orchestrator's `this`.
 *
 * Routes may not reach the database directly (lint:arch), which is why they were
 * on the service at all. A repository satisfies that rule without making the
 * orchestrator the place queries live.
 */

import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { classifyWorkType } from "./crew-work-type.js";
import {
    agentCards,
    crewBreakouts,
    crewClaims,
    crewCommitments,
    crewDecisions,
    crewHandRaises,
    crewIssues,
    crewMembers,
    crewPlans,
    crewSessions,
    crewTurns,
    crewTurnTopics,
    supervisorNotes,
    users,
    userOrgs,
    type AgentCardRecord,
    type CrewTurnRecord,
} from "@shared/schema/index.js";

export const crewRepository = {
    /**
     * Leaves `interrupting` alone: that flag is the Stop button's, and the cancel
     * route answers 409 while it is set, so a pause that set it disabled Stop
     * until the author resumed. consumeCancellation reads the pause itself.
     */
    async setAuthoringPaused(orgId: number, sessionId: number, paused: boolean) {
        await db.update(crewSessions).set({
            cycleContext: sql`jsonb_set(coalesce(${crewSessions.cycleContext}, '{}'::jsonb), '{authoringPaused}', ${JSON.stringify(paused)}::jsonb)`,
        }).where(and(eq(crewSessions.id, sessionId), eq(crewSessions.organizationId, orgId)));
    },

    async recordAuthoringPause(orgId: number, sessionId: number, message: string, userId?: string) {
        await db.insert(crewTurns).values([
            { organizationId: orgId, sessionId, speakerType: "user", speakerName: "You", userId: userId ?? null, content: message, round: 0 },
            { organizationId: orgId, sessionId, speakerType: "supervisor", speakerName: "Scribe", content: "Paused. You can edit the document. Send your next instruction, or say ‘continue’, when you’re ready. An action already in progress may finish; no further agent tools will start while paused.", round: 0 },
        ]);
    },

    async latestUserTurnId(orgId: number, sessionId: number) {
        const [turn] = await db.select({ id: crewTurns.id }).from(crewTurns)
            .where(and(eq(crewTurns.organizationId, orgId), eq(crewTurns.sessionId, sessionId), eq(crewTurns.speakerType, "user")))
            .orderBy(desc(crewTurns.id)).limit(1);
        return turn?.id;
    },
    /**
     * Looks up a room WITHOUT creating one. Returns null when the org has no such room.
     *
     * ensureSession is find-or-CREATE, and it was reachable from every read route via
     * authorizeRoom. That meant any GET could mint a room — which is exactly what
     * happened: the SSE stream arrived without an orgId, fell back to the user's
     * default org, and created the room there while the rest of the page addressed a
     * different org. A read should never have that power.
     */
    /** By numeric id, within one org — what the studio rail holds as `sessionId`. */
    async findSessionById(orgId: number, sessionId: number) {
        const [existing] = await db
            .select()
            .from(crewSessions)
            .where(and(eq(crewSessions.organizationId, orgId), eq(crewSessions.id, sessionId)))
            .limit(1);
        return existing ?? null;
    },

    async findSession(orgId: number, sessionKey: string) {
        const [existing] = await db
            .select()
            .from(crewSessions)
            .where(and(eq(crewSessions.organizationId, orgId), eq(crewSessions.sessionKey, sessionKey)))
            .limit(1);
        return existing ?? null;
    },

    /**
     * Finds a session by key. If not found in the given org, and the caller is authorized
     * (super admin or member of the owning org), resolves the owning session.
     */
    async resolveAuthorizedSession(
        sessionKey: string,
        defaultOrgId: number,
        auth: { userId?: string; isSuperAdmin: boolean },
    ) {
        const inDefault = await this.findSession(defaultOrgId, sessionKey);
        if (inDefault) return inDefault;

        const [existing] = await db
            .select()
            .from(crewSessions)
            .where(eq(crewSessions.sessionKey, sessionKey))
            .limit(1);
        if (!existing) return null;

        if (auth.isSuperAdmin) return existing;

        if (auth.userId) {
            const [membership] = await db
                .select({ orgId: userOrgs.orgId })
                .from(userOrgs)
                .where(and(eq(userOrgs.userId, auth.userId), eq(userOrgs.orgId, existing.organizationId)))
                .limit(1);
            if (membership) return existing;
        }

        return null;
    },

    /**
     * Replaces the room's roster. Cards are validated against the org so a
     * caller cannot pull another organisation's agent into the room.
     */
    async setMembers(orgId: number, sessionId: number, agentCardIds: number[]): Promise<AgentCardRecord[]> {
        const unique = [...new Set(agentCardIds)];

        const valid = unique.length
            ? await db
                  .select()
                  .from(agentCards)
                  .where(
                      and(
                          eq(agentCards.organizationId, orgId),
                          eq(agentCards.enabled, true),
                          inArray(agentCards.id, unique),
                      ),
                  )
            : [];

        await db.delete(crewMembers).where(eq(crewMembers.sessionId, sessionId));

        if (valid.length > 0) {
            await db
                .insert(crewMembers)
                .values(valid.map((c) => ({ sessionId, agentCardId: c.id })))
                .onConflictDoNothing();
        }

        return valid;
    },
    /** Active pills are a user's choice; room membership remains independent. */
    async saveActiveAgentSelection(orgId: number, sessionId: number, userId: string, agentCardIds: number[]) {
        const unique = [...new Set(agentCardIds)];
        const rows = unique.length ? await db.select({ id: agentCards.id }).from(agentCards).where(and(eq(agentCards.organizationId, orgId), eq(agentCards.enabled, true), inArray(agentCards.id, unique))) : [];
        const valid = unique.filter(id => rows.some(row => row.id === id));
        await db.update(crewSessions).set({ memory: sql`jsonb_set(coalesce(${crewSessions.memory}, '{}'::jsonb), '{activeAgentSelections}', coalesce(${crewSessions.memory}->'activeAgentSelections', '{}'::jsonb) || jsonb_build_object(${userId}::text, ${JSON.stringify(valid)}::jsonb), true)` }).where(and(eq(crewSessions.organizationId, orgId), eq(crewSessions.id, sessionId)));
        return valid;
    },

    /**
     * Adds cards to an existing roster without replacing it. The same org check as
     * setMembers applies, so a room cannot inherit another tenant's card.
     */
    async addMembers(orgId: number, sessionId: number, agentCardIds: number[]): Promise<AgentCardRecord[]> {
        const unique = [...new Set(agentCardIds)];

        const valid = unique.length
            ? await db
                  .select()
                  .from(agentCards)
                  .where(
                      and(
                          eq(agentCards.organizationId, orgId),
                          eq(agentCards.enabled, true),
                          inArray(agentCards.id, unique),
                      ),
                  )
            : [];

        if (valid.length > 0) {
            await db
                .insert(crewMembers)
                .values(valid.map((c) => ({ sessionId, agentCardId: c.id })))
                .onConflictDoNothing();
        }

        return valid;
    },

    /** Inserts one transcript row for a room owned by `orgId`. */
    async postTurn(
        orgId: number,
        sessionId: number,
        values: {
            speakerType: CrewTurnRecord["speakerType"];
            agentCardId?: number | null;
            speakerName: string;
            userId?: string | null;
            content: string;
            round?: number;
            topic?: string | null;
            intent?: string | null;
            /** Overrides the auto-classified work type (see crew-work-type.ts). */
            workType?: string | null;
            resolvedModelId?: number | null;
            /** The model/provider that actually served the turn, and whether it was a failover. */
            servedModel?: string | null;
            servedProvider?: string | null;
            wasFallback?: boolean | null;
            latencyMs?: number | null;
            toolsUsed?: CrewTurnRecord["toolsUsed"];
            artifacts?: CrewTurnRecord["artifacts"];
        },
        executor: Pick<typeof db, 'insert'> = db,
    ): Promise<CrewTurnRecord | null> {
        const [turn] = await executor.insert(crewTurns).values({
            sessionId,
            organizationId: orgId,
            speakerType: values.speakerType,
            agentCardId: values.agentCardId ?? null,
            speakerName: values.speakerName,
            userId: values.userId ?? null,
            content: values.content,
            round: values.round ?? 0,
            topic: values.topic ?? null,
            intent: values.intent ?? null,
            // The turn is what it executed: classify from tools_used + intent
            // unless the caller already knows better.
            workType: values.workType ?? classifyWorkType(values.toolsUsed, values.intent),
            resolvedModelId: values.resolvedModelId ?? null,
            servedModel: values.servedModel ?? null,
            servedProvider: values.servedProvider ?? null,
            wasFallback: values.wasFallback ?? false,
            latencyMs: values.latencyMs ?? null,
            toolsUsed: values.toolsUsed ?? [],
            artifacts: values.artifacts ?? [],
        }).returning();
        return turn ?? null;
    },

    /**
     * Declared-topic tag rows for a room, oldest first. `sinceRound` bounds by
     * the tag's round (the same rule getRoomDelta applies to notes): a tag is
     * written mid-round, so its own id cannot anchor a delta.
     */
    async getTurnTopics(
        sessionId: number,
        opts?: { sinceRound?: number; topicId?: number },
    ) {
        const conditions = [eq(crewTurnTopics.sessionId, sessionId)];
        if (opts?.sinceRound != null) conditions.push(gte(crewTurnTopics.round, opts.sinceRound));
        if (opts?.topicId != null) conditions.push(eq(crewTurnTopics.topicId, opts.topicId));
        return db
            .select()
            .from(crewTurnTopics)
            .where(and(...conditions))
            .orderBy(asc(crewTurnTopics.id));
    },

    /**
     * Backlink for a knowledge topic: every tagged turn across the
     * organization's rooms, newest first. Org-scoped on the tag row —
     * knowledge_topics rows are per-org, but the join still filters here so a
     * stale or misresolved topicId can never leak another tenant's turns.
     */
    /**
     * `visibleProjectIds` are the projects the caller may read: a room in any
     * other project (a private one they are not in) contributes nothing, or its
     * excerpts would reach every member of the org.
     */
    async getTurnsForTopic(organizationId: number, topicId: number, limit = 50, visibleProjectIds: number[] = []) {
        return db
            .select({
                turnTopicId: crewTurnTopics.id,
                turnId: crewTurns.id,
                sessionId: crewSessions.id,
                sessionKey: crewSessions.sessionKey,
                sessionTitle: crewSessions.title,
                label: crewTurnTopics.label,
                source: crewTurnTopics.source,
                speakerName: crewTurns.speakerName,
                speakerType: crewTurns.speakerType,
                round: crewTurns.round,
                excerpt: sql<string>`left(${crewTurns.content}, 240)`,
                createdAt: crewTurns.createdAt,
            })
            .from(crewTurnTopics)
            .innerJoin(crewTurns, eq(crewTurnTopics.turnId, crewTurns.id))
            .innerJoin(crewSessions, eq(crewTurnTopics.sessionId, crewSessions.id))
            .where(and(eq(crewTurnTopics.organizationId, organizationId), eq(crewTurnTopics.topicId, topicId),
                visibleProjectIds.length
                    ? or(isNull(crewSessions.projectId), inArray(crewSessions.projectId, visibleProjectIds))
                    : isNull(crewSessions.projectId)))
            .orderBy(desc(crewTurnTopics.id))
            .limit(limit);
    },

    /**
     * Applies or rejects a gated agent tag. Only rows currently 'pending' in
     * this session can transition — an already-applied user tag can never be
     * flipped by the approval surface.
     */
    async setTurnTopicStatus(organizationId: number, sessionId: number, turnTopicId: number, status: "applied" | "rejected") {
        const [row] = await db
            .update(crewTurnTopics)
            .set({ status })
            .where(and(
                eq(crewTurnTopics.id, turnTopicId),
                eq(crewTurnTopics.organizationId, organizationId),
                eq(crewTurnTopics.sessionId, sessionId),
                eq(crewTurnTopics.source, "agent"),
                eq(crewTurnTopics.status, "pending"),
            ))
            .returning();
        return row ?? null;
    },

    async getMembers(sessionId: number): Promise<AgentCardRecord[]> {
        const rows = await db
            .select({ card: agentCards })
            .from(crewMembers)
            .innerJoin(agentCards, eq(crewMembers.agentCardId, agentCards.id))
            .where(eq(crewMembers.sessionId, sessionId))
            .orderBy(asc(crewMembers.id));

        return rows.map((r) => r.card);
    },

    /**
     * The most recent `limit` turns, oldest first.
     *
     * The limit has to be applied from the NEW end. Ordering ascending and then
     * limiting returns the OLDEST rows, so every room past `limit` turns fed its
     * agents the opening of the conversation and never the exchange they were
     * actually in — `runRound` asks for TRANSCRIPT_WINDOW here, and
     * `toGenerationMessages` then takes the last window of what it was handed,
     * which cannot recover turns the query never returned.
     */
    async getTranscript(sessionId: number, limit = 200): Promise<CrewTurnRecord[]> {
        const newestFirst = await db
            .select()
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, sessionId))
            .orderBy(desc(crewTurns.id))
            .limit(limit);
        return newestFirst.reverse();
    },

    async getNotes(sessionId: number, limit = 100) {
        return db
            .select()
            .from(supervisorNotes)
            .where(eq(supervisorNotes.sessionId, sessionId))
            .orderBy(asc(supervisorNotes.id))
            .limit(limit);
    },

    async getPlans(sessionId: number) {
        return db
            .select()
            .from(crewPlans)
            .where(eq(crewPlans.sessionId, sessionId))
            .orderBy(desc(crewPlans.id));
    },

    async getDecisions(sessionId: number) {
        return db.select().from(crewDecisions).where(eq(crewDecisions.sessionId, sessionId)).orderBy(desc(crewDecisions.id));
    },

    async getClaims(sessionId: number) {
        return db.select().from(crewClaims).where(eq(crewClaims.sessionId, sessionId)).orderBy(desc(crewClaims.id));
    },

    async getCommitments(sessionId: number) {
        return db.select().from(crewCommitments).where(eq(crewCommitments.sessionId, sessionId)).orderBy(desc(crewCommitments.id));
    },

    /** Open issues raised by this room, newest first. */
    async getIssues(sessionId: number) {
        return db
            .select()
            .from(crewIssues)
            .where(eq(crewIssues.sessionId, sessionId))
            .orderBy(desc(crewIssues.id));
    },

    /** Hands raised in the most recent round only — older ones are stale. */
    async getRaisedHands(sessionId: number) {
        const [latest] = await db
            .select({ round: crewHandRaises.round })
            .from(crewHandRaises)
            .where(eq(crewHandRaises.sessionId, sessionId))
            .orderBy(desc(crewHandRaises.round))
            .limit(1);

        if (!latest) return [];

        const rows = await db
            .select({ hand: crewHandRaises, card: agentCards })
            .from(crewHandRaises)
            .innerJoin(agentCards, eq(crewHandRaises.agentCardId, agentCards.id))
            .where(
                and(
                    eq(crewHandRaises.sessionId, sessionId),
                    eq(crewHandRaises.round, latest.round),
                ),
            )
            .orderBy(desc(crewHandRaises.memoryHits), desc(crewHandRaises.affinityScore));

        return rows.map((r) => ({
            agentCardId: r.hand.agentCardId,
            agentName: r.card.name,
            reason: r.hand.reason,
            affinityScore: r.hand.affinityScore,
            memoryHits: r.hand.memoryHits,
            round: r.hand.round,
        }));
    },

    async resolveUserDisplayName(userId: string): Promise<string> {
        try {
            const { users } = await import("@shared/schema/index.js");
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
            if (!user) return "Guest";
            return (user as any).displayName || (user as any).name || (user as any).username || (user as any).email || "Guest";
        } catch {
            return "Guest";
        }
    },

    async requestRoundCancellation(sessionId: number): Promise<void> {
        await db.update(crewSessions)
            .set({ interrupting: true })
            .where(eq(crewSessions.id, sessionId));
    },

    async updateSession(sessionId: number, updates: any) {
        const [updated] = await db
            .update(crewSessions)
            .set(updates)
            .where(eq(crewSessions.id, sessionId))
            .returning();
        return updated;
    },

    async getWorkProductTurns(orgId: number, sessionId: number) {
        const rows = await db.select({ id: crewTurns.id, speakerName: crewTurns.speakerName, artifacts: crewTurns.artifacts })
            .from(crewTurns).where(and(eq(crewTurns.organizationId, orgId), eq(crewTurns.sessionId, sessionId),
                sql`${crewTurns.artifacts} @> '[{"payload":{"type":"crew_work_product"}}]'::jsonb`))
            .orderBy(desc(crewTurns.id)).limit(100);
        return rows.reverse();
    },

    async updateRoomBrief(sessionId: number, organizationId: number, brief: import('@shared/crew-room-brief').CrewRoomBrief) {
        const [updated] = await db.update(crewSessions).set({
            memory: sql`jsonb_set(${crewSessions.memory}, '{roomBrief}', ${JSON.stringify(brief)}::jsonb, true)`,
            updatedAt: new Date(),
        }).where(and(eq(crewSessions.id, sessionId), eq(crewSessions.organizationId, organizationId))).returning();
        return updated;
    },

    async findRoomTurn(orgId: number, sessionId: number, turnId: number) {
        const [turn] = await db.select().from(crewTurns).where(and(
            eq(crewTurns.organizationId, orgId), eq(crewTurns.sessionId, sessionId), eq(crewTurns.id, turnId),
        )).limit(1);
        return turn;
    },

    async createDecision(values: any) {
        const [decision] = await db.insert(crewDecisions).values(values).returning();
        return decision;
    },

    async updateDecision(decisionId: number, sessionId: number, updates: any) {
        const [decision] = await db
            .update(crewDecisions)
            .set(updates)
            .where(and(eq(crewDecisions.id, decisionId), eq(crewDecisions.sessionId, sessionId)))
            .returning();
        return decision ?? null;
    },

    async createClaim(values: any) {
        const [claim] = await db.insert(crewClaims).values(values).returning();
        return claim;
    },

    async updateClaim(claimId: number, sessionId: number, updates: any) {
        const [claim] = await db
            .update(crewClaims)
            .set(updates)
            .where(and(eq(crewClaims.id, claimId), eq(crewClaims.sessionId, sessionId)))
            .returning();
        return claim ?? null;
    },

    async createCommitment(values: any) {
        const [commitment] = await db.insert(crewCommitments).values(values).returning();
        return commitment;
    },

    async updateCommitment(commitmentId: number, sessionId: number, updates: any) {
        const [commitment] = await db
            .update(crewCommitments)
            .set(updates)
            .where(and(eq(crewCommitments.id, commitmentId), eq(crewCommitments.sessionId, sessionId)))
            .returning();
        return commitment ?? null;
    },

    /**
     * Breakout lineage for a room: the parent it was spawned from (if any) and the
     * children it spawned. Lives here rather than in the route because lint:arch
     * forbids direct db access from route handlers.
     */
    async getBreakoutLineage(orgId: number, session: { id: number; parentSessionId: number | null }) {
        const children = await db
            .select({
                id: crewBreakouts.id,
                childSessionId: crewBreakouts.childSessionId,
                subTopic: crewBreakouts.subTopic,
                suggestedBy: crewBreakouts.suggestedBy,
                createdAt: crewBreakouts.createdAt,
                childSessionKey: crewSessions.sessionKey,
                childTitle: crewSessions.title,
            })
            .from(crewBreakouts)
            .innerJoin(crewSessions, eq(crewSessions.id, crewBreakouts.childSessionId))
            .where(eq(crewBreakouts.parentSessionId, session.id));

        let parent: { sessionKey: string; title: string | null } | null = null;
        if (session.parentSessionId) {
            const [parentSession] = await db
                .select({ sessionKey: crewSessions.sessionKey, title: crewSessions.title })
                .from(crewSessions)
                .where(and(
                    eq(crewSessions.id, session.parentSessionId),
                    eq(crewSessions.organizationId, orgId),
                ))
                .limit(1);
            parent = parentSession ?? null;
        }

        return { parent, children };
    },

    async getRoomConclusionData(sessionId: number) {
        const [decisions, claims, commitments, lastTurn] = await Promise.all([
            db.select().from(crewDecisions).where(eq(crewDecisions.sessionId, sessionId)),
            db.select().from(crewClaims).where(eq(crewClaims.sessionId, sessionId)),
            db.select().from(crewCommitments).where(eq(crewCommitments.sessionId, sessionId)),
            db.select().from(crewTurns).where(eq(crewTurns.sessionId, sessionId)).orderBy(desc(crewTurns.id)).limit(1),
        ]);
        return { decisions, claims, commitments, lastTurn: lastTurn[0] ?? null };
    },

    async archiveSession(sessionId: number) {
        const [updatedSession] = await db
            .update(crewSessions)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(crewSessions.id, sessionId))
            .returning();
        return updatedSession;
    },

    /**
     * Adopt a project for a room that does not yet have one.
     *
     * Was an inline `db.update` inside the attachment upload route, the single
     * thing keeping `lint:arch` red on this branch: route handlers may not reach
     * the database directly.
     */
    async setSessionProject(sessionId: number, projectId: number) {
        const [updated] = await db
            .update(crewSessions)
            .set({ projectId })
            .where(eq(crewSessions.id, sessionId))
            .returning();
        return updated ?? null;
    },
};
