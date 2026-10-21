/**
 * Which AgentMail threads a caller may read.
 *
 * An organization has one AgentMail inbox, but not every thread in it is the whole
 * organization's: a thread started from a private project's CREW room, or about a
 * mission in that project, belongs to that project. agentmail_threads records the
 * project when the thread is first linked; reads filter on it.
 *
 * A thread with no row, or a row with no project, is the organization's, as before.
 * A thread whose project the caller cannot read answers exactly like a thread that
 * does not exist, so its existence is not disclosed either.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentmailThreads, crewSessions, missionRuns } from "@shared/schema/index.js";
import { assertOrgId } from "@server/utils/auth-context.js";
import { NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { projectService, type ProjectCtx } from "@server/domain/projects/core/project.service.js";

const logger = createLogger("AgentMailThreadScope");

export interface ThreadLink {
    projectId?: number | null;
    crewSessionId?: number | null;
    missionRunId?: number | null;
}

/** The caller's identity as project access sees it. No user: only org-visible projects. */
export function threadScopeCtx(context: {
    organizationId?: number | null;
    userId?: string;
    agentName?: string;
    isOrgAdmin?: boolean;
    isSuperAdmin?: boolean;
} | undefined, organizationId: number): ProjectCtx {
    return {
        organizationId,
        userId: context?.userId,
        agentId: context?.agentName,
        isOrgAdmin: context?.isOrgAdmin === true,
        isSuperAdmin: context?.isSuperAdmin === true,
    };
}

export const agentMailThreadScope = {
    /**
     * Record which project a thread belongs to. A thread that already has a project
     * keeps it: linking can narrow an unscoped thread but never moves or widens one.
     */
    async record(organizationId: number, threadId: string, link: ThreadLink): Promise<void> {
        const orgId = assertOrgId(organizationId);
        if (!threadId) return;
        await db.insert(agentmailThreads)
            .values({
                organizationId: orgId,
                threadId,
                projectId: link.projectId ?? null,
                crewSessionId: link.crewSessionId ?? null,
                missionRunId: link.missionRunId ?? null,
            })
            .onConflictDoUpdate({
                target: [agentmailThreads.organizationId, agentmailThreads.threadId],
                set: {
                    projectId: sql`COALESCE(${agentmailThreads.projectId}, EXCLUDED.project_id)`,
                    crewSessionId: sql`COALESCE(${agentmailThreads.crewSessionId}, EXCLUDED.crew_session_id)`,
                    missionRunId: sql`COALESCE(${agentmailThreads.missionRunId}, EXCLUDED.mission_run_id)`,
                },
            });
    },

    /** Record a thread started from a CREW room, under the room's project. */
    async recordForCrewSession(organizationId: number, threadId: string, sessionId: number): Promise<void> {
        const orgId = assertOrgId(organizationId);
        const [session] = await db.select({ projectId: crewSessions.projectId })
            .from(crewSessions)
            .where(and(eq(crewSessions.id, sessionId), eq(crewSessions.organizationId, orgId)))
            .limit(1);
        if (!session) return;
        await this.record(orgId, threadId, { projectId: session.projectId, crewSessionId: sessionId });
    },

    /** Record a thread about a mission run, under the mission's primary project. */
    async recordForMissionRun(organizationId: number, threadId: string, missionRunId: number): Promise<void> {
        const orgId = assertOrgId(organizationId);
        const [run] = await db.select({ missionId: missionRuns.missionId })
            .from(missionRuns)
            .where(eq(missionRuns.id, missionRunId))
            .limit(1);
        const projectId = run?.missionId
            ? await projectService.resolveProjectForResource("mission", run.missionId)
            : null;
        await this.record(orgId, threadId, { projectId, missionRunId });
    },

    /**
     * A predicate over thread ids: true when ctx may read the thread. Built once per
     * request so a listing costs two queries, not one per thread.
     */
    async readableFilter(ctx: ProjectCtx): Promise<(threadId: string) => boolean> {
        const orgId = assertOrgId(ctx.organizationId);
        const scoped = await db.select({ threadId: agentmailThreads.threadId, projectId: agentmailThreads.projectId })
            .from(agentmailThreads)
            .where(and(eq(agentmailThreads.organizationId, orgId), isNotNull(agentmailThreads.projectId)));
        if (scoped.length === 0) return () => true;

        const readable = new Set(
            (await projectService.listProjects(ctx, { includeArchived: true })).map((p) => p.id),
        );
        const hidden = new Set(scoped.filter((t) => !readable.has(t.projectId!)).map((t) => t.threadId));
        return (threadId: string) => !hidden.has(threadId);
    },

    /** Drop the threads ctx may not read from a listing. */
    async filterThreads<T extends { thread_id: string }>(ctx: ProjectCtx, threads: T[]): Promise<T[]> {
        const canRead = await this.readableFilter(ctx);
        return threads.filter((t) => canRead(t.thread_id));
    },

    /** Throw NotFoundError, indistinguishable from a missing thread, unless ctx may read it. */
    async assertReadable(ctx: ProjectCtx, threadId: string): Promise<void> {
        const orgId = assertOrgId(ctx.organizationId);
        const [row] = await db.select({ projectId: agentmailThreads.projectId })
            .from(agentmailThreads)
            .where(and(eq(agentmailThreads.organizationId, orgId), eq(agentmailThreads.threadId, threadId)))
            .limit(1);
        if (!row || row.projectId == null) return;
        const readable = await projectService.listProjects(ctx, { includeArchived: true });
        if (!readable.some((p) => p.id === row.projectId)) {
            logger.debug(`[ThreadScope] Thread ${threadId} withheld: project ${row.projectId} not readable`);
            throw new NotFoundError("Thread not found");
        }
    },
};
