import { workspaceContextMessage } from '@shared/crew-workspace-results.js';
import { financialSnapshotsService } from '../core/financial-snapshots.service.js';
import { resolveWorkspaceSelection } from '../core/crew-workspace-results.js';
import { resolveMountedAppContext } from '../core/crew-mounted-app-context.service.js';
import { resolveAppForRecords } from '@domain/apps/core/app-records-reader.service.js';
import { approvalService } from '@domain/integrations/core/approval.service.js';
import { isBoundSurfaceApproval } from '../core/crew-surface-approval.js';
import { saveGmailDirective } from '@domain/integrations/core/gmail-directives.service.js';
import { prepareGmailNotification } from '../core/gmail-notification-handoff.service.js';
import { getCrewReadiness } from '../core/crew-readiness.service.js';
import { developmentBindingOptions, saveDevelopmentBinding } from '../core/crew-development-binding.service.js';
import { exportCalendarOperationSkill } from '../core/crew-operation-skill.service.js';
import { getOperationSkillReview, validateOperationSkillReview, submitOperationSkillReview, approveOperationSkillReview } from '../core/crew-operation-skill-review.service.js';
import { canManageOrganization } from '@server/utils/auth-context.js';
import { normalizeCrewStudio } from '../core/crew-studio-tools.js';
/**
 * CREW Group Chat REST API
 *
 * POST /api/crew/message              — run a round of discussion
 * GET  /api/crew/:sessionKey          — full room state (members, transcript, notes, plans)
 * PUT  /api/crew/:sessionKey/members  — set which agent cards are in the room
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import multer from "multer";
import { ValidationError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { withProjectScope } from "@server/middleware/project-scope.js";
import { crewOrchestratorService } from "../core/crew-orchestrator.service.js";
import { crewRepository } from "../core/crew-repository.js";
import { crewRoomBriefSchema } from '@shared/crew-room-brief.js';
import { crewWorkProductSchema } from '@shared/crew-work-product.js';
import { scribeConversationIntent } from "@shared/scribe-conversation.js";
import { scribeService } from "@domain/scribe/core/scribe.service.js";
import { concludeSession, ensureSession, getRoomDelta, reopenSession } from "../core/crew-session.service.js";
import { crewBeaconService, parseBeacon } from '../core/crew-beacon.service.js';
import { crewParticipantsService, displayNameFor } from "../core/crew-participants.service.js";
import { crewStreamService } from "../core/crew-stream.service.js";
import { crewPrimersService } from "../core/crew-primers.service.js";
import { crewMeetingSchedulerService } from "../core/crew-meeting-scheduler.service.js";
import { CrewCycleBridgeService } from "../core/crew-cycle-bridge.service.js";
import {
    crewRoomModes, crewDecisionStatuses, crewClaimStatuses, crewCommitmentStatuses,
} from "@shared/schema/index.js";
import { projectService } from "@server/domain/projects/core/project.service.js";
import {
    CREW_OUTPUT_INTENTS,
    extractOutputIntentFromMessage,
    isValidOutputIntent,
    type CrewOutputIntent,
} from "@shared/crew-output-intent.js";

const logger = createLogger("CrewRoutes");
const router = Router();

/**
 * Held in memory only long enough to hash, parse and write — the service is
 * what persists. 25 MB is well above a slide deck and well below anything that
 * would put a room's upload in swap.
 */
const attachmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 5 },
});

router.use(requireAuth);
router.get('/:sessionKey/development-binding', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    res.json(await developmentBindingOptions(room));
}));
router.put('/:sessionKey/development-binding', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);
    if (!userId || (room.createdBy !== userId && !await canManageOrganization(userId, orgId))) throw new ForbiddenError('Only the room host or an organization manager can configure development context.');
    res.json(await saveDevelopmentBinding(room, req.body, userId));
}));
router.get('/:sessionKey/operation-skill-drafts/:hash/review', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    res.json(await getOperationSkillReview(await authorizeRoom(req, orgId, req.params.sessionKey), req.params.hash));
}));
router.post('/:sessionKey/operation-skill-drafts/:hash/:action', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);
    if (!userId) throw new ForbiddenError('Sign in to review this skill.');
    const action = req.params.action;
    if (action === 'validate') return void res.json(await validateOperationSkillReview(room, req.params.hash, req.body, userId));
    if (!['submit', 'approve'].includes(action)) throw new ValidationError('Invalid review action.', { field: 'action' });
    if (!await canManageOrganization(userId, orgId)) throw new ForbiddenError('Organization management permission is required to register or approve skills.');
    res.json(action === 'submit' ? await submitOperationSkillReview(room, req.params.hash, req.body, userId) : await approveOperationSkillReview(room, req.params.hash, userId));
}));
router.post('/:sessionKey/operation-skill-drafts', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const proposalId = req.body?.proposalId;
    if (!Number.isInteger(proposalId) || proposalId < 1) throw new ValidationError('Select a valid calendar operation.', { field: 'proposalId' });
    res.json(await exportCalendarOperationSkill(room, proposalId));
}));
router.get('/:sessionKey/readiness', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const studio = req.query.studio;
    if (studio !== undefined && (typeof studio !== 'string' || (studio !== 'none' && !normalizeCrewStudio(studio)))) {
        throw new ValidationError('Select a valid studio.', { field: 'studio' });
    }
    res.json(await getCrewReadiness(room, studio === 'none' ? null : studio as string | undefined, currentUserId(req)));
}));
router.get('/:sessionKey/financial-snapshots/:id',asyncHandler(async(req:Request,res:Response)=>{
 const orgId=requireOrgId(await getUserOrgContext(req));await authorizeRoom(req,orgId,req.params.sessionKey);
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw new ValidationError('Invalid snapshot ID',{field:'id'});
 res.json(await financialSnapshotsService.review(req.params.id,{organizationId:orgId,userId:currentUserId(req),sessionKey:req.params.sessionKey}));
}));
router.post('/:sessionKey/financial-snapshots/:id/save',asyncHandler(async(req:Request,res:Response)=>{
 const orgId=requireOrgId(await getUserOrgContext(req));await authorizeRoom(req,orgId,req.params.sessionKey);
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw new ValidationError('Invalid snapshot ID',{field:'id'});
 res.json(await financialSnapshotsService.confirm(req.params.id,{organizationId:orgId,userId:currentUserId(req),sessionKey:req.params.sessionKey}));
}));
router.put('/:sessionKey/active-agents', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);
    const ids = parseAgentCardIds(req.body?.agentCardIds);
    if (!userId || ids === undefined) throw new ValidationError('Agent selection is required.', { field: 'agentCardIds' });
    res.json({ agentCardIds: await crewRepository.saveActiveAgentSelection(orgId, room.id, userId, ids) });
}));
/** A one-time location beacon: posted to the room as a map, with a push to everyone in the room's project. */
router.post('/:sessionKey/beacon', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);
    if (!userId) throw new ValidationError('Sign in to share your location.', { field: 'userId' });
    if (room.status === 'archived') throw new ValidationError('Reopen the room before sharing your location', { field: 'status' });
    const beacon = parseBeacon(req.body);
    const result = await crewBeaconService.raise({ orgId, room, userId, displayName: await resolveDisplayName(userId), beacon });
    res.status(201).json(result);
}));
router.post('/:sessionKey/notification-context', asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);
    const eventId = req.body?.eventId;
    if (!userId || !Number.isInteger(eventId) || eventId < 1) throw new ValidationError('Select a valid email notification.', { field: 'eventId' });
    const result = await prepareGmailNotification({ orgId, userId, eventId, room });
    await crewStreamService.publish({ type: 'turn', organizationId: orgId, sessionKey: req.params.sessionKey, actor: userId, payload: { turn: result.turn } });
    res.json(result);
}));

