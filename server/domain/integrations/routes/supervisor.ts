/**
 * Supervisor API
 * Plan streaming per AI_AGENT_ENHANCEMENTS_SPEC.
 */

import { Router, Request, Response } from "express";
import { supervisorService } from "../core/supervisor.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { CapabilityDiscoveryService } from "@domain/core/infrastructure/capability-discovery.service.js";

const router = Router();

/**
 * POST /api/supervisor/plan-stream
 * Stream supervisor plan generation via SSE.
 * Body: { intent, model?, credentialId?, capabilityCatalog?, knowledgeContext?, pipelineIds? }
 * Reduces perceived latency for mission launches (AI_AGENT_ENHANCEMENTS_SPEC).
 */
router.post("/plan-stream", requireAuth, async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const intent = body.intent;
        if (!intent || typeof intent !== "string") {
            return res.status(400).json({ error: "intent is required" });
        }
        const model = body.model;
        const credentialId = body.credentialId;
        let capabilityCatalog = body.capabilityCatalog ?? "";
        const knowledgeContext = body.knowledgeContext ?? "";
        const pipelineIds = Array.isArray(body.pipelineIds) ? body.pipelineIds : [];

        const orgContext = await getUserOrgContext(req);
        if (pipelineIds.length > 0 && !capabilityCatalog) {
            const caps = await CapabilityDiscoveryService.discoverCapabilities(
                pipelineIds,
                orgContext.organizationId || 0
            );
            capabilityCatalog = caps.map((c: any) => `- ${c.name}: ${c.description}`).join("\n");
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const send = (event: string, data: object) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            if (typeof (res as any).flush === "function") (res as any).flush();
        };

        for await (const item of supervisorService.planStream(
            intent,
            model,
            credentialId,
            capabilityCatalog,
            knowledgeContext ?? "",
            undefined, // previousPlan
            "", // history
            orgContext.organizationId || undefined,
            orgContext.userId
        )) {
            if (item.type === "chunk") {
                send("plan_chunk", { text: item.text });
            } else {
                send("plan_done", { plan: item.plan });
            }
        }
        send("plan_end", {});
        res.end();
    } catch (e: any) {
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.write(`event: plan_error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
            res.end();
        }
    }
});

export const supervisorRouter = router;
export default router;


