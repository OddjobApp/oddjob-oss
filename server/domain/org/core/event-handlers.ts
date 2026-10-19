import { crossAppEventBus, CrossAppEvent, CrossAppEventType } from "./event-bus.service.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, sql } from "drizzle-orm";
import { orgSettings, forensicEventLog, autonomousActionArtifacts } from "@shared/schema/index.js";

const logger = createLogger("EventHandlers");

/**
 * Persist a cross-app event to forensic_event_log so it's queryable, org-scoped,
 * and auditable. Every handler funnels through here for the durable record;
 * concrete follow-up actions are added per handler.
 */
async function recordEvent(
    event: CrossAppEvent,
    workbench: string,
    status: "success" | "failure" | "warning" = "success",
    extra?: Record<string, any>,
): Promise<void> {
    try {
        const nowNs = BigInt(Date.now()) * 1_000_000n;
        await db.insert(forensicEventLog).values({
            jobType: `cross_app:${event.type}`,
            status,
            organizationId: event.organizationId ?? null,
            userId: (event as any).userId ?? null,
            startTimeNs: nowNs,
            endTimeNs: nowNs,
            attributes: {
                sourceApp: event.sourceApp,
                workbench,
                eventType: event.type,
                payload: event.payload,
                ...(extra ?? {}),
            },
        });
    } catch (err: any) {
        // Logging must never break the handler — surface but don't throw
        logger.warn(`[EventHandlers] Failed to record event ${event.type}: ${err.message}`);
    }
}

/**
 * Bump org-level alert tracking columns. Used when a budget/quota event arrives
 * so the existing alerting infrastructure (which reads orgSettings.lastAlertAt)
 * picks up the spike on its next poll.
 */
async function markOrgAlert(organizationId: number | null | undefined, threshold: number): Promise<void> {
    if (!organizationId) return;
    try {
        await db.update(orgSettings)
            .set({ lastAlertAt: new Date(), lastAlertThreshold: threshold, updatedAt: new Date() })
            .where(eq(orgSettings.organizationId, organizationId));
    } catch (err: any) {
        logger.warn(`[EventHandlers] Failed to mark org alert for ${organizationId}: ${err.message}`);
    }
}

/**
 * Guards against double registration. There are two callers: the explicit boot
 * call in routes.ts, and a top-level call in org-forge.service.ts that fires
 * whenever that module is first dynamically imported. registerHandler() appends
 * to an array with no de-duplication, so without this guard every handler would
 * run twice — and a spawn_cycle handler running twice creates two cycles per
 * event.
 */
let handlersRegistered = false;

/**
 * Register all cross-app event handlers. Idempotent per process.
 */
export function registerCrossAppEventHandlers(): void {
    if (handlersRegistered) {
        logger.debug("[EventHandlers] Already registered; skipping");
        return;
    }
    handlersRegistered = true;

    registerPMWorkbenchHandlers();
    registerScrumMasterWorkbenchHandlers();
    registerQAWorkbenchHandlers();
    registerAIWorkforceDashboardHandlers();
    registerStakeholderWorkbenchHandlers();
    registerMissionAdvancementHandlers();
    registerGuardrailObservabilityHandlers();
    registerAutonomousActionHandlers();
    logger.info("[EventHandlers] All cross-app event handlers registered");
}

// ─── Autonomous Actions (Signal Intelligence) ────────────────────────────────

/**
 * Handlers for the Signal Intelligence engine's autonomous actions.
 *
 * These events were previously sent with EventEmitter's raw `emit`, which never
 * reached the handler registry — so they had no consumer at all. They now arrive
 * via publish(); this gives spawn_cycle a real effect.
 */
/**
 * Creates the durable record an autonomous action produced.
 *
 * Shared by the three action types that have no domain object of their own. The
 * artifact is what makes the action real: attributable to its signal and policy,
 * queryable, and carrying a status an operator can move.
 *
 * Returns a `HandlerResult` so the outcome reaches the publisher rather than
 * only the forensic log — `blastRadius` is the entity count the artifact covers,
 * which is what the prediction-error loop compares against the world model's
 * predicted blast radius.
 */
