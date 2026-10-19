import { type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { AppRecordsStore } from "@domain/finance/core/app-records-store.js";
import { reArmWindow } from "@domain/sales/core/opportunity-window.service.js";
import {
    buildOutboundContext,
    heuristicDraft,
    buildDraftPrompt,
    parseDraft,
} from "./outbound.logic.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("AppPlatformOutboundController");

/**
 * Outbound Rescue (Act III).
 *
 *  • POST /outbound/draft    — generate the followup prompt + editable email
 *    draft for a slipping deal (grounded Gemini, deterministic fallback). This
 *    is the "outbound agent prompt context loop" that pauses at the human
 *    breakpoint so the rep can edit the prompt and draft live.
 *
 *  • POST /outbound/dispatch — the RESUME: log the sent email as an EMAIL_SENT
 *    engagement activity, then RE-ARM the deal's window (reset the clock, hold
 *    the ceiling, write an immutable `rearm` snapshot) — the out-of-band hook
 *    that re-arms the deal on a followup.
 *
 * All reads/writes are token-scoped by (appId, orgId) through AppRecordsStore /
 * app_records, so the outbound flow can never cross a tenant boundary.
 */

interface RawRecord {
    recordId: string;
    data: Record<string, any>;
}

async function loadCollection(appId: number, orgId: number, collection: string): Promise<RawRecord[]> {
    const rows = await db
        .select()
        .from(appRecords)
        .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, collection)));
    return rows.map((r) => ({ recordId: r.recordId, data: (r.data as Record<string, any>) ?? {} }));
}

async function gatherContext(appId: number, orgId: number, opportunityId: string, now: number) {
    const [opps, accounts, leads, activitiesAll, windowsAll] = await Promise.all([
        loadCollection(appId, orgId, "opportunities"),
        loadCollection(appId, orgId, "accounts"),
        loadCollection(appId, orgId, "leads"),
        loadCollection(appId, orgId, "activities"),
        loadCollection(appId, orgId, "opportunity_windows"),
    ]);

    const oppRec = opps.find((r) => r.data.opportunity_id === opportunityId);
    if (!oppRec) throw new NotFoundError(`Opportunity '${opportunityId}' not found`);

    const account = accounts.map((r) => r.data).find((a) => a.account_id === oppRec.data.account_id) ?? null;
    const lead = leads.map((r) => r.data).find((l) => l.lead_id === oppRec.data.lead_id) ?? null;
    const activities = activitiesAll.map((r) => r.data).filter((a) => a.opportunity_id === opportunityId);
    const windowRows = windowsAll.map((r) => r.data);
    const window =
        windowRows.find((w) => w.opportunity_id === opportunityId && (w.status === "ARMED" || w.status === "DECAYING")) ??
        windowRows.find((w) => w.opportunity_id === opportunityId) ??
        null;

    return buildOutboundContext(oppRec.data, account, lead, activities, window, now);
}

export class OutboundController {
    /** Generate the prompt + editable email draft (the breakpoint payload). */
    public static async draft(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const opportunityId = String(req.body?.opportunity_id ?? "").trim();
        if (!opportunityId) throw new BadRequestError("'opportunity_id' is required");

        const now = Date.now();
        const ctx = await gatherContext(appId, orgId, opportunityId, now);
        const fallback = heuristicDraft(ctx);

        let subject = fallback.subject;
        let body = fallback.body;
        let source: "ai" | "heuristic" = "heuristic";

        const apiKey = developmentProviderKey();
        if (apiKey) {
            try {
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const client = AIClientFactory.getClient({ provider: "google" } as any);
                const response = await client.execute(
                    { model: "gemini-2.5-flash", temperature: 0.4, maxTokens: 500, isPriority: true, useCache: false, saveOutputToFile: false } as any,
                    buildDraftPrompt(ctx),
                    apiKey,
                );
                if (response?.success && response.output) {
                    const parsed = parseDraft(response.output, fallback);
                    subject = parsed.subject;
                    body = parsed.body;
                    source = "ai";
                }
            } catch (err: any) {
                logger.warn(`[Outbound] Draft AI failed for ${opportunityId}, using heuristic: ${err.message}`);
            }
        }

        res.json({
            opportunity_id: opportunityId,
            deal_name: ctx.dealName,
            account_name: ctx.accountName,
            to: ctx.recipientEmail,
            recipient_name: ctx.recipientName,
            source,
            prompt: ctx.recipientName || ctx.competitorHit ? buildDraftPrompt(ctx) : fallback.prompt,
            subject,
            body,
            rationale: fallback.rationale,
        });
    }

