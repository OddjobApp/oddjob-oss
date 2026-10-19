import { Router } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { z } from "zod";
import { isValidRecurrence } from "@shared/contracts/project-event-recurrence.js";
import { assertOrgId, getUserOrgContext } from "@server/utils/auth-context.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { missions } from "@shared/schema/missions/core.js";
import { apps } from "@shared/schema/apps.js";
import { datasets } from "@shared/schema/datasets.js";
import { knowledgeDocuments } from "@shared/schema/knowledge-base.js";
import { cycleRunEvents } from "@shared/schema/cycle-run-events.js";
import { projectResources } from "@shared/schema/projects.js";
import {
    createProjectSchema,
    updateProjectSchema,
    insertProjectMemberSchema,
    insertProjectResourceSchema,
    PROJECT_RESOURCE_TYPES,
    PROJECT_EVENT_KINDS,
    PROJECT_EVENT_SEVERITIES,
    type ProjectResourceType,
} from "@shared/schema/projects.js";
import { BadRequestError } from "@server/utils/errors.js";
import { setSessionProject, resolveProjectScope } from "@server/middleware/project-scope.js";
import { projectService, type ProjectCtx } from "../core/project.service.js";
import { financeRolesService } from "../core/finance-roles.service.js";
import { saasAdapterInventoryService } from "@domain/integrations/saas-adapter-inventory.service.js";
import { projectBindingService } from "@domain/integrations/project-binding.service.js";
import { attachmentService } from "@domain/knowledge/core/attachment.service.js";
import { attachmentIndexService } from "@domain/knowledge/core/attachment-index.service.js";

/**
 * Org-scoped HTTP API for Project Spaces. Like the ontology routes, every handler
 * resolves the org from the session and never from a request parameter, so
 * cross-tenant access is impossible by construction.
 *
 * See docs/PROJECT_SPACES_DESIGN.md.
 */
const projectsRouter = Router();

async function ctxOf(req: any): Promise<ProjectCtx> {
    const orgContext = await getUserOrgContext(req);
    const agentId = req.headers?.["x-agent-id"];
    
    // Explicit org requested via query param or header takes absolute precedence
    const queryOrg = req.query?.orgId || req.query?.organizationId;
    const headerOrg = req.headers?.["x-organization-id"];
    const explicitOrg = queryOrg || headerOrg;

    let organizationId: number | null = null;
    if (explicitOrg && !isNaN(parseInt(explicitOrg as string, 10))) {
        organizationId = parseInt(explicitOrg as string, 10);
    } else if (orgContext.organizationId) {
        organizationId = orgContext.organizationId;
    } else {
        const sessionOrg = req.session?.currentOrgId || req.session?.organizationId || req.session?.defaultOrgId;
        if (sessionOrg && !isNaN(parseInt(sessionOrg as string, 10))) {
            organizationId = parseInt(sessionOrg as string, 10);
        } else if (orgContext.isSuperAdmin || process.env.NODE_ENV !== "production") {
            organizationId = await projectService.getFallbackOrgId();
        }
    }

    return {
        organizationId: assertOrgId(organizationId),
        userId: orgContext.userId || "anonymous",
        // Declaring an agent principal can only narrow what this request may reach
        // (§8 ceilings lower, never grant), so it is taken at face value.
        agentId: typeof agentId === "string" && agentId.trim() ? agentId.trim() : undefined,
        isSuperAdmin: orgContext.isSuperAdmin,
        isOrgAdmin: orgContext.isOrgAdmin,
    };
}

function assertResourceType(value: unknown): ProjectResourceType {
    if (typeof value !== "string" || !PROJECT_RESOURCE_TYPES.includes(value as ProjectResourceType)) {
        throw new BadRequestError(
            `resourceType must be one of: ${PROJECT_RESOURCE_TYPES.join(", ")}.`,
        );
    }
    return value as ProjectResourceType;
}

// ---- Collection ------------------------------------------------------------