/** The authenticated user id, when the session carries one. */
function currentUserId(req: Request): string | undefined {
    const id = (req.session as any)?.userId;
    return id ? String(id) : undefined;
}

/**
 * Resolves the speaker label for a turn from the SERVER-side session rather than
 * a client-supplied name — with several humans in a room, a spoofable display
 * name would misattribute the transcript.
 */
async function resolveDisplayName(userId: string | undefined): Promise<string> {
    if (!userId) return "Guest";
    return crewRepository.resolveUserDisplayName(userId);
}

/**
 * Resolves a room and applies its Project Space read gate.
 *
 * Does NOT create by default. It used to call ensureSession — find-or-CREATE — from
 * every route including the reads, so any GET could mint a room in whatever org the
 * request happened to resolve to. That is how a bare SSE stream, falling back to the
 * user's default org, created a room the rest of the page could not see. Creation is
 * now something a route asks for explicitly, and only POST /message does.
 */
async function authorizeRoom(
    req: Request,
    orgId: number,
    sessionKey: string,
    options: { create?: boolean; studio?: string } = {},
) {
    const session = options.create
        ? await ensureSession(orgId, sessionKey, currentUserId(req), options.studio)
        : await crewRepository.findSession(orgId, sessionKey);

    if (!session) {
        const missing: any = new Error(`Room not found: "${sessionKey}".`);
        missing.statusCode = 404;
        missing.code = "ROOM_NOT_FOUND";
        throw missing;
    }
    if (session.projectId !== null) {
        const orgContext = await getUserOrgContext(req);
        await projectService.getProject({
            organizationId: orgId,
            userId: orgContext.userId,
            isSuperAdmin: orgContext.isSuperAdmin,
            isOrgAdmin: orgContext.isOrgAdmin,
        }, session.projectId);
    }
    return session;
}

/** Parses and validates an agent card id list from a request body field. */
function parseAgentCardIds(value: unknown): number[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
        throw new ValidationError("agentCardIds must be an array", {
            field: "agentCardIds",
        });
    }
    const ids = value.map((v) => Number(v));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
        throw new ValidationError(
            "agentCardIds must contain positive integers", { field: "agentCardIds" },
        );
    }
    return ids;
}

/** The governed approval card a mounted app surface asked for — only when it is bound to this room and app. */
router.get('/:sessionKey/surface-approval/:approvalId', withProjectScope(), asyncHandler(async (req: any, res: Response) => {
    const ctx = await getUserOrgContext(req);
    const orgId = requireOrgId(ctx);
    const room = await authorizeRoom(req, orgId, req.params.sessionKey);
    const id = Number(req.params.approvalId);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof req.query.app !== 'string') throw new ValidationError('Invalid app approval request');
    const app = await resolveAppForRecords({ organizationId: orgId, userId: String(req.user.id), roomProjectId: room.projectId ?? null,
        isOrgAdmin: ctx.isOrgAdmin, isSuperAdmin: ctx.isSuperAdmin }, req.query.app);
    const detail = await approvalService.getById(id, req.user.id, req.user.email, orgId, req.user.adminRole);
    const args = detail.toolArgs as any;
    if (!isBoundSurfaceApproval(args, app.id, req.params.sessionKey)) throw new NotFoundError('No governed approval bound to this room and app');
    res.json({ ...args, type: 'approval_request', proposalId: id, status: detail.status, organizationId: orgId });
}));

/**
 * POST /api/crew/message
 * Body: { message, sessionId, agentCardIds? }
 *
 * Returns 503 when no model provider can be resolved, matching the intent
 * router's contract for the same failure.
 */
