import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/core/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { BadRequestError, ForbiddenError } from "../../../utils/errors.js";
import { getUserOrgContext, requireOrgId } from "../../../utils/auth-context.js";
import { trycuaService, type TrycuaAction } from "../trycua/trycua-service.js";
import { trycuaComputerIntelligenceService } from "../trycua/computer-intelligence.service.js";
import { trycuaComputerUseTaskService } from "../trycua/computer-use-task.service.js";
import { assertViewerAccess, issueViewerTicket, proxyViewerAsset, resolveViewerHost, viewerPageUrl } from "../trycua/desktop-viewer.js";
import { issueStreamTicket } from "../trycua/trycua-stream.gateway.js";
import { learnedSkillsService } from "../trycua/learned-skills.service.js";
import { synthesizeReflexionRepair, recordReflexionBufferEntry, getReflexionCritiques, computeDomFailureSignature } from "../trycua/reflexion.js";
import { createLogger } from "../../../utils/logger.js";
import { db } from "@server/database_service.js";
import { trycuaSessionEvents } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import path from "node:path";

const router = Router();
const logger = createLogger("TrycuaRoutes");

router.get("/computer-use/skills", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const { listSkills } = await import("../trycua/computer-use-skills.js");
    res.json({ skills: listSkills() });
}));

router.get("/computer-use/skills/:skillId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { getSkill } = await import("../trycua/computer-use-skills.js");
    const skill = getSkill(req.params.skillId);
    if (!skill) throw new BadRequestError(`Unknown skill: ${req.params.skillId}`);
    res.json({ skill });
}));

router.get("/computer-use/tasks", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const tasks = await trycuaComputerUseTaskService.listTasks({
        organizationId,
        userId: orgContext.isAdmin ? undefined : orgContext.userId,
        limit: clampLimit(req.query.limit),
    });
    res.json({ tasks });
}));

router.post("/computer-use/tasks", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const sessionId = optionalString(req.body?.sessionId);
    const task = optionalString(req.body?.task);

    if (!sessionId) {
        throw new BadRequestError("sessionId is required");
    }
    if (!task) {
        throw new BadRequestError("task is required");
    }

    const session = await trycuaService.getSession(sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const created = await trycuaComputerUseTaskService.createTask({
        sessionId,
        organizationId,
        userId: orgContext.userId,
        task,
        goal: optionalString(req.body?.goal),
        instruction: optionalString(req.body?.instruction),
        action: optionalString(req.body?.action) as TrycuaAction | undefined,
        text: optionalString(req.body?.text),
        target: optionalTarget(req.body?.target),
        key: optionalString(req.body?.key),
        hotkey: optionalStringArray(req.body?.hotkey, "hotkey"),
        scroll: optionalScroll(req.body?.scroll),
        drag: optionalDrag(req.body?.drag),
        clipboardText: optionalString(req.body?.clipboardText),
        waitMs: optionalFiniteNumber(req.body?.waitMs, "waitMs"),
        maxSteps: optionalNumber(req.body?.maxSteps, "maxSteps"),
        requireConfirmation: optionalBoolean(req.body?.requireConfirmation, "requireConfirmation") ?? false,
        allowSensitive: optionalBoolean(req.body?.allowSensitive, "allowSensitive") ?? false,
        executeImmediately: optionalBoolean(req.body?.executeImmediately, "executeImmediately") ?? true,
        skillId: optionalString(req.body?.skillId),
        previousTaskId: optionalString(req.body?.previousTaskId),
        skillInputs: optionalStringRecord(req.body?.skillInputs, "skillInputs"),
    });

    res.status(201).json(created);
}));

router.get("/computer-use/tasks/:taskId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const task = await trycuaComputerUseTaskService.getTaskWithSteps(
        req.params.taskId,
        organizationId,
        orgContext.isAdmin ? undefined : orgContext.userId,
    );
    res.json(task);
}));

router.post("/computer-use/tasks/:taskId/run", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const result = await trycuaComputerUseTaskService.runAutonomousLoop(
        req.params.taskId,
        organizationId,
        orgContext.isAdmin ? undefined : orgContext.userId,
    );
    res.json(result);
}));

router.get("/computer-use/tasks/:taskId/replay", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const replay = await trycuaComputerUseTaskService.replay(
        req.params.taskId,
        organizationId,
        orgContext.isAdmin ? undefined : orgContext.userId,
    );
    res.json(replay);
}));