async function createActionArtifact(
    event: CrossAppEvent,
    kind: "rfc" | "compliance_finding" | "routing_directive",
    build: (p: Record<string, any>) => { title: string; body: string; details?: Record<string, unknown> },
) {
    const p = event.payload ?? {};

    if (!event.organizationId) {
        logger.warn(`[AutonomousAction] ${kind} without organizationId; skipping`);
        await recordEvent(event, "signal_intelligence", "failure", { reason: "missing organizationId" });
        return { status: "failed" as const, detail: "missing organizationId" };
    }

    const affectedEntityIds = Array.isArray(p.affectedEntityIds) ? p.affectedEntityIds : [];

    try {
        const { title, body, details } = build(p);

        const [artifact] = await db
            .insert(autonomousActionArtifacts)
            .values({
                organizationId: event.organizationId,
                eventPrimitiveId: p.eventPrimitiveId ?? null,
                policyId: typeof p.policyId === "number" ? p.policyId : null,
                kind,
                title: title.slice(0, 500),
                body,
                severity: p.severity ?? null,
                jurisdiction: p.jurisdiction ?? null,
                targetSector: p.targetSector ?? null,
                affectedEntityIds,
                details: details ?? {},
            })
            .returning();

        logger.info(
            `[AutonomousAction] Created ${kind} artifact ${artifact.id} for event ${p.eventPrimitiveId}`,
        );
        await recordEvent(event, "signal_intelligence", "success", {
            artifactId: artifact.id,
            kind,
            eventPrimitiveId: p.eventPrimitiveId ?? null,
            affectedEntityCount: affectedEntityIds.length,
        });

        return {
            status: "succeeded" as const,
            metrics: { blastRadius: affectedEntityIds.length },
            detail: artifact.id,
        };
    } catch (err: any) {
        logger.error(`[AutonomousAction] Failed to create ${kind} artifact: ${err.message}`);
        await recordEvent(event, "signal_intelligence", "failure", {
            reason: err.message,
            kind,
            eventPrimitiveId: p.eventPrimitiveId ?? null,
        });
        // Reported, not just logged: a caught error is invisible to the
        // publisher, and "the action succeeded" would then mean "an event was
        // emitted".
        return { status: "failed" as const, detail: err.message };
    }
}

function registerAutonomousActionHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AUTONOMOUS_ACTION_SPAWN_CYCLE,
        name: "spawn-cycle",
        handler: async (event: CrossAppEvent) => {
            const p = event.payload ?? {};
            logger.info(
                `[AutonomousAction] SPAWN_CYCLE: event=${p.eventPrimitiveId} ` +
                    `sector=${p.targetSector} jurisdiction=${p.jurisdiction} severity=${p.severity}`,
            );

            if (!event.organizationId) {
                logger.warn("[AutonomousAction] SPAWN_CYCLE without organizationId; skipping");
                await recordEvent(event, "signal_intelligence", "failure", {
                    reason: "missing organizationId",
                });
                return { status: "failed", detail: "missing organizationId" };
            }

            try {
                const { CycleManagerService } = await import(
                    "@domain/mission/core/cycle-manager.service.js"
                );

                const name = `Policy response: ${p.eventType ?? "signal"} — ${p.targetSector ?? "unknown sector"}`;
                const objective =
                    `Respond to a ${p.severity ?? "detected"} ${p.eventType ?? "policy event"} ` +
                    `affecting ${p.targetSector ?? "an unspecified sector"} in ` +
                    `${p.jurisdiction ?? "an unspecified jurisdiction"}.`;

                // requiresApproval=1 on purpose. The policy's approval gate
                // authorised *creating* this cycle, but it is spawned with no
                // blueprints — there is nothing to execute yet. Launching it
                // active would be a no-op dressed up as an action, so it lands
                // as pending_approval for an operator to scope and release.
                const cycle = await CycleManagerService.launchCycle(
                    {
                        name: name.slice(0, 200),
                        objective,
                        description: p.triggerContext?.rawText
                            ? String(p.triggerContext.rawText).slice(0, 2000)
                            : undefined,
                        priority: typeof p.priority === "number" ? p.priority : 5,
                        requiresApproval: 1,
                        metadata: {
                            // Requirement 17.6: the event is the triggering context
                            // and the cycle is linked to the affected entities.
                            source: "autonomous-action",
                            eventPrimitiveId: p.eventPrimitiveId ?? null,
                            eventType: p.eventType ?? null,
                            severity: p.severity ?? null,
                            jurisdiction: p.jurisdiction ?? null,
                            targetSector: p.targetSector ?? null,
                            confidenceScore: p.triggerContext?.confidenceScore ?? null,
                            affectedEntityIds: Array.isArray(p.affectedEntityIds)
                                ? p.affectedEntityIds
                                : [],
                        },
                    },
                    "autonomous-action",
                    event.organizationId,
                );

                logger.info(
                    `[AutonomousAction] Spawned cycle ${cycle.id} ("${cycle.name}") for event ${p.eventPrimitiveId}`,
                );

                const affectedEntityCount = Array.isArray(p.affectedEntityIds)
                    ? p.affectedEntityIds.length
                    : 0;

                await recordEvent(event, "signal_intelligence", "success", {
                    cycleId: cycle.id,
                    cycleStatus: cycle.status,
                    eventPrimitiveId: p.eventPrimitiveId ?? null,
                    affectedEntityCount,
                });

                // Reported back to the publisher, not only to the forensic log.
                // `blastRadius` is how many entities the cycle was actually
                // scoped to — the observation the prediction-error loop compares
                // against the blast radius the world model predicted. Without a
                // returned value this number existed but reached nothing.
                return {
                    status: "succeeded",
                    metrics: { cycleId: cycle.id, blastRadius: affectedEntityCount },
                };
            } catch (err: any) {
                logger.error(`[AutonomousAction] Failed to spawn cycle: ${err.message}`);
                await recordEvent(event, "signal_intelligence", "failure", {
                    reason: err.message,
                    eventPrimitiveId: p.eventPrimitiveId ?? null,
                });
                // The catch is deliberate — one failing consumer must not break
                // the fan-out — but the failure has to be visible to the caller,
                // or "the action succeeded" means "the event was emitted".
                return { status: "failed", detail: err.message };
            }
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AUTONOMOUS_ACTION_CREATE_RFC,
        name: "create-rfc",
        handler: async (event: CrossAppEvent) =>
            createActionArtifact(event, "rfc", (p) => ({
                title: `RFC: respond to ${p.eventType ?? "signal"} affecting ${p.targetSector ?? "an unspecified sector"}`,
                body:
                    `A ${p.severity ?? "detected"} ${p.eventType ?? "event"} in ` +
                    `${p.jurisdiction ?? "an unspecified jurisdiction"} affects ` +
                    `${p.targetSector ?? "an unspecified sector"}.\n\n` +
                    `This RFC was opened automatically by an autonomy policy. It proposes a ` +
                    `change of posture in response and requires human scoping before anything ` +
                    `is executed — the policy authorised RAISING it, not acting on it.` +
                    (p.triggerContext?.rawText ? `\n\nSignal text:\n${String(p.triggerContext.rawText).slice(0, 2000)}` : ""),
                details: {
                    proposedBy: "autonomous-action",
                    confidenceScore: p.triggerContext?.confidenceScore ?? null,
                    requiresHumanScoping: true,
                },
            })),
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AUTONOMOUS_ACTION_UPDATE_COMPLIANCE_CHECK,
        name: "update-compliance-check",
        handler: async (event: CrossAppEvent) =>
            createActionArtifact(event, "compliance_finding", (p) => ({
                title: `Compliance review: ${p.eventType ?? "signal"} in ${p.jurisdiction ?? "unspecified jurisdiction"}`,
                body:
                    `A ${p.severity ?? "detected"} ${p.eventType ?? "event"} may bear on compliance ` +
                    `obligations for ${p.targetSector ?? "an unspecified sector"} operating in ` +
                    `${p.jurisdiction ?? "an unspecified jurisdiction"}.\n\n` +
                    `Raised automatically for review. It records that the signal warrants a ` +
                    `compliance assessment; it does not itself assess or attest to anything.`,
                details: {
                    // Named rather than asserted: the platform has compliance
                    // schemas (shared/schema/compliance.ts) but no control
                    // store, so nothing here can claim a control passed or
                    // failed. It flags the jurisdiction/sector pair for review.
                    reviewScope: {
                        jurisdiction: p.jurisdiction ?? null,
                        targetSector: p.targetSector ?? null,
                    },
                    assessed: false,
                },
            })),
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AUTONOMOUS_ACTION_MODIFY_SPATIAL_ROUTING,
        name: "modify-spatial-routing",
        handler: async (event: CrossAppEvent) =>
            createActionArtifact(event, "routing_directive", (p) => ({
                title: `Routing directive: avoid ${p.jurisdiction ?? "affected area"} for ${p.targetSector ?? "affected assets"}`,
                body:
                    `A ${p.severity ?? "detected"} ${p.eventType ?? "event"} affects routing through ` +
                    `${p.jurisdiction ?? "an unspecified jurisdiction"}.\n\n` +
                    `This directive records the recommended routing change and the assets it ` +
                    `covers. It is advisory: no route is altered until it is acknowledged, ` +
                    `because re-routing live assets on an automated signal is not a decision ` +
                    `this policy is authorised to take unattended.`,
                details: {
                    directive: "avoid_affected_jurisdiction",
                    jurisdiction: p.jurisdiction ?? null,
                    advisory: true,
                },
            })),
    });
}