router.post("/message", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const { message: rawMessage, sessionId, agentCardIds, computerUseStudioActive, studio, activeStudio, outputIntent: rawOutputIntent } = req.body ?? {};
    const userId = currentUserId(req);

    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
        throw new ValidationError(
            "Message content is required and cannot be empty", { field: "message" },
        );
    }
    let outputIntent: CrewOutputIntent | undefined = undefined;
    if (rawOutputIntent !== undefined && rawOutputIntent !== null) {
        if (!isValidOutputIntent(rawOutputIntent)) {
            throw new ValidationError(`outputIntent must be one of: ${CREW_OUTPUT_INTENTS.join(", ")}`, { field: "outputIntent" });
        }
        outputIntent = rawOutputIntent;
    }
    let message = rawMessage;
    if (!outputIntent || outputIntent === "auto") {
        const extracted = extractOutputIntentFromMessage(rawMessage);
        if (extracted.outputIntent) {
            outputIntent = extracted.outputIntent;
            if (extracted.cleanMessage) {
                message = extracted.cleanMessage;
            }
        }
    }
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new ValidationError("Session ID is required", {
            field: "sessionId",
        });
    }
    if (computerUseStudioActive !== undefined && typeof computerUseStudioActive !== "boolean") {
        throw new ValidationError("computerUseStudioActive must be a boolean", {
            field: "computerUseStudioActive",
        });
    }
    if (activeStudio !== undefined && activeStudio !== null && typeof activeStudio !== "string") {
        throw new ValidationError("activeStudio must be a string or null", { field: "activeStudio" });
    }
    if (studio !== undefined && typeof studio !== "string") {
        throw new ValidationError("studio must be a string", { field: "studio" });
    }

    try {
        // POST /message is where a room legitimately comes into existence.
        const room = await authorizeRoom(req, orgId, sessionId, { create: true, studio });
        if (/^\/directives?\b/i.test(rawMessage.trim())) {
            const directive = await saveGmailDirective({ orgId, userId: String(userId), projectId: room.projectId ?? req.projectId ?? null, sessionKey: sessionId, message: rawMessage });
            if (directive) {
                await crewRepository.postTurn(orgId, room.id, { speakerType: 'user', speakerName: await resolveDisplayName(userId), userId, content: rawMessage });
                const turn = await crewRepository.postTurn(orgId, room.id, { speakerType: 'supervisor', speakerName: 'Room', content: directive.message, artifacts: [{ tool: 'gmail_directive', payload: directive }] });
                await crewStreamService.publish({ type: 'turn', organizationId: orgId, sessionKey: sessionId, actor: userId, payload: { turn } });
                return res.json({ turns: turn ? [turn] : [], directive });
            }
        }
        const selectedContext = req.body?.selectedContext;
        let mountedAppContext = "";
        if (req.body?.mountedApp !== undefined) {
            mountedAppContext = await resolveMountedAppContext(req.body.mountedApp, {
                organizationId: orgId, userId: String(userId), roomProjectId: room.projectId ?? null,
                isOrgAdmin: orgContext.isOrgAdmin, isSuperAdmin: orgContext.isSuperAdmin,
            });
        }
        if (selectedContext !== undefined) {
            const items = await resolveWorkspaceSelection(selectedContext, id => crewRepository.findRoomTurn(orgId, room.id, id));
            if (items.length) message = workspaceContextMessage(message, items);
        }
        if (scribeConversationIntent(rawMessage) === "pause" && await scribeService.getSessionDocument(room.id, orgId)) {
            await crewRepository.setAuthoringPaused(orgId, room.id, true);
            await crewRepository.recordAuthoringPause(orgId, room.id, message, userId);
            await crewStreamService.publish({ type: "turn", organizationId: orgId, sessionKey: sessionId, actor: userId, payload: { authoringPaused: true } });
            return res.json({ paused: true });
        }
        // Any other message is the author coming back, whether or not it says
        // "continue". Holding the room until they found a resume phrase recorded
        // ordinary instructions ("ok, I'm done editing") and answered none of them.
        if (room.cycleContext?.authoringPaused) {
            await crewRepository.setAuthoringPaused(orgId, room.id, false);
        }
        const effectiveProjectId = room.projectId ?? req.projectId ?? null;
        const result = await crewOrchestratorService.runRound({
            orgId,
            sessionKey: sessionId,
            message,
            userId,
            userDisplayName: await resolveDisplayName(userId),
            mountedAppContext,
            agentCardIds: parseAgentCardIds(agentCardIds),
            computerUseStudioActive: computerUseStudioActive === true,
            activeStudio,
            outputIntent,
            // Resolved by withProjectScope, which applies the Project Space read
            // gate — a project the caller cannot see never reaches here.
            projectId: effectiveProjectId,
            projectKey: effectiveProjectId === req.projectId ? req.projectKey ?? null : null,
        });

        res.json(result);
    } catch (error: any) {
        if (error?.message?.startsWith("Cooldown:")) {
            res.setHeader("Retry-After", "2");
            return res.status(429).json({
                success: false,
                error: {
                    code: "RATE_LIMITED",
                    message: "Please wait before sending another message.",
                    statusCode: 429,
                },
                retryAfter: 2,
                timestamp: new Date().toISOString(),
            });
        }
        if (error?.message?.includes("No available model provider")) {
            logger.error("All model providers unavailable during crew round", error);
            return res.status(503).json({
                success: false,
                error: {
                    code: "SERVICE_UNAVAILABLE",
                    message: "No model provider is currently available. Please retry later.",
                    statusCode: 503,
                },
                timestamp: new Date().toISOString(),
            });
        }
        if (error?.message?.startsWith("Budget exceeded:")) {
            return res.status(402).json({
                success: false,
                error: {
                    code: "BUDGET_EXCEEDED",
                    message: error.message.replace(/^Budget exceeded: /, ""),
                    statusCode: 402,
                },
                timestamp: new Date().toISOString(),
            });
        }
        if (error?.message?.includes("No agents in this crew")) {
            return res.status(400).json({
                success: false,
                error: { code: "NO_CREW_MEMBERS", message: error.message, statusCode: 400 },
                timestamp: new Date().toISOString(),
            });
        }
        throw error;
    }
}));

/**
 * GET /api/crew/rooms
 * Rooms the caller participates in — how someone finds a room they were invited
 * to. Declared BEFORE /:sessionKey, which would otherwise capture "rooms".
 */
router.get("/rooms", withProjectScope({ useDefault: false }), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const userId = currentUserId(req);

    // Naming a project lists every room in that Project Space; withProjectScope
    // has already applied the read gate, so an unreadable project never
    // resolves. Without one, this is "rooms I am in".
    const askedForProject = Boolean(req.query.projectKey || req.query.projectId);
    if (askedForProject && req.projectId) {
        const rooms = await crewParticipantsService.listRoomsForProject(orgId, req.projectId);
        return res.json({ rooms, scope: "project", projectKey: req.projectKey ?? null });
    }

    if (!userId) return res.json({ rooms: [], scope: "mine" });

    // ?scope=all: my rooms in every organization I belong to, each carrying its
    // org, so a client can list them together and pin each room's org on open.
    if (req.query.scope === "all") {
        const rooms = await crewParticipantsService.listRoomsForUserAcrossOrgs(userId, orgId);
        return res.json({ rooms, scope: "all" });
    }

    const rooms = await crewParticipantsService.listRoomsForUser(orgId, userId);
    res.json({ rooms, scope: "mine" });
}));

import { GoodQuestionEngine, type DiverseTopicArchetype } from "@domain/ai/core/good-question-engine.js";

/**
 * GET /api/crew/primers
 * Opening moves for a cold room, curated from the Project Space's own activity,
 * alongside structured DIVERSE Goal Topic Archetypes.
 * Optional `sessionId` filters out anything the room has already covered.
 * Declared before /:sessionKey, which would otherwise capture "primers".
 */