projectsRouter.get("/", requireAuth, asyncHandler(async (req: any, res: any) => {
    const includeArchived = req.query.includeArchived === "true";
    const projects = await projectService.listProjectsWithSpend(await ctxOf(req), { includeArchived });
    res.json({ projects });
}));

projectsRouter.post("/", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    // organizationId/createdBy/isDefault are server-supplied; a client-sent value is
    // ignored, and `key` is derived from the name when absent.
    const parsed = createProjectSchema.parse(req.body ?? {});
    const project = await projectService.createProject(ctx, parsed as any);
    res.status(201).json({ project });
}));

// ---- Active scope (the header switcher) ------------------------------------
// Registered before /:key so 'active' is never read as a project key.

projectsRouter.get("/active", requireAuth, asyncHandler(async (req: any, res: any) => {
    const scope = await resolveProjectScope(req);
    if (!scope) return res.json({ project: null });
    const project = await projectService.getProject(await ctxOf(req), scope.id);
    res.json({ project });
}));

projectsRouter.post("/active", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const raw = req.body?.projectId ?? req.body?.projectKey ?? null;

    if (raw === null) {
        setSessionProject(req, null);
        return res.json({ project: null });
    }

    // Resolving through the service is what stops a caller from pinning their session
    // to another org's project id.
    const project = await projectService.getProject(ctx, raw);
    setSessionProject(req, project.id);
    res.json({ project });
}));

// ---- Single project --------------------------------------------------------

projectsRouter.get("/:key", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const [spend, role] = await Promise.all([
        projectService.getProjectSpend(ctx, project.id),
        projectService.roleFor(ctx, project),
    ]);
    res.json({ project, spend, role });
}));

projectsRouter.patch("/:key", requireAuth, asyncHandler(async (req: any, res: any) => {
    const patch = updateProjectSchema.parse(req.body ?? {});
    const project = await projectService.updateProject(await ctxOf(req), req.params.key, patch);
    res.json({ project });
}));

projectsRouter.post("/:key/archive", requireAuth, asyncHandler(async (req: any, res: any) => {
    const project = await projectService.archiveProject(await ctxOf(req), req.params.key);
    res.json({ project });
}));

projectsRouter.get("/:key/spend", requireAuth, asyncHandler(async (req: any, res: any) => {
    const spend = await projectService.getProjectSpend(await ctxOf(req), req.params.key);
    res.json({ spend });
}));

// ---- Files tab -------------------------------------------------------------
//
// The same records the room reads through list_attachments, so a file listed
// here and a file an agent can search are the same thing.

projectsRouter.get("/:key/files", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
    res.json({ files: await attachmentService.listForProject(ctx.organizationId, project.id) });
}));

