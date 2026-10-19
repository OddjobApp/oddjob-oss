
import { db } from "@server/database_service.js";
import { analysisSessions, type CreateAnalysisSessionInput } from "@shared/schema/index.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../domain/jobs/job.service.js";
import { getOrgConditions } from "../../../utils/index.js";

const logger = createLogger("AnalysisService");

export const analysisService = {
    /**
     * Analysis Session Management
     */
    async createSession(input: CreateAnalysisSessionInput, orgContext: OrgContext) {
        return withQueryTracking("analysisService.createSession", async () => {
            const [session] = await db.insert(analysisSessions).values({
                ...input,
                organizationId: orgContext.organizationId,
                createdBy: orgContext.userId.toString(),
            }).returning();
            return session;
        }, { table: "analysis_sessions", operation: "insert" });
    },

    async getSession(id: number, orgContext: OrgContext) {
        return withQueryTracking("analysisService.getSession", async () => {
            const [session] = await db.select().from(analysisSessions)
                .where(and(
                    eq(analysisSessions.id, id),
                    orgContext.organizationId !== null
                        ? eq(analysisSessions.organizationId, orgContext.organizationId)
                        : sql`${analysisSessions.organizationId} IS NULL`
                ));

            if (!session) throw new NotFoundError(`Session not found with ID ${id}`);
            return session;
        }, { table: "analysis_sessions", operation: "select" });
    },

    async listSessions(orgContext: OrgContext) {
        return withQueryTracking("analysisService.listSessions", async () => {
            return db.select().from(analysisSessions)
                .where(eq(analysisSessions.organizationId, orgContext.organizationId as number))
                .orderBy(desc(analysisSessions.updatedAt));
        }, { table: "analysis_sessions", operation: "select" });
    },
};


