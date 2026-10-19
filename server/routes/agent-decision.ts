import { Router, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { MoltProducer } from "@domain/governor/index.js";

export const agentDecisionRouter = Router();

const DecisionSchema = z.object({
    approved: z.boolean(),
    reason: z.string().optional(),
    proposalId: z.string().optional() // Optional for now, but good for strict matching later
});

// Store pending decisions in memory for now (simple PoC) - in prod, use Redis
// key: sessionId, value: pending proposal
const globalAny = global as any;
if (!globalAny._pendingDecisions) {
    globalAny._pendingDecisions = new Map<string, any>();
}
export const pendingDecisions = globalAny._pendingDecisions as Map<string, any>;

agentDecisionRouter.get("/:sessionId/decision", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const pending = pendingDecisions.get(sessionId);
    res.json({ pending: pending || null });
}));

agentDecisionRouter.post("/:sessionId/decision", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const body = DecisionSchema.parse(req.body);

    // Initialize MoltProducer for this session
    // Note: In a real distributed system, we might need to ensure we're connecting 
    // to the same Redis instance/cluster as the runner.
    const producer = new MoltProducer(sessionId);

    try {
        // Publish DECISION event
        await producer.publish("DECISION", {
            approved: body.approved,
            reason: body.reason,
            proposalId: body.proposalId,
            timestamp: Date.now(),
            user: (req as any).user?.username || "unknown"
        });

        res.json({ success: true, message: "Decision published" });
    } catch (error: any) {
        console.error("Failed to publish decision:", error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await producer.disconnect();
    }
}));