// ─── PM Workbench ────────────────────────────────────────────────────────────

function registerPMWorkbenchHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.TEST_FAILED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[PMWorkbench] TEST_FAILED: ${event.payload.testName}`);
            await recordEvent(event, "pm", "failure", {
                requirementId: event.payload.requirementId ?? null,
                testName: event.payload.testName ?? null,
                severity: event.payload.severity ?? "medium",
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.STORY_BLOCKED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[PMWorkbench] STORY_BLOCKED: ${event.payload.storyId}`);
            await recordEvent(event, "pm", "warning", {
                storyId: event.payload.storyId ?? null,
                blockerReason: event.payload.reason ?? null,
                impactScope: event.payload.impactScope ?? null,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AGENT_PIP_TRIGGERED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[PMWorkbench] AGENT_PIP_TRIGGERED: ${event.payload.agentId}`);
            await recordEvent(event, "pm", "warning", {
                agentId: event.payload.agentId ?? null,
                reason: event.payload.reason ?? null,
                velocityImpact: event.payload.velocityImpact ?? null,
            });
        },
    });
}

// ─── Scrum Master Workbench ─────────────────────────────────────────────────

function registerScrumMasterWorkbenchHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.BLOCKER_ESCALATED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[ScrumMaster] BLOCKER_ESCALATED: ${event.payload.blockerId}`);
            await recordEvent(event, "scrum_master", "failure", {
                blockerId: event.payload.blockerId ?? null,
                ageMinutes: event.payload.ageMinutes ?? null,
                escalatedTo: event.payload.escalatedTo ?? null,
                severity: "high",
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.SPRINT_VELOCITY_CHANGED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[ScrumMaster] SPRINT_VELOCITY_CHANGED: ${event.payload.velocity}`);
            const prev = Number(event.payload.previousVelocity ?? 0);
            const next = Number(event.payload.velocity ?? 0);
            const delta = prev > 0 ? ((next - prev) / prev) * 100 : 0;
            const anomaly = Math.abs(delta) > 30; // >30% swing flagged
            await recordEvent(event, "scrum_master", anomaly ? "warning" : "success", {
                sprintId: event.payload.sprintId ?? null,
                previousVelocity: prev,
                newVelocity: next,
                pctChange: delta.toFixed(1),
                anomalyDetected: anomaly,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.DEPLOYMENT_FAILED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[ScrumMaster] DEPLOYMENT_FAILED: ${event.payload.deploymentId}`);
            await recordEvent(event, "scrum_master", "failure", {
                deploymentId: event.payload.deploymentId ?? null,
                environment: event.payload.environment ?? null,
                affectedStories: event.payload.affectedStories ?? [],
                rootCause: event.payload.rootCause ?? null,
                triggerIncidentResponse: true,
            });
        },
    });
}

// ─── QA Workbench ────────────────────────────────────────────────────────────

function registerQAWorkbenchHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.REQUIREMENT_UPDATED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[QAWorkbench] REQUIREMENT_UPDATED: ${event.payload.requirementId}`);
            await recordEvent(event, "qa", "success", {
                requirementId: event.payload.requirementId ?? null,
                changeType: event.payload.changeType ?? "update",
                affectsTestCases: event.payload.affectsTestCases ?? [],
                regressionSuggested: event.payload.changeType !== "minor",
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.STORY_MOVED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[QAWorkbench] STORY_MOVED: ${event.payload.storyId} → ${event.payload.newStatus}`);
            const triggerTests = ["in_qa", "ready_for_qa", "QA"].includes(String(event.payload.newStatus));
            await recordEvent(event, "qa", "success", {
                storyId: event.payload.storyId ?? null,
                fromStatus: event.payload.previousStatus ?? null,
                toStatus: event.payload.newStatus ?? null,
                triggerTestExecution: triggerTests,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.DEPLOYMENT_COMPLETED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[QAWorkbench] DEPLOYMENT_COMPLETED: ${event.payload.deploymentId}`);
            await recordEvent(event, "qa", "success", {
                deploymentId: event.payload.deploymentId ?? null,
                environment: event.payload.environment ?? null,
                smokeTestRequested: event.payload.environment === "production",
            });
        },
    });
}

// ─── AI Workforce Dashboard ─────────────────────────────────────────────────

function registerAIWorkforceDashboardHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.STORY_BLOCKED,
        handler: async (event: CrossAppEvent) => {
            const agentId = event.payload.agentId;
            if (!agentId) return; // Only act on agent-attributed blocks
            logger.info(`[AIWorkforce] STORY_BLOCKED by agent: ${agentId}`);
            await recordEvent(event, "ai_workforce", "warning", {
                agentId,
                storyId: event.payload.storyId ?? null,
                thrashingIncident: true,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.AGENT_TOKEN_BUDGET_EXCEEDED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[AIWorkforce] AGENT_TOKEN_BUDGET_EXCEEDED: ${event.payload.agentId}`);
            await recordEvent(event, "ai_workforce", "failure", {
                agentId: event.payload.agentId ?? null,
                budgetUsd: event.payload.budgetUsd ?? null,
                spentUsd: event.payload.spentUsd ?? null,
                suggestSmallerModel: true,
            });
            await markOrgAlert(event.organizationId, 100);
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.FLAKY_TEST_DETECTED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[AIWorkforce] FLAKY_TEST_DETECTED: ${event.payload.testName}`);
            await recordEvent(event, "ai_workforce", "warning", {
                testName: event.payload.testName ?? null,
                failureRate: event.payload.failureRate ?? null,
                relatedAgent: event.payload.relatedAgent ?? null,
                qualityDegradation: Number(event.payload.failureRate ?? 0) > 0.2,
            });
        },
    });
}

// ─── Stakeholder Workbench ──────────────────────────────────────────────────

function registerStakeholderWorkbenchHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.DEPLOYMENT_COMPLETED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[Stakeholder] DEPLOYMENT_COMPLETED: ${event.payload.deploymentId}`);
            await recordEvent(event, "stakeholder", "success", {
                deploymentId: event.payload.deploymentId ?? null,
                durationMinutes: event.payload.durationMinutes ?? null,
                storiesShipped: event.payload.storiesShipped ?? 0,
                stakeholderNotificationQueued: true,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.BUDGET_EXCEEDED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[Stakeholder] BUDGET_EXCEEDED: ${event.payload.amount}`);
            const amount = Number(event.payload.amount ?? 0);
            const budget = Number(event.payload.budget ?? 1);
            const pct = budget > 0 ? Math.round((amount / budget) * 100) : 100;
            await recordEvent(event, "stakeholder", "failure", {
                amount,
                budget,
                utilizationPct: pct,
                critical: true,
                escalationTriggered: pct >= 100,
            });
            await markOrgAlert(event.organizationId, Math.min(pct, 100));
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.SPRINT_COMPLETED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[Stakeholder] SPRINT_COMPLETED: ${event.payload.sprintId}`);
            await recordEvent(event, "stakeholder", "success", {
                sprintId: event.payload.sprintId ?? null,
                completedPoints: event.payload.completedPoints ?? 0,
                plannedPoints: event.payload.plannedPoints ?? 0,
                completionRate: event.payload.plannedPoints
                    ? Math.round((Number(event.payload.completedPoints ?? 0) / Number(event.payload.plannedPoints)) * 100)
                    : 0,
            });
        },
    });
}

