import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { db } from "@server/database_service.js";
import { approvalRequests } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { AGENT_TOOLS } from "@domain/tools/v1/capabilities/index.js";
import { normalizeToolName } from "@domain/tools/v1/tool-registry.service.js";

const router = Router();

// POST /api/approvals/:id/execute
router.post("/:id/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const requestId = parseInt(req.params.id);
    if (isNaN(requestId)) throw new BadRequestError("Invalid request ID");

    const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    if (!approval) throw new NotFoundError("Approval request not found");

    if (approval.status === 'approved') {
        throw new BadRequestError("This proposal has already been approved and executed.");
    }
    if (approval.status === 'rejected') {
        throw new BadRequestError("This proposal was rejected.");
    }

    // Verify token (Optional, but good practice if provided)
    const { token } = req.body;
    if (token && token !== approval.token) {
        throw new BadRequestError("Invalid approval token");
    }

    if (!approval.toolName) {
        throw new BadRequestError("This approval request is not a tool execution proposal.");
    }

    const normalizedName = normalizeToolName(approval.toolName);
    const tool = AGENT_TOOLS[normalizedName];
    
    if (!tool) {
        throw new BadRequestError(`Tool definition not found for: ${approval.toolName}`);
    }

    // Execute the tool bypassing the handlers.ts interceptor
    const context = {
        organizationId: approval.organizationId,
        missionRunId: approval.executionId !== "system" ? parseInt(approval.executionId) : undefined,
        userId: (req as any).user?.id,
        named: {},
        positional: {}
    };

    let result;
    try {
        result = await tool.execute(approval.toolArgs as any, context as any);
        
        // Mark as approved and executed
        await db.update(approvalRequests)
            .set({ 
                status: 'approved',
                decisionAt: new Date(),
                comments: "Approved and executed via HIL",
            })
            .where(eq(approvalRequests.id, requestId));

    } catch (err: any) {
        throw new Error(`Tool execution failed: ${err.message}`);
    }

    res.json({ success: true, result });
}));

export default router;
