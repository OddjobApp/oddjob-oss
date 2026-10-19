
import { db } from "../../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { CycleManagerService } from "../../domain/mission/core/cycle-manager.service.js";
import { successResponse, errorResponse, validateArgs, type ToolContext } from "./utils.js";
import { assertOrgId } from "@server/utils/auth-context.js";

export async function handleListCycles(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ status?: string }>(args, { status: 'string?' });
    if ('isError' in v) return v;

    try {
        const orgId = assertOrgId(context?.organizationId);
        const condition = v.status
            ? and(eq(operationalCycles.organizationId, orgId), eq(operationalCycles.status, v.status))
            : eq(operationalCycles.organizationId, orgId);

        const cycles = await db.select().from(operationalCycles)
            .where(condition)
            .orderBy(desc(operationalCycles.createdAt));
        return successResponse(cycles);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleLaunchCycle(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ name: string; objective: string; recurrence?: string; priority?: number; requiresApproval?: boolean }>(
        args,
        { name: 'string', objective: 'string', recurrence: 'string?', priority: 'number?', requiresApproval: 'boolean?' }
    );
    if ('isError' in v) return v;

    try {
        const userId = context?.userId || "mcp-agent";
        const orgId = assertOrgId(context?.organizationId);
        const cycle = await CycleManagerService.launchCycle(v, userId, orgId);
        return successResponse(cycle);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleApproveCycle(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ cycleId: number }>(args, { cycleId: 'number' });
    if ('isError' in v) return v;

    try {
        const userId = context?.userId || "mcp-agent";
        const orgId = assertOrgId(context?.organizationId);

        const [cycle] = await db.update(operationalCycles)
            .set({ status: 'active', updatedAt: new Date() })
            .where(and(eq(operationalCycles.id, v.cycleId), eq(operationalCycles.organizationId, orgId)))
            .returning();

        const metadata = cycle?.metadata as any;
        if (metadata?.blueprints) {
            for (const blueprint of metadata.blueprints as any[]) {
                await CycleManagerService.spawnMissionForCycle(v.cycleId, blueprint, userId, orgId, cycle.priority ?? 5);
            }
        }
        return successResponse({ success: true, message: "Cycle approved and fleet launched." });
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handlePauseCycle(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ cycleId: number }>(args, { cycleId: 'number' });
    if ('isError' in v) return v;

    try {
        const orgId = assertOrgId(context?.organizationId);
        await db.update(operationalCycles)
            .set({ status: 'paused', updatedAt: new Date() })
            .where(and(eq(operationalCycles.id, v.cycleId), eq(operationalCycles.organizationId, orgId)));
        return successResponse({ success: true });
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleResumeCycle(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ cycleId: number }>(args, { cycleId: 'number' });
    if ('isError' in v) return v;

    try {
        const orgId = assertOrgId(context?.organizationId);
        await db.update(operationalCycles)
            .set({ status: 'active', updatedAt: new Date() })
            .where(and(eq(operationalCycles.id, v.cycleId), eq(operationalCycles.organizationId, orgId)));
        return successResponse({ success: true });
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