router.get("/primers", withProjectScope({ useDefault: false }), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const cycleInfo = sessionId ? await crewPrimersService.resolveCycleContext(orgId, sessionId) : null;

    const [primers, topicArchetypes] = await Promise.all([
        crewPrimersService.build({
            orgId,
            projectId: req.projectId ?? null,
            sessionKey: sessionId,
        }),
        Promise.resolve(
            crewPrimersService.getTopicArchetypes(
                cycleInfo
                    ? {
                          cycleName: cycleInfo.cycleName,
                          stageName: cycleInfo.stageName,
                      }
                    : undefined,
            ),
        ),
    ]);

    res.json({
        primers,
        topicArchetypes,
        cycleContext: cycleInfo
            ? {
                  cycleSlug: cycleInfo.cycleSlug,
                  cycleName: cycleInfo.cycleName,
                  stageId: cycleInfo.cycleStageId,
                  stageName: cycleInfo.stageName,
              }
            : null,
        projectKey: req.projectKey ?? null,
    });
}));

/**
 * GET /api/crew/diverse-intake/:topicId
 * Generates an interactive GQE FormAgent intake payload for a selected Topic Archetype.
 */
router.get("/diverse-intake/:topicId", asyncHandler(async (req: Request, res: Response) => {
    const topicId = (req.params.topicId || "build_app") as DiverseTopicArchetype;
    const intakeCard = GoodQuestionEngine.synthesizeDIVERSEIntakeCard(topicId);
    res.json(intakeCard);
}));

/**
 * POST /api/crew/diverse-prompt
 * Formats a DIVERSE FormAgent submission into a compiled mission brief for agent execution.
 */
router.post("/diverse-prompt", asyncHandler(async (req: Request, res: Response) => {
    const { topicId, submission } = req.body ?? {};
    const compiledPrompt = GoodQuestionEngine.formatDIVERSEPrompt(topicId || "build_app", submission || {});
    res.json({ compiledPrompt });
}));

/**
 * POST /api/crew/:sessionKey/participants
 * Body: { identifier } — a user id or username.
 *
 * Project Space access is enforced by withProjectScope before this runs, so a
 * room the caller cannot see is unreachable here; the service additionally
 * checks the invitee shares the organisation.
 */
router.post(
    "/:sessionKey/participants",
    withProjectScope(),
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const userId = currentUserId(req);

        const identifier = req.body?.identifier;
        if (typeof identifier !== "string" || identifier.trim().length === 0) {
            throw new ValidationError("A user id or username is required", {
                field: "identifier",
            });
        }

        const session = await authorizeRoom(req, orgId, req.params.sessionKey);
        if (userId) {
            await crewParticipantsService.ensureParticipant(session.id, orgId, userId);
        }

        const result = await crewParticipantsService.invite({
            sessionId: session.id,
            orgId,
            invitedBy: userId ?? "system",
            identifier: identifier.trim(),
        });

        if (!result.ok) {
            return res.status(400).json({
                success: false,
                error: { code: "INVITE_FAILED", message: result.error, statusCode: 400 },
                timestamp: new Date().toISOString(),
            });
        }

        void crewStreamService.publish({
            type: "participant",
            organizationId: orgId,
            sessionKey: req.params.sessionKey,
            actor: userId,
            payload: { joined: result.participant.displayName },
        });

        const participants = await crewParticipantsService.list(session.id);
        res.json({ participant: result.participant, participants });
    }),
);

/**
 * GET /api/crew/:sessionKey/stream
 * Server-sent events for a room, so another participant's turns appear without
 * the client having to send something first.
 */
router.get("/:sessionKey/stream", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    let orgId = requireOrgId(orgContext);
    const sessionKey = req.params.sessionKey;

    const hasExplicitOrg = Boolean(req.query.orgId || req.query.organizationId || req.headers["x-organization-id"]);
    const streamSession = hasExplicitOrg
        ? await crewRepository.findSession(orgId, sessionKey)
        : await crewRepository.resolveAuthorizedSession(sessionKey, orgId, orgContext);
    if (streamSession) orgId = streamSession.organizationId;
    if (streamSession?.projectId != null) {
        const streamOrgContext = await getUserOrgContext(req);
        await projectService.getProject({
            organizationId: orgId,
            userId: streamOrgContext.userId,
            isSuperAdmin: streamOrgContext.isSuperAdmin,
            isOrgAdmin: streamOrgContext.isOrgAdmin,
        }, streamSession.projectId);
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx proxy buffering
    res.flushHeaders();

    res.write(`event: ready\ndata: ${JSON.stringify({ sessionKey })}\n\n`);

    const unsubscribe = crewStreamService.subscribe(orgId, sessionKey, (event) => {
        try {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        } catch {
            // Write to a dead socket; cleanup happens on close.
        }
    });

    // Without a keepalive, proxies drop an idle SSE connection.
    const keepalive = setInterval(() => {
        try {
            res.write(`: keepalive\n\n`);
        } catch {
            /* handled by close */
        }
    }, 25_000);

    const cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
        logger.debug(`SSE client disconnected from room ${sessionKey}`);
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
}));

/**
 * POST /api/crew/:sessionKey/cancel
 * Marks the active session as "interrupting", signalling the orchestrator to
 * skip remaining speakers in the current round.
 *
 * Returns 409 if the session is already interrupting or has no active round.
 */
router.post("/:sessionKey/cancel", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const session = await authorizeRoom(req, orgId, req.params.sessionKey);

    // If already interrupting, there's nothing to cancel (no active round or already cancelling)
    if (session.interrupting) {
        return res.status(409).json({
            success: false,
            error: {
                code: "NO_ACTIVE_ROUND",
                message: "No active round to cancel or cancellation already in progress",
                statusCode: 409,
            },
            timestamp: new Date().toISOString(),
        });
    }

    // Set the interrupting flag
    await crewRepository.requestRoundCancellation(session.id);

    logger.info(`Round cancellation requested for session ${session.sessionKey}`);

    res.json({ success: true, message: "Round cancellation requested" });
}));

/**
 * GET /api/crew/:sessionKey[?since=<turnId>]
 * Full room state. Returns empty collections for a room that does not exist yet
 * rather than 404 — the client opens a room before anything has been said in it.
 *
 * With a valid `since` cursor the response carries only what was created after
 * that turn, so a live room does not re-download its whole transcript on every
 * SSE event. An unparseable cursor is ignored and the full state is returned.
 * Either way the response shape is identical and carries a `cursor` field the
 * client uses for its next delta request.
 */
