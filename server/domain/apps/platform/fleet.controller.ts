import { type Request, type Response } from "express";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { resolveAppRoomCycle } from '../core/app-room-cycle-binding.service.js';

function uiStatus(status: string): "active" | "waiting" | "blocked" | "idle" | "completed" {
    if (status === "completed") return "completed";
    if (status === "failed") return "blocked";
    if (status.startsWith("waiting_")) return "waiting";
    if (status === "active") return "active";
    return "idle";
}

export class FleetController {
    public static async workload(req: Request, res: Response) {
        const { orgId, appId, deploymentId } = req.appTokenContext!;
        const cycle = await resolveAppRoomCycle(appId, orgId, req.query.crewRoom);

        const rows = cycle
            ? await db
                .select({ run: missionRuns, mission: missions })
                .from(missionRuns)
                .leftJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(and(
                    eq(missionRuns.organizationId, orgId),
                    or(eq(missionRuns.cycleId, cycle.id), and(isNull(missionRuns.cycleId),
                        eq(missionRuns.createdBy, `app-deployment:${deploymentId}`),
                        sql`${missionRuns.missionContext}->'sdlcBinding'->>'roomKey' = ${String(req.query.crewRoom)}`,
                        sql`${missionRuns.missionContext}->'sdlcBinding'->>'cycleId' = ${String(cycle.id)}`)),
                    isNull(missionRuns.deletedAt),
                ))
                .orderBy(desc(missionRuns.updatedAt))
                .limit(100)
            : [];

        const agents = rows.map(({ run, mission }) => {
            const status = uiStatus(run.status);
            const trace = Array.isArray(run.dynamicTrace) ? run.dynamicTrace : [];
            const context = (run.missionContext ?? {}) as Record<string, unknown>;
            const runtimeSeconds = Math.max(0, Math.round((Date.now() - run.createdAt.getTime()) / 1000));
            return {
                id: String(run.id),
                agent: mission?.name ?? run.name,
                mission: run.name,
                objective: mission?.objective ?? mission?.description ?? "",
                status,
                currentStep: typeof context.currentStep === "string" ? context.currentStep : status === "completed" ? "Completed" : "In progress",
                workingOn: typeof context.workingOn === "string" ? context.workingOn : mission?.objective ?? run.name,
                dependencies: [],
                unresolvedDependencies: status === "waiting" || status === "blocked" ? [run.failureReason ?? "Human or upstream action required"] : [],
                runtimeSeconds,
                costUsd: Number(run.costUsd ?? 0),
                confidence: typeof context.confidence === "number" ? context.confidence : null,
                risk: status === "blocked" ? "high" : status === "waiting" ? "medium" : "low",
                lastActionAt: run.updatedAt.toISOString(),
                flightRecorder: trace.slice(-20).map((entry: any, index: number) => ({
                    id: index + 1,
                    type: String(entry?.type ?? "trace"),
                    toolName: entry?.toolName ? String(entry.toolName) : null,
                    content: String(entry?.content ?? entry?.message ?? JSON.stringify(entry)),
                    confidence: typeof entry?.confidence === "number" ? entry.confidence : null,
                    createdAt: String(entry?.createdAt ?? run.updatedAt.toISOString()),
                })),
            };
        });

        const summary = { active: 0, waiting: 0, blocked: 0, idle: 0, completed: 0, tokenSpendUsd: 0 };
        for (const agent of agents) {
            summary[agent.status] += 1;
            summary.tokenSpendUsd += agent.costUsd;
        }

        const attention = agents
            .filter((agent) => agent.status === "blocked" || agent.status === "waiting")
            .map((agent) => ({
                id: agent.id,
                severity: agent.status === "blocked" ? "critical" : "watch",
                agent: agent.agent,
                mission: agent.mission,
                reason: agent.unresolvedDependencies[0],
            }));

        res.json({
            scope: 'room-cycle',
            bindingStatus: cycle ? 'bound' : 'unbound',
            bindingMessage: cycle ? null : 'Bind this room to a development cycle in the same Project Space to view its agent workload.',
            cycle: cycle ? {
                id: cycle.id,
                name: cycle.name,
                status: cycle.status,
                objective: cycle.objective,
                budgetLimitUsd: Number(cycle.budgetLimitUsd ?? 0),
                currentSpendUsd: Number(cycle.currentSpendUsd ?? 0),
            } : null,
            agents,
            attention,
            summary: { ...summary, tokenSpendUsd: Number(summary.tokenSpendUsd.toFixed(4)) },
            generatedAt: new Date().toISOString(),
        });
    }
}
