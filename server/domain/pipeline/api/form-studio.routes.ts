import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, type OrgContext } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { respondentDefinition } from "@shared/form-studio.js";
import { FORM_SESSION_HEADER, MAX_LINK_HOURS } from "@shared/form-studio-link.js";
import { createRateLimiter } from "@server/middleware/rate-limiter.js";
import { verifyFormSession } from "../core/form-link-session.js";
import { assertNameFreeInProject, attachToDefaultProject, emailCanReadProject, projectNameConflict } from "../core/form-studio-access.js";
import { formStudioService as service } from "../core/form-studio.service.js";
import { formStudioLibrary as library } from "../core/form-studio-library.service.js";
export const formStudioRouter = Router();
const id = z.coerce.number().int().positive();
const revision = z.number().int().nonnegative();
const name = z.string().min(1).max(300);
const patch = z.object({
  revision, name: name.optional(), schema: z.record(z.any()).optional(), themeConfig: z.record(z.any()).optional(), securityConfig: z.record(z.any()).optional(),
  // Autosaves by one author within 30 seconds share a revision.
  autosave: z.boolean().optional(), summary: z.string().min(1).max(300).optional(),
  // Required to rename a form that pipelines find by name.
  confirmRename: z.boolean().optional(),
});
const libraryQuery = z.object({
  q: z.string().max(200).optional(),
  state: z.enum(["draft", "published", "draft_ahead", "legacy", "archived"]).optional(),
  issues: z.enum(["open", "clear"]).optional(),
  use: z.enum(["used", "unused"]).optional(),
});
const proposalRequest = z.object({ sourceIds: z.array(id).max(10), instruction: z.string().min(1).max(12000) });
// Public links are unauthenticated, so every route is rate limited per link and
// address, and asking for an emailed code far more tightly than reading the form.
const QUARTER_HOUR = 15 * 60 * 1000;
const publicReads = createRateLimiter({ windowMs: QUARTER_HOUR, maxRequests: 300 });
const publicWrites = createRateLimiter({ windowMs: QUARTER_HOUR, maxRequests: 30 });
const codeRequests = createRateLimiter({ windowMs: QUARTER_HOUR, maxRequests: 5 });
const email = z.string().trim().toLowerCase().email().max(320);

const projectCtxOf = (ctx: OrgContext) => ({
  organizationId: ctx.organizationId as number, userId: ctx.userId ?? undefined, isSuperAdmin: Boolean(ctx.isSuperAdmin), isOrgAdmin: Boolean(ctx.isOrgAdmin),
});
/** A Project Space the caller can read, and edit when asked; otherwise not found or forbidden. */
async function projectOf(ctx: OrgContext, key: string, options: { edit?: boolean } = {}) {
  const { projectService } = await import("@domain/projects/core/project.service.js");
  const project = await projectService.getProject(projectCtxOf(ctx), key);
  if (options.edit) await projectService.assertCanEdit(projectCtxOf(ctx), project);
  return project;
}

/**
 * The respondent a link that asks for a code has verified, or a 401 telling the page
 * to ask. A members-only link always asks, and turns away with a 403 a session whose
 * email is not, or is no longer, a member of the project.
 */
async function respondentOf(
  req: Request, res: Response, token: string, security: { requireOtp: boolean }, name: string,
  access: { membersOnly: boolean; projectId: number | null; projectName: string | null }, organizationId: number | null,
): Promise<{ email: string } | null | false> {
  if (!security.requireOtp && !access.membersOnly) return null;
  const respondent = verifyFormSession(req.header(FORM_SESSION_HEADER), token);
  if (!respondent) {
    res.status(401).json({
      status: "otp_required", name, membersOnly: access.membersOnly,
      message: access.membersOnly ? "This form is for members of its project. Confirm your email address to open it." : "This form asks you to confirm your email address first.",
    });
    return false;
  }
  if (access.membersOnly && !(await emailCanReadProject(access.projectId as number, organizationId as number, respondent.email))) {
    res.status(403).json({ status: "members_only", name, message: `This form is only for members of ${access.projectName ?? "its project"}.` });
    return false;
  }
  return respondent;
}