// ─── Mission Advancement (Event-Driven) ──────────────────────────────────────
// When a pipeline step writes outputs to the blackboard, immediately poke
// the dynamic orchestrator to process the next cycle — no polling delay.
// Multi-org safe: events carry orgId, deduplication via Redis key.

function registerMissionAdvancementHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.STEP_OUTPUT_WRITTEN,
        handler: async (event: CrossAppEvent) => {
            const { missionId, missionRunId } = event.payload;
            if (!missionId || !missionRunId) return;

            logger.info(`[EventHandlers] STEP_OUTPUT_WRITTEN: org=${event.organizationId}, mission=${missionId}, run=${missionRunId}, step=${event.payload.stepCode}`);

            // Deduplication: only enqueue if not already enqueued in the last 5 seconds
            try {
                const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
                const redis = getRedisClient();
                const stepKey = event.payload.stepCode ?? `order_${event.payload.stepOrder ?? "x"}`;
                const dedupeKey = `mission_advance:${missionRunId}:${stepKey}`;
                const alreadyQueued = await redis.set(dedupeKey, "1", "PX", 5000, "NX");
                
                if (!alreadyQueued) {
                    logger.debug(`[EventHandlers] Skipping duplicate advancement for run ${missionRunId} step ${event.payload.stepCode}`);
                    return;
                }
            } catch {
                // Redis unavailable — proceed without deduplication
            }

            // Trigger the next orchestration cycle immediately
            try {
                const { queueMissionCycle } = await import("../../mission/infrastructure/dynamic-mission-queue.js");
                await queueMissionCycle({
                    missionRunId,
                    userId: "system",
                    orgId: event.organizationId ?? null,
                });
                logger.info(`[EventHandlers] Enqueued mission run ${missionRunId} for immediate advancement (org ${event.organizationId})`);
            } catch (err: any) {
                logger.warn(`[EventHandlers] Failed to enqueue mission advancement: ${err.message}`);
            }
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.STEP_COMPLETED,
        handler: async (event: CrossAppEvent) => {
            logger.info(`[EventHandlers] STEP_COMPLETED: org=${event.organizationId}, step=${event.payload.stepCode || "unknown"}, mission=${event.payload.missionId}`);
            await recordEvent(event, "mission_orchestrator", "success", {
                stepCode: event.payload.stepCode ?? null,
                missionId: event.payload.missionId ?? null,
            });
        },
    });
}

// ─── Guardrail Observability ─────────────────────────────────────────────────
// Log guardrail events for the Fleet Command dashboard and analytics.

function registerGuardrailObservabilityHandlers(): void {
    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.GUARDRAIL_STALL_DETECTED,
        handler: async (event: CrossAppEvent) => {
            logger.warn(`[Guardrails] STALL DETECTED: job=${event.payload.jobId}, mission=${event.payload.missionId}, iteration=${event.payload.iteration}, consecutive_no_progress=${event.payload.consecutiveNoProgress}`);
            await recordEvent(event, "ai_workforce", "warning", {
                agentId: event.payload.jobId ?? null,
                guardrailType: "stall_detected",
                iteration: event.payload.iteration,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.GUARDRAIL_ITERATION_LIMIT,
        handler: async (event: CrossAppEvent) => {
            logger.warn(`[Guardrails] ITERATION LIMIT: job=${event.payload.jobId}, mission=${event.payload.missionId}, maxIterations=${event.payload.maxIterations}`);
            await recordEvent(event, "ai_workforce", "failure", {
                agentId: event.payload.jobId ?? null,
                guardrailType: "iteration_limit_exhausted",
                maxIterations: event.payload.maxIterations,
            });
        },
    });

    crossAppEventBus.registerHandler({
        eventType: CrossAppEventType.GUARDRAIL_TRIGGERED,
        handler: async (event: CrossAppEvent) => {
            logger.warn(`[Guardrails] TRIGGERED: ${event.payload.guardrailType} for job=${event.payload.jobId}`);
            await recordEvent(event, "ai_workforce", "warning", {
                agentId: event.payload.jobId ?? null,
                guardrailType: event.payload.guardrailType ?? "unknown",
            });
        },
    });
}