// ---- Attachments -----------------------------------------------------------
//
// Scoped to the room's project, which is why they hang off the session rather
// than off the org: an attachment with no project has no scope, and an unscoped
// document is the leak this design exists to prevent. A room that is not in a
// project therefore cannot take attachments at all.

router.post(
    "/:sessionKey/attachments",
    withProjectScope(),
    attachmentUpload.array("files", 5),
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const session = await authorizeRoom(req, orgId, req.params.sessionKey);

        let effectiveProjectId = session.projectId ?? req.projectId ?? null;
        if (effectiveProjectId == null) {
            const { projectService } = await import("@domain/projects/core/project.service.js");
            effectiveProjectId = await projectService.resolveDefaultProjectId(orgId);
        }

        if (effectiveProjectId == null) {
            throw new ValidationError(
                "This room is not in a project space, and a default project could not be resolved. " +
                "Open the room inside a project and try again.",
            );
        }

        if (session.projectId == null && effectiveProjectId != null) {
            await crewRepository.setSessionProject(session.id, effectiveProjectId);
        }

        const files = (req.files as Express.Multer.File[]) || [];
        if (files.length === 0) throw new ValidationError("No files were uploaded.");

        const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
        const stored = [];
        for (const file of files) {
            const { attachment, blob } = await attachmentService.attachToRoom({
                orgId,
                projectId: effectiveProjectId,
                sessionId: session.id,
                buffer: file.buffer,
                originalName: file.originalname,
                mimeType: file.mimetype,
                uploadedBy: currentUserId(req) ?? null,
            });
            stored.push({ id: attachment.id, name: attachment.displayName, parseStatus: blob.parseStatus });

            // Index in the background: embedding a large document takes seconds
            // and the upload should not block on it. The attachment is already
            // stored and listed as `pending`, so the room shows it immediately
            // and the status changes when the embedding lands — never a silent
            // gap between "uploaded" and "searchable".
            void import("@domain/knowledge/core/attachment-index.service.js")
                .then(({ attachmentIndexService }) =>
                    attachmentIndexService.indexAttachment(attachment.id, orgId),
                )
                .catch((err: any) =>
                    // indexAttachment records `failed` with the reason before it
                    // rethrows, so the status is already truthful here.
                    logger.error(`Background index failed for attachment ${attachment.id}: ${err?.message}`),
                );
        }

        const attachments = await attachmentService.listForSession(orgId, session.id);

        // The upload appears in the conversation: one turn from the person, with
        // thumbnails and document cards. Posting it does not start a round.
        const { attachmentCardItems, attachmentTurnText } = await import("../core/crew-attachment-preview.service.js");
        const items = attachmentCardItems(attachments as any, stored.map((s) => s.id));
        let turn = null;
        if (items.length > 0) {
            const userId = currentUserId(req);
            turn = await crewRepository.postTurn(orgId, session.id, {
                speakerType: "user",
                speakerName: await resolveDisplayName(userId),
                userId: userId ?? null,
                content: attachmentTurnText(items),
                artifacts: [{ tool: "room_attachments", payload: { type: "room_attachments", sessionKey: session.sessionKey, items } as any }],
            });
            await crewStreamService.publish({ type: "turn", organizationId: orgId, sessionKey: session.sessionKey, actor: userId, payload: { speakerType: "user" } });
        }

        res.status(201).json({ attachments, turn });
    }),
);

/**
 * GET /api/crew/:sessionKey/attachments/:id/thumbnail?w=320
 * A small WebP of an uploaded image, for the chat. Same room and project gate as
 * the download; widths snap to a few sizes. Not an image: 404.
 */
router.get(
    "/:sessionKey/attachments/:id/thumbnail",
    withProjectScope(),
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const session = await authorizeRoom(req, orgId, req.params.sessionKey);

        let effectiveProjectId = session.projectId ?? req.projectId ?? null;
        if (effectiveProjectId == null) {
            const { projectService } = await import("@domain/projects/core/project.service.js");
            effectiveProjectId = await projectService.resolveDefaultProjectId(orgId);
        }
        if (effectiveProjectId == null) throw new NotFoundError("No such attachment.");

        const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
        const { isThumbnailable, snapWidth, thumbnail } = await import("../core/crew-attachment-preview.service.js");
        const id = Number(req.params.id);
        const file = await attachmentService.readBlob(orgId, effectiveProjectId, id);
        if (!file || !isThumbnailable(file.mimeType)) throw new NotFoundError("No such image.");

        const width = snapWidth(req.query.w);
        const body = await thumbnail(`${orgId}:${id}`, file.bytes, width);
        res.setHeader("Content-Type", "image/webp");
        // Private: it is a tenant's file. An attachment's bytes never change (revisions are new rows).
        res.setHeader("Cache-Control", "private, max-age=86400, immutable");
        res.send(body);
    }),
);

router.get("/:sessionKey/attachments", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
    res.json({ attachments: await attachmentService.listForSession(orgId, session.id) });
}));

router.delete("/:sessionKey/attachments/:id", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const attachmentId = Number(req.params.id);
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) throw new NotFoundError("No such attachment.");
    const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
    if (!await attachmentService.removeFromSession(orgId, session.id, attachmentId)) throw new NotFoundError("No such attachment.");
    res.json({ attachments: await attachmentService.listForSession(orgId, session.id) });
}));

