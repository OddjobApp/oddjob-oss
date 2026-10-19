import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { documentTemplateService } from "../core/document-template.service.js";

const router = Router();

// GET /api/document-templates - List all templates for org
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId === null) {
        return res.status(400).json({ error: "Missing organization context" });
    }
    const results = await documentTemplateService.list(orgContext.organizationId);
    res.json(results);
}));

// POST /api/document-templates - Create new template
router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId === null) {
        return res.status(400).json({ error: "Missing organization context" });
    }
    const data = req.body;
    const userId = (req.session as any)?.userId?.toString() || "system";

    const template = await documentTemplateService.create({
        ...data,
        createdBy: userId,
    }, orgContext.organizationId);
    res.json(template);
}));

// GET /api/document-templates/:id - Get template details
router.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId === null) {
        return res.status(400).json({ error: "Missing organization context" });
    }
    const id = parseInt(req.params.id);
    const template = await documentTemplateService.getById(id, orgContext.organizationId);

    if (!template) {
        return res.status(404).json({ error: "Document template not found" });
    }

    res.json(template);
}));

// PATCH /api/document-templates/:id - Update template
router.patch("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId === null) {
        return res.status(400).json({ error: "Missing organization context" });
    }
    const id = parseInt(req.params.id);
    const data = req.body;

    const template = await documentTemplateService.update(id, data, orgContext.organizationId);
    res.json(template);
}));

// DELETE /api/document-templates/:id - Delete template
router.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId === null) {
        return res.status(400).json({ error: "Missing organization context" });
    }
    const id = parseInt(req.params.id);
    await documentTemplateService.delete(id, orgContext.organizationId);
    res.json({ success: true });
}));

// POST /api/document-templates/export - Compile and stream DocumentBlockAST in specified format
// requireAuth: this router has no router-level guard (each route applies its own),
// and export drives docx/pptx zip building from caller-supplied JSON — leaving it
// open is an anonymous CPU/memory amplification endpoint.
router.post("/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { ast, format } = req.body;
    if (!ast) {
        return res.status(400).json({ error: "Missing document AST" });
    }

    const { presentationAssemblyService } = await import("../core/presentation-assembly.service.js");
    const safeTitle = (ast.title || "document").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    switch (format) {
        case "docx": {
            const buffer = await presentationAssemblyService.compileASTToDocx(ast);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
            return res.send(buffer);
        }
        case "pptx": {
            const buffer = await presentationAssemblyService.compileASTToPptx(ast);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
            res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pptx"`);
            return res.send(buffer);
        }
        case "html": {
            const html = presentationAssemblyService.compileToWebDeck(ast);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.html"`);
            return res.send(html);
        }
        case "markdown": {
            const md = presentationAssemblyService.compileToMarkdownSummary(ast);
            res.setHeader("Content-Type", "text/markdown; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.md"`);
            return res.send(md);
        }
        default:
            return res.status(400).json({ error: `Unsupported export format: ${format}` });
    }
}));

export default router;