formStudioRouter.get("/public/:token", publicReads, asyncHandler(async (req: Request, res: Response) => {
  const { row, release, security, access } = await service.published(req.params.token);
  if ((await respondentOf(req, res, req.params.token, security, release.name, access, row.organizationId)) === false) return;
  // A respondent gets no knowledge sources, tests, issues, reviewer results, rules or actions.
  res.json({ name: release.name, revision: release.revision, releaseNumber: release.releaseNumber, themeConfig: release.themeConfig, requireOtp: security.requireOtp || access.membersOnly, membersOnly: access.membersOnly, schema: respondentDefinition(release.schema) });
}));
formStudioRouter.post("/public/:token", publicWrites, asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ revision, inputs: z.record(z.any()) }).parse(req.body);
  const { row, release, security, access } = await service.published(req.params.token);
  const respondent = await respondentOf(req, res, req.params.token, security, release.name, access, row.organizationId);
  if (respondent === false) return;
  res.status(201).json(await service.submit(req.params.token, body.revision, body.inputs, respondent));
}));
formStudioRouter.post("/public/:token/code", codeRequests, asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ email }).parse(req.body);
  res.json(await service.requestLinkCode(req.params.token, body.email));
}));
formStudioRouter.post("/public/:token/code/verify", publicWrites, asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") }).parse(req.body);
  res.json(await service.verifyLinkCode(req.params.token, body.email, body.code));
}));
formStudioRouter.use(requireAuth);
// The Forms library: authored forms only, never runtime requests or stored responses.
formStudioRouter.get("/", asyncHandler(async (req: Request, res: Response) => res.json(await library.list(await getUserOrgContext(req), libraryQuery.parse(req.query)))));
// A form's own Project Space, or the project a new form is started in, lists its documents first.
formStudioRouter.get("/sources", asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getUserOrgContext(req);
  const q = z.string().max(200).parse(req.query.q ?? "");
  const formId = req.query.formId ? id.parse(req.query.formId) : undefined;
  const projectKey = typeof req.query.projectKey === "string" && req.query.projectKey ? req.query.projectKey : null;
  const projectId = projectKey ? (await projectOf(ctx, projectKey)).id : undefined;
  res.json(await service.sources(q, ctx, { formId, projectId }));
}));
formStudioRouter.get("/sources/:id", asyncHandler(async (req: Request, res: Response) => res.json(await service.readSource(id.parse(req.params.id), await getUserOrgContext(req)))));
// A proposal for a new form. Nothing is saved until POST / creates the draft from it.
formStudioRouter.post("/generate", asyncHandler(async (req: Request, res: Response) => {
  const body = proposalRequest.parse(req.body);
  res.json(await service.generateNew(body.sourceIds, body.instruction, await getUserOrgContext(req)));
}));
formStudioRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({
    name, schema: z.record(z.any()).optional(), description: z.string().max(10000).nullable().optional(),
    // A form started in a Project Space belongs to it.
    projectKey: z.string().min(1).max(64).optional(),
  }).parse(req.body);
  const ctx = await getUserOrgContext(req);
  // Editing rights in the project are checked before anything is created.
  const project = body.projectKey ? await projectOf(ctx, body.projectKey, { edit: true }) : null;
  if (project && !project.isDefault) await assertNameFreeInProject(project.id, body.name);
  const form = await service.create(body.name, ctx, { schema: body.schema, description: body.description });
  if (project) {
    const { projectService } = await import("@domain/projects/core/project.service.js");
    await projectService.attachResource(projectCtxOf(ctx), project.id, "form", form.id);
  } else if (ctx.organizationId != null) {
    // Every unassigned form lives in the organization's default project, like every other resource.
    await attachToDefaultProject(form.id, ctx.organizationId, ctx.userId ?? null);
  }
  res.status(201).json(form);
}));
// A stage of a cycle's response that an approval request asks the signed-in person
// to fill in. Only its designated approver or an admin of its organization may.
const deciderOf = (req: any) => ({ id: req.user.id, email: req.user.email, adminRole: req.user.adminRole });
formStudioRouter.get("/stage-requests/:approvalId", asyncHandler(async (req: Request, res: Response) => {
  const { stageRequestForUser } = await import("../core/form-studio-stage-requests.service.js");
  res.json(await stageRequestForUser(id.parse(req.params.approvalId), deciderOf(req)));
}));
formStudioRouter.post("/stage-requests/:approvalId", asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ inputs: z.record(z.any()) }).parse(req.body);
  const { completeStageForUser } = await import("../core/form-studio-stage-requests.service.js");
  res.json(await completeStageForUser(id.parse(req.params.approvalId), body.inputs, deciderOf(req)));
}));
formStudioRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => res.json(await service.get(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.put("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { revision: expected, autosave, summary, confirmRename, ...changes } = patch.parse(req.body);
  try {
    res.json(await service.save(id.parse(req.params.id), expected, changes, await getUserOrgContext(req), summary, { autosave, confirmRename }));
  } catch (error) {
    // A rename to a name another form in the same Project Space already has.
    throw projectNameConflict(error, changes.name);
  }
}));
formStudioRouter.get("/:id/usage", asyncHandler(async (req: Request, res: Response) => res.json(await library.usage(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/duplicate", asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ name: name.optional() }).parse(req.body ?? {});
  res.status(201).json(await service.duplicate(id.parse(req.params.id), await getUserOrgContext(req), body.name));
}));
formStudioRouter.post("/:id/generate", asyncHandler(async (req: Request, res: Response) => {
  const body = proposalRequest.extend({ revision }).parse(req.body);
  res.json(await service.generate(id.parse(req.params.id), body.revision, body.sourceIds, body.instruction, await getUserOrgContext(req)));
}));
formStudioRouter.post("/:id/undo", asyncHandler(async (req: Request, res: Response) => res.json(await service.undo(id.parse(req.params.id), revision.parse(req.body.revision), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/redo", asyncHandler(async (req: Request, res: Response) => res.json(await service.redo(id.parse(req.params.id), revision.parse(req.body.revision), await getUserOrgContext(req)))));
formStudioRouter.get("/:id/revisions", asyncHandler(async (req: Request, res: Response) => res.json(await service.revisions(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/revisions/:seq/restore", asyncHandler(async (req: Request, res: Response) => res.json(await service.restore(id.parse(req.params.id), revision.parse(req.body.revision), id.parse(req.params.seq), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/template-update/apply", asyncHandler(async (req: Request, res: Response) => res.json(await service.applyTemplateUpdate(id.parse(req.params.id), revision.parse(req.body.revision), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/template-update/dismiss", asyncHandler(async (req: Request, res: Response) => res.json(await service.dismissTemplateUpdate(id.parse(req.params.id), revision.parse(req.body.revision), await getUserOrgContext(req)))));
formStudioRouter.get("/:id/releases", asyncHandler(async (req: Request, res: Response) => res.json(await service.releases(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/publish", asyncHandler(async (req: Request, res: Response) => res.json(await service.publish(id.parse(req.params.id), revision.parse(req.body.revision), await getUserOrgContext(req)))));
formStudioRouter.post("/:id/link/rotate", asyncHandler(async (req: Request, res: Response) => res.json(await service.rotateLink(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.get("/:id/link", asyncHandler(async (req: Request, res: Response) => res.json(await service.linkAccess(id.parse(req.params.id), await getUserOrgContext(req)))));
formStudioRouter.put("/:id/link", asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({
    requireOtp: z.boolean(), tokenExpirationHours: z.number().int().min(1).max(MAX_LINK_HOURS).nullable(),
    // Only meaningful for a form in a private project; null returns it to members only.
    audience: z.enum(["anyone", "project_members"]).nullable().optional(),
  }).parse(req.body);
  res.json(await service.setLinkSecurity(id.parse(req.params.id), body, await getUserOrgContext(req)));
}));
formStudioRouter.post("/:id/test", asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ inputs: z.record(z.any()), stageId: z.string().max(100).optional() }).parse(req.body);
  res.json(await service.test(id.parse(req.params.id), body.inputs, await getUserOrgContext(req), body.stageId));
}));
formStudioRouter.get("/:id/responses", asyncHandler(async (req: Request, res: Response) => res.json(await service.responses(id.parse(req.params.id), await getUserOrgContext(req)))));