router.post("/computer-use/tasks/:taskId/confirm", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const allow = optionalBoolean(req.body?.allow, "allow");
    if (allow === undefined) {
        throw new BadRequestError("allow is required");
    }

    const task = await trycuaComputerUseTaskService.confirmTask({
        taskId: req.params.taskId,
        organizationId,
        userId: orgContext.isAdmin ? undefined : orgContext.userId,
        allow,
        text: optionalString(req.body?.text),
        clipboardText: optionalString(req.body?.clipboardText),
        includeVerificationObservation: optionalBoolean(req.body?.includeVerificationObservation, "includeVerificationObservation") ?? true,
    });

    res.json(task);
}));

router.post("/computer-use/tasks/:taskId/cancel", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const task = await trycuaComputerUseTaskService.cancelTask(
        req.params.taskId,
        organizationId,
        orgContext.isAdmin ? undefined : orgContext.userId,
    );
    res.json(task);
}));

router.post("/computer-use/tasks/:taskId/save-as-skill", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const { skill, skipped } = await learnedSkillsService.createSkillFromTask({
        organizationId,
        userId: orgContext.userId,
        taskId: req.params.taskId,
        name: optionalString(req.body?.name),
        goal: optionalString(req.body?.goal),
    });
    // `skipped` names the actions that could not become steps, so the dock can
    // say the draft is shorter than the run instead of implying it is the run.
    res.json({ skill, skipped });
}));

router.get("/sessions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const sessions = await trycuaService.listSessions(
        organizationId,
        orgContext.isAdmin ? undefined : orgContext.userId,
    );
    res.json({ sessions });
}));

router.post("/sessions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.createSession({
        organizationId,
        userId: orgContext.userId,
        requestedOs: optionalString(req.body?.os),
        sandboxName: optionalString(req.body?.sandboxName),
        missionRunId: optionalNumber(req.body?.missionRunId, "missionRunId"),
        jobId: optionalNumber(req.body?.jobId, "jobId"),
    });
    res.status(201).json({ session });
}));

router.get("/sessions/:sessionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);
    res.json({ session });
}));

/** One-use ticket for the /api/trycua/stream socket (screenshot stream of this session). */
router.post("/sessions/:sessionId/stream-ticket", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);
    const ticket = issueStreamTicket({ sessionId: session.id, organizationId, userId: String(orgContext.userId) });
    res.set("Cache-Control", "no-store");
    res.json({ ticket });
}));

router.post("/sessions/:sessionId/actions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const action = optionalString(req.body?.action) as TrycuaAction | undefined;
    if (!action) {
        throw new BadRequestError("action is required");
    }

    const result = await trycuaService.executeAction(req.params.sessionId, organizationId, orgContext.userId, {
        action,
        params: isRecord(req.body?.params) ? req.body.params : {},
    });

    void trycuaComputerUseTaskService.recordDirectAction({
        sessionId: req.params.sessionId,
        organizationId,
        userId: orgContext.userId,
        action,
        payload: isRecord(req.body?.params) ? req.body.params : {},
        result,
    }).catch((err) => logger.warn("Failed to record direct action step", { error: err?.message }));

    res.json({ result });
}));

router.get("/sessions/:sessionId/screenshot", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const screenshot = await trycuaService.getScreenshot(req.params.sessionId, organizationId, orgContext.userId);
    res.json({ screenshot });
}));

router.get("/sessions/:sessionId/accessibility", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const accessibility = await trycuaService.getAccessibilityTree(req.params.sessionId, organizationId, orgContext.userId);
    res.json({ accessibility });
}));

router.post("/sessions/:sessionId/diff", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);
    const before = optionalString(req.body?.before);
    const after = optionalString(req.body?.after);
    if (!before || !after) throw new BadRequestError("before and after screenshot data URLs are required");
    const diff = await trycuaComputerIntelligenceService.compareScreenshots(before, after, organizationId);
    res.json({ diff });
}));

router.get("/sessions/:sessionId/observe", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const observation = await trycuaComputerIntelligenceService.observeSession({
        sessionId: req.params.sessionId,
        organizationId,
        userId: orgContext.userId,
        includeScreenshot: optionalBoolean(req.query.includeScreenshot, "includeScreenshot") ?? true,
    });

    res.json({ observation });
}));

