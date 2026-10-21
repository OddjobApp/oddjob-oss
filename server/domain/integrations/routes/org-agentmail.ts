import { Router, type Request, type Response } from "express";
import { requireAuth } from "@server/domain/auth/core/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { orgAgentMailService } from "../core/org-agentmail.service.js";
import { agentMailService } from "../core/agentmail.service.js";
import { handleOrgAgentMailDelivery } from "../core/org-agentmail-inbound.service.js";

const router = Router();

// AgentMail delivers each organization's inbound mail here, to the URL registered
// for it. No session: the organization's own webhook secret authenticates the
// delivery, which is verified over the raw body the JSON parser kept.
router.post("/webhooks/:token", asyncHandler(async (req: Request, res: Response) => {
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody?.length) return res.status(400).json({ error: "Empty body" });
    const header = (name: string) => (typeof req.headers[name] === "string" ? req.headers[name] as string : undefined);
    const result = await handleOrgAgentMailDelivery(req.params.token, rawBody, {
        id: header("svix-id"), timestamp: header("svix-timestamp"), signature: header("svix-signature"),
    });
    return res.status(result.status).json(result.body);
}));

router.use((req, res, next) => {
    if (req.path === "/webhook") return next("router");
    return requireAuth(req, res, next);
});
router.get("/connection", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...await orgAgentMailService.status(requireOrgId(context)), canManage: context.isOrgAdmin || context.isSuperAdmin });
}));
router.put("/connection", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    if (!context.isOrgAdmin && !context.isSuperAdmin) return res.status(403).json({ message: "Organization administrator required" });
    res.setHeader("Cache-Control", "no-store");
    return res.json(await orgAgentMailService.connect(requireOrgId(context), req.body));
}));
router.delete("/connection", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    if (!context.isOrgAdmin && !context.isSuperAdmin) return res.status(403).json({ message: "Organization administrator required" });
    await orgAgentMailService.disconnect(requireOrgId(context));
    return res.status(204).send();
}));
router.get("/status", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    res.json(await orgAgentMailService.status(requireOrgId(context)));
}));
router.get("/threads", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    const client = await agentMailService.forOrg(requireOrgId(context));
    res.setHeader("Cache-Control", "no-store");
    res.json(await client.listThreads(25));
}));
router.get("/threads/:threadId", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    const client = await agentMailService.forOrg(requireOrgId(context));
    res.setHeader("Cache-Control", "no-store");
    res.json(await client.getThread(req.params.threadId));
}));
router.get("/threads/:threadId/messages", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    const client = await agentMailService.forOrg(requireOrgId(context));
    const thread = await client.getThread(req.params.threadId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ messages: thread.messages });
}));
export default router;