router.get(
    "/:sessionKey/attachments/:id/download",
    withProjectScope(),
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const session = await authorizeRoom(req, orgId, req.params.sessionKey);

        let effectiveProjectId = session.projectId ?? req.projectId ?? null;
        if (effectiveProjectId == null) {
            const { projectService } = await import("@domain/projects/core/project.service.js");
            effectiveProjectId = await projectService.resolveDefaultProjectId(orgId);
        }
        if (effectiveProjectId == null) throw new NotFoundError("No such attachment.");

        const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
        const file = await attachmentService.readBlob(orgId, effectiveProjectId, Number(req.params.id));
        // Scoped by org AND project in the query, so a miss means it is not this
        // room's to read — reported as absent rather than forbidden.
        if (!file) throw new NotFoundError("No such attachment.");

        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${file.displayName.replace(/"/g, "")}"`);
        res.send(file.bytes);
    }),
);

/**
 * GET /api/crew/:sessionKey/audit-report
 * Cryptographically signed procurement-grade audit bundle and executive HTML report.
 * Formats: ?format=json (default) or ?format=html
 */
router.get("/:sessionKey/audit-report", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    // authorizeRoom (not bare findSession) so a room inside a Project Space
    // the caller cannot read reports 404 — same gate the transcript itself
    // gets; the signed audit bundle must not be weaker than the data it
    // summarises.
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);

    const { buildCrewRoomAuditBundle, renderAuditReportHtml } = await import("@domain/mission/core/mission-audit-report.js");
    const { attachmentService } = await import("@domain/knowledge/core/attachment.service.js");
    const [turns, attachments] = await Promise.all([
        crewRepository.getTranscript(session.id),
        attachmentService.listForSession(orgId, session.id),
    ]);

    // The bundle names the room `key`; crew_sessions calls the same thing
    // sessionKey.
    const auditBundle = buildCrewRoomAuditBundle(
        {
            id: session.id,
            key: session.sessionKey,
            title: session.title ?? undefined,
            organizationId: session.organizationId,
            mode: session.mode,
        },
        turns,
        attachments,
        req.projectKey,
    );

    if (req.query.format === "html") {
        const html = renderAuditReportHtml(auditBundle);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(html);
    }

    return res.json(auditBundle);
}));

router.get("/:sessionKey", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    let orgId = requireOrgId(orgContext);

    // A room the client has opened but not yet spoken in does not exist server-side:
    // rooms are created by POST /message. That is EMPTY, not MISSING, and answering 404
    // made every freshly opened room look broken. Returning the empty shape lets the
    // client render a new room while keeping reads incapable of creating one.
    const hasExplicitOrg = Boolean(req.query.orgId || req.query.organizationId || req.headers["x-organization-id"]);
    const session = hasExplicitOrg
        ? await crewRepository.findSession(orgId, req.params.sessionKey)
        : await crewRepository.resolveAuthorizedSession(req.params.sessionKey, orgId, orgContext);
    if (session) orgId = session.organizationId;
    const userId = currentUserId(req);

    if (!session) {
        return res.json({
            session: null,
            members: [],
            turns: [],
            notes: [],
            plans: [],
            issues: [],
            raisedHands: [],
            decisions: [],
            claims: [],
            commitments: [],
            turnTopics: [],
            participants: [],
            currentUserId: userId ?? null,
            delta: false,
            cursor: null,
        });
    }

    // Project Space read gate, which authorizeRoom would otherwise have applied.
    if (session.projectId !== null) {
        await projectService.getProject({
            organizationId: orgId,
            userId: orgContext.userId,
            isSuperAdmin: orgContext.isSuperAdmin,
            isOrgAdmin: orgContext.isOrgAdmin,
        }, session.projectId);
    }

    if (userId) await crewParticipantsService.ensureParticipant(session.id, orgId, userId);

    const rawSince = typeof req.query.since === "string" ? Number(req.query.since) : NaN;
    const since = Number.isInteger(rawSince) && rawSince > 0 ? rawSince : null;

    const [members, participants, state, workProductTurns] = await Promise.all([
        crewRepository.getMembers(session.id),
        crewParticipantsService.list(session.id),
        since !== null
            ? getRoomDelta(session.id, since)
            : (async () => {
                  const [turns, notes, plans, issues, raisedHands, decisions, claims, commitments, turnTopics] = await Promise.all([
                      crewRepository.getTranscript(session.id),
                      crewRepository.getNotes(session.id),
                      crewRepository.getPlans(session.id),
                      crewRepository.getIssues(session.id),
                      crewRepository.getRaisedHands(session.id),
                      crewRepository.getDecisions(session.id),
                      crewRepository.getClaims(session.id),
                      crewRepository.getCommitments(session.id),
                      crewRepository.getTurnTopics(session.id),
                  ]);
                  return { turns, notes, plans, issues, raisedHands, decisions, claims, commitments, turnTopics };
              })(),
        crewRepository.getWorkProductTurns(orgId, session.id),
    ]);

    // Highest turn id the client now holds. On an empty delta the cursor must
    // stay where it was, or the client would rewind and refetch what it has.
    const cursor = state.turns.length > 0
        ? state.turns[state.turns.length - 1].id
        : since;

    res.json({
        session,
        members,
        ...state,
        workProductTurns,
        participants,
        currentUserId: userId ?? null,
        delta: since !== null,
        cursor,
    });
}));

/** Structured room state: explicit mode and durable memory. */
router.patch('/:sessionKey/brief', withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const parsed = crewRoomBriefSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('A room objective and success criteria are required', { field: 'brief' });
    if (session.status === 'archived') throw new ValidationError('Reopen the room before changing its brief', { field: 'status' });
    const updated = await crewRepository.updateRoomBrief(session.id, orgId, parsed.data);
    await crewStreamService.publish({ type: 'blackboard-sync', organizationId: orgId, sessionKey: session.sessionKey });
    res.json({ session: updated });
}));

router.post('/:sessionKey/work-product', withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (session.status === 'archived') throw new ValidationError('Reopen the room before editing a work product', { field: 'status' });
    const parsed = crewWorkProductSchema.safeParse({ ...req.body, type: 'crew_work_product' });
    if (!parsed.success || !parsed.data.sourceTurnId) throw new ValidationError('A valid work product and source version are required', { field: 'workProduct' });
    const source = await crewRepository.findRoomTurn(orgId, session.id, parsed.data.sourceTurnId);
    const matching = source?.artifacts?.some(artifact => {
        const product = crewWorkProductSchema.safeParse(artifact.payload);
        return product.success && product.data.documentKey === parsed.data.documentKey;
    });
    if (!matching) throw new ValidationError('The source work product does not belong to this room', { field: 'sourceTurnId' });
    const userId = currentUserId(req);
    const turn = await crewRepository.postTurn(orgId, session.id, {
        speakerType: 'user', speakerName: await resolveDisplayName(userId), userId,
        content: `Updated work product: ${parsed.data.title}\n${parsed.data.changeSummary}\n\n${parsed.data.content}`,
        artifacts: [{ tool: 'edit_work_product', payload: parsed.data }],
    });
    await crewStreamService.publish({ type: 'turn', organizationId: orgId, sessionKey: session.sessionKey, actor: userId, payload: { speakerType: 'user' } });
    res.json({ turn });
}));

router.patch("/:sessionKey/state", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.mode !== undefined) {
        if (!crewRoomModes.includes(req.body.mode)) throw new ValidationError("Invalid CREW room mode", { field: "mode" });
        updates.mode = req.body.mode;
    }
    if (req.body?.memory !== undefined) {
        const memory = req.body.memory;
        if (!memory || typeof memory !== "object") throw new ValidationError("memory must be an object", { field: "memory" });
        updates.memory = {
            ...session.memory,
            facts: Array.isArray(memory.facts) ? memory.facts.map(String).slice(0, 100) : [],
            hypotheses: Array.isArray(memory.hypotheses) ? memory.hypotheses.map(String).slice(0, 100) : [],
            openQuestions: Array.isArray(memory.openQuestions) ? memory.openQuestions.map(String).slice(0, 100) : [],
            constraints: Array.isArray(memory.constraints) ? memory.constraints.map(String).slice(0, 100) : [],
            ontologyRefs: Array.isArray(memory.ontologyRefs) ? memory.ontologyRefs.slice(0, 100) : [],
            updatedRound: Number.isInteger(memory.updatedRound) ? memory.updatedRound : 0,
        };
    }
    // agentTagApproval: when on, agent-declared topic tags persist 'pending'
    // until the room owner decides via POST /:sessionKey/topics/:id/decision.
    if (typeof req.body?.agentTagApproval === "boolean") {
        updates.memory = {
            ...(updates.memory ?? session.memory),
            agentTagApproval: req.body.agentTagApproval,
        };
    }
    const updated = await crewRepository.updateSession(session.id, updates);
    res.json({ session: updated });
}));

/**
 * Room-owner decision on a gated agent tag: apply or reject it. Only the
 * room's creator (or an org/super admin) can decide — the tag was proposed
 * by an agent, not by the person being asked to bless it.
 */
router.post("/:sessionKey/topics/:turnTopicId/decision", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const status = req.body?.status;
    if (status !== "applied" && status !== "rejected") {
        throw new ValidationError("status must be 'applied' or 'rejected'", { field: "status" });
    }
    const userId = currentUserId(req);
    const isRoomOwner = session.createdBy != null && String(session.createdBy) === String(userId);
    if (!isRoomOwner && !orgContext.isOrgAdmin && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Only the room owner or an admin can decide agent topic tags");
    }
    const { decideTurnTag } = await import("../core/crew-topics.service.js");
    const row = await decideTurnTag(orgId, session.id, Number(req.params.turnTopicId), status);
    if (!row) throw new ValidationError("No pending agent tag with that id in this room", { field: "turnTopicId" });
    res.json({ turnTopic: row });
}));

router.post("/:sessionKey/decisions", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (typeof req.body?.statement !== "string" || !req.body.statement.trim()) throw new ValidationError("Decision statement is required", { field: "statement" });
    const status = req.body.status ?? "proposed";
    if (!crewDecisionStatuses.includes(status)) throw new ValidationError("Invalid decision status", { field: "status" });
    const decision = await crewRepository.createDecision({
        sessionId: session.id, organizationId: orgId, statement: req.body.statement.trim(),
        rationale: req.body.rationale ?? null, alternatives: req.body.alternatives ?? [],
        evidenceTurnIds: req.body.evidenceTurnIds ?? [], ontologyRefs: req.body.ontologyRefs ?? [],
        confidence: req.body.confidence ?? null, status, supersedesDecisionId: req.body.supersedesDecisionId ?? null,
        createdBy: currentUserId(req) ?? null, round: req.body.round ?? 0,
    });
    res.status(201).json({ decision });
}));

router.patch("/:sessionKey/decisions/:decisionId", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (!crewDecisionStatuses.includes(req.body?.status)) throw new ValidationError("Invalid decision status", { field: "status" });
    const decision = await crewRepository.updateDecision(Number(req.params.decisionId), session.id, {
        status: req.body.status,
        rationale: req.body.rationale,
        updatedAt: new Date(),
    });
    if (!decision) return res.status(404).json({ error: "Decision not found" });
    res.json({ decision });
}));

router.post("/:sessionKey/claims", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (typeof req.body?.claim !== "string" || !req.body.claim.trim()) throw new ValidationError("Claim is required", { field: "claim" });
    const status = req.body.status ?? "unverified";
    if (!crewClaimStatuses.includes(status)) throw new ValidationError("Invalid claim status", { field: "status" });
    const claim = await crewRepository.createClaim({
        sessionId: session.id, organizationId: orgId, claim: req.body.claim.trim(), status,
        confidence: req.body.confidence ?? null, sourceTurnId: req.body.sourceTurnId ?? null,
        evidence: req.body.evidence ?? [], createdBy: currentUserId(req) ?? null,
    });
    res.status(201).json({ claim });
}));

router.patch("/:sessionKey/claims/:claimId", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (!crewClaimStatuses.includes(req.body?.status)) throw new ValidationError("Invalid claim status", { field: "status" });
    const claim = await crewRepository.updateClaim(Number(req.params.claimId), session.id, {
        status: req.body.status,
        evidence: req.body.evidence ?? [],
        confidence: req.body.confidence ?? null,
        updatedAt: new Date(),
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    res.json({ claim });
}));

router.post("/:sessionKey/commitments", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    if (typeof req.body?.title !== "string" || !req.body.title.trim()) throw new ValidationError("Commitment title is required", { field: "title" });
    const status = req.body.status ?? "open";
    if (!crewCommitmentStatuses.includes(status)) throw new ValidationError("Invalid commitment status", { field: "status" });
    const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new ValidationError("Invalid dueAt", { field: "dueAt" });
    const commitment = await crewRepository.createCommitment({
        sessionId: session.id, organizationId: orgId, title: req.body.title.trim(), detail: req.body.detail ?? null,
        ownerType: req.body.ownerType ?? "user", ownerId: req.body.ownerId ?? currentUserId(req) ?? null,
        dueAt, status, ontologyRefs: req.body.ontologyRefs ?? [], completionEvidence: req.body.completionEvidence ?? [],
        createdBy: currentUserId(req) ?? null,
    });
    res.status(201).json({ commitment });
}));

router.patch("/:sessionKey/commitments/:commitmentId", withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const status = req.body?.status;
    if (!crewCommitmentStatuses.includes(status)) throw new ValidationError("Invalid commitment status", { field: "status" });
    const commitment = await crewRepository.updateCommitment(Number(req.params.commitmentId), session.id, {
        status,
        completionEvidence: req.body.completionEvidence ?? [],
        updatedAt: new Date(),
    });
    if (!commitment) return res.status(404).json({ error: "Commitment not found" });
    res.json({ commitment });
}));

/**
 * PUT /api/crew/:sessionKey/members
 * Body: { agentCardIds: number[] }
 */
router.put("/:sessionKey/members", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const ids = parseAgentCardIds(req.body?.agentCardIds);
    if (ids === undefined) {
        throw new ValidationError("agentCardIds is required", {
            field: "agentCardIds",
        });
    }

    const session = await authorizeRoom(req, orgId, req.params.sessionKey);
    const members = await crewRepository.setMembers(orgId, session.id, ids);

    logger.info(`Crew ${session.id} roster set to ${members.length} member(s)`);
    res.json({ members });
}));

/**
 * GET /api/crew/:sessionKey/breakouts
 *
 * Returns the breakout lineage for a room — the parent session (if this is a
 * child room) and any child sessions (if this room has spawned breakouts).
 */
router.get("/:sessionKey/breakouts", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const session = await authorizeRoom(req, orgId, req.params.sessionKey);

    const { parent, children } = await crewRepository.getBreakoutLineage(orgId, session);

    res.json({
        sessionKey: req.params.sessionKey,
        parent: parent
            ? { ...parent, url: `/workspace/chat/${parent.sessionKey}` }
            : null,
        children: children.map((c) => ({
            id: c.id,
            subTopic: c.subTopic,
            suggestedBy: c.suggestedBy,
            createdAt: c.createdAt,
            sessionKey: c.childSessionKey,
            title: c.childTitle,
            url: `/workspace/chat/${c.childSessionKey}`,
        })),
    });
}));

/**
 * POST /api/crew/:sessionKey/conclude
 *
 * Formally closes the meeting, synthesizing all decisions, work products,
 * attachments, and plan items into an Executive Closing Brief document deliverable,
 * and sets status to "archived".
 */
router.post("/:sessionKey/conclude", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);

    const result = await concludeSession(orgId, req.params.sessionKey, userId);
    res.json({
        success: true,
        session: result.session,
        turn: result.turn,
    });
}));

/**
 * POST /api/crew/:sessionKey/reopen
 *
 * Re-opens an archived crew discussion room.
 */
router.post("/:sessionKey/reopen", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    await authorizeRoom(req, orgId, req.params.sessionKey);
    const userId = currentUserId(req);

    const result = await reopenSession(orgId, req.params.sessionKey, userId);
    res.json({
        success: true,
        session: result.session,
        turn: result.turn,
    });
}));

/**
 * POST /api/crew/schedules/propose
 * Propose a new multi-participant meeting.
 */
router.post("/schedules/propose", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const userId = currentUserId(req) || "user";
    const { title, agenda, projectId, candidateSlots, requestedAttendees, reminderMinutesBefore } = req.body;

    if (!title || !candidateSlots || !Array.isArray(candidateSlots)) {
        throw new ValidationError("title and candidateSlots array are required");
    }

    const result = await crewMeetingSchedulerService.proposeMeeting(orgId, {
        projectId: projectId ? Number(projectId) : undefined,
        title,
        agenda,
        hostUserId: userId,
        candidateSlots,
        requestedAttendees: Array.isArray(requestedAttendees) ? requestedAttendees : [],
        reminderMinutesBefore: reminderMinutesBefore ? Number(reminderMinutesBefore) : 15,
    });

    res.status(201).json({
        success: true,
        schedule: result.schedule,
        artifact: result.artifact,
    });
}));

/**
 * GET /api/crew/schedules/:id
 * Retrieve schedule details.
 */
router.get("/schedules/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const scheduleId = Number(req.params.id);
    const schedule = await crewMeetingSchedulerService.getSchedule(orgId, scheduleId);
    if (!schedule) {
        throw new NotFoundError(`Meeting schedule #${scheduleId} not found`);
    }

    res.json({ success: true, schedule });
}));