router.post("/sessions/:sessionId/guided-actions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const guidedResult = await trycuaComputerIntelligenceService.executeGuidedAction({
        sessionId: req.params.sessionId,
        organizationId,
        userId: orgContext.userId,
        goal: optionalString(req.body?.goal),
        instruction: optionalString(req.body?.instruction),
        action: optionalString(req.body?.action) as TrycuaAction | undefined,
        text: optionalString(req.body?.text),
        key: optionalString(req.body?.key),
        hotkey: optionalStringArray(req.body?.hotkey, "hotkey"),
        target: optionalTarget(req.body?.target),
        scroll: optionalScroll(req.body?.scroll),
        drag: optionalDrag(req.body?.drag),
        clipboardText: optionalString(req.body?.clipboardText),
        waitMs: optionalFiniteNumber(req.body?.waitMs, "waitMs"),
        allowSensitive: optionalBoolean(req.body?.allowSensitive, "allowSensitive") ?? false,
        execute: optionalBoolean(req.body?.execute, "execute") ?? true,
        includeVerificationObservation: optionalBoolean(req.body?.includeVerificationObservation, "includeVerificationObservation") ?? true,
    });

    res.json(guidedResult);
}));

router.get("/sessions/:sessionId/events", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const limit = clampLimit(req.query.limit);
    const events = await db
        .select()
        .from(trycuaSessionEvents)
        .where(and(
            eq(trycuaSessionEvents.sessionId, req.params.sessionId),
            eq(trycuaSessionEvents.organizationId, organizationId),
        ))
        .orderBy(desc(trycuaSessionEvents.createdAt))
        .limit(limit);

    res.json({ events });
}));

router.delete("/sessions/:sessionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const session = await trycuaService.getSession(req.params.sessionId, organizationId);
    assertSessionAccess(session, orgContext);

    const terminated = await trycuaService.endSession(req.params.sessionId, organizationId, orgContext.userId);
    res.json({ terminated });
}));

function assertSessionAccess(
    session: { userId: string },
    orgContext: { userId: string; isAdmin: boolean },
) {
    if (!orgContext.isAdmin && session.userId !== orgContext.userId) {
        throw new ForbiddenError("You do not have access to this Trycua session");
    }
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
        throw new BadRequestError("Expected string input");
    }
    return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new BadRequestError(`${field} must be a positive integer`);
    }
    return parsed;
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new BadRequestError(`${field} must be a finite number`);
    }
    return parsed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value.toLowerCase() === "true") return true;
        if (value.toLowerCase() === "false") return false;
    }
    throw new BadRequestError(`${field} must be a boolean`);
}

function optionalTarget(value: unknown) {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) {
        throw new BadRequestError("target must be an object");
    }
    return {
        x: optionalFiniteNumber(value.x, "target.x"),
        y: optionalFiniteNumber(value.y, "target.y"),
        label: optionalString(value.label),
        role: optionalString(value.role),
    };
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const values = typeof value === "string"
        ? value.split("+").map((item) => item.trim()).filter(Boolean)
        : value;
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string" || item.length < 1 || item.length > 64)) {
        throw new BadRequestError(`${field} must be an array of non-empty strings under 64 characters`);
    }
    return values;
}

function optionalScroll(value: unknown) {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) {
        throw new BadRequestError("scroll must be an object");
    }
    return {
        x: optionalFiniteNumber(value.x, "scroll.x"),
        y: optionalFiniteNumber(value.y, "scroll.y"),
        clicks: optionalFiniteNumber(value.clicks, "scroll.clicks"),
    };
}

function optionalDrag(value: unknown) {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) {
        throw new BadRequestError("drag must be an object");
    }
    return {
        startX: optionalFiniteNumber(value.startX, "drag.startX"),
        startY: optionalFiniteNumber(value.startY, "drag.startY"),
        endX: optionalFiniteNumber(value.endX, "drag.endX"),
        endY: optionalFiniteNumber(value.endY, "drag.endY"),
        durationMs: optionalFiniteNumber(value.durationMs, "drag.durationMs"),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return 100;
    return Math.min(parsed, 500);
}

/**
 * Live, interactive view of the org's desktop (noVNC), e.g. to log in to a site by hand or
 * to take over when a task pauses on yield_to_user. Opens in its own tab. The WebSocket
 * half is handled by handleViewerUpgrade in the server's upgrade hook.
 */
