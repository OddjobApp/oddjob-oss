import {
    ListMissionsInput,
    GetMissionDetailsInput,
    UpdateMissionInput,
} from "../tools/missions.js";
import { missionService } from "../../domain/mission/index.js";
import {
    successResponse,
    getOrgContext,
    createHandlerWrapper,
    type ToolContext
} from "./utils.js";
import { db } from "../../database_service.js";
import { missions, missionMembers, pipelineExecutions } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

export const handleListMissions = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListMissionsInput.parse(args);
        const orgContext = getOrgContext(context);

        const results = await db.select({
            id: missions.id,
            name: missions.name,
            type: missions.type,
            objective: missions.objective,
            memberCount: sql<number>`(SELECT COUNT(*) FROM mission_members WHERE mission_id = ${missions.id})`,
            activeRuns: sql<number>`(SELECT COUNT(*) FROM pipeline_executions WHERE mission_id = ${missions.id} AND status = 'running')`,
            createdAt: missions.createdAt
        })
            .from(missions)
            .where(orgContext.organizationId ? eq(missions.organizationId, orgContext.organizationId) : undefined)
            .limit(input.limit)
            .orderBy(missions.createdAt);

        return successResponse(results, `Found ${results.length} missions`);
    }
);

export const handleGetMissionDetails = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionDetailsInput.parse(args);
        const orgContext = getOrgContext(context);

        const [wg] = await db.select().from(missions).where(eq(missions.id, input.missionId)).limit(1);
        if (!wg) throw new Error("Mission not found");

        const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, input.missionId));
        const activeRuns = await db.select().from(pipelineExecutions).where(sql`${pipelineExecutions.missionId} = ${input.missionId} AND ${pipelineExecutions.status} = 'running'`);

        return successResponse({
            ...wg,
            members,
            activeRuns
        });
    }
);

export const handleUpdateMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateMissionInput.parse(args);
        const orgContext = getOrgContext(context);

        const [updated] = await db.update(missions)
            .set({
                name: input.name,
                objective: input.objective,
                blackboard: input.blackboard,
                updatedAt: new Date()
            })
            .where(eq(missions.id, input.missionId))
            .returning();

        return successResponse(updated, `Updated mission "${updated.name}"`);
    },
    { requireAdmin: true }
);