/**
 * POST /api/crew/schedules/:id/vote
 * Submit availability vote for a candidate slot.
 */
router.post("/schedules/:id/vote", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const userId = currentUserId(req) || "user";
    const scheduleId = Number(req.params.id);
    const { slotId } = req.body;

    if (!slotId) {
        throw new ValidationError("slotId is required to vote");
    }

    const updated = await crewMeetingSchedulerService.voteSlot(orgId, scheduleId, userId, slotId);
    res.json({ success: true, schedule: updated });
}));

/**
 * POST /api/crew/schedules/:id/confirm
 * Lock in the confirmed slot, add to calendar, and schedule launch.
 */
router.post("/schedules/:id/confirm", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const userId = currentUserId(req) || "user";
    const scheduleId = Number(req.params.id);
    const { slotId } = req.body;

    if (!slotId) {
        throw new ValidationError("slotId is required to confirm schedule");
    }

    const result = await crewMeetingSchedulerService.confirmMeeting(orgId, scheduleId, slotId, userId);
    res.json({
        success: true,
        schedule: result.schedule,
        artifact: result.artifact,
    });
}));

/**
 * GET /api/crew/schedules/:id/ics
 * Download standard RFC 5545 iCalendar (.ics) invite.
 */
router.get("/schedules/:id/ics", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const scheduleId = Number(req.params.id);
    const schedule = await crewMeetingSchedulerService.getSchedule(orgId, scheduleId);
    if (!schedule) {
        throw new NotFoundError(`Meeting schedule #${scheduleId} not found`);
    }

    const icsContent = crewMeetingSchedulerService.generateIcs(schedule);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="meeting-${schedule.id}.ics"`);
    res.send(icsContent);
}));

/**
 * GET /api/crew/:sessionKey/cycle-fleet
 * Resolves all connected app surfaces for a cycle-linked room.
 */
router.get("/:sessionKey/cycle-fleet", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const result = await CrewCycleBridgeService.getCycleFleetForRoom(orgId, req.params.sessionKey);
    res.json(result);
}));

/**
 * POST /api/crew/cycle/convene
 * Convenes or provisions a ceremony room for a cycle stage.
 */
router.post("/cycle/convene", asyncHandler(async (req: Request, res: Response) => {
    const orgId = requireOrgId(await getUserOrgContext(req));
    const { cycleSlug, cycleName, stageId, stageName, title, topic, rosterAgentCardIds, requiredDecisions, parentSessionKey, isStandingRoom } = req.body;

    if (!cycleSlug) {
        throw new ValidationError("cycleSlug is required to convene a cycle room");
    }

    const result = await CrewCycleBridgeService.createCycleStageRoom(orgId, {
        cycleSlug,
        cycleName,
        stageId,
        stageName,
        title,
        topic,
        rosterAgentCardIds,
        requiredDecisions,
        parentSessionKey,
        isStandingRoom,
        createdBy: currentUserId(req) || "user",
    });

    res.json({ success: true, ...result });
}));


export const crewRouter = router;
export default router;