router.get("/desktop/viewer", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    // The org comes from ?orgId= (the "Open desktop" buttons pass the app's selected org)
    // or the session; assertViewerAccess then checks the user actually belongs to it.
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    await assertViewerAccess(orgContext, organizationId);
    await trycuaService.assertEnabled(organizationId);

    const viewerHost = await resolveViewerHost(organizationId); // may start the desktop (up to ~90s)
    const ticket = issueViewerTicket({ organizationId, userId: String(orgContext.userId), viewerHost });
    logger.info("Desktop viewer opened", { organizationId, userId: orgContext.userId });
    res.set("Cache-Control", "no-store");
    res.redirect(302, viewerPageUrl(organizationId, ticket, { viewOnly: req.query.viewOnly === "1" || req.query.viewOnly === "true" }));
}));

/**
 * The viewer page URL, for embedding the desktop in Oddjob's own UI.
 *
 * Same gate as /desktop/viewer, but it answers with the URL instead of redirecting
 * to it: a redirect cannot be followed inside an iframe here, and the studio's frame
 * failed to load while the same URL worked when opened directly. The caller sets the
 * frame's src to this url. Each call spends a ticket, so ask once per connection.
 */
router.get("/desktop/viewer-url", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    await assertViewerAccess(orgContext, organizationId);
    await trycuaService.assertEnabled(organizationId);

    const viewerHost = await resolveViewerHost(organizationId); // may start the desktop (up to ~90s)
    const ticket = issueViewerTicket({ organizationId, userId: String(orgContext.userId), viewerHost });
    logger.info("Desktop viewer embedded", { organizationId, userId: orgContext.userId });
    res.set("Cache-Control", "no-store");
    res.json({ url: viewerPageUrl(organizationId, ticket, { viewOnly: req.query.viewOnly === "1" || req.query.viewOnly === "true" }) });
}));

router.get(/^\/desktop\/viewer\/o\/(\d+)\/(.+)$/, requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const params = req.params as Record<string, string>;
    const organizationId = Number(params[0]);
    const orgContext = await getUserOrgContext(req);
    await assertViewerAccess(orgContext, organizationId);
    await proxyViewerAsset(req, res, organizationId, String(params[1]));
}));

// ---------------------------------------------------------------------------
// Learned skills: record a person's actions in the desktop browser, review the draft
// skill, approve it, and it is replayed for matching tasks. See learned-skills.service.ts.
// ---------------------------------------------------------------------------

/** Org + membership + computer use enabled; the same gate as the viewer. */
async function skillsContext(req: Request) {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    await assertViewerAccess(orgContext, organizationId);
    await trycuaService.assertEnabled(organizationId);
    return { ...orgContext, organizationId, userId: String(orgContext.userId) };
}

router.post("/desktop/recordings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const recording = await learnedSkillsService.startRecording({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        taskId: optionalString(req.body?.taskId),
        trigger: "manual",
    });
    res.status(201).json({ recording });
}));

router.get("/desktop/recordings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const recordings = await learnedSkillsService.listRecordings(ctx.organizationId, clampLimit(req.query.limit));
    res.json({ recordings, activeRecordingId: learnedSkillsService.isRecording(ctx.organizationId) ?? null });
}));

router.get("/desktop/recordings/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    res.json({ recording: await learnedSkillsService.getRecording(ctx.organizationId, req.params.id) });
}));

router.post("/desktop/recordings/:id/stop", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const recording = await learnedSkillsService.stopRecording(ctx.organizationId, req.params.id);
    res.json({ recording });
}));

router.delete("/desktop/recordings/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    await learnedSkillsService.discardRecording(ctx.organizationId, req.params.id);
    res.status(204).end();
}));

router.post("/desktop/recordings/:id/skill", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const skill = await learnedSkillsService.createSkillFromRecording({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        recordingId: req.params.id,
        goal: optionalString(req.body?.goal),
        name: optionalString(req.body?.name),
    });
    res.status(201).json({ skill });
}));

router.get("/skills", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const status = optionalString(req.query.status);
    if (status && !["draft", "active", "archived"].includes(status)) throw new BadRequestError("status must be draft, active or archived");
    res.json({ skills: await learnedSkillsService.listSkills(ctx.organizationId, status) });
}));

router.get("/skills/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    res.json({ skill: await learnedSkillsService.getSkill(ctx.organizationId, req.params.id) });
}));

