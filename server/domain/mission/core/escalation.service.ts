import { db } from "@server/database_service.js";
import { missionRuns, missions, operationalCycles, cycleBlueprints, users, approvalRequests } from "@shared/schema/index.js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EscalationService");

export class EscalationService {
    static async checkEscalations(): Promise<void> {
        logger.debug("[EscalationService] Running escalation check...");

        // Fetch active waiting runs with their parent cycle and mission info
        const waitingRuns = await db.select({
            run: {
                id: missionRuns.id,
                name: missionRuns.name,
                status: missionRuns.status,
                updatedAt: missionRuns.updatedAt,
                createdAt: missionRuns.createdAt,
                cycleId: missionRuns.cycleId,
                organizationId: missionRuns.organizationId,
                missionContext: missionRuns.missionContext,
                missionId: missionRuns.missionId,
                createdBy: missionRuns.createdBy,
                resumeCondition: missionRuns.resumeCondition
            },
            mission: {
                id: missions.id,
                name: missions.name,
            },
            cycle: {
                id: operationalCycles.id,
                name: operationalCycles.name,
                metadata: operationalCycles.metadata
            }
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .innerJoin(operationalCycles, eq(missionRuns.cycleId, operationalCycles.id))
        .where(and(
            eq(missionRuns.status, "waiting_on_human"),
            isNull(missionRuns.deletedAt),
            isNull(missions.deletedAt),
            isNull(operationalCycles.deletedAt)
        ));

        for (const entry of waitingRuns) {
            try {
                await this.processRunEscalation(entry);
            } catch (err: any) {
                logger.error(`[EscalationService] Error processing run ${entry.run.id}: ${err.message}`, err);
            }
        }
    }

    private static async processRunEscalation(entry: {
        run: any;
        mission: any;
        cycle: any;
    }): Promise<void> {
        const { run, mission, cycle } = entry;
        const escalations = (cycle.metadata as any)?.escalations || [];
        const policy = escalations.find((p: any) => p.mission_ref === mission.name);

        if (!policy) {
            return;
        }

        const elapsedMinutes = (Date.now() - new Date(run.updatedAt).getTime()) / 60000;
        const context = (run.missionContext as any) || {};
        const escalationState = context.escalationState || { warningTriggered: false, criticalTriggered: false };

        // 1. Check Warning Threshold
        if (elapsedMinutes >= policy.warning_threshold_minutes && !escalationState.warningTriggered) {
            logger.warn(`[EscalationService] Warning threshold breached for run ${run.id} (${mission.name}). Stalled for ${elapsedMinutes.toFixed(1)}m.`);
            escalationState.warningTriggered = true;
            
            // Persist state change
            await db.update(missionRuns)
                .set({
                    missionContext: { ...context, escalationState },
                    updatedAt: new Date()
                })
                .where(eq(missionRuns.id, run.id));

            // Trigger Alerts
            await this.triggerAlerts(entry, policy.on_warning, policy.alert_channels);
        }

        // 2. Check Critical Threshold
        if (elapsedMinutes >= policy.critical_threshold_minutes && !escalationState.criticalTriggered) {
            logger.error(`[EscalationService] Critical threshold breached for run ${run.id} (${mission.name}). Stalled for ${elapsedMinutes.toFixed(1)}m. Executing fallback: ${policy.on_critical.action}`);
            escalationState.criticalTriggered = true;

            // Persist state change first so downstream hooks can read the updated state
            await db.update(missionRuns)
                .set({
                    missionContext: { ...context, escalationState },
                    updatedAt: new Date()
                })
                .where(eq(missionRuns.id, run.id));

            if (policy.on_critical.action === "route_to_mission") {
                // A. Mark run as failed
                const { missionRunService } = await import("./mission-run.service.js");
                await missionRunService.update(run.id, {
                    status: "failed",
                    isSuccess: false,
                    failureReason: policy.on_critical.message || `Critical SLA breach for ${mission.name}`
                });

                // B. Trigger alerts
                await this.triggerAlerts(entry, policy.on_critical, policy.alert_channels);

                // C. Spawn target blueprint
                const targetName = policy.on_critical.target;
                const [targetBp] = await db.select()
                    .from(cycleBlueprints)
                    .where(and(
                        eq(cycleBlueprints.cycleId, cycle.id),
                        eq(cycleBlueprints.name, targetName)
                    ))
                    .limit(1);

                if (targetBp) {
                    logger.info(`[EscalationService] Spawning fallback blueprint "${targetName}" for Cycle ${cycle.id}`);
                    const { CycleManagerService } = await import("./cycle-manager.service.js");
                    await CycleManagerService.spawnMissionForCycle(
                        cycle.id,
                        targetBp,
                        run.createdBy,
                        run.organizationId
                    );
                } else {
                    logger.error(`[EscalationService] Target blueprint "${targetName}" not found in Cycle ${cycle.id}`);
                }
            }
        }
    }

    private static async triggerAlerts(
        entry: { run: any; mission: any; cycle: any },
        actionConfig: any,
        channels: string[]
    ): Promise<void> {
        const { run, mission, cycle } = entry;
        const message = actionConfig.message;

        const { CycleManagerService } = await import("./cycle-manager.service.js");

        for (const channel of channels) {
            if (channel === "slack") {
                try {
                    await CycleManagerService.notifyFleetEvent(
                        run.organizationId,
                        `Escalation Alert: ${mission.name}`,
                        `*${cycle.name}* - Run #${run.id}\n${message}`,
                        "warn"
                    );
                } catch (err: any) {
                    logger.error(`[EscalationService] Slack alert failed: ${err.message}`);
                }
            }

            if (channel === "email") {
                try {
                    const { agentMailService } = await import("@server/domain/integrations/core/agentmail.service.js");
                    const mail = await agentMailService.forOrg(Number(run.organizationId));
                    // Find recipient emails
                    const emailRecipients = new Set<string>();

                    // 1. Approvers of the request
                    const requestIds = run.resumeCondition?.approvalRequestIds || [];
                    if (requestIds.length > 0) {
                        const approvers = await db.select({ email: approvalRequests.approverEmail })
                            .from(approvalRequests)
                            .where(and(inArray(approvalRequests.id, requestIds), eq(approvalRequests.organizationId, run.organizationId)));
                        for (const app of approvers) {
                            if (app.email) emailRecipients.add(app.email);
                        }
                    }

                    // 2. Creator of the run
                    if (run.createdBy) {
                        const [creator] = await db.select({ email: users.email })
                            .from(users)
                            .where(eq(users.id, run.createdBy))
                            .limit(1);
                        if (creator?.email) emailRecipients.add(creator.email);
                    }

                    if (emailRecipients.size > 0) {
                        const recipients = Array.from(emailRecipients);
                        if (mail.isConfigured()) {
                            for (const email of recipients) {
                                await mail.send({
                                    to: [email],
                                    subject: `[Escalation Alert] ${mission.name} Stalled`,
                                    text: message,
                                    html: `<div style="font-family:sans-serif;padding:24px;border:1px solid #e4e4e7;border-radius:8px;">
                                            <h2 style="color:#ef4444;margin-top:0;">Escalation SLA Alert</h2>
                                            <p style="font-size:14px;color:#3f3f46;">${message}</p>
                                            <p style="font-size:12px;color:#a1a1aa;margin-top:20px;">Cycle: ${cycle.name} | Run ID: ${run.id}</p>
                                          </div>`
                                });
                            }
                            logger.info(`[EscalationService] Emails sent via AgentMail to: ${recipients.join(", ")}`);
                        } else {
                            logger.info(`[EscalationService] (AgentMail not configured) Email alert to ${recipients.join(", ")}: ${message}`);
                        }
                    }
                } catch (err: any) {
                    logger.error(`[EscalationService] Email alert failed: ${err.message}`);
                }
            }
        }
    }
}