projectsRouter.get("/:key/files/:id/download", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
    const file = await attachmentService.readBlob(ctx.organizationId, project.id, Number(req.params.id));
    // Scoped by org AND project in the query, so a miss means it is not this
    // project's to read.
    if (!file) throw new BadRequestError("No such file in this project.");

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.displayName.replace(/"/g, "")}"`);
    res.send(file.bytes);
}));

/**
 * What the in-place editor will carry, in BYTES on both sides.
 *
 * Attachments are accepted up to 50MB, and this reads one whole blob into
 * memory to answer with it as JSON — so without a cap here, one click on a
 * large log opens the server to a 50MB read and hands the browser a 50MB
 * textarea. The same number bounds the write, measured after encoding rather
 * than in characters: a two-million CHARACTER limit is up to four times that
 * many bytes once the document is not ASCII.
 */
const MAX_EDITABLE_BYTES = 1024 * 1024;
const tooLarge = (what: string) =>
    new BadRequestError(
        `This file is too large to ${what} here (limit ${MAX_EDITABLE_BYTES / 1024}KB). ` +
        `Download it, change it locally, and attach it again.`,
    );

projectsRouter.get("/:key/files/:id/content", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const file = await attachmentService.readBlob(ctx.organizationId, project.id, Number(req.params.id));
    if (!file) throw new BadRequestError("No such file in this project.");
    const editable = (file.mimeType || "").startsWith("text/") || /\.(md|markdown|txt|json|csv|xml|ya?ml|log)$/i.test(file.displayName);
    if (!editable) throw new BadRequestError("This file type cannot be edited as text.");
    if (file.bytes.byteLength > MAX_EDITABLE_BYTES) throw tooLarge("open");
    res.json({ content: file.bytes.toString("utf-8"), displayName: file.displayName });
}));

projectsRouter.patch("/:key/files/:id/content", requireAuth, asyncHandler(async (req: any, res: any) => {
    const { content } = z.object({ content: z.string() }).parse(req.body ?? {});
    if (Buffer.byteLength(content, "utf-8") > MAX_EDITABLE_BYTES) throw tooLarge("save");
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    // getProject authorizes a READ — the whole org can read an org-visible
    // project, and a viewer can read a private one. Writing is the editor's.
    await projectService.assertCanEdit(ctx, project);
    const updated = await attachmentService.updateText(ctx.organizationId, project.id, Number(req.params.id), content);
    if (!updated) throw new BadRequestError("No such file in this project.");
    void attachmentIndexService.indexAttachment(Number(req.params.id), ctx.organizationId)
        .catch(() => undefined);
    res.json({ file: updated });
}));

// ---- Integrations tab ------------------------------------------------------
//
// The same records the CREW room reads through list_saas_adapters, so the room
// and this tab cannot drift: the room is a conversational path to these rows,
// not a second source of truth.

projectsRouter.get("/:key/integrations", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const adapters = await saasAdapterInventoryService.listForProject(ctx.organizationId, project.id);
    res.json({ adapters });
}));

projectsRouter.post("/:key/integrations/bindings", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const body = z.object({
        resourceKind: z.enum(["confluence_space", "jira_project"]),
        resourceKey: z.string().min(1),
        resourceName: z.string().optional(),
        resourceType: z.string().optional(),
        externalId: z.string().optional(),
        webUrl: z.string().optional(),
    }).parse(req.body ?? {});

    const binding = await projectBindingService.bind({
        orgId: ctx.organizationId,
        projectId: project.id,
        ...body,
        boundBy: req.user?.email ?? req.user?.id ?? null,
    });
    res.status(201).json({ binding });
}));

projectsRouter.delete("/:key/integrations/bindings/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const removed = await projectBindingService.unbind(
        ctx.organizationId,
        project.id,
        Number(req.params.id),
    );
    // Scoped by org AND project inside the service, so a missing row here means
    // it is not this project's to remove — reported as absent, not as success.
    if (!removed) throw new BadRequestError("No such binding on this project.");
    res.json({ removed });
}));

// ---- Scoped work surfaces (Overview / Cycles / Work tabs) ------------------

projectsRouter.get("/:key/cycles", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const cycles = await projectService.listCycles(ctx, project.id);
    res.json({ cycles });
}));

projectsRouter.get("/:key/missions", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const missionRows = await projectService.listMissions(ctx, project.id);
    res.json({ missions: missionRows });
}));

// Apps produced by this project. Replaces App Arsenal's `parentCycle`
// first-owner-wins grouping, which was a proxy for exactly this concept (§2.3).
projectsRouter.get("/:key/apps", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const appRows = await projectService.listApps(ctx, project.id);
    res.json({ apps: appRows });
}));

// Knowledge in scope — datasets and documents. Both carry a real project_id
// (migration 0007), which is also the boundary project-scoped RAG retrieval uses.
projectsRouter.get("/:key/knowledge", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const { datasets: datasetRows, documents: documentRows } = await projectService.listKnowledge(ctx, project.id);
    res.json({ datasets: datasetRows, documents: documentRows });
}));

// ---- Forms tab ---------------------------------------------------------------
// The project's Form Studio forms, the stages waiting in its cycles, recent results,
// and the datasets its responses are recorded in. Reading the project is the gate.
projectsRouter.get("/:key/forms", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const { projectFormsOverview } = await import("@domain/pipeline/core/form-studio-projects.service.js");
    res.json(await projectFormsOverview({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        isAdmin: Boolean(ctx.isOrgAdmin),
        isSuperAdmin: Boolean(ctx.isSuperAdmin),
        isOrgAdmin: Boolean(ctx.isOrgAdmin),
    } as any, project.id));
}));

// ---- Media tab ---------------------------------------------------------------
// The project's Media Studio productions and the rooms they are made in. Reading the
// project is the gate; a production is still left out where its project cannot be read.
projectsRouter.get("/:key/media", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
    res.json({
        productions: await mediaStudio.projectProductions({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            isAdmin: Boolean(ctx.isOrgAdmin),
            isSuperAdmin: Boolean(ctx.isSuperAdmin),
            isOrgAdmin: Boolean(ctx.isOrgAdmin),
        } as any, project.id),
    });
}));

// Recent execution activity across the project's cycles, reached through the
// mission runs that link a cycle to the pipeline execution it started.
// cycle_run_events.run_id is a pipeline_executions.id; the note that used to
// sit here said otherwise, and listActivity was written to match the note
// rather than the writers.
projectsRouter.get("/:key/activity", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    const events = await projectService.listActivity(ctx, project.id, limit);
    res.json({ events });
}));

// ---- Resources -------------------------------------------------------------

projectsRouter.get("/:key/resources", requireAuth, asyncHandler(async (req: any, res: any) => {
    const resourceType = req.query.type ? assertResourceType(req.query.type) : undefined;
    const relation = req.query.relation === "referenced" ? "referenced" as const : undefined;
    const resources = await projectService.listResources(await ctxOf(req), req.params.key, {
        resourceType,
        relation,
    });
    res.json({ resources });
}));

projectsRouter.post("/:key/resources", requireAuth, asyncHandler(async (req: any, res: any) => {
    const parsed = insertProjectResourceSchema
        .omit({ projectId: true })
        .parse(req.body ?? {});
    const resource = await projectService.attachResource(
        await ctxOf(req),
        req.params.key,
        parsed.resourceType as ProjectResourceType,
        parsed.resourceId,
        parsed.relation ?? "primary",
    );
    res.status(201).json({ resource });
}));

projectsRouter.delete("/:key/resources/:type/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const removed = await projectService.detachResource(
        await ctxOf(req),
        req.params.key,
        assertResourceType(req.params.type),
        Number(req.params.id),
    );
    res.json({ removed });
}));

/**
 * Shape for an authored timeline event. Dates arrive as ISO strings over the
 * wire and are converted at the route boundary rather than in the service, so
 * the service keeps a Date-typed contract.
 */
const projectEventInputSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).nullish(),
    kind: z.enum(PROJECT_EVENT_KINDS).optional(),
    severity: z.enum(PROJECT_EVENT_SEVERITIES).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullish(),
    // Validated here rather than at render time, so a rule that would never fire
    // is rejected with a message instead of producing an event nobody sees.
    recurrence: z.string().refine(v => isValidRecurrence(v), "Not a valid cron schedule").nullish(),
    recurrenceTimezone: z.string().optional(),
    recurrenceUntil: z.string().datetime().nullish(),
});

// ---- Timeline events -------------------------------------------------------

/**
 * The authored half of a project's timeline: deadlines, launches, milestones —
 * the things the platform cannot observe for itself.
 *
 * Registered in the ontology as `project_events`, so anything added here is
 * immediately referenceable by an agent, and drawn on by crew primers so a cold
 * room in this project opens knowing what is coming up.
 */
projectsRouter.get("/:key/events", requireAuth, asyncHandler(async (req: any, res: any) => {
    const parseDate = (value: unknown): Date | undefined => {
        if (typeof value !== "string" || !value) return undefined;
        const parsed = new Date(value);
        // An unparseable filter must not silently widen the range to everything.
        if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`Invalid date: ${value}`);
        return parsed;
    };

    const events = await projectService.listEvents(await ctxOf(req), req.params.key, {
        from: parseDate(req.query.from),
        to: parseDate(req.query.to),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ events });
}));

projectsRouter.post("/:key/events", requireAuth, asyncHandler(async (req: any, res: any) => {
    const parsed = projectEventInputSchema.parse(req.body ?? {});
    const event = await projectService.createEvent(await ctxOf(req), req.params.key, {
        ...parsed,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        recurrenceUntil: parsed.recurrenceUntil ? new Date(parsed.recurrenceUntil) : null,
    });
    res.status(201).json({ event });
}));

projectsRouter.patch("/:key/events/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    // Dates are pulled out of the spread rather than overwritten after it: the
    // parsed values are ISO strings, and spreading them into a Date-typed patch
    // would type-check only because the later keys happen to win.
    const { startsAt, endsAt, recurrenceUntil, ...rest } =
        projectEventInputSchema.partial().parse(req.body ?? {});
    const event = await projectService.updateEvent(
        await ctxOf(req),
        req.params.key,
        Number(req.params.id),
        {
            ...rest,
            ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
            ...(endsAt !== undefined ? { endsAt: endsAt ? new Date(endsAt) : null } : {}),
            ...(recurrenceUntil !== undefined
                ? { recurrenceUntil: recurrenceUntil ? new Date(recurrenceUntil) : null }
                : {}),
        },
    );
    res.json({ event });
}));

projectsRouter.delete("/:key/events/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const removed = await projectService.deleteEvent(
        await ctxOf(req),
        req.params.key,
        Number(req.params.id),
    );
    res.json({ removed });
}));

// ---- Members ---------------------------------------------------------------

projectsRouter.get("/:key/members", requireAuth, asyncHandler(async (req: any, res: any) => {
    const ctx = await ctxOf(req);
    const project = await projectService.getProject(ctx, req.params.key);
    const [members, role] = await Promise.all([
        projectService.listMembers(ctx, project.id),
        // The client hides the management controls on this, so it ships with the list
        // rather than costing a second round trip.
        projectService.roleFor(ctx, project),
    ]);
    res.json({ members, role });
}));

// Who can still be granted a role: the org roster and the shared agent pool, minus
// existing members.
projectsRouter.get("/:key/member-candidates", requireAuth, asyncHandler(async (req: any, res: any) => {
    const candidates = await projectService.listMemberCandidates(await ctxOf(req), req.params.key);
    res.json(candidates);
}));

projectsRouter.post("/:key/members", requireAuth, asyncHandler(async (req: any, res: any) => {
    const parsed = insertProjectMemberSchema.omit({ projectId: true }).parse(req.body ?? {});
    const member = await projectService.addMember(await ctxOf(req), req.params.key, {
        principalType: parsed.principalType as "user" | "agent",
        principalId: parsed.principalId,
        role: parsed.role as any,
    });
    res.status(201).json({ member });
}));

projectsRouter.delete("/:key/members/:principalType/:principalId", requireAuth, asyncHandler(async (req: any, res: any) => {
    const removed = await projectService.removeMember(
        await ctxOf(req),
        req.params.key,
        req.params.principalType,
        req.params.principalId,
    );
    res.json({ removed });
}));

// ---- Finance roles (QuickBooks access) ------------------------------------

// The project's user members with their finance roles. `canManage` is true for
// a project owner, the one role that may change them.
projectsRouter.get("/:key/finance-roles", requireAuth, asyncHandler(async (req: any, res: any) => {
    res.json(await financeRolesService.listForProject(await ctxOf(req), req.params.key));
}));

// Replace one member's finance roles: { roles: ["ar", "executive"] }; [] removes all.
projectsRouter.put("/:key/finance-roles/:userId", requireAuth, asyncHandler(async (req: any, res: any) => {
    const roles = await financeRolesService.setRoles(await ctxOf(req), req.params.key, req.params.userId, req.body?.roles);
    res.json({ userId: req.params.userId, roles });
}));

export default projectsRouter;