router.patch("/skills/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const body = req.body ?? {};
    if (body.inputs !== undefined && !Array.isArray(body.inputs)) throw new BadRequestError("inputs must be an array");
    if (body.steps !== undefined && !Array.isArray(body.steps)) throw new BadRequestError("steps must be an array");
    const riskClass = optionalString(body.riskClass);
    if (riskClass && !["low", "medium", "high", "critical"].includes(riskClass)) throw new BadRequestError("riskClass must be low, medium, high or critical");
    const skill = await learnedSkillsService.updateSkill(ctx.organizationId, req.params.id, {
        name: optionalString(body.name),
        description: optionalString(body.description),
        site: optionalString(body.site),
        goalExample: optionalString(body.goalExample),
        procedure: optionalString(body.procedure),
        riskClass,
        inputs: body.inputs,
        steps: body.steps,
    });
    res.json({ skill });
}));

router.post("/skills/:id/approve", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    res.json({ skill: await learnedSkillsService.approveSkill(ctx, req.params.id) });
}));

router.post("/skills/:id/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError("Only an organization admin can test an unapproved skill");
    const skill = await learnedSkillsService.getSkill(ctx.organizationId, req.params.id);
    if (skill.status === "archived") throw new BadRequestError("Archived skills cannot be tested");
    if (learnedSkillsService.isRecording(ctx.organizationId)) throw new BadRequestError("Stop recording before testing");
    const sessionId = optionalString(req.body?.sessionId);
    if (!sessionId) throw new BadRequestError("sessionId is required");
    const created = await trycuaComputerUseTaskService.createTask({
        sessionId, organizationId: ctx.organizationId, userId: ctx.userId,
        task: `Test learned skill: ${skill.name}`, skillId: skill.id,
        skillInputs: optionalStringRecord(req.body?.skillInputs, "skillInputs"), skillTest: true,
        requireConfirmation: false, allowSensitive: ["high", "critical"].includes(skill.riskClass), executeImmediately: false,
    });
    res.status(201).json(created);
}));

router.post("/skills/:id/repair", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const recordingId = optionalString(req.body?.recordingId);
    if (!recordingId) throw new BadRequestError("recordingId is required");
    res.json({ skill: await learnedSkillsService.repairFromRecording(ctx.organizationId, req.params.id, recordingId, req.body?.stepIndex) });
}));

router.post("/skills/:id/reflexion", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const skill = await learnedSkillsService.getSkill(ctx.organizationId, req.params.id);
    const body = req.body ?? {};
    const stepIndex = Number(body.stepIndex ?? 0);
    const target = body.target;
    if (!target || typeof target !== "object") {
        throw new BadRequestError("target is required and must be a TargetDescriptor object");
    }
    const error = optionalString(body.error);
    const currentDomSnippet = optionalString(body.currentDomSnippet);
    const url = optionalString(body.url);

    const evaluation = synthesizeReflexionRepair({
        stepIndex,
        target,
        error,
        currentDomSnippet,
        url,
    });

    const domSignature = computeDomFailureSignature(target);
    await recordReflexionBufferEntry({
        organizationId: ctx.organizationId,
        skillId: skill.id,
        stepIndex,
        site: skill.site || "unknown",
        failureCategory: evaluation.category,
        domFailureSignature: domSignature,
        verbalCritique: evaluation.critique,
        proposedRemediation: evaluation.remediation ?? {},
        succeededOnNextTrial: evaluation.action === "execute_remediation_prestep" ? true : undefined,
    });

    res.json(evaluation);
}));

router.get("/skills/:id/reflexion", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const skill = await learnedSkillsService.getSkill(ctx.organizationId, req.params.id);
    const critiques = await getReflexionCritiques({
        organizationId: ctx.organizationId,
        skillId: skill.id,
        site: skill.site ?? undefined,
        limit: clampLimit(req.query.limit),
    });
    res.json({ critiques });
}));

router.get("/skill-artifacts/:filename", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    const filename = req.params.filename;
    if (!/^[0-9a-f-]{36}-[a-zA-Z0-9._-]+$/.test(filename)) throw new BadRequestError("Invalid artifact name");
    res.download(path.resolve("storage", "learned-skill-artifacts", String(ctx.organizationId), filename));
}));

router.post("/skills/:id/archive", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ctx = await skillsContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError("Only an organization admin can archive a computer-use skill");
    res.json({ skill: await learnedSkillsService.archiveSkill(ctx.organizationId, req.params.id) });
}));

function optionalStringRecord(value: unknown, field: string): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestError(`${field} must be an object of strings`);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v !== "string" && typeof v !== "number") throw new BadRequestError(`${field}.${k} must be a string`);
        out[k] = String(v);
    }
    return out;
}

export default router;
