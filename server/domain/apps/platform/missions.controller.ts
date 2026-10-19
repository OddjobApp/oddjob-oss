import { type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { missions, appRecords } from "@shared/schema/index.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { normalizeLookupName, recordAppOutbox } from "../apps-platform.helpers.js";

import { validateReleaseEvidence } from "../../../blueprints/apps/sdlc-workbench/lib/workflow-safety.js";
import { requireSdlcBinding, requireReleaseHandoffContext } from '../core/sdlc-stage-handoffs.service.js';
import { reserveDeploymentLaunch, type DeploymentLaunchResponse } from '../core/sdlc-deployment-launch.service.js';

const logger = createLogger("AppPlatformMissionsController");

export class MissionsController {
    public static async triggerMission(req: Request, res: Response) {
        const { orgId, appId, deploymentId } = req.appTokenContext!;
        const { name } = req.body;
        if (!name || typeof name !== "string")
            throw new BadRequestError("'name' is required");
        const sdlc = req.query?.crewRoom ? await requireSdlcBinding(req.appTokenContext!, req.query.crewRoom) : null;
        const launchPayload = { ...req.body };
        delete launchPayload.sdlcBinding;
        if (sdlc) launchPayload.sdlcBinding = sdlc.binding;

        if (normalizeLookupName(name) === normalizeLookupName("Production Deployment")) {
            const context = sdlc
                ? { ...(req.body.context ?? {}), ...await requireReleaseHandoffContext(req.appTokenContext!, req.query.crewRoom, req.body.context?.handoffId) }
                : req.body.context ?? {};
            launchPayload.context = context;
            const read = async (collection: string, id: unknown) => {
                if (typeof id !== "string" || !id) return null;
                const [row] = await db.select().from(appRecords).where(and(
                    eq(appRecords.appId, appId), eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                    sql`${appRecords.data}->>'commitSha' = ${String(context.commitSha ?? "")}`,
                    ...(sdlc ? [sql`${appRecords.data}->'sdlcContext'->>'roomKey' = ${sdlc.binding.roomKey}`,
                        sql`${appRecords.data}->'sdlcContext'->>'revision' = ${sdlc.binding.revision}`] : []),
                )).orderBy(desc(appRecords.createdAt)).limit(1);
                // A later rejection/failure supersedes an earlier approval.
                return row?.recordId === id ? row.data : null;
            };
            const [cab, uat, gate] = await Promise.all([
                read("stakeholder_workbench_cab_approvals", context.cabApprovalId),
                read("stakeholder_workbench_uat_signoffs", context.uatSignoffId),
                read("qa_workbench_quality_gates", context.qualityGateId),
            ]);
            const blocker = validateReleaseEvidence(context, cab, uat, gate);
            if (blocker) throw new BadRequestError(blocker);
        }

        const { missionService } =
            await import("@domain/mission/core/mission.service.js");

        const [exactMission] = await db
            .select({
                id: missions.id,
                name: missions.name,
                workflowBlueprint: missions.workflowBlueprint,
                blackboard: missions.blackboard,
            })
            .from(missions)
            .where(
                and(
                    eq(missions.name, name),
                    eq(missions.organizationId, orgId),
                    eq(missions.status, "active"),
                ),
            )
            .limit(1);

        let mission: typeof exactMission | undefined = exactMission;
        if (!mission) {
            const requestedName = normalizeLookupName(name);
            const activeMissions = await db
                .select({
                    id: missions.id,
                    name: missions.name,
                    workflowBlueprint: missions.workflowBlueprint,
                    blackboard: missions.blackboard,
                })
                .from(missions)
                .where(
                    and(
                        eq(missions.organizationId, orgId),
                        eq(missions.status, "active"),
                    ),
                );

            mission = activeMissions.find((candidate) => {
                const candidateName = normalizeLookupName(candidate.name || "");
                return (
                    candidateName === requestedName
                );
            });
        }

        if (!mission) {
            const outboxRecordId = await recordAppOutbox(
                appId,
                orgId,
                "mission-trigger",
                {
                    name,
                    body: req.body || {},
                    reason: "mission-not-active",
                    message:
                        "Mission was not found or is not active in this organization.",
                },
            );
            logger.warn(
                `[AppPlatform] Mission '${name}' unavailable for app ${appId}; queued trigger ${outboxRecordId}`,
            );
            return res.status(202).json({
                runId: null,
                status: "queued",
                queued: true,
                outboxRecordId,
                message: "Mission not active; trigger queued for retry",
            });
        }

        const reservation = sdlc && normalizeLookupName(name) === normalizeLookupName('Production Deployment')
            ? await reserveDeploymentLaunch(req.appTokenContext!, launchPayload.context.handoffId, mission.id) : null;
        if (reservation?.replayed) return res.status(reservation.response.statusCode).json({ ...reservation.response.body, replayed: true });
        const respond = async (statusCode: number, body: DeploymentLaunchResponse['body']) => {
            if (reservation && !reservation.replayed) await reservation.complete({ statusCode, body });
            return res.status(statusCode).json(body);
        };
        // Ticket identity stays in the run context; concurrent runs must not mutate their shared mission template.
        try {
            const result = await missionService.launchMission(
                mission.id,
                `app-deployment:${deploymentId}`,
                orgId,
                undefined,
                launchPayload,
            );
            if (!result.success) {
                return respond(502, { runId: result.missionRunId ?? null, status: "failed", error: result.error ?? "Mission execution failed. Reconcile before retrying." });
            }
            if (!Number.isInteger(result.missionRunId) || Number(result.missionRunId) < 1) {
                return respond(202, { runId: null, status: "unconfirmed", missionId: mission.id,
                    message: "Execution returned no durable run receipt. Reconcile before retrying; no retry was queued." });
            }

            logger.info(
                `[AppPlatform] App ${appId} triggered mission '${mission.name}' (run ${result.missionRunId})`,
            );
            return respond(200, {
                runId: result.missionRunId,
                status: "launched",
                missionId: mission.id,
                missionName: mission.name,
            });
        } catch (err: any) {
            const outboxRecordId = await recordAppOutbox(
                appId,
                orgId,
                "mission-trigger-reconciliation",
                {
                    name,
                    missionId: mission.id,
                    missionName: mission.name,
                    body: req.body || {},
                    reason: "launch-outcome-unknown",
                    error: err?.message || String(err),
                },
            );
            logger.warn(
                `[AppPlatform] Mission '${mission.name}' outcome requires reconciliation for app ${appId}; record ${outboxRecordId}`,
            );
            return respond(202, {
                runId: null,
                status: "unconfirmed",
                queued: false,
                outboxRecordId,
                message: "Mission outcome is unknown. Reconcile before retrying; no retry was queued.",
            });
        }
    }
}
