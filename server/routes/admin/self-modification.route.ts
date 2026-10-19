import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../domain/auth/core/security.service.js";
import { requireSuperAdmin } from "../../utils/auth-context.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { BadRequestError } from "../../utils/errors.js";
import { selfModificationAdminService } from "../../services/self-modification-admin.service.js";
import { normalizeAuditFilter, parseProposalId } from "../../services/self-modification-input.js";

const router = Router();

// ============================================================================
// SELF-MODIFICATION TOOLS (Super Admin Only)
// ============================================================================

router.get("/code-status", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const result = await SELF_MODIFICATION_TOOLS.code_status.execute({}, { isSuperAdmin: true } as any);
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    const branch = await execAsync('git branch --show-current', { cwd: process.cwd() }).then(r => r.stdout.trim()).catch(() => 'main');
    
    res.json({ status: result, branch });
}));

router.post("/code-read", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath } = req.body;
    
    if (!filePath) throw new BadRequestError("filePath is required");
    
    const result = await SELF_MODIFICATION_TOOLS.code_read.execute({ filePath }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId 
    } as any);
    
    res.json({ content: result });
}));

router.post("/code-edit", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath, oldContent, newContent, commitMessage } = req.body;
    
    if (!filePath || !oldContent || !newContent) {
        throw new BadRequestError("filePath, oldContent, and newContent are required");
    }
    
    const result = await SELF_MODIFICATION_TOOLS.code_edit.execute({ filePath, oldContent, newContent, commitMessage }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId,
        ipAddress: req.ip 
    } as any);
    
    res.json({ success: !result.startsWith("Error"), message: result });
}));

router.post("/code-create", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath, content, commitMessage } = req.body;
    
    if (!filePath || !content) {
        throw new BadRequestError("filePath and content are required");
    }
    
    const result = await SELF_MODIFICATION_TOOLS.code_create.execute({ filePath, content, commitMessage }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId,
        ipAddress: req.ip 
    } as any);
    
    res.json({ success: !result.startsWith("Error"), message: result });
}));

router.post("/code-delete", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath, confirm, commitMessage } = req.body;
    
    if (!filePath || confirm !== true) {
        throw new BadRequestError("filePath and confirm=true are required");
    }
    
    const result = await SELF_MODIFICATION_TOOLS.code_delete.execute({ filePath, confirm, commitMessage }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId,
        ipAddress: req.ip 
    } as any);
    
    res.json({ success: !result.startsWith("Error"), message: result });
}));

router.post("/code-diff", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath } = req.body;
    
    const result = await SELF_MODIFICATION_TOOLS.code_diff.execute({ filePath }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId 
    } as any);
    
    res.json({ diff: result });
}));

router.post("/code-rollback", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath, commit, confirm } = req.body;
    
    if (!filePath || confirm !== true) {
        throw new BadRequestError("filePath and confirm=true are required");
    }
    
    const result = await SELF_MODIFICATION_TOOLS.code_rollback.execute({ filePath, commit, confirm }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId,
        ipAddress: req.ip 
    } as any);
    
    res.json({ success: !result.startsWith("Error"), message: result });
}));

router.post("/ai-refactor", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SELF_MODIFICATION_TOOLS } = await import("../../domain/tools/v1/capabilities/self-modification.js");
    const { filePath, instruction } = req.body;
    
    if (!filePath || !instruction) {
        throw new BadRequestError("filePath and instruction are required");
    }
    
    const result = await SELF_MODIFICATION_TOOLS.ai_refactor.execute({ filePath, instruction }, { 
        isSuperAdmin: true, 
        userId: (req.session as any)?.userId,
        ipAddress: req.ip 
    } as any);
    
    res.json({ success: !result.startsWith("Error"), content: result });
}));

router.get("/audit-log", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const entries = await selfModificationAdminService.listAuditEntries(
        normalizeAuditFilter(req.query.filter),
    );
    
    res.json({
        entries: entries.map((e: typeof entries[number]) => ({
            id: e.id,
            action: e.action,
            details: e.changes,
            timestamp: e.createdAt?.toISOString() || new Date().toISOString(),
            userId: String(e.userId),
        }))
    });
}));

router.post("/proposals/:id/approve", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const proposalId = parseProposalId(req.params.id);
    const updated = await selfModificationAdminService.approveProposal(
        proposalId,
        String((req.session as any)?.userId ?? "unknown"),
    );

    if (!updated) throw new BadRequestError("Proposal not found");

    res.json({ success: true, proposal: updated });
}));

router.post("/proposals/:id/second-approve", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const proposalId = parseProposalId(req.params.id);
    const updated = await selfModificationAdminService.secondApproveProposal(
        proposalId,
        String((req.session as any)?.userId ?? "unknown"),
    );

    if (!updated) throw new BadRequestError("Proposal not found");

    res.json({ success: true, proposal: updated });
}));

router.post("/validate", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { filePath, content } = req.body;
    if (!filePath || typeof filePath !== "string") {
        throw new BadRequestError("filePath is required");
    }
    const result = await selfModificationAdminService.validateProposedChange(
        filePath,
        typeof content === "string" ? content : "",
    );
    res.json(result);
}));

router.get("/check-permissions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { getUserOrgContext } = await import("../../utils/auth-context.js");
    const orgContext = await getUserOrgContext(req);
    res.json({ isSuperAdmin: orgContext.isSuperAdmin || false });
}));

export default router;
