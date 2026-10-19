import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { assertOrgId, getUserOrgContext, requireOrgAdminOrSuper } from "@server/utils/auth-context.js";
import { knowledgePackService } from "./knowledge-pack.service.js";
import { syntheticFinanceWorkflowService } from "./synthetic-finance-workflow.service.js";
import { knowledgePackLifecycleService, snapshotHash } from "./knowledge-pack-lifecycle.service.js";
import { knowledgePackMonitorService } from "./knowledge-pack-monitor.service.js";

const router = Router();
router.use(requireOrgAdminOrSuper);

const Role = z.enum(["drafter", "reviewer", "publisher", "auditor", "source_acquirer", "source_verifier", "source_monitor", "change_reviewer", "legal", "compliance", "release_manager"]);
const actor = async (req: Request) => {
  const org = await getUserOrgContext(req);
  const role = Role.parse(req.body?.role);
  return { organizationId: assertOrgId(org.organizationId), id: `synthetic-finance-agent:${role}`, requestedBy: String(org.userId), role };
};
const financeActor = async (req: Request) => {
  const org = await getUserOrgContext(req);
  const role = z.enum(["drafter", "reviewer", "publisher", "auditor"]).parse(req.body?.role);
  return { organizationId: assertOrgId(org.organizationId), id: `synthetic-finance-agent:${role}`, requestedBy: String(org.userId), role };
};

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req);
  const rows = await knowledgePackService.listForOrganization(assertOrgId(org.organizationId));
  res.json({ installations: rows.map(({ installation, pack }) => ({ ...installation, pack: { id: pack.id, key: pack.packKey, name: pack.name, version: pack.version, contentHash: pack.contentHash, synthetic: pack.synthetic } })) });
}));

router.get("/decisions", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req); const organizationId = assertOrgId(org.organizationId);
  const rows = await knowledgePackService.listDecisions(organizationId, 100);
  res.json({ decisions: rows });
}));

router.get("/lifecycle", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req);
  res.json(await knowledgePackLifecycleService.list(assertOrgId(org.organizationId)));
}));

router.get("/monitors", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req);
  res.json(await knowledgePackMonitorService.list(assertOrgId(org.organizationId)));
}));

router.put("/sources/:id/monitor", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req); const organizationId = assertOrgId(org.organizationId);
  const input = z.object({ enabled: z.boolean().default(true), checkIntervalHours: z.number().int().min(1).max(720), trustedHosts: z.array(z.string().min(1)).min(1), escalationHours: z.number().int().min(1).max(2160) }).parse(req.body);
  res.json(await knowledgePackMonitorService.configure(organizationId, Number(req.params.id), { ...input, ownerUserId: String(org.userId) }));
}));

router.post("/monitors/:id/run", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req); const organizationId = assertOrgId(org.organizationId);
  const monitors = await knowledgePackMonitorService.list(organizationId);
  if (!monitors.monitors.some(item => item.id === Number(req.params.id))) throw new Error("Knowledge pack monitor not found in this organization");
  res.json(await knowledgePackMonitorService.runMonitor(Number(req.params.id)));
}));

router.post("/sources", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "source_acquirer") throw new Error("Source acquisition requires the source_acquirer role");
  const input = z.object({ packKey: z.string().min(1), title: z.string().min(1), sourceUri: z.string().url(), authority: z.string().min(1), jurisdiction: z.string().min(1), effectiveDate: z.string().optional(), contentSnapshot: z.string().min(1), freshnessDays: z.number().int().min(1).max(365).optional() }).parse(req.body);
  res.status(201).json(await knowledgePackLifecycleService.acquireSource(a.organizationId, a.id, input));
}));

router.post("/sources/:id/verify", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "source_verifier") throw new Error("Source verification requires the source_verifier role");
  res.json(await knowledgePackLifecycleService.verifySource(a.organizationId, Number(req.params.id), a.id));
}));

router.post("/sources/:id/recheck", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "source_monitor") throw new Error("Source rechecks require the source_monitor role");
  const input = z.object({ contentSnapshot: z.string().min(1), effectiveDate: z.string().optional() }).parse(req.body);
  res.json(await knowledgePackLifecycleService.recheckSource(a.organizationId, Number(req.params.id), a.id, input));
}));

router.post("/change-candidates/:id/review", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "change_reviewer") throw new Error("Change review requires the change_reviewer role");
  const { decision } = z.object({ decision: z.enum(["accepted", "dismissed"]) }).parse(req.body);
  res.json(await knowledgePackLifecycleService.reviewCandidate(a.organizationId, Number(req.params.id), a.id, decision));
}));

router.post("/releases/from/:baseId", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "release_manager") throw new Error("Release creation requires the release_manager role");
  const input = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), sourceIds: z.array(z.number().int().positive()).min(1) }).parse(req.body);
  const base = await knowledgePackService.getPackById(Number(req.params.baseId));
  if (!base) throw new Error("Base knowledge pack release not found");
  const manifest = structuredClone(base.manifest) as any;
  manifest.metadata.version = input.version;
  manifest.metadata.contentHash = snapshotHash(JSON.stringify({ ...manifest, metadata: { ...manifest.metadata, contentHash: undefined } }));
  res.status(201).json(await knowledgePackLifecycleService.createDraft(a.organizationId, manifest, input.sourceIds));
}));

router.post("/releases/:id/attest", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  const input = z.object({ type: z.enum(["legal", "compliance"]), decision: z.enum(["approved", "rejected"]), notes: z.string().optional() }).parse(req.body);
  if (a.role !== input.type) throw new Error(`Attestation requires the ${input.type} role`);
  res.json(await knowledgePackLifecycleService.attest(a.organizationId, Number(req.params.id), a.id, input));
}));

router.post("/releases/:id/promote", asyncHandler(async (req: Request, res: Response) => {
  const a = await actor(req);
  if (a.role !== "release_manager") throw new Error("Promotion requires the release_manager role");
  const { target } = z.object({ target: z.enum(["validated", "published"]) }).parse(req.body);
  res.json(await knowledgePackLifecycleService.promote(a.organizationId, Number(req.params.id), target));
}));

router.get("/synthetic-finance/communications", asyncHandler(async (req: Request, res: Response) => {
  const org = await getUserOrgContext(req);
  res.json({ communications: await syntheticFinanceWorkflowService.list(assertOrgId(org.organizationId)) });
}));

router.post("/synthetic-finance/communications", asyncHandler(async (req: Request, res: Response) => {
  const a = await financeActor(req);
  const input = z.object({ title: z.string().min(1), content: z.string().min(1), customerClassification: z.string().min(1), archiveTarget: z.string().min(1) }).parse(req.body);
  res.status(201).json(await syntheticFinanceWorkflowService.draft(a.organizationId, a, input));
}));

router.post("/synthetic-finance/communications/:id/submit", asyncHandler(async (req: Request, res: Response) => {
  const a = await financeActor(req); const email = z.string().email().parse(req.body.email);
  res.json(await syntheticFinanceWorkflowService.submit(a.organizationId, Number(req.params.id), { ...a, email }));
}));

router.post("/synthetic-finance/communications/:id/approve", asyncHandler(async (req: Request, res: Response) => {
  const a = await financeActor(req);
  res.json(await syntheticFinanceWorkflowService.approve(a.organizationId, Number(req.params.id), a));
}));

router.post("/synthetic-finance/communications/:id/publish", asyncHandler(async (req: Request, res: Response) => {
  const a = await financeActor(req);
  res.json(await syntheticFinanceWorkflowService.publish(a.organizationId, Number(req.params.id), a));
}));

export default router;