    /** RESUME: record the sent email, then re-arm the deal's window. */
    public static async dispatch(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const opportunityId = String(req.body?.opportunity_id ?? "").trim();
        const subject = String(req.body?.subject ?? "").trim();
        const body = String(req.body?.body ?? "").trim();
        if (!opportunityId) throw new BadRequestError("'opportunity_id' is required");
        if (!subject || !body) throw new BadRequestError("'subject' and 'body' are required to dispatch");

        // Confirm the opportunity exists in this tenant before writing anything.
        const opps = await loadCollection(appId, orgId, "opportunities");
        const oppRec = opps.find((r) => r.data.opportunity_id === opportunityId);
        if (!oppRec) throw new NotFoundError(`Opportunity '${opportunityId}' not found`);
        const dealName = String(oppRec.data.name ?? opportunityId);

        const now = new Date();
        const store = new AppRecordsStore(appId, orgId);

        // 1. Log the outbound email as a re-arm engagement activity.
        const activityId = `act_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
        await store.upsert("activities", activityId, {
            activity_id: activityId,
            opportunity_id: opportunityId,
            type: "EMAIL_SENT",
            occurred_at: now.toISOString(),
            actor: "outbound-rescue",
            summary: `Followup dispatched: ${subject}`,
            is_rearm_signal: true,
            rearm_effect: "HOLD",
            weight: 1,
        });

        // 2. Re-arm the live window (out-of-band hook): reset clock, hold ceiling,
        //    write an immutable `rearm` snapshot. Null when the deal has no live window.
        const rearm = await reArmWindow(store, opportunityId, now);

        // 3a. Live in-app refresh: publish a dataset.updated event scoped to this
        //     org so every open workbench surface (pipeline, forecast, alerts)
        //     refetches and reflects the re-armed window. Never blocks.
        let notified = false;
        try {
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
            await eventStream.publish(
                "dataset.updated",
                { organizationId: orgId, source: "outbound-rescue", opportunity_id: opportunityId, rearmed: !!rearm },
                { organizationId: orgId },
                "outbound-rescue",
            );
            notified = true;
        } catch (err: any) {
            logger.warn(`[Outbound] Event publish failed (non-fatal): ${err.message}`);
        }

        // 3b. Out-of-band notification: post to the org's configured Slack (the
        //     "Slack Connect" hook). Org-scoped and best-effort — messagingService
        //     resolves the org's Slack connector and safely no-ops if none is set.
        let slackNotified = false;
        try {
            const { messagingService } = await import("@domain/integrations/messaging-service.js");
            const results = await messagingService.notify(
                {
                    title: `Followup dispatched — ${dealName}`,
                    body: subject,
                    severity: "info",
                    fields: [
                        { label: "Deal", value: dealName, short: true },
                        ...(rearm
                            ? [
                                  { label: "Ceiling held", value: `${rearm.ceiling}%`, short: true },
                                  { label: "Next step-down", value: new Date(rearm.next_gate_deadline).toLocaleDateString(), short: true },
                              ]
                            : [{ label: "Window", value: "no live window to re-arm", short: true }]),
                    ],
                    metadata: { source: "outbound-rescue", opportunity_id: opportunityId },
                },
                orgId,
            );
            slackNotified = results.some((r) => r?.success);
        } catch (err: any) {
            logger.warn(`[Outbound] Slack notify failed (non-fatal): ${err.message}`);
        }

        logger.info(`[Outbound] Dispatched followup for ${opportunityId}; rearmed=${!!rearm} slack=${slackNotified}`);
        res.json({
            dispatched: true,
            opportunity_id: opportunityId,
            activity_id: activityId,
            rearmed: !!rearm,
            rearm,
            notified,
            slack_notified: slackNotified,
        });
    }
}
