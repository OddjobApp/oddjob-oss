/**
 * AgentMail Inbound Webhook Route
 * POST /api/integrations/agentmail/webhook
 *
 * Receives message.received events from AgentMail, verifies HMAC,
 * classifies intent, gates on passcode/OTP, then executes the action.
 *
 * Supported intents:
 *   APPROVE <passcode>  → resolves a pending HIL approval request
 *   REJECT  <passcode>  → rejects a pending HIL approval request
 *   STEER   <guidance>  → updates mission steering nudge (no passcode needed)
 *   LAUNCH  <objective> → creates a new mission (future)
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { agentMailService } from "../core/agentmail.service.js";
import {
    parseEmailIntent,
    verifyHighRiskAction,
    verifyLowRiskAction,
    getApprovalByRequestId,
    getLatestPendingApprovalForEmail,
} from "../core/agentmail-intent.service.js";
import { db } from "@server/database_service.js";
import { approvalRequests, missions, missionRuns } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { forensicEventLog } from "@shared/schema/index.js";
import { decisionRouter } from "../../governor/core/decision-router.js";

const logger = createLogger("AgentMailWebhook");
const router = Router();

// ── Inbound webhook ───────────────────────────────────────────────────────────

router.post(
    "/webhook",
    asyncHandler(async (req: Request, res: Response) => {
        if (process.env.NODE_ENV === "production") {
            return res.status(410).json({ error: "Shared AgentMail webhooks are disabled. Use organization inbox polling." });
        }
        // 1. HMAC verification using raw body (set by express.raw middleware upstream)
        const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
        const svixId        = req.headers["svix-id"] as string        ?? "";
        const svixTimestamp = req.headers["svix-timestamp"] as string ?? "";
        const svixSignature = req.headers["svix-signature"] as string ?? "";

        if (!svixId || !svixTimestamp || !svixSignature || !rawBody.length) {
            return res.status(401).json({ error: "Webhook signature required" });
        }
        {
            const valid = agentMailService.verifyWebhookSignature(rawBody, svixId, svixTimestamp, svixSignature);
            if (!valid) {
                logger.warn("[AgentMail] Webhook HMAC verification failed — rejected");
                return res.status(401).json({ error: "Invalid webhook signature" });
            }
        }

        // 2. Parse event
        const event = req.body as any;
        const eventType: string = event?.type ?? "";

        logger.info(`[AgentMail] Event received: ${eventType}`);

        if (eventType !== "message.received") {
            return res.status(200).json({ ok: true, skipped: true });
        }

        const msg = event?.data as any;
        if (!msg) return res.status(200).json({ ok: true });

        const fromEmail: string  = msg?.from ?? "";
        const bodyText: string   = msg?.text ?? msg?.html ?? "";
        const threadId: string   = msg?.thread_id ?? "";
        const subject: string    = msg?.subject ?? "";

        if (!fromEmail || !bodyText) {
            return res.status(200).json({ ok: true, skipped: "missing from/body" });
        }

        // 3. Parse intent from body
        const parsed = await parseEmailIntent(bodyText);
        logger.info(`[AgentMail] Intent: ${parsed.intent} from ${fromEmail}`);

        // 4. THREAD SYNC: Check if this email is a reply to a CREW room or mission thread
        let threadRouted = false;
        if (threadId) {
            const { agentMailThreadSync } = await import("../core/agentmail-thread-sync.service.js");
            
            // 4a. Check CREW Room link
            const crewLink = await agentMailThreadSync.findCrewSessionByThreadId(threadId);
            if (crewLink) {
                const crewResult = await agentMailThreadSync.routeReplyToCrewSession(
                    threadId,
                    fromEmail,
                    bodyText,
                    subject
                );
                threadRouted = crewResult.success;
                if (crewResult.success) {
                    logger.info(`[AgentMail] Inbound reply from ${fromEmail} routed to CREW room "${crewLink.sessionKey}" (Turn #${crewResult.turnId})`);
                    return res.status(200).json({
                        ok: true,
                        destination: "crew",
                        sessionKey: crewLink.sessionKey,
                        turnId: crewResult.turnId,
                    });
                }
            }

            // 4b. Check Mission link
            const missionLink = await agentMailThreadSync.findMissionByThreadId(threadId);
            if (missionLink && parsed.intent === "steer") {
                // Route the steering reply to the linked mission
                const routeResult = await agentMailThreadSync.routeReplyToMission(
                    threadId,
                    fromEmail,
                    parsed.payload || bodyText
                );
                threadRouted = routeResult.success;
                
                if (routeResult.success) {
                    await agentMailService.sendAck(fromEmail, threadId,
                        `✅ Your reply has been applied to the active mission. The agent will factor this in on the next evaluation.`
                    );
                    return res.status(200).json({ ok: true, intent: "steer", threadRouted: true, missionRunId: routeResult.missionRunId });
                }
            }
        }

        // 5. Audit log every inbound attempt
        await db.insert(forensicEventLog).values({
            traceId: `agentmail-${Date.now()}`,
            spanId: `inbound-${Date.now()}`,
            startTimeNs: BigInt(Date.now()) * 1000000n,
            jobType: "agentmail_inbound",
            status: "info",
            attributes: {
                fromEmail,
                intent: parsed.intent,
                subject,
                threadId,
                requestId: parsed.requestId,
                hasPasscode: !!parsed.passcode,
                threadRouted,
            },
        } as any).catch(() => {});  // non-blocking

        const appUrl = process.env.APP_URL ?? "http://localhost:5000";

        // ── APPROVE / REJECT ─────────────────────────────────────────────────

        if (parsed.intent === "approve" || parsed.intent === "reject") {
            // Find the approval request
            let approvalReq = parsed.requestId
                ? await getApprovalByRequestId(parsed.requestId)
                : await getLatestPendingApprovalForEmail(fromEmail);

            if (!approvalReq) {
                await agentMailService.sendAck(fromEmail, threadId,
                    `No pending approval found for your account. Please check your Decision Inbox at ${appUrl}/control/decisions`
                );
                return res.status(200).json({ ok: true });
            }

            if (approvalReq.status !== "pending") {
                await agentMailService.sendAck(fromEmail, threadId,
                    `Request #${approvalReq.id} has already been ${approvalReq.status}. No action taken.`
                );
                return res.status(200).json({ ok: true });
            }

            // Gate: verify sender + OTP passcode
            const gate = await verifyHighRiskAction(fromEmail, approvalReq.executionId, parsed.passcode);
            if (!gate.ok) {
                await agentMailService.sendAck(fromEmail, threadId,
                    `⚠️ Could not process your request: ${gate.reason}`
                );
                return res.status(200).json({ ok: true });
            }

            // Sender address must match the intended approver
            if (approvalReq.approverEmail && approvalReq.approverEmail !== fromEmail) {
                await agentMailService.sendAck(fromEmail, threadId,
                    `⚠️ This approval was sent to a different address. Action not taken.`
                );
                return res.status(200).json({ ok: true });
            }

            // Execute decision
            const decision = parsed.intent === "approve" ? "approved" : "rejected";
            await db.update(approvalRequests)
                .set({
                    status: decision,
                    decisionAt: new Date(),
                    approverId: gate.userId,
                    comments: `Resolved via AgentMail reply from ${fromEmail}`,
                })
                .where(eq(approvalRequests.id, approvalReq.id));

            // Publish decision:resolved event for real-time SSE delivery
            if (approvalReq.organizationId != null) {
                await decisionRouter.publishResolution(approvalReq.id, approvalReq.organizationId, decision);
            }

            logger.info(`[AgentMail] Request #${approvalReq.id} ${decision} by ${fromEmail}`);

            await agentMailService.sendAck(fromEmail, threadId,
                `✅ Request #${approvalReq.id} has been ${decision}. The agent will resume shortly.`
            );

            return res.status(200).json({ ok: true, decision, requestId: approvalReq.id });
        }

        // ── STEER (mission guidance nudge) ───────────────────────────────────

        if (parsed.intent === "steer") {
            const gate = await verifyLowRiskAction(fromEmail);
            if (!gate.ok) {
                await agentMailService.sendAck(fromEmail, threadId,
                    `⚠️ ${gate.reason}`
                );
                return res.status(200).json({ ok: true });
            }

            // Extract the guidance text (everything after STEER/NUDGE keyword)
            // Supports optional α: "STEER ALPHA=0.8 focus more on cost reduction"
            const rawPayload = parsed.payload?.replace(/^\s*(STEER|NUDGE|GUIDANCE)\s*/i, "").trim() ?? "";

            // Parse optional ALPHA= parameter for PSBS steering intensity override
            const alphaMatch = rawPayload.match(/\bALPHA\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/i);
            const steeringAlpha = alphaMatch ? parseFloat(alphaMatch[1]) : null;
            const guidance = rawPayload.replace(/\bALPHA\s*=\s*[\d.]+\b/i, "").trim();

            if (!guidance && steeringAlpha === null) {
                await agentMailService.sendAck(fromEmail, threadId,
                    `No guidance text found. Reply with: STEER <your guidance here>\nOptionally: STEER ALPHA=0.8 <guidance> to set steering intensity (0=off, 1=max)`
                );
                return res.status(200).json({ ok: true });
            }

            // Find the most recent active mission for this user and apply nudge
            const [activeMission] = await db
                .select()
                .from(missions)
                .where(eq(missions.organizationId, 1))  // scoped to org via user lookup in future
                .limit(1)
                .catch(() => [] as any[]);

            if (activeMission) {
                // Apply humanSteeringNudge to missions table
                if (guidance) {
                    await db.update(missions)
                        .set({ humanSteeringNudge: guidance } as any)
                        .where(eq(missions.id, activeMission.id));
                }

                // Apply α override to missionContext (PSBS — takes effect next cycle)
                if (steeringAlpha !== null) {
                    const { missionRunService } = await import("../../mission/core/mission-run.service.js");
                    const [activeRun] = await db
                        .select({ id: missionRuns.id, missionContext: missionRuns.missionContext })
                        .from(missionRuns)
                        .where(and(eq(missionRuns.missionId, activeMission.id), eq(missionRuns.status, "running")))
                        .orderBy(desc(missionRuns.createdAt))
                        .limit(1)
                        .catch(() => [] as any[]);

                    if (activeRun) {
                        await missionRunService.update(activeRun.id, {
                            missionContext: {
                                ...(activeRun.missionContext as any || {}),
                                _steeringAlpha: steeringAlpha,
                            }
                        });
                        logger.info(`[AgentMail] PSBS: α override set to ${steeringAlpha} by ${fromEmail} for run ${activeRun.id}`);
                    }
                }

                const alphaNote = steeringAlpha !== null ? ` Steering intensity (α) set to ${steeringAlpha}.` : "";
                logger.info(`[AgentMail] Steering nudge applied from ${fromEmail}: "${guidance}"${alphaNote}`);

                await agentMailService.sendAck(fromEmail, threadId,
                    `✅ Guidance received and applied to the active mission.${alphaNote} The agent will factor this in on the next evaluation.`
                );
            } else {
                await agentMailService.sendAck(fromEmail, threadId,
                    `No active mission found. Your guidance has been noted but not applied.`
                );
            }

            return res.status(200).json({ ok: true, intent: "steer" });
        }


        // ── UNKNOWN ──────────────────────────────────────────────────────────

        logger.info(`[AgentMail] Unrecognised intent from ${fromEmail}, ignoring`);
        return res.status(200).json({ ok: true, intent: "unknown" });
    })
);

// ── GET /status — health check / confirm inbox is connected ──────────────────

router.get(
    "/status",
    asyncHandler(async (_req: Request, res: Response) => {
        const configured = agentMailService.isConfigured();
        if (!configured) {
            return res.json({ configured: false, message: "AGENTMAIL_API_KEY and AGENTMAIL_INBOX must both be set" });
        }
        const data = await agentMailService.listThreads(1).catch(() => null);
        res.json({
            configured: true,
            inbox: process.env.AGENTMAIL_INBOX,
            reachable: !!data,
        });
    })
);

export default router;
