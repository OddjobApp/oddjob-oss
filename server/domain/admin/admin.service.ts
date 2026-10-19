import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { db } from "@server/database_service.js";
import {
    orgSettings,
    adminRoles,
    users,
    orgs,
    suppressionPolicies,
    aiUsageLogs,
    missionShadowRuns,
    missionRuns,
    missions,
    forensicEventLog,
    approvalRequests
} from "@shared/schema/index.js";
import { eq, and, sql, gte, desc, inArray, or } from "drizzle-orm";

export class AdminService {
    /**
     * Get Organization Settings
     */
    async getOrgSettings(orgId: number) {
        if (!orgId) throw new BadRequestError("Organization ID required");

        const [settings] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, orgId))
            .limit(1);

        if (!settings) {
            return {
                organizationId: orgId,
                knowledgeStoreEnabled: true,
                knowledgeGraphEnabled: true,
                psychologistEnabled: true,
                skillImportEnabled: true,
                autoresearchEnabled: true,
                trustgraphEnabled: true,
                mcpHttpEnabled: false,
                missionConcurrency: 1,
                monthlyBudgetUsd: "100.00",
                budgetResetDay: 1,
                datasetsEnabled: true,
                trycuaEnabled: false,
                trycuaDefaultOs: "linux",
                trycuaMaxSessionTime: 60,
            };

        }
        return settings;
    }

    /**
     * Update Organization Settings
     */
    async updateOrgSettings(orgId: number, settings: any) {
        if (!orgId) throw new BadRequestError("Organization ID required");

        const [existing] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)).limit(1);

        if (existing) {
            const updateData: Record<string, unknown> = {
                knowledgeStoreEnabled: settings.knowledgeStoreEnabled,
                knowledgeGraphEnabled: settings.knowledgeGraphEnabled,
                psychologistEnabled: settings.psychologistEnabled,
                skillImportEnabled: settings.skillImportEnabled,
                autoresearchEnabled: settings.autoresearchEnabled,
                trustgraphEnabled: settings.trustgraphEnabled,
                mcpHttpEnabled: settings.mcpHttpEnabled,
                allowedAgentTools: settings.allowedAgentTools,
                allowedJobTypes: settings.allowedJobTypes,
                missionConcurrency: settings.missionConcurrency,
                monthlyBudgetUsd: settings.monthlyBudgetUsd,
                budgetResetDay: settings.budgetResetDay,
                datasetsEnabled: settings.datasetsEnabled,
                updatedAt: new Date()
            };

            if (settings.trycuaEnabled !== undefined) updateData.trycuaEnabled = Boolean(settings.trycuaEnabled);
            if (settings.enterpriseRbacEnforced !== undefined) updateData.enterpriseRbacEnforced = Boolean(settings.enterpriseRbacEnforced);
            if (settings.trycuaDefaultOs !== undefined) updateData.trycuaDefaultOs = normalizeTrycuaOs(settings.trycuaDefaultOs);
            if (settings.trycuaMaxSessionTime !== undefined) updateData.trycuaMaxSessionTime = normalizeTrycuaMaxSessionTime(settings.trycuaMaxSessionTime);

            if (settings.embedOAuthConfig !== undefined) updateData.embedOAuthConfig = settings.embedOAuthConfig;
            if (settings.profileApiDomainAllowlist !== undefined) updateData.profileApiDomainAllowlist = settings.profileApiDomainAllowlist;
            const [updated] = await db.update(orgSettings)
                .set(updateData as any)
                .where(eq(orgSettings.organizationId, orgId))
                .returning();
            return updated;
        } else {
            const insertData: Record<string, unknown> = {
                organizationId: orgId,
                knowledgeStoreEnabled: settings.knowledgeStoreEnabled ?? true,
                knowledgeGraphEnabled: settings.knowledgeGraphEnabled ?? true,
                psychologistEnabled: settings.psychologistEnabled ?? true,
                skillImportEnabled: settings.skillImportEnabled ?? false,
                autoresearchEnabled: settings.autoresearchEnabled ?? true,
                trustgraphEnabled: settings.trustgraphEnabled ?? true,
                mcpHttpEnabled: settings.mcpHttpEnabled ?? false,
                allowedAgentTools: settings.allowedAgentTools,
                allowedJobTypes: settings.allowedJobTypes,
                missionConcurrency: settings.missionConcurrency ?? 1,
                monthlyBudgetUsd: settings.monthlyBudgetUsd ?? "100.00",
                budgetResetDay: settings.budgetResetDay ?? 1,
                datasetsEnabled: settings.datasetsEnabled ?? true,
                trycuaEnabled: settings.trycuaEnabled ?? false,
                trycuaDefaultOs: normalizeTrycuaOs(settings.trycuaDefaultOs ?? "linux"),
                trycuaMaxSessionTime: normalizeTrycuaMaxSessionTime(settings.trycuaMaxSessionTime ?? 60),
                enterpriseRbacEnforced: settings.enterpriseRbacEnforced ?? false,
            };

            if (settings.embedOAuthConfig !== undefined) insertData.embedOAuthConfig = settings.embedOAuthConfig;
            if (settings.profileApiDomainAllowlist !== undefined) insertData.profileApiDomainAllowlist = settings.profileApiDomainAllowlist;
            const [created] = await db.insert(orgSettings)
                .values(insertData as any)
                .returning();
            return created;
        }
    }

    /**
     * Assign an admin role to a user.
     */
    async assignAdminRole(userId: string, role: string, organizationId: number | null) {
        if (!userId || !role) throw new BadRequestError("userId and role required");
        const VALID_ROLES = ["super_admin", "org_admin"] as const;
        if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
            throw new BadRequestError(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
        }
        if (role === "org_admin" && !organizationId) throw new BadRequestError("organizationId required for org_admin");

        const [existingRole] = await db.select().from(adminRoles).where(eq(adminRoles.userId, userId)).limit(1);
        const [assigned] = existingRole
            ? await db.update(adminRoles)
                .set({ role, organizationId: role === "super_admin" ? null : organizationId })
                .where(eq(adminRoles.userId, userId))
                .returning()
            : await db.insert(adminRoles).values({
                userId,
                role,
                organizationId: role === "super_admin" ? null : organizationId
            }).returning();

        if (role === "super_admin") {
            const { financeRolesService } = await import('@domain/projects/core/finance-roles.service.js');
            await financeRolesService.ensureSystemExecutive(userId, userId);
        }
        return assigned;
    }

    /**
     * List all admin roles.
     */
    async listAdminRoles() {
        const roles = await db.select({
            id: adminRoles.id,
            userId: adminRoles.userId,
            role: adminRoles.role,
            organizationId: adminRoles.organizationId,
            createdAt: adminRoles.createdAt,
            username: users.username,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            orgName: orgs.name
        })
            .from(adminRoles)
            .leftJoin(users, eq(adminRoles.userId, users.id))
            .leftJoin(orgs, eq(adminRoles.organizationId, orgs.id));

        return roles;
    }

    /**
     * Remove an admin role.
     */
    async removeAdminRole(roleId: number) {
        const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
        if (!role) throw new NotFoundError("Role not found", "NOT_FOUND", { roleId });

        if (role.role === "org_admin" && role.organizationId) {
            const otherAdmins = await db.select()
                .from(adminRoles)
                .where(and(
                    eq(adminRoles.role, "org_admin"),
                    eq(adminRoles.organizationId, role.organizationId),
                    sql`${adminRoles.id} != ${roleId}`
                ));

            if (otherAdmins.length === 0) throw new BadRequestError("Cannot remove the last admin");
        }
        await db.delete(adminRoles).where(eq(adminRoles.id, roleId));
    }

    /**
     * Proactively scans all monitored skills for poor performance and 
     * initiates autonomous evolution cycles (Neural Core Sync).
     */
    async syncNeuralCore(orgId: number) {
        const { SentinelService } = await import("../agents/core/sentinel.service.js");
        const { autoresearchService } = await import("../mission/core/autoresearch.service.js");

        // 1. Identify skills with < 80% reliability inside this organization.
        const candidates = await SentinelService.getEvolutionCandidatesForOrg(orgId, 80);
        if (candidates.length === 0) {
            return {
                message: "Neural Core is synchronized. No skills meet acceleration criteria.",
                candidatesTriggered: 0,
                candidatesFound: 0,
                blockedCandidates: 0,
                details: []
            };
        }

        let triggered = 0;
        let blocked = 0;
        const results = [];

        // 2. Limit to top 5 to prevent token spikes
        const targetCandidates = candidates.slice(0, 5);

        for (const candidate of targetCandidates) {
            const skillId = candidate.skillId;
            const runId = candidate.latestMissionRunId;

            if (runId) {
                // Initiate evolution (non-blocking)
                autoresearchService.initiateEvolution(skillId, runId, { orgId }).catch(err => {
                    console.error(`[AdminService] Sync failed for skill ${skillId}: ${err.message}`);
                });
                triggered++;
                results.push({
                    skillId,
                    status: "triggered",
                    runId,
                    reliabilityPct: candidate.reliabilityPct,
                    total: candidate.total,
                    success: candidate.success,
                    failure: candidate.failure,
                    linkedRunCount: candidate.linkedRunCount,
                    unlinkedEventCount: candidate.unlinkedEventCount
                });
            } else {
                blocked++;
                results.push({
                    skillId,
                    status: "blocked_missing_mission_run",
                    reason: "Telemetry exists for this organization, but no recent event is linked to a mission run. Autoresearch needs a parent run before it can launch a shadow experiment.",
                    reliabilityPct: candidate.reliabilityPct,
                    total: candidate.total,
                    success: candidate.success,
                    failure: candidate.failure,
                    linkedRunCount: candidate.linkedRunCount,
                    unlinkedEventCount: candidate.unlinkedEventCount
                });
            }
        }

        return {
            message: triggered > 0 
                ? `Neural Core sync initiated for ${triggered} skills.` 
                : blocked > 0
                    ? `${blocked} performance candidates need mission-run context before Autoresearch can launch.`
                    : "No valid mission context found for performance candidates.",
            candidatesTriggered: triggered,
            candidatesFound: candidates.length,
            blockedCandidates: blocked,
            details: results
        };
    }

    async getSuppressionPolicies(limit = 200) {
        return await db.select().from(suppressionPolicies).limit(limit);
    }

    async getTokenRateMetrics(since: Date, orgId?: number | null, isSuperAdmin: boolean = false) {
        const orgCondition = (!isSuperAdmin && orgId)
            ? eq(aiUsageLogs.organizationId, orgId)
            : undefined;
        const [row] = await db
            .select({
                totalCostUsd: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.costUsd} AS NUMERIC)), 0)`,
                totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`,
            })
            .from(aiUsageLogs)
            .where(orgCondition ? and(gte(aiUsageLogs.createdAt, since), orgCondition) : gte(aiUsageLogs.createdAt, since));

        const totalCost = parseFloat(row?.totalCostUsd ?? "0");
        const totalTokens = Number(row?.totalTokens ?? 0);
        const blendedRate = totalTokens >= 10000 ? totalCost / totalTokens : null;
        return { blendedRate, totalCostUsd: totalCost, totalTokens };
    }

    async getAutoresearchActivity(orgId: number, limitN: number = 200) {
        const orgMissionRuns = await db
            .select({ id: missionRuns.id, missionId: missionRuns.missionId, name: missionRuns.name, status: missionRuns.status })
            .from(missionRuns)
            .leftJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(or(eq(missionRuns.organizationId, orgId), eq(missions.organizationId, orgId)))
            .limit(1000);

        const runIds = orgMissionRuns.map(r => r.id);
        if (runIds.length === 0) {
            return {
                orgMissionRuns,
                allShadows: [],
                triggerEvents: [],
                proposals: []
            };
        }

        const allShadows = await db
            .select()
            .from(missionShadowRuns)
            .where(inArray(missionShadowRuns.parentRunId, runIds))
            .orderBy(desc(missionShadowRuns.createdAt))
            .limit(limitN);

        const triggerEvents = await db
            .select()
            .from(forensicEventLog)
            .where(and(
                eq(forensicEventLog.jobType, "sentinel_insight"),
                sql`${forensicEventLog.attributes}->>'action' = 'trigger_autoresearch'`,
                inArray(forensicEventLog.missionRunId, runIds)
            ))
            .orderBy(desc(forensicEventLog.createdAt))
            .limit(100);

        const shadowExecutionIds = allShadows.map(s => `optimization:${s.id}`);
        const proposals = shadowExecutionIds.length > 0
            ? await db.select().from(approvalRequests).where(or(...shadowExecutionIds.map(eid => eq(approvalRequests.executionId, eid)))).orderBy(desc(approvalRequests.createdAt))
            : [];

        return {
            orgMissionRuns,
            allShadows,
            triggerEvents,
            proposals
        };
    }
}

export const adminService = new AdminService();

function normalizeTrycuaOs(value: unknown): "linux" | "windows" | "macos" {
    const normalized = String(value ?? "linux").toLowerCase();
    if (normalized !== "linux" && normalized !== "windows" && normalized !== "macos") {
        throw new BadRequestError("trycuaDefaultOs must be one of linux, windows, or macos");
    }
    return normalized;
}

function normalizeTrycuaMaxSessionTime(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
        throw new BadRequestError("trycuaMaxSessionTime must be an integer between 1 and 1440");
    }
    return parsed;
}
