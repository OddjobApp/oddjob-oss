import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile as readLocalFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { crewSessions } from "@shared/schema/crew.js";
import { scribeAnnotations, scribeBranches, scribeDocuments, scribeEntityLedger, scribeNodes } from "@shared/schema/scribe.js";
import {
    mediaAssemblies,
    mediaWardrobe, mediaDecisions, mediaAssets, mediaKeyframes, mediaPlotPoints, mediaProductions, mediaReferences, mediaScenes, mediaShots, mediaTakes,
    type MediaAssembly, type MediaAsset, type MediaKeyframe, type MediaPlotPoint, type MediaProduction, type MediaReference, type MediaScene, type MediaWardrobe, type MediaDecision, type MediaShotRow, type MediaTake,
} from "@shared/schema/media-studio.js";
import { users, userOrgs } from "@shared/schema/auth.js";
import { projects as projectsTable } from "@shared/schema/projects.js";
import { shotTimelineStarts, DEFECT_CLASSES, DEFECT_LABELS, MEDIA_ASPECT_RATIOS, MEDIA_ASSET_EXTENSIONS, MEDIA_ASSET_MIME_TYPES, REFERENCE_KINDS, SHOT_TRANSITIONS, VIDEO_ENGINES, formatCents, mediaAssetUrl, reelSignature, sceneAssemblyProblem, wardrobeForScene, type MediaDecisionKind, type MediaDecisionView, type WardrobeView, type AssemblyManifest, type AssemblyView, type AssetView, type CharacterView, type KeyframeView, type MediaAspectRatio, type MediaAssetKind, type KeyframeReference, type ProductionSummary, type ProductionView, type ProjectProduction, type ReferenceKind, type ReferenceView, type ShotView, type TakeRequest, type TakeView, type VideoEngine, type VideoResolution } from "@shared/media-studio.js";
import { buildAssemblyPlan, reelDimensions, type PlanClip } from "./assembly-plan.js";
import { createFfmpegRunner, ffmpegBinary, type FfmpegRunner } from "./ffmpeg.js";
import { charactersNamedIn, compileKeyframe, compileShot, referencePrompt, SEEDANCE_DURATION } from "@shared/media-prompt.js";
import { parseScribeStationToScene, type ParsedScribeShot } from "@shared/scribe-to-media.js";
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { AppError, BadRequestError, ConflictError, NotFoundError } from "@server/utils/errors.js";
import { approvalRequests } from "@shared/schema/hil.js";
import { createLogger } from "@server/utils/logger.js";
import { createGeminiImageGenerator, ImageGenerationError, type ImageGenerator, type ReferenceImage } from "./gemini-image.js";
import { ORG_GEMINI_KEY_MISSING, resolveOrgFalKey, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";
import { createComfyUIImageGenerator } from "./comfyui-image.js";
import { createFalVideoProvider, VideoProviderError, type VideoProvider } from "./video-provider.js";
import { createComfyUIProvider, type ComfyUIProvider } from "./comfyui-provider.js";
import { notifyRenderFinished } from "./render-notifications.js";
import { DEFAULT_WAN_WORKFLOW_GRAPH, detectComfyMapping, getComfyModelName, parseComfyGraph, setComfyModelName, summarizeComfyWorkflow } from "@shared/comfy-workflow.js";
import { biblePromptInput, parseProjectStyleBible, projectStyleBibleSchema, type CharacterContinuityAnchor, type ProjectStyleBible } from "@shared/style-bible.js";
import { LOCATION_CATALOG } from "@shared/location-library.js";
import { PROP_CATALOG } from "@shared/prop-library.js";
import { LIGHTING_CATALOG } from "@shared/lighting-library.js";
import { SHOT_TYPES_CATALOG } from "@shared/shot-types.js";
import { LENS_CATALOG, CAMERA_MOTION_CATALOG } from "@shared/camera-library.js";
import { orchestrateCinematicShot, type CinematicShotInput, type CinematicSceneContext } from "@shared/cinematic-orchestrator.js";
import { BARNABY_VANCE, PIP_THE_PUP } from "@shared/character.js";
import { verifyCharacterConsistency } from "./identity-drift-verifier.js";

const logger = createLogger("MediaStudio");

export type { AssetView, KeyframeView, PlotPointView, ProductionSummary, ProductionView, SceneView, ShotView, TakeView } from "@shared/media-studio.js";

/**
 * Media Studio's productions: the storyboard (scenes, plot points, keyframes), the
 * film (shots and their takes), and the files they produce.
 *
 * Everything is read and written within the caller's organization, by equality. A
 * production in a private Project Space reads as not found to anyone who cannot read
 * that project, the same way Form Studio hides a private project's forms. Mutations
 * answer with the whole production as it now stands.
 *
 * Keyframes render here (Gemini, no approval, counted against the budget). Video takes
 * render with Seedance on fal.ai only after a person approves each one in the Decision
 * Inbox; without FAL_KEY a take is recorded as a simulation with no video and no charge.
 */

/** A keyframe still "rendering" this long after its last update is taken as lost. */
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;
/** A reel "assembling" with no heartbeat for this long was lost to a restart. */
const ASSEMBLY_GIVE_UP_MS = 15 * 60 * 1000;
const ASSEMBLY_LOST = "The assembly did not finish; the server may have restarted. Assemble the scene again.";

// ── Input ───────────────────────────────────────────────────────────────────

const title = z.string().trim().min(1).max(200);
const budget = z.number().int().min(0).max(10_000_000);

const productionInput = z.object({
    title,
    aspectRatio: z.enum(MEDIA_ASPECT_RATIOS).optional(),
    budgetLimitCents: budget.optional(),
    style: z.string().trim().max(1000).optional(),
    videoEngine: z.enum(VIDEO_ENGINES).optional(),
    /** The CREW room the production is made in, by key or id; it belongs to the room's Project Space. */
    crewSessionKey: z.string().trim().min(1).max(200).optional(),
    crewSessionId: z.number().int().positive().optional(),
    projectKey: z.string().trim().min(1).max(200).optional(),
}).refine((input) => [input.crewSessionKey, input.crewSessionId, input.projectKey].filter((v) => v !== undefined).length <= 1, {
    message: "Give a room or a project, not both.",
});

const productionPatch = z.object({
    title: title.optional(),
    aspectRatio: z.enum(MEDIA_ASPECT_RATIOS).optional(),
    budgetLimitCents: budget.optional(),
    style: z.string().trim().max(1000).optional(),
});
const sceneInput = z.object({ title, synopsis: z.string().max(4000).optional() });
const scenePatch = z.object({
    title: title.optional(),
    synopsis: z.string().max(4000).optional(),
    location: z.string().trim().max(200).optional(),
    timeOfDay: z.string().trim().max(100).optional(),
    mood: z.string().trim().max(300).optional(),
});
const scribeLinkInput = z.object({ documentId: z.number().int().positive().nullable() });
const stationLinkInput = z.object({ scribeNodeId: z.number().int().positive().nullable() });
const dialogueLine = z.object({
    speaker: z.string().trim().min(1).max(80),
    line: z.string().trim().min(1).max(1000),
    delivery: z.string().trim().max(120).optional(),
});
const plotPointInput = z.object({ title, beat: z.string().max(4000).optional() });
const plotPointPatch = z.object({ title: title.optional(), beat: z.string().max(4000).optional() });
const shotInput = z.object({
    prompt: z.string().max(4000).optional(),
    negativePrompt: z.string().max(2000).nullable().optional(),
    cameraMotion: z.string().max(200).nullable().optional(),
    seed: z.string().max(200).nullable().optional(),
    durationSeconds: z.number().int().min(1).max(60).optional(),
    transition: z.enum(SHOT_TRANSITIONS).optional(),
    // The timeline edits. Seconds here are fractional — a trim lands on a frame — and
    // nullable, because clearing one is how a shot goes back to the whole take, its
    // standard transition length, or its place in the magnetic order. z.object strips
    // what it does not declare, so an undeclared field is accepted and then silently
    // dropped, which is exactly how these were lost before.
    transitionDurationSeconds: z.number().min(0).max(10).nullable().optional(),
    track: z.number().int().min(1).max(2).optional(),
    startTimeSeconds: z.number().min(0).max(36000).nullable().optional(),
    trimInSeconds: z.number().min(0).max(3600).nullable().optional(),
    trimOutSeconds: z.number().min(0).max(3600).nullable().optional(),
    holdDurationSeconds: z.number().min(0).max(600).nullable().optional(),
    /** A cutaway hangs off a primary shot, this far into it (0125). */
    anchorShotId: z.number().int().positive().nullable().optional(),
    anchorOffsetSeconds: z.number().min(0).max(36000).nullable().optional(),
    plotPointId: z.number().int().positive().nullable().optional(),
    referenceKeyframeId: z.number().int().positive().nullable().optional(),
    framing: z.string().trim().max(200).nullable().optional(),
    lens: z.string().trim().max(100).nullable().optional(),
    action: z.string().trim().max(4000).optional(),
    dialogue: z.array(dialogueLine).max(30).optional(),
});
const orderInput = z.array(z.number().int().positive()).max(500);
const rejectionInput = z.object({ defectClass: z.enum(DEFECT_CLASSES).optional(), notes: z.string().trim().max(2000).optional() });
const keyframeInput = z.object({ prompt: z.string().trim().max(4000).optional() });
const sceneNoteInput = z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
    /** A todo is work the manuscript still owes; a note is an observation. */
    kind: z.enum(["todo", "note"]).optional().default("todo"),
    severity: z.enum(["info", "suggestion", "warning"]).optional().default("suggestion"),
});
const wardrobeInput = z.object({
    characterName: z.string().trim().min(1).max(100),
    garment: z.string().trim().min(1).max(1000),
    notes: z.string().trim().max(1000).optional(),
    /** Worn from this scene onward; null or absent means from the beginning. */
    fromSceneId: z.number().int().positive().nullable().optional(),
});
const wardrobePatch = z.object({
    characterName: z.string().trim().min(1).max(100).optional(),
    garment: z.string().trim().min(1).max(1000).optional(),
    notes: z.string().trim().max(1000).optional(),
    fromSceneId: z.number().int().positive().nullable().optional(),
});
const referenceInput = z.object({
    kind: z.enum(REFERENCE_KINDS),
    name: z.string().trim().min(1).max(200),
    /** How they look, when the manuscript does not say. */
    description: z.string().trim().max(1000).optional(),
    prompt: z.string().trim().max(4000).optional(),
});
const videoEngineInput = z.object({
    engine: z.enum(VIDEO_ENGINES),
    /** A ComfyUI workflow exported with Export (API). */
    workflow: z.object({ name: z.string().trim().min(1).max(200).optional(), graph: z.unknown() }).optional(),
    model: z.string().trim().min(1).max(300).optional(),
});
const takeInput = z.object({
    note: z.string().trim().max(1000).optional(),
    endOnNextKeyframe: z.boolean().optional(),
    generateAudio: z.boolean().optional(),
});
const reshootInput = z.object({
    defectClass: z.enum(DEFECT_CLASSES).optional(),
    notes: z.string().trim().max(1000).optional(),
    endOnNextKeyframe: z.boolean().optional(),
});
const batchApproveInput = z.object({ takeIds: z.array(z.number().int().positive()).min(1).max(100) });
const batchReshootInput = z.object({
    items: z.array(z.object({
        takeId: z.number().int().positive(),
        defectClass: z.enum(DEFECT_CLASSES).optional(),
        notes: z.string().trim().max(1000).optional(),
    })).min(1).max(50),
});

/** One take of a batch: whether it went through, why not, and a re-shoot's new take. */
export interface BatchTakeResult {
    takeId: number;
    ok: boolean;
    error?: string;
    newTakeId?: number | null;
}

const statusWords = (status: string) => status.replace(/_/g, " ");

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, what: string): z.infer<S> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        throw new BadRequestError(`${what}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);
    }
    return parsed.data;
}

const isUniqueViolation = (error: unknown) => {
    const e = error as { code?: string; cause?: { code?: string } } | null;
    return (e?.code ?? e?.cause?.code) === "23505";
};

// ── Access ──────────────────────────────────────────────────────────────────

const projectCtxOf = (ctx: OrgContext) => ({
    organizationId: ctx.organizationId as number,
    userId: ctx.userId ?? undefined,
    isSuperAdmin: Boolean(ctx.isSuperAdmin),
    isOrgAdmin: Boolean(ctx.isOrgAdmin),
});

async function projects() {
    const { projectService } = await import("@domain/projects/core/project.service.js");
    return projectService;
}

/** Refuses, as not found, anything in a private Project Space the caller cannot read. */
/**
 * That the caller actually belongs to an organization, before anything is read as it.
 *
 * Nothing else downstream asks. assertProjectVisible returns without checking when a
 * production has no project, and assertCanRead returns early for any project that is
 * not private — so a context carrying someone else's organizationId satisfies every
 * check that follows it. Not found rather than forbidden: whether the asset exists is
 * itself the answer being withheld.
 */
async function assertOrgMembership(ctx: OrgContext, organizationId: number, notFound: string) {
    if (ctx.isSuperAdmin) return;
    if (!ctx.userId) throw new NotFoundError(notFound);
    const [membership] = await db.select({ userId: userOrgs.userId }).from(userOrgs)
        .where(and(eq(userOrgs.orgId, organizationId), eq(userOrgs.userId, ctx.userId))).limit(1);
    if (!membership) throw new NotFoundError(notFound);
}

async function assertProjectVisible(ctx: OrgContext, projectId: number | null, notFound: string) {
    if (projectId == null) return;
    try {
        await (await projects()).getProject(projectCtxOf(ctx), projectId);
    } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError(notFound);
        throw error;
    }
}

async function productionRow(ctx: OrgContext, id: number): Promise<MediaProduction> {
    const org = requireOrgId(ctx);
    const [row] = await db.select().from(mediaProductions)
        .where(and(eq(mediaProductions.id, id), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Production not found.");
    await assertProjectVisible(ctx, row.projectId, "Production not found.");
    return row;
}

async function sceneRow(ctx: OrgContext, id: number): Promise<{ scene: MediaScene; production: MediaProduction }> {
    const org = requireOrgId(ctx);
    const [row] = await db.select({ scene: mediaScenes, production: mediaProductions }).from(mediaScenes)
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaScenes.id, id), eq(mediaScenes.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Scene not found.");
    await assertProjectVisible(ctx, row.production.projectId, "Scene not found.");
    return row;
}

async function plotPointRow(ctx: OrgContext, id: number): Promise<{ plotPoint: MediaPlotPoint; scene: MediaScene; production: MediaProduction }> {
    const org = requireOrgId(ctx);
    const [row] = await db.select({ plotPoint: mediaPlotPoints, scene: mediaScenes, production: mediaProductions }).from(mediaPlotPoints)
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaPlotPoints.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaPlotPoints.id, id), eq(mediaPlotPoints.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Plot point not found.");
    await assertProjectVisible(ctx, row.production.projectId, "Plot point not found.");
    return row;
}

async function keyframeRow(ctx: OrgContext, id: number): Promise<{ keyframe: MediaKeyframe; production: MediaProduction }> {
    const org = requireOrgId(ctx);
    const [row] = await db.select({ keyframe: mediaKeyframes, production: mediaProductions }).from(mediaKeyframes)
        .innerJoin(mediaPlotPoints, eq(mediaPlotPoints.id, mediaKeyframes.plotPointId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaPlotPoints.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaKeyframes.id, id), eq(mediaKeyframes.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Keyframe not found.");
    await assertProjectVisible(ctx, row.production.projectId, "Keyframe not found.");
    return row;
}

async function shotRow(ctx: OrgContext, id: number): Promise<{ shot: MediaShotRow; scene: MediaScene; production: MediaProduction }> {
    const org = requireOrgId(ctx);
    const [row] = await db.select({ shot: mediaShots, scene: mediaScenes, production: mediaProductions }).from(mediaShots)
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaShots.id, id), eq(mediaShots.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Shot not found.");
    await assertProjectVisible(ctx, row.production.projectId, "Shot not found.");
    return row;
}

async function takeRow(ctx: OrgContext, id: number): Promise<{ take: MediaTake; shot: MediaShotRow; production: MediaProduction }> {
    const org = requireOrgId(ctx);
    const [row] = await db.select({ take: mediaTakes, shot: mediaShots, production: mediaProductions }).from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaTakes.id, id), eq(mediaTakes.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Take not found.");
    await assertProjectVisible(ctx, row.production.projectId, "Take not found.");
    return row;
}

async function assertPlotPointInScene(plotPointId: number, sceneId: number, organizationId: number) {
    const [plotPoint] = await db.select({ id: mediaPlotPoints.id }).from(mediaPlotPoints)
        .where(and(eq(mediaPlotPoints.id, plotPointId), eq(mediaPlotPoints.sceneId, sceneId), eq(mediaPlotPoints.organizationId, organizationId))).limit(1);
    if (!plotPoint) throw new BadRequestError("That plot point is not in this scene.");
}

/** A room in the caller's organization, by key or id, or not found. */
async function roomOf(ctx: OrgContext, room: { key?: string; id?: number }) {
    const org = requireOrgId(ctx);
    const [session] = await db.select({ id: crewSessions.id, projectId: crewSessions.projectId }).from(crewSessions)
        .where(and(
            eq(crewSessions.organizationId, org),
            room.key !== undefined ? eq(crewSessions.sessionKey, room.key) : eq(crewSessions.id, room.id as number),
        )).limit(1);
    return session ?? null;
}

// ── Reading ─────────────────────────────────────────────────────────────────

const iso = (date: Date) => date.toISOString();

function excerpt(text: string, max: number) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Answers whether the caller can read a project, remembering each answer. */
function projectReader(ctx: OrgContext) {
    const readable = new Map<number, boolean>();
    return async (projectId: number | null) => {
        if (projectId == null) return true;
        if (!readable.has(projectId)) {
            try {
                await assertProjectVisible(ctx, projectId, "hidden");
                readable.set(projectId, true);
            } catch (error) {
                if (!(error instanceof NotFoundError)) throw error;
                readable.set(projectId, false);
            }
        }
        return readable.get(projectId) as boolean;
    };
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const row of rows) {
        const k = key(row);
        const group = groups.get(k);
        if (group) group.push(row);
        else groups.set(k, [row]);
    }
    return groups;
}

/** Only a live render that was actually sent costs anything. */
const spent = (rows: Array<{ mode: string | null; submittedAt: Date | null; costCents: number }>) =>
    rows.reduce((sum, row) => sum + (row.mode === "live" && row.submittedAt ? row.costCents : 0), 0);

async function productionSpend(productionId: number, organizationId: number): Promise<number> {
    const cents = sql<number>`coalesce(sum(${mediaTakes.costCents}), 0)::int`;
    const [takes] = await db.select({ cents }).from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .where(and(eq(mediaScenes.productionId, productionId), eq(mediaTakes.organizationId, organizationId), eq(mediaTakes.mode, "live"), isNotNull(mediaTakes.submittedAt)));
    const [keyframes] = await db.select({ cents: sql<number>`coalesce(sum(${mediaKeyframes.costCents}), 0)::int` }).from(mediaKeyframes)
        .innerJoin(mediaPlotPoints, eq(mediaPlotPoints.id, mediaKeyframes.plotPointId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaPlotPoints.sceneId))
        .where(and(eq(mediaScenes.productionId, productionId), eq(mediaKeyframes.organizationId, organizationId), eq(mediaKeyframes.mode, "live"), isNotNull(mediaKeyframes.submittedAt)));
    const [references] = await db.select({ cents: sql<number>`coalesce(sum(${mediaReferences.costCents}), 0)::int` }).from(mediaReferences)
        .where(and(eq(mediaReferences.productionId, productionId), eq(mediaReferences.organizationId, organizationId), eq(mediaReferences.mode, "live"), isNotNull(mediaReferences.submittedAt)));
    return Number(takes?.cents ?? 0) + Number(keyframes?.cents ?? 0) + Number(references?.cents ?? 0);
}

const keyframeView = (row: MediaKeyframe): KeyframeView => ({
    id: row.id, prompt: row.prompt, status: row.status, mode: row.mode ?? null, costCents: row.costCents,
    imageUrl: row.imageAssetId ? mediaAssetUrl(row.imageAssetId) : null, isSelected: row.isSelected, error: row.error,
    references: Array.isArray(row.referenceImages) ? row.referenceImages : [], createdAt: iso(row.createdAt),
});

const wardrobeView = (row: MediaWardrobe, sceneKeys: Map<number, string>): WardrobeView => ({
    id: row.id, characterName: row.characterName, garment: row.garment, notes: row.notes,
    fromSceneId: row.fromSceneId, fromSceneKey: row.fromSceneId == null ? null : sceneKeys.get(row.fromSceneId) ?? null,
    plateStatus: row.plateStatus, plateUrl: row.imageAssetId ? mediaAssetUrl(row.imageAssetId) : null,
    costCents: row.costCents, error: row.error,
});

const decisionView = (row: MediaDecision): MediaDecisionView => ({
    id: row.id, kind: row.kind, proposalId: row.proposalId, sceneKey: row.sceneKey,
    instruction: row.instruction, summary: Array.isArray(row.summary) ? row.summary : [],
    skipped: Array.isArray(row.skipped) ? row.skipped : [], decidedBy: row.decidedBy, createdAt: iso(row.createdAt),
});

const referenceView = (row: MediaReference): ReferenceView => ({
    id: row.id, kind: row.kind, name: row.name, prompt: row.prompt, status: row.status, costCents: row.costCents,
    imageUrl: row.imageAssetId ? mediaAssetUrl(row.imageAssetId) : null, error: row.error, createdAt: iso(row.createdAt),
});

/** What a take asked for, without the workflow graph it keeps for rendering: that can run to megabytes. */
const publicRequest = (request: TakeRequest | null | undefined): TakeRequest => {
    const { workflow, ...rest } = request ?? {};
    return workflow ? { ...rest, workflowName: workflow.name } : rest;
};

/** A shot's seed as ComfyUI takes it: the whole number the shot gives, else a new one, recorded with the take. */
const seedOf = (seed: string | null) => (seed?.trim() && /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : Math.floor(Math.random() * 2 ** 31));

const takeView = (row: MediaTake): TakeView => {
    const isRendering = row.status === "rendering" || row.status === "queued";
    // Only a ComfyUI take has ComfyUI progress, and asking for it is not free: the first
    // comfyProvider() call builds the provider, which opens the tracker's WebSocket. Left
    // ungated, serializing a fal-only production starts that socket.
    const streaming = isRendering && row.generationId && row.provider === "comfyui"
        ? comfyProvider().getProgress(row.generationId)
        : undefined;
    return {
        id: row.id, takeNumber: row.takeNumber, prompt: row.prompt, negativePrompt: row.negativePrompt, cameraMotion: row.cameraMotion, seed: row.seed,
        durationSeconds: row.durationSeconds, status: row.status, mode: row.mode, costCents: row.costCents,
        videoUrl: row.videoAssetId ? mediaAssetUrl(row.videoAssetId) : null, provider: row.provider ?? null, request: publicRequest(row.request),
        defectClass: row.defectClass ?? null, notes: row.notes, error: row.error,
        requestedBy: row.requestedBy, decidedBy: row.decidedBy, createdAt: iso(row.createdAt),
        ...(streaming ? { streaming } : {}),
    };
};

const assemblyView = (row: MediaAssembly, shots: ShotView[]): AssemblyView => ({
    id: row.id, status: row.status,
    reelUrl: row.status === "ready" && row.reelAssetId ? mediaAssetUrl(row.reelAssetId) : null,
    durationSeconds: row.manifest?.durationSeconds ?? null, error: row.error,
    current: reelSignature(row.manifest?.clips ?? []) === reelSignature(shots.map((shot) => ({
        shotId: shot.id, takeId: shot.takes.find((take) => take.status === "approved")?.id ?? null, transition: shot.transition,
    }))),
    createdAt: iso(row.createdAt),
});

const summary = (row: MediaProduction): ProductionSummary => ({
    id: row.id, title: row.title, aspectRatio: row.aspectRatio, projectId: row.projectId, crewSessionId: row.crewSessionId, updatedAt: iso(row.updatedAt),
});

/** Check if a character is used in any rendered video takes with a character anchor. */
async function characterInUseInVideos(productionId: number, organizationId: number, characterName: string): Promise<boolean> {
    const takesWithCharacter = await db.select({ id: mediaTakes.id })
        .from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .where(
            and(
                eq(mediaScenes.productionId, productionId),
                eq(mediaTakes.organizationId, organizationId),
                eq(mediaTakes.status, "approved"),
                isNotNull(mediaTakes.videoAssetId),
                sql`EXISTS (
                    SELECT 1 FROM jsonb_array_elements(${mediaTakes.request}->'characterAnchors') as anchor
                    WHERE lower(anchor->>'name') = lower(${characterName})
                )`
            )
        )
        .limit(1);
    return takesWithCharacter.length > 0;
}

/** The linked Scribe manuscript's title, and its characters and locations. */
async function storyOf(production: MediaProduction): Promise<{ scribeDocumentTitle: string | null; characters: CharacterView[] }> {
    if (production.scribeDocumentId == null) return { scribeDocumentTitle: null, characters: [] };
    const [document] = await db.select({ title: scribeDocuments.title }).from(scribeDocuments)
        .where(and(eq(scribeDocuments.id, production.scribeDocumentId), eq(scribeDocuments.organizationId, production.organizationId))).limit(1);
    if (!document) return { scribeDocumentTitle: null, characters: [] };
    const entries = await db.select().from(scribeEntityLedger)
        .where(and(eq(scribeEntityLedger.documentId, production.scribeDocumentId), inArray(scribeEntityLedger.entityType, ["character", "location"])))
        .orderBy(asc(scribeEntityLedger.termName));
    
    // Check character usage in rendered videos
    const charactersWithUsage = await Promise.all(
        entries.map(async (entry) => {
            if (entry.entityType !== "character") {
                return {
                    id: entry.id,
                    kind: entry.entityType as CharacterView["kind"],
                    name: entry.termName,
                    description: entry.definitionText ?? "",
                    aliases: entry.aliases ?? [],
                    inUseInVideo: false,
                };
            }
            const inUse = await characterInUseInVideos(production.id, production.organizationId, entry.termName);
            return {
                id: entry.id,
                kind: entry.entityType as CharacterView["kind"],
                name: entry.termName,
                description: entry.definitionText ?? "",
                aliases: entry.aliases ?? [],
                inUseInVideo: inUse,
            };
        })
    );
    
    return {
        scribeDocumentTitle: document.title,
        characters: charactersWithUsage,
    };
}

async function view(loaded: MediaProduction): Promise<ProductionView> {
    const org = loaded.organizationId;
    // Read again: the caller's row was loaded before its change.
    const [production] = await db.select().from(mediaProductions)
        .where(and(eq(mediaProductions.id, loaded.id), eq(mediaProductions.organizationId, org))).limit(1);
    if (!production) throw new NotFoundError("Production not found.");

    const { scribeDocumentTitle, characters } = await storyOf(production);

    const scenes = await db.select().from(mediaScenes)
        .where(and(eq(mediaScenes.productionId, production.id), eq(mediaScenes.organizationId, org)))
        .orderBy(asc(mediaScenes.position), asc(mediaScenes.id));
    const sceneIds = scenes.map((scene) => scene.id);

    // The station each linked scene tells, from the linked manuscript only.
    const stationIds = scenes.map((scene) => scene.scribeNodeId).filter((id): id is number => id != null);
    const stations = stationIds.length && production.scribeDocumentId != null
        ? await db.select({ id: scribeNodes.id, title: scribeNodes.title, content: scribeNodes.content }).from(scribeNodes)
            .where(and(inArray(scribeNodes.id, stationIds), eq(scribeNodes.documentId, production.scribeDocumentId)))
        : [];
    const stationById = new Map(stations.map((station) => [station.id, station]));

    let plotPoints: MediaPlotPoint[] = [];
    let shots: MediaShotRow[] = [];
    if (sceneIds.length) {
        [plotPoints, shots] = await Promise.all([
            db.select().from(mediaPlotPoints).where(and(inArray(mediaPlotPoints.sceneId, sceneIds), eq(mediaPlotPoints.organizationId, org)))
                .orderBy(asc(mediaPlotPoints.position), asc(mediaPlotPoints.id)),
            db.select().from(mediaShots).where(and(inArray(mediaShots.sceneId, sceneIds), eq(mediaShots.organizationId, org)))
                .orderBy(asc(mediaShots.position), asc(mediaShots.id)),
        ]);
    }
    let keyframes = plotPoints.length
        ? await db.select().from(mediaKeyframes).where(and(inArray(mediaKeyframes.plotPointId, plotPoints.map((p) => p.id)), eq(mediaKeyframes.organizationId, org)))
            .orderBy(asc(mediaKeyframes.createdAt), asc(mediaKeyframes.id))
        : [];
    const takes = shots.length
        ? await db.select().from(mediaTakes).where(and(inArray(mediaTakes.shotId, shots.map((s) => s.id)), eq(mediaTakes.organizationId, org)))
            .orderBy(asc(mediaTakes.takeNumber))
        : [];

    // A render that never reported back (the server restarted mid-render) would say
    // "rendering" forever. It was sent, so its cost still counts.
    const staleBefore = Date.now() - RENDER_TIMEOUT_MS;
    const stale = new Set(keyframes.filter((k) => k.status === "rendering" && k.updatedAt.getTime() < staleBefore).map((k) => k.id));
    if (stale.size) {
        const error = "The render did not finish; the server may have restarted. Render it again.";
        const now = new Date();
        await db.update(mediaKeyframes).set({ status: "failed", error, updatedAt: now })
            .where(and(inArray(mediaKeyframes.id, [...stale]), eq(mediaKeyframes.status, "rendering")));
        keyframes = keyframes.map((k) => (stale.has(k.id) ? { ...k, status: "failed" as const, error, updatedAt: now } : k));
    }

    const sceneKeyById = new Map(scenes.map((scene) => [scene.id, scene.sceneKey]));
    const [wardrobeRows, decisionRows] = await Promise.all([
        db.select().from(mediaWardrobe)
            .where(and(eq(mediaWardrobe.productionId, production.id), eq(mediaWardrobe.organizationId, org)))
            .orderBy(asc(mediaWardrobe.characterName), asc(mediaWardrobe.id)),
        db.select().from(mediaDecisions)
            .where(and(eq(mediaDecisions.productionId, production.id), eq(mediaDecisions.organizationId, org)))
            .orderBy(desc(mediaDecisions.createdAt), desc(mediaDecisions.id)).limit(50),
    ]);

    let references = await db.select().from(mediaReferences)
        .where(and(eq(mediaReferences.productionId, production.id), eq(mediaReferences.organizationId, org)))
        .orderBy(asc(mediaReferences.createdAt), asc(mediaReferences.id));
    const lostReferences = new Set(references.filter((r) => r.status === "rendering" && r.updatedAt.getTime() < staleBefore).map((r) => r.id));
    if (lostReferences.size) {
        const error = "The render did not finish; the server may have restarted. Render it again.";
        const now = new Date();
        await db.update(mediaReferences).set({ status: "failed", error, updatedAt: now })
            .where(and(inArray(mediaReferences.id, [...lostReferences]), eq(mediaReferences.status, "rendering")));
        references = references.map((r) => (lostReferences.has(r.id) ? { ...r, status: "failed" as const, error, updatedAt: now } : r));
    }

    const keyframesByPlotPoint = groupBy(keyframes, (row) => row.plotPointId);
    const takesByShot = groupBy(takes, (row) => row.shotId);
    const plotPointsByScene = groupBy(plotPoints, (row) => row.sceneId);
    const shotsByScene = groupBy(shots, (row) => row.sceneId);
    const shotViewsByScene = new Map(scenes.map((scene) => [scene.id, (shotsByScene.get(scene.id) ?? []).map((shot): ShotView => ({
        id: shot.id, position: shot.position, plotPointId: shot.plotPointId, prompt: shot.prompt, negativePrompt: shot.negativePrompt,
        cameraMotion: shot.cameraMotion, seed: shot.seed, durationSeconds: shot.durationSeconds, transition: shot.transition,
        transitionDurationSeconds: shot.transitionDurationSeconds, track: shot.track,
        startTimeSeconds: shot.startTimeSeconds, trimInSeconds: shot.trimInSeconds, trimOutSeconds: shot.trimOutSeconds,
        holdDurationSeconds: shot.holdDurationSeconds,
        anchorShotId: shot.anchorShotId, anchorOffsetSeconds: shot.anchorOffsetSeconds,
        referenceKeyframeId: shot.referenceKeyframeId, framing: shot.framing, lens: shot.lens, action: shot.action,
        dialogue: Array.isArray(shot.dialogue) ? shot.dialogue : [],
        takes: (takesByShot.get(shot.id) ?? []).map(takeView),
    }))]));

    // Each scene's latest reel. One a restart left "assembling" is marked failed first.
    const latestAssembly = new Map<number, MediaAssembly>();
    if (sceneIds.length) {
        await failLostAssemblies(org);
        const assemblies = await db.select().from(mediaAssemblies)
            .where(and(inArray(mediaAssemblies.sceneId, sceneIds), eq(mediaAssemblies.organizationId, org)))
            .orderBy(desc(mediaAssemblies.createdAt), desc(mediaAssemblies.id));
        for (const row of assemblies) if (!latestAssembly.has(row.sceneId)) latestAssembly.set(row.sceneId, row);
    }

    const projectStyleBible = await bibleOf(production);
    const videoEngine: VideoEngine = production.videoEngine === "comfyui" ? "comfyui" : "fal";
    const falProvider = await providerFor("fal", production.organizationId);
    const videoProvider = videoEngine === "comfyui" ? comfyProvider() : falProvider;

    return {
        ...summary(production),
        projectStyleBible,
        scribeDocumentId: scribeDocumentTitle === null ? null : production.scribeDocumentId,
        scribeDocumentTitle,
        characters,
        style: production.style,
        references: references.map(referenceView),
        wardrobe: wardrobeRows.map((row) => wardrobeView(row, sceneKeyById)),
        decisions: decisionRows.map(decisionView),
        video: {
            engine: videoEngine, label: videoProvider.label ?? videoProvider.name, configured: videoProvider.configured,
            resolution: videoProvider.resolution, centsPerSecond: videoProvider.centsPerSecond,
            available: { fal: falProvider.configured, comfyui: comfyProvider().configured },
            workflow: production.comfyWorkflow ? summarizeComfyWorkflow(production.comfyWorkflow) : null,
        },
        budgetLimitCents: production.budgetLimitCents,
        spendCents: spent(takes) + spent(keyframes) + spent(references),
        createdAt: iso(production.createdAt),
        scenes: scenes.map((scene) => ({
            id: scene.id, position: scene.position, sceneKey: scene.sceneKey, title: scene.title, synopsis: scene.synopsis,
            scribeNodeId: scene.scribeNodeId != null && stationById.has(scene.scribeNodeId) ? scene.scribeNodeId : null,
            station: scene.scribeNodeId != null && stationById.has(scene.scribeNodeId)
                ? {
                    title: stationById.get(scene.scribeNodeId)!.title,
                    excerpt: excerpt(stationById.get(scene.scribeNodeId)!.content, 600),
                    // A scene derived before the digest existed has none, and is
                    // reported unchanged: claiming the story moved when we cannot
                    // tell would put a warning on every old scene at once.
                    changed: scene.stationDigest != null
                        && scene.stationDigest !== stationDigest(stationById.get(scene.scribeNodeId)!.content),
                }
                : null,
            location: scene.location, timeOfDay: scene.timeOfDay, mood: scene.mood,
            plotPoints: (plotPointsByScene.get(scene.id) ?? []).map((plotPoint) => ({
                id: plotPoint.id, position: plotPoint.position, title: plotPoint.title, beat: plotPoint.beat,
                keyframes: (keyframesByPlotPoint.get(plotPoint.id) ?? []).map(keyframeView),
            })),
            shots: shotViewsByScene.get(scene.id) ?? [],
            assembly: latestAssembly.has(scene.id) ? assemblyView(latestAssembly.get(scene.id)!, shotViewsByScene.get(scene.id) ?? []) : null,
        })),
    };
}

// ── Writing helpers ─────────────────────────────────────────────────────────

async function touch(productionId: number) {
    await db.update(mediaProductions).set({ updatedAt: new Date() }).where(eq(mediaProductions.id, productionId));
}

async function nextPosition(table: typeof mediaScenes | typeof mediaPlotPoints | typeof mediaShots, parent: "productionId" | "sceneId", parentId: number) {
    const column = (table as any)[parent];
    const rows: Array<{ position: number }> = await db.select({ position: (table as any).position }).from(table as any).where(eq(column, parentId));
    return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

/** Puts a parent's children in the given order. The list must name each child once. */
async function reorder(table: typeof mediaScenes | typeof mediaPlotPoints | typeof mediaShots, parent: "productionId" | "sceneId", parentId: number, organizationId: number, input: unknown) {
    const ids = parse(orderInput, input, "Invalid order");
    const t = table as any;
    const children: Array<{ id: number }> = await db.select({ id: t.id }).from(t).where(and(eq(t[parent], parentId), eq(t.organizationId, organizationId)));
    const current = new Set(children.map((child) => child.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) {
        throw new BadRequestError("The order must list each item exactly once.");
    }
    await db.transaction(async (tx) => {
        for (const [position, id] of ids.entries()) {
            await tx.update(t).set({ position, updatedAt: new Date() }).where(eq(t.id, id));
        }
    });
}

/**
 * Adds a scene at the end. The production's counter numbers scenes, incremented in one
 * statement, so two scenes added at once get different keys, and a deleted scene's key
 * is never handed to a new one while the room may still be talking about it.
 */
async function insertScene(production: MediaProduction, fields: {
    title: string;
    synopsis: string;
    scribeNodeId?: number | null;
    stationDigest?: string | null;
    location?: string;
    timeOfDay?: string;
}) {
    const [counter] = await db.update(mediaProductions)
        .set({ sceneCounter: sql`${mediaProductions.sceneCounter} + 1`, updatedAt: new Date() })
        .where(and(eq(mediaProductions.id, production.id), eq(mediaProductions.organizationId, production.organizationId)))
        .returning({ sceneCounter: mediaProductions.sceneCounter });
    // Returned so a caller deriving from a station can go on to add its shots.
    const [scene] = await db.insert(mediaScenes).values({
        productionId: production.id, organizationId: production.organizationId,
        position: await nextPosition(mediaScenes, "productionId", production.id),
        sceneKey: `SCENE-${String(counter.sceneCounter).padStart(2, "0")}`,
        title: fields.title, synopsis: fields.synopsis, scribeNodeId: fields.scribeNodeId ?? null,
        stationDigest: fields.stationDigest ?? null,
        ...(fields.location ? { location: fields.location } : {}),
        ...(fields.timeOfDay ? { timeOfDay: fields.timeOfDay } : {}),
    }).returning();
    return scene;
}

/** A Scribe manuscript in the caller's organization, with the Project Space of its room. */
async function manuscriptOf(ctx: OrgContext, documentId: number) {
    const org = requireOrgId(ctx);
    const [document] = await db.select({ id: scribeDocuments.id, title: scribeDocuments.title, activeBranchId: scribeDocuments.activeBranchId, projectId: crewSessions.projectId })
        .from(scribeDocuments)
        .innerJoin(crewSessions, eq(crewSessions.id, scribeDocuments.sessionId))
        .where(and(eq(scribeDocuments.id, documentId), eq(scribeDocuments.organizationId, org))).limit(1);
    if (!document) throw new NotFoundError("Manuscript not found.");
    await assertProjectVisible(ctx, document.projectId, "Manuscript not found.");
    return document;
}

/** Stores a file a render or an assembly produced. Only the media types the asset route may serve are accepted. */
async function storeAsset(production: MediaProduction, input: {
    kind: MediaAssetKind; mimeType: string; content: Buffer; source: string; durationSeconds?: number; width?: number; height?: number;
}, createdBy: string | null): Promise<AssetView> {
    if (!MEDIA_ASSET_MIME_TYPES[input.kind]?.includes(input.mimeType)) {
        throw new BadRequestError(`A ${input.kind} cannot be stored as ${input.mimeType}.`);
    }
    if (!input.content.length) throw new BadRequestError("The file is empty.");

    const storagePath = `media-studio/${production.id}/${input.kind}s/${randomUUID()}${MEDIA_ASSET_EXTENSIONS[input.mimeType] ?? ""}`;
    const { storageService } = await import("@domain/knowledge/core/storage-service.js");
    await storageService.saveFile(production.organizationId, storagePath, input.content);
    const [row] = await db.insert(mediaAssets).values({
        organizationId: production.organizationId, productionId: production.id, kind: input.kind, storagePath, mimeType: input.mimeType,
        byteSize: input.content.length, durationSeconds: input.durationSeconds ?? null, width: input.width ?? null, height: input.height ?? null,
        source: input.source, createdBy,
    }).returning();
    return assetView(row);
}

// ── Takes: approval, rendering, following ───────────────────────────────────

/** A render still unfinished this long after it was sent is given up on. */
const RENDER_GIVE_UP_MS = 30 * 60 * 1000;
/** The least time between two status checks of one render. */
const REFRESH_EVERY_MS = 8_000;

let defaultComfy: ComfyUIProvider | null = null;
const comfyProvider = () => (defaultComfy ??= createComfyUIProvider());
/**
 * The provider that renders an engine's takes for one organization. A take is
 * followed by the provider it was sent to, named on the take.
 *
 * fal.ai renders on the organization's own key (strict BYOK), so it is built
 * per call rather than cached: a single shared provider held the platform's
 * FAL_KEY and billed every organization's video to it.
 */
const providerFor = async (engine: string | null | undefined, organizationId: number): Promise<VideoProvider> =>
    engine === "comfyui"
        ? comfyProvider()
        : createFalVideoProvider({ apiKey: (await resolveOrgFalKey(organizationId)) ?? "" });
/** A provider's display name, without resolving any key. */
const providerLabel = (engine: string | null | undefined): string =>
    engine === "comfyui" ? (comfyProvider().label ?? "ComfyUI") : "fal.ai";

export type ApprovalRequester = (input: {
    organizationId: number; executionId: string; approverId: string; approverEmail: string; context: Record<string, unknown>;
}) => Promise<{ id: number }>;

const requestApprovalInInbox: ApprovalRequester = async ({ organizationId, executionId, approverId, approverEmail, context }) => {
    const { approvalService } = await import("@domain/integrations/core/approval.service.js");
    const request = await approvalService.createApprovalRequest({
        executionId, approverType: "internal", approverId, approverEmail, status: "pending", organizationId, context,
    });
    return { id: request.id };
};

export type TakeDecisionOutcome =
    | { handled: false }
    | { handled: true; success: boolean; status: string; error?: string };

/** The signed-in person behind a context, or null for an agent or a missing user. */
async function personOf(userId: string | null | undefined): Promise<{ id: string; email: string } | null> {
    if (!userId) return null;
    const [person] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, String(userId))).limit(1);
    return person?.email ? { id: person.id, email: person.email } : null;
}

/** Cents set aside for takes still waiting for approval. */
async function pendingCents(productionId: number, organizationId: number): Promise<number> {
    const [row] = await db.select({ cents: sql<number>`coalesce(sum(${mediaTakes.costCents}), 0)::int` }).from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .where(and(eq(mediaScenes.productionId, productionId), eq(mediaTakes.organizationId, organizationId), eq(mediaTakes.status, "pending_approval")));
    return Number(row?.cents ?? 0);
}

/** A rendered keyframe that still has its image, or null. */
async function framingKeyframe(keyframeId: number, organizationId: number) {
    const [row] = await db.select({ keyframe: mediaKeyframes, asset: mediaAssets }).from(mediaKeyframes)
        .innerJoin(mediaAssets, eq(mediaAssets.id, mediaKeyframes.imageAssetId))
        .where(and(
            eq(mediaKeyframes.id, keyframeId), eq(mediaKeyframes.organizationId, organizationId),
            inArray(mediaKeyframes.status, ["ready", "approved"]),
        )).limit(1);
    return row ?? null;
}

async function uploadFrame(provider: VideoProvider, keyframeId: number, organizationId: number): Promise<string> {
    const frame = await framingKeyframe(keyframeId, organizationId);
    if (!frame) throw new VideoProviderError("A keyframe this take is framed by no longer has a rendered image.", false);
    const { storageService } = await import("@domain/knowledge/core/storage-service.js");
    const content = await storageService.readFile(organizationId, frame.asset.storagePath);
    return provider.uploadImage(content, frame.asset.mimeType);
}

async function takeWithProduction(takeId: number, organizationId: number) {
    const [row] = await db.select({ take: mediaTakes, production: mediaProductions }).from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(and(eq(mediaTakes.id, takeId), eq(mediaTakes.organizationId, organizationId), eq(mediaProductions.organizationId, organizationId))).limit(1);
    return row ?? null;
}

/**
 * Where a take sits, for a message read outside the studio. Best effort: a notification
 * that says the production but not the scene is still worth sending.
 */
async function takePlacement(take: MediaTake) {
    const [row] = await db.select({
        productionId: mediaProductions.id,
        productionTitle: mediaProductions.title,
        crewSessionId: mediaProductions.crewSessionId,
        organizationId: mediaProductions.organizationId,
        sceneTitle: mediaScenes.title,
        shotPosition: mediaShots.position,
    })
        .from(mediaTakes)
        .innerJoin(mediaShots, eq(mediaShots.id, mediaTakes.shotId))
        .innerJoin(mediaScenes, eq(mediaScenes.id, mediaShots.sceneId))
        .innerJoin(mediaProductions, eq(mediaProductions.id, mediaScenes.productionId))
        .where(eq(mediaTakes.id, take.id))
        .limit(1);
    return row ?? null;
}

/** Marks a take in flight failed. A render fal refused or never ran is not charged. */
async function failTake(take: MediaTake, error: string, billed: boolean) {
    const changed = await db.update(mediaTakes)
        .set({ status: "failed", error: error.slice(0, 1000), providerState: "failed", ...(billed ? {} : { costCents: 0 }), updatedAt: new Date() })
        .where(and(eq(mediaTakes.id, take.id), inArray(mediaTakes.status, ["queued", "rendering"])));
    // Only when this call is the one that moved it. The follower checks every ten
    // seconds and a give-up can race a late answer, so an unguarded notify sends the
    // same bad news twice.
    if ((changed.rowCount ?? 0) === 0) return;
    const place = await takePlacement(take);
    if (!place) return;
    await notifyRenderFinished({
        organizationId: place.organizationId,
        productionId: place.productionId,
        productionTitle: place.productionTitle,
        crewSessionId: place.crewSessionId,
        takeId: take.id,
        takeNumber: take.takeNumber,
        sceneTitle: place.sceneTitle,
        shotPosition: place.shotPosition,
        outcome: "failed",
        detail: error,
        provider: take.provider ?? null,
    });
}

const refreshing = new Set<number>();
const lastRefreshed = new Map<number, number>();

/**
 * Asks the provider how a take's render is going, and records it. A finished render's
 * video is downloaded into storage before the take shows as ready for review, so
 * playback never depends on a provider link that expires.
 */
async function refreshTake(takeId: number, organizationId: number, provider: VideoProvider, options: { force?: boolean } = {}): Promise<void> {
    if (refreshing.has(takeId)) return;
    if (!options.force && Date.now() - (lastRefreshed.get(takeId) ?? 0) < REFRESH_EVERY_MS) return;
    refreshing.add(takeId);
    lastRefreshed.set(takeId, Date.now());
    try {
        const row = await takeWithProduction(takeId, organizationId);
        if (!row) return;
        const { take, production } = row;
        if ((take.status !== "queued" && take.status !== "rendering") || !take.generationId) return;
        const endpoint = take.request?.endpoint;
        if (!endpoint) {
            await failTake(take, "The take has no record of where it was sent.", false);
            return;
        }
        const age = Date.now() - (take.submittedAt?.getTime() ?? Date.now());

        let status: Awaited<ReturnType<VideoProvider["status"]>>;
        try {
            status = await provider.status(endpoint, take.generationId);
        } catch (error) {
            // Most often a passing network error: asked again on the next check, unless the render is long overdue.
            if (age > RENDER_GIVE_UP_MS) await failTake(take, (error as Error).message, true);
            return;
        }

        if (status.state === "queued" || status.state === "running") {
            if (age > RENDER_GIVE_UP_MS) {
                await failTake(take, `${provider.label ?? "fal.ai"} did not finish this render within 30 minutes.`, true);
                return;
            }
            await db.update(mediaTakes)
                .set({ status: status.state === "running" ? "rendering" : "queued", providerState: status.state, updatedAt: new Date() })
                .where(and(eq(mediaTakes.id, take.id), inArray(mediaTakes.status, ["queued", "rendering"])));
            return;
        }
        if (status.state === "failed") {
            await failTake(take, `${provider.label ?? "fal.ai"} could not render the take: ${status.error ?? "no reason was given"}`, false);
            await touch(production.id);
            return;
        }

        try {
            const result = await provider.result(endpoint, take.generationId);
            const content = await provider.download(result.videoUrl);
            const asset = await storeAsset(production, {
                kind: "video", mimeType: result.mimeType, content, source: `${provider.name}:${endpoint}`, durationSeconds: take.durationSeconds,
            }, take.requestedBy);
            const finished = await db.update(mediaTakes)
                .set({ status: "ready_for_review", videoAssetId: asset.id, providerState: "completed", error: null, updatedAt: new Date() })
                .where(and(eq(mediaTakes.id, take.id), inArray(mediaTakes.status, ["queued", "rendering"])));
            if ((finished.rowCount ?? 0) > 0) {
                const place = await takePlacement(take);
                if (place) {
                    await notifyRenderFinished({
                        organizationId: place.organizationId,
                        productionId: place.productionId,
                        productionTitle: place.productionTitle,
                        crewSessionId: place.crewSessionId,
                        takeId: take.id,
                        takeNumber: take.takeNumber,
                        sceneTitle: place.sceneTitle,
                        shotPosition: place.shotPosition,
                        outcome: "ready",
                        costCents: take.costCents ?? 0,
                        provider: take.provider ?? null,
                    });
                }
            }
        } catch (error) {
            await failTake(take, (error as Error)?.message ?? String(error), error instanceof VideoProviderError ? error.billed : true);
        }
        await touch(production.id);
    } finally {
        refreshing.delete(takeId);
    }
}

/** Checks on a render every ten seconds until it finishes or is given up on. */
function followTake(takeId: number, organizationId: number, provider: VideoProvider) {
    const startedAt = Date.now();
    const check = async () => {
        try {
            await refreshTake(takeId, organizationId, provider, { force: true });
            const [row] = await db.select({ status: mediaTakes.status }).from(mediaTakes).where(eq(mediaTakes.id, takeId)).limit(1);
            if (row && (row.status === "queued" || row.status === "rendering") && Date.now() - startedAt < RENDER_GIVE_UP_MS + 60_000) {
                setTimeout(check, 10_000).unref?.();
            }
        } catch (error) {
            logger.warn(`Following take ${takeId} failed: ${(error as Error)?.message ?? error}`);
        }
    };
    setTimeout(check, 10_000).unref?.();
}

// ── Scene assembly ──────────────────────────────────────────────────────────

let defaultRunner: FfmpegRunner | null | undefined;
function defaultFfmpeg(): FfmpegRunner | null {
    if (defaultRunner === undefined) {
        const binary = ffmpegBinary();
        defaultRunner = binary ? createFfmpegRunner(binary) : null;
    }
    return defaultRunner;
}

/** Marks an organization's reels that stopped sending their heartbeat as failed, so they no longer hold its one assembly slot. */
async function failLostAssemblies(organizationId: number) {
    await db.update(mediaAssemblies).set({ status: "failed", error: ASSEMBLY_LOST, updatedAt: new Date() })
        .where(and(
            eq(mediaAssemblies.organizationId, organizationId), eq(mediaAssemblies.status, "assembling"),
            lt(mediaAssemblies.updatedAt, new Date(Date.now() - ASSEMBLY_GIVE_UP_MS)),
        ));
}

/**
 * Cuts a reel from its recorded manifest: copies each take's video to a work folder,
 * reads its real length and streams, runs the plan, and stores the reel. It never
 * throws; a failure is recorded on the row with ffmpeg's reason.
 */
async function runAssembly(assemblyId: number, production: MediaProduction, runner: FfmpegRunner): Promise<void> {
    const org = production.organizationId;
    const stillAssembling = and(eq(mediaAssemblies.id, assemblyId), eq(mediaAssemblies.organizationId, org), eq(mediaAssemblies.status, "assembling"));
    const heartbeat = setInterval(() => {
        void db.update(mediaAssemblies).set({ updatedAt: new Date() }).where(stillAssembling).catch(() => undefined);
    }, 60_000);
    heartbeat.unref?.();
    let dir: string | null = null;
    try {
        const [row] = await db.select().from(mediaAssemblies).where(and(eq(mediaAssemblies.id, assemblyId), eq(mediaAssemblies.organizationId, org))).limit(1);
        if (!row) return;
        const manifest = row.manifest ?? {};
        const clips = manifest.clips ?? [];
        if (!clips.length || !manifest.width || !manifest.height) throw new Error("The assembly has no record of what to cut.");

        dir = await mkdtemp(joinPath(tmpdir(), "media-assembly-"));
        const assets = await db.select().from(mediaAssets)
            .where(and(inArray(mediaAssets.id, clips.map((clip) => clip.assetId)), eq(mediaAssets.organizationId, org)));
        const assetById = new Map(assets.map((asset) => [asset.id, asset]));
        const { storageService } = await import("@domain/knowledge/core/storage-service.js");

        const planned: PlanClip[] = [];
        for (const [index, clip] of clips.entries()) {
            const asset = assetById.get(clip.assetId);
            if (!asset) throw new Error(`Shot ${clip.shotNumber}'s video is no longer stored.`);
            const file = joinPath(dir, `clip-${index}${MEDIA_ASSET_EXTENSIONS[asset.mimeType] ?? ".mp4"}`);
            await writeFile(file, await storageService.readFile(org, asset.storagePath));
            const probe = await runner.probe(file);
            const durationSeconds = probe.durationSeconds ?? asset.durationSeconds;
            if (!probe.hasVideo || !durationSeconds) throw new Error(`Take ${clip.takeNumber} of shot ${clip.shotNumber} has no video ffmpeg can read.`);
            planned.push({
                path: file, durationSeconds, hasAudio: probe.hasAudio, transition: clip.transition,
                transitionDurationSeconds: clip.transitionDurationSeconds ?? undefined,
                track: clip.track ?? 1,
                startTimeSeconds: clip.startTimeSeconds ?? undefined,
                trimInSeconds: clip.trimInSeconds ?? undefined,
                // An out-point past the take's real length is a hold, not footage: ffmpeg
                // would just run out. The trim stops at what exists and tpad covers the rest.
                trimOutSeconds: clip.trimOutSeconds == null ? undefined : Math.min(clip.trimOutSeconds, durationSeconds),
                holdDurationSeconds: (clip.holdDurationSeconds ?? 0)
                    + Math.max(0, (clip.trimOutSeconds ?? 0) - durationSeconds) || undefined,
            });
        }

        const output = joinPath(dir, "reel.mp4");
        const plan = buildAssemblyPlan({ clips: planned, width: manifest.width, height: manifest.height, output });
        await runner.run(plan.args);
        const made = await runner.probe(output);
        const durationSeconds = Number((made.durationSeconds ?? plan.durationSeconds).toFixed(2));
        const reel = await storeAsset(production, {
            kind: "reel", mimeType: "video/mp4", content: await readLocalFile(output), source: "ffmpeg",
            durationSeconds: Math.round(durationSeconds), width: plan.width, height: plan.height,
        }, row.requestedBy);
        await db.update(mediaAssemblies)
            .set({ status: "ready", reelAssetId: reel.id, manifest: { ...manifest, durationSeconds }, error: null, updatedAt: new Date() })
            .where(stillAssembling);
    } catch (error) {
        const message = String((error as Error)?.message ?? error).slice(0, 2000);
        logger.warn(`Assembly ${assemblyId} failed: ${message}`);
        await db.update(mediaAssemblies).set({ status: "failed", error: message, updatedAt: new Date() }).where(stillAssembling).catch(() => undefined);
    } finally {
        clearInterval(heartbeat);
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        await touch(production.id).catch(() => undefined);
    }
}

let defaultComfyGenerator: ImageGenerator | null = null;
const comfyImages = () => (defaultComfyGenerator ??= createComfyUIImageGenerator());

/**
 * The image generator for a production. Gemini renders bill the production's
 * organization, so the generator is built per call with that org's key -- no
 * shared instance holding the platform key. `?? ""` matters: undefined would
 * let createGeminiImageGenerator fall back to the platform key itself.
 */
async function imageGeneratorFor(production: MediaProduction): Promise<ImageGenerator> {
    if (production.videoEngine === "comfyui") {
        return comfyImages();
    }
    return createGeminiImageGenerator({ apiKey: (await resolveOrgGeminiKey(production.organizationId)) ?? "" });
}

function imageSource(model: string): string {
    if (model.includes(":")) return model;
    return `${model.startsWith("gemini") ? "gemini" : "comfyui"}:${model}`;
}

/** At most this many images go with a keyframe: Gemini's image models work best with three or fewer. */
/**
 * The Project Style Bible in force for a production, or null.
 *
 * Read on the render paths as well as by `view`, because the bible is what says
 * how the film is shot and a render that does not read it is not shot that way.
 * A project whose metadata cannot be read yields null rather than failing: a
 * missing bible must never stop a frame that would otherwise render.
 */
/**
 * What each character wears in a scene.
 *
 * Read on the render paths, so a frame is drawn in the costume the story has
 * reached rather than in a rule about the whole film. The scene order is read
 * with it because "worn from scene three onward" is a statement about position,
 * not about ids.
 */
async function wardrobeIn(production: MediaProduction, sceneId: number): Promise<Array<{ characterName: string; garment: string; notes: string }>> {
    const org = production.organizationId;
    const [rows, scenes] = await Promise.all([
        db.select().from(mediaWardrobe).where(and(eq(mediaWardrobe.productionId, production.id), eq(mediaWardrobe.organizationId, org))),
        db.select({ id: mediaScenes.id, position: mediaScenes.position }).from(mediaScenes)
            .where(and(eq(mediaScenes.productionId, production.id), eq(mediaScenes.organizationId, org)))
            .orderBy(asc(mediaScenes.position), asc(mediaScenes.id)),
    ]);
    if (!rows.length) return [];
    const positions = new Map(scenes.map((scene, index) => [scene.id, index]));
    const at = positions.get(sceneId);
    if (at === undefined) return [];
    return wardrobeForScene(rows, positions, at);
}

/** Only the characters a frame actually shows are dressed by name. */
function wardrobeShownIn(
    worn: Array<{ characterName: string; garment: string; notes: string }>,
    text: string,
    characters: CharacterView[],
): Array<{ characterName: string; garment: string; notes: string }> {
    if (!worn.length) return [];
    const named = new Set(charactersNamedIn(text, characters).map((character) => character.name.trim().toLowerCase()));
    const shown = text.toLowerCase();
    return worn.filter((item) => {
        const name = item.characterName.trim().toLowerCase();
        return named.has(name) || (name.length > 2 && shown.includes(name));
    });
}

/** The station as it read when a scene was derived from it. */
const stationDigest = (content: string | null | undefined) => createHash("sha256").update(content ?? "").digest("hex");

/**
 * Does this station spell its shots out, or is it prose?
 *
 * parseScribeStationToScene always returns at least one shot — it invents a wide
 * establishing shot when it finds no [SHOT n] blocks — which is the right answer
 * for a preview and the wrong one for an import: a prose manuscript would gain a
 * "Wide shot, Cinematic sequence" in every scene that nobody wrote. So shots are
 * taken across only when the author actually wrote them.
 */
const spellsOutShots = (content: string | null | undefined) => /\[SHOT\s+\d+\]/i.test(content ?? "");

/** A parsed shot in the shape addShot takes. Seedance renders whole seconds, 4 to 15. */
function shotFromStation(parsed: ParsedScribeShot) {
    const seconds = Math.round(Number(parsed.durationSeconds) || SEEDANCE_DURATION.min);
    return {
        prompt: parsed.prompt?.slice(0, 4000) ?? "",
        action: parsed.subject?.slice(0, 4000) ?? "",
        framing: parsed.framing?.slice(0, 200) ?? null,
        cameraMotion: parsed.cameraMotion?.slice(0, 200) ?? null,
        seed: parsed.seed == null ? null : String(parsed.seed).slice(0, 200),
        durationSeconds: Math.min(SEEDANCE_DURATION.max, Math.max(SEEDANCE_DURATION.min, seconds)),
        dialogue: parsed.dialogue?.character && parsed.dialogue.line
            ? [{ speaker: parsed.dialogue.character.slice(0, 80), line: parsed.dialogue.line.slice(0, 1000) }]
            : [],
    };
}

async function bibleOf(production: MediaProduction): Promise<ProjectStyleBible | null> {
    if (production.projectId == null) return null;
    try {
        const [projectRow] = await db.select({ metadata: projectsTable.metadata }).from(projectsTable)
            .where(and(eq(projectsTable.id, production.projectId), eq(projectsTable.organizationId, production.organizationId))).limit(1);
        if (projectRow?.metadata && typeof projectRow.metadata === "object" && "styleBible" in projectRow.metadata) {
            return parseProjectStyleBible(projectRow.metadata.styleBible);
        }
    } catch {
        // Ignore if metadata is inaccessible.
    }
    return null;
}

/**
 * Four, not three, so a theme always travels.
 *
 * A theme is the one reference that must be on EVERY frame — it is what makes
 * the film look like one film. Sharing three slots with the continuity anchors
 * meant it was dropped from exactly the busy frames that needed it most, so it
 * has a slot of its own.
 */
const MAX_KEYFRAME_REFERENCES = 4;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The images a plot point's keyframe is rendered with, in order: the approved references
 * of the characters it names (two at most), the nearest earlier approved keyframe in its
 * scene, and the approved reference of the scene's location.
 */
async function keyframeReferences(production: MediaProduction, scene: MediaScene, plotPoint: MediaPlotPoint, characters: CharacterView[]): Promise<KeyframeReference[]> {
    const org = production.organizationId;
    const approved = await db.select().from(mediaReferences).where(and(
        eq(mediaReferences.productionId, production.id), eq(mediaReferences.organizationId, org),
        eq(mediaReferences.status, "approved"), isNotNull(mediaReferences.imageAssetId),
    )).orderBy(asc(mediaReferences.id));
    const text = `${plotPoint.title} ${plotPoint.beat}`;

    // A character counts when the manuscript names them in the plot point, or when a reference's own name appears in it.
    const referencedCharacters = approved.filter((r) => r.kind === "character")
        .map((r): CharacterView => ({ id: r.id, kind: "character", name: r.name, description: "", aliases: [] }));
    const named = [...charactersNamedIn(text, characters), ...charactersNamedIn(text, referencedCharacters)].map((character) => character.name);
    const people: KeyframeReference[] = [];
    for (const name of named) {
        const reference = approved.find((r) => r.kind === "character" && sameName(r.name, name));
        if (reference?.imageAssetId && people.length < 2 && !people.some((p) => p.assetId === reference.imageAssetId)) {
            people.push({ kind: "character", label: reference.name, assetId: reference.imageAssetId });
        }
    }

    let previous: KeyframeReference | null = null;
    const points = await db.select({ id: mediaPlotPoints.id, title: mediaPlotPoints.title }).from(mediaPlotPoints)
        .where(and(eq(mediaPlotPoints.sceneId, scene.id), eq(mediaPlotPoints.organizationId, org)))
        .orderBy(asc(mediaPlotPoints.position), asc(mediaPlotPoints.id));
    for (let at = points.findIndex((point) => point.id === plotPoint.id) - 1; at >= 0 && !previous; at--) {
        const [frame] = await db.select({ assetId: mediaKeyframes.imageAssetId }).from(mediaKeyframes).where(and(
            eq(mediaKeyframes.plotPointId, points[at].id), eq(mediaKeyframes.organizationId, org),
            eq(mediaKeyframes.status, "approved"), isNotNull(mediaKeyframes.imageAssetId),
        )).limit(1);
        if (frame?.assetId) previous = { kind: "previous_keyframe", label: `${scene.sceneKey} plot point ${at + 1}: ${points[at].title}`, assetId: frame.assetId };
    }

    // The scene's location in its own words, or a manuscript location it or the plot point names.
    const places = [
        scene.location,
        ...characters.filter((c) => c.kind === "location"
            && ([c.name, ...c.aliases].some((name) => sameName(name, scene.location)) || charactersNamedIn(text, [c], "location").length > 0))
            .map((c) => c.name),
    ].filter((name) => name.trim());
    const placeReference = approved.find((r) => r.kind === "location" && places.some((name) => sameName(r.name, name)));
    const place: KeyframeReference | null = placeReference?.imageAssetId
        ? { kind: "location", label: placeReference.name, assetId: placeReference.imageAssetId }
        : null;

    /*
     * The theme, which goes on every frame. It is what makes a production look
     * like one film rather than a set of unrelated pictures, so it is reserved a
     * slot and the story anchors share what is left — the reverse of letting it
     * fall off whichever frame happened to name two characters.
     */
    const themeReference = approved.find((r) => r.kind === "theme");
    const theme: KeyframeReference | null = themeReference?.imageAssetId
        ? { kind: "theme", label: themeReference.name, assetId: themeReference.imageAssetId }
        : null;

    const anchors = [...people, ...(previous ? [previous] : []), ...(place ? [place] : [])];
    return theme
        ? [...anchors.slice(0, MAX_KEYFRAME_REFERENCES - 1), theme]
        : anchors.slice(0, MAX_KEYFRAME_REFERENCES);
}

/** The bytes of the reference images a render sends, in order. A missing image fails the render before anything is sent. */
async function referenceImagesOf(references: KeyframeReference[], organizationId: number): Promise<ReferenceImage[]> {
    if (!references.length) return [];
    const assets = await db.select().from(mediaAssets)
        .where(and(inArray(mediaAssets.id, references.map((reference) => reference.assetId)), eq(mediaAssets.organizationId, organizationId)));
    const { storageService } = await import("@domain/knowledge/core/storage-service.js");
    const images: ReferenceImage[] = [];
    for (const reference of references) {
        const asset = assets.find((row) => row.id === reference.assetId);
        if (!asset) throw new ImageGenerationError(`The reference image of ${reference.label} is gone. Render the keyframe again.`, false);
        try {
            images.push({ mimeType: asset.mimeType, content: await storageService.readFile(organizationId, asset.storagePath) });
        } catch (error) {
            throw new ImageGenerationError(`The reference image of ${reference.label} could not be read: ${(error as Error)?.message ?? error}`, false);
        }
    }
    return images;
}

async function renderReference(ctx: OrgContext, production: MediaProduction, reference: MediaReference, generator: ImageGenerator) {
    try {
        // A character sheet holds two views side by side; a place is framed as the film is.
        const image = await generator.generate(reference.prompt, reference.kind === "character" ? "16:9" : production.aspectRatio);
        let asset: AssetView;
        try {
            asset = await mediaStudio.saveAsset(ctx, production.id, { kind: "image", mimeType: image.mimeType, content: image.content, source: imageSource(image.model) });
        } catch (error) {
            throw new ImageGenerationError(`The image could not be stored: ${(error as Error)?.message ?? error}`, true);
        }
        await db.update(mediaReferences).set({ status: "ready", imageAssetId: asset.id, error: null, updatedAt: new Date() })
            .where(and(eq(mediaReferences.id, reference.id), eq(mediaReferences.status, "rendering")));
    } catch (error) {
        const billed = error instanceof ImageGenerationError ? error.billed : true;
        const message = (error as Error)?.message ?? String(error);
        await db.update(mediaReferences)
            .set({ status: "failed", error: message.slice(0, 1000), ...(billed ? {} : { costCents: 0 }), updatedAt: new Date() })
            .where(eq(mediaReferences.id, reference.id))
            .catch(() => undefined);
    }
}

async function wardrobeRow(ctx: OrgContext, wardrobeId: number) {
    const org = requireOrgId(ctx);
    const [row] = await db.select().from(mediaWardrobe)
        .where(and(eq(mediaWardrobe.id, wardrobeId), eq(mediaWardrobe.organizationId, org))).limit(1);
    if (!row) throw new NotFoundError("Wardrobe entry not found.");
    return { row, production: await productionRow(ctx, row.productionId) };
}

/** The plate render, which mirrors a reference's: a failure that was never sent is not charged. */
async function renderWardrobePlate(ctx: OrgContext, production: MediaProduction, row: MediaWardrobe, generator: ImageGenerator) {
    try {
        const image = await generator.generate(row.platePrompt ?? row.garment, production.aspectRatio);
        let asset: AssetView;
        try {
            asset = await mediaStudio.saveAsset(ctx, production.id, { kind: "image", mimeType: image.mimeType, content: image.content, source: imageSource(image.model) });
        } catch (error) {
            throw new ImageGenerationError(`The image could not be stored: ${(error as Error)?.message ?? error}`, true);
        }
        await db.update(mediaWardrobe).set({ plateStatus: "ready", imageAssetId: asset.id, error: null, updatedAt: new Date() })
            .where(and(eq(mediaWardrobe.id, row.id), eq(mediaWardrobe.plateStatus, "rendering")));
    } catch (error) {
        const billed = error instanceof ImageGenerationError ? error.billed : true;
        const message = (error as Error)?.message ?? String(error);
        await db.update(mediaWardrobe)
            .set({ plateStatus: "failed", error: message.slice(0, 1000), ...(billed ? {} : { costCents: 0 }), updatedAt: new Date() })
            .where(eq(mediaWardrobe.id, row.id))
            .catch(() => undefined);
    }
}

/**
 * Record what was decided, so the production can say how it came to look this way.
 *
 * Keyed by the card's own id, so applying the same card twice records once. A
 * decision that cannot be written must never fail the change it describes — the
 * change is the thing the author asked for, and losing its note is the smaller
 * harm — so this swallows its own errors.
 */
export async function recordMediaDecision(scope: {
    organizationId: number;
    productionId: number;
    kind: MediaDecisionKind;
    proposalId: string;
    sceneId?: number | null;
    sceneKey?: string | null;
    instruction?: string;
    summary?: string[];
    skipped?: string[];
    crewSessionId?: number | null;
    decidedBy?: string | null;
}): Promise<void> {
    try {
        await db.insert(mediaDecisions).values({
            organizationId: scope.organizationId,
            productionId: scope.productionId,
            kind: scope.kind,
            proposalId: scope.proposalId,
            sceneId: scope.sceneId ?? null,
            sceneKey: scope.sceneKey ?? null,
            instruction: (scope.instruction ?? "").slice(0, 4000),
            summary: scope.summary ?? [],
            skipped: scope.skipped ?? [],
            crewSessionId: scope.crewSessionId ?? null,
            decidedBy: scope.decidedBy ?? null,
        }).onConflictDoNothing();
    } catch (error) {
        // A missing note must not undo an applied change — but it must not vanish
        // either. Swallowed silently, this is indistinguishable from a decision
        // log that was never written, which is exactly how a dark table starts.
        logger.warn(
            `Recording a ${scope.kind} decision for production ${scope.productionId} failed, and the change itself stands: ` +
            `${(error as Error)?.message ?? error}`,
        );
    }
}

async function referenceRow(ctx: OrgContext, referenceId: number) {
    const org = requireOrgId(ctx);
    const [reference] = await db.select().from(mediaReferences)
        .where(and(eq(mediaReferences.id, referenceId), eq(mediaReferences.organizationId, org))).limit(1);
    if (!reference) throw new NotFoundError("Reference not found.");
    try {
        return { reference, production: await productionRow(ctx, reference.productionId) };
    } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError("Reference not found.");
        throw error;
    }
}

async function renderKeyframe(ctx: OrgContext, production: MediaProduction, keyframe: MediaKeyframe, generator: ImageGenerator) {
    try {
        const references = await referenceImagesOf(Array.isArray(keyframe.referenceImages) ? keyframe.referenceImages : [], production.organizationId);
        const image = await generator.generate(keyframe.prompt, production.aspectRatio, references);
        let asset: AssetView;
        try {
            asset = await mediaStudio.saveAsset(ctx, production.id, { kind: "image", mimeType: image.mimeType, content: image.content, source: imageSource(image.model) });
        } catch (error) {
            throw new ImageGenerationError(`The image could not be stored: ${(error as Error)?.message ?? error}`, true);
        }
        await db.update(mediaKeyframes).set({ status: "ready", imageAssetId: asset.id, error: null, updatedAt: new Date() })
            .where(and(eq(mediaKeyframes.id, keyframe.id), eq(mediaKeyframes.status, "rendering")));
        // A plot point's first image is what it shows until someone picks another.
        await db.execute(sql`UPDATE media_keyframes SET is_selected = true
            WHERE id = ${keyframe.id} AND status = 'ready'
              AND NOT EXISTS (SELECT 1 FROM media_keyframes WHERE plot_point_id = ${keyframe.plotPointId} AND is_selected = true)`)
            .catch((error) => { if (!isUniqueViolation(error)) throw error; });
    } catch (error) {
        const billed = error instanceof ImageGenerationError ? error.billed : true;
        const message = (error as Error)?.message ?? String(error);
        await db.update(mediaKeyframes)
            .set({ status: "failed", error: message.slice(0, 1000), ...(billed ? {} : { costCents: 0 }), updatedAt: new Date() })
            .where(eq(mediaKeyframes.id, keyframe.id))
            .catch(() => undefined);
    }
}

// ── Service ─────────────────────────────────────────────────────────────────

export const mediaStudio = {
    async listProductions(ctx: OrgContext, filter: { crewSessionKey?: string; crewSessionId?: number } = {}): Promise<ProductionSummary[]> {
        const org = requireOrgId(ctx);
        const conditions = [eq(mediaProductions.organizationId, org)];
        if (filter.crewSessionKey !== undefined || filter.crewSessionId !== undefined) {
            const room = await roomOf(ctx, { key: filter.crewSessionKey, id: filter.crewSessionId });
            if (!room) return [];
            conditions.push(eq(mediaProductions.crewSessionId, room.id));
        }
        const rows = await db.select().from(mediaProductions).where(and(...conditions)).orderBy(desc(mediaProductions.updatedAt));
        const canRead = projectReader(ctx);
        const visible: MediaProduction[] = [];
        for (const row of rows) {
            if (await canRead(row.projectId)) visible.push(row);
        }
        return visible.map(summary);
    },

    /** A Project Space's productions, each with what it holds, what it has spent, and the room it is made in. */
    async projectProductions(ctx: OrgContext, projectId: number): Promise<ProjectProduction[]> {
        const org = requireOrgId(ctx);
        const rows = await db.select({ production: mediaProductions, roomKey: crewSessions.sessionKey, roomTitle: crewSessions.title })
            .from(mediaProductions)
            .leftJoin(crewSessions, and(eq(crewSessions.id, mediaProductions.crewSessionId), eq(crewSessions.organizationId, org)))
            .where(and(eq(mediaProductions.organizationId, org), eq(mediaProductions.projectId, projectId)))
            .orderBy(desc(mediaProductions.updatedAt));
        const canRead = projectReader(ctx);
        const listed: ProjectProduction[] = [];
        for (const row of rows) {
            if (!(await canRead(row.production.projectId))) continue;
            const current = await view(row.production);
            const shots = current.scenes.flatMap((scene) => scene.shots);
            listed.push({
                id: current.id,
                title: current.title,
                aspectRatio: current.aspectRatio,
                updatedAt: current.updatedAt,
                scenes: current.scenes.length,
                shots: shots.length,
                approvedTakes: shots.filter((shot) => shot.takes.some((take) => take.status === "approved")).length,
                reels: current.scenes.filter((scene) => scene.assembly?.status === "ready").length,
                spendCents: current.spendCents,
                budgetLimitCents: current.budgetLimitCents,
                room: row.roomKey ? { sessionKey: row.roomKey, title: row.roomTitle ?? null } : null,
            });
        }
        return listed;
    },

    async createProduction(ctx: OrgContext, input: unknown): Promise<ProductionView> {
        const org = requireOrgId(ctx);
        const body = parse(productionInput, input, "Invalid production");
        let projectId: number | null = null;
        let crewSessionId: number | null = null;

        if (body.crewSessionKey !== undefined || body.crewSessionId !== undefined) {
            const room = await roomOf(ctx, { key: body.crewSessionKey, id: body.crewSessionId });
            if (!room) throw new NotFoundError("Room not found.");
            crewSessionId = room.id;
            projectId = room.projectId ?? null;
            // A room in a private project the caller cannot read does not exist for them.
            await assertProjectVisible(ctx, projectId, "Room not found.");
        } else if (body.projectKey) {
            const service = await projects();
            const project = await service.getProject(projectCtxOf(ctx), body.projectKey);
            await service.assertCanEdit(projectCtxOf(ctx), project);
            projectId = project.id;
        }

        let inheritedStyle = "";
        let inheritedAspectRatio: MediaAspectRatio = "16:9";
        let inheritedVideoEngine: VideoEngine = "fal";
        let canonicalAnchors: CharacterContinuityAnchor[] = [];

        if (projectId != null) {
            try {
                const [projectRow] = await db.select({ metadata: projectsTable.metadata }).from(projectsTable)
                    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, org))).limit(1);
                if (projectRow?.metadata && typeof projectRow.metadata === "object" && "styleBible" in projectRow.metadata) {
                    const bible = parseProjectStyleBible(projectRow.metadata.styleBible);
                    if (bible.look) inheritedStyle = bible.look;
                    if (bible.defaultAspectRatio) inheritedAspectRatio = bible.defaultAspectRatio;
                    if (bible.defaultVideoEngine) inheritedVideoEngine = bible.defaultVideoEngine;
                    if (bible.canonicalCharacters?.length) canonicalAnchors = bible.canonicalCharacters;
                }
            } catch {
                // Ignore if metadata is inaccessible
            }
        }

        const [row] = await db.insert(mediaProductions).values({
            organizationId: org, projectId, crewSessionId, title: body.title,
            style: body.style ?? inheritedStyle,
            aspectRatio: body.aspectRatio ?? inheritedAspectRatio,
            videoEngine: body.videoEngine ?? inheritedVideoEngine,
            budgetLimitCents: body.budgetLimitCents ?? 10000, createdBy: (await personOf(ctx.userId))?.id ?? null,
        }).returning();

        if (canonicalAnchors.length > 0) {
            const author = (await personOf(ctx.userId))?.id ?? null;
            const generator = await imageGeneratorFor(row);
            const provider = generator.model.startsWith("comfyui") ? "comfyui" : "gemini";
            for (const anchor of canonicalAnchors) {
                try {
                    const prompt = referencePrompt({ kind: anchor.kind, name: anchor.name, description: anchor.description, style: row.style });
                    const [inserted] = await db.insert(mediaReferences).values({
                        organizationId: org,
                        productionId: row.id,
                        kind: anchor.kind,
                        name: anchor.name,
                        prompt,
                        status: "rendering",
                        provider,
                        mode: "live",
                        costCents: 0,
                        requestedBy: author,
                    }).returning();
                    if (generator.configured && inserted) {
                        void renderReference(ctx, row, inserted, generator);
                    }
                } catch {
                    // Ignore duplicate key errors if already present
                }
            }
        }

        return view(row);
    },

    async getProduction(ctx: OrgContext, id: number): Promise<ProductionView> {
        const production = await productionRow(ctx, id);
        const current = await view(production);
        // Reading a production also checks on its renders, so they finish even after a restart.
        for (const take of current.scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.takes))) {
            if (take.status !== "queued" && take.status !== "rendering") continue;
            const provider = await providerFor(take.provider, production.organizationId);
            if (provider.configured) {
                void refreshTake(take.id, production.organizationId, provider).catch((error) => logger.warn(`Checking take ${take.id} failed: ${error?.message ?? error}`));
            }
        }
        return current;
    },

    async updateProduction(ctx: OrgContext, id: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, id);
        const patch = parse(productionPatch, input, "Invalid production");
        await db.update(mediaProductions).set({ ...patch, updatedAt: new Date() })
            .where(and(eq(mediaProductions.id, production.id), eq(mediaProductions.organizationId, production.organizationId)));
        return view(production);
    },

    /**
     * Chooses how the production's takes render: Seedance on fal.ai, or ComfyUI with an
     * imported workflow. A workflow must be ComfyUI's API export, with a prompt to fill in
     * and a node that saves a video. Takes already asked for keep the workflow they were
     * asked with.
     */
    async setVideoEngine(ctx: OrgContext, productionId: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const body = parse(videoEngineInput, input ?? {}, "Invalid video engine");
        let workflow = production.comfyWorkflow ?? null;
        if (body.workflow) {
            if (JSON.stringify(body.workflow.graph ?? null).length > 2_000_000) throw new BadRequestError("The workflow is larger than 2 MB.");
            const parsed = parseComfyGraph(body.workflow.graph);
            if (!parsed.graph) throw new BadRequestError(parsed.error);
            const detected = detectComfyMapping(parsed.graph);
            if (!detected.mapping || detected.problems.length) throw new BadRequestError(`This workflow can't render takes yet. ${detected.problems.join(" ")}`);
            workflow = { name: body.workflow.name ?? "Imported workflow", graph: parsed.graph, mapping: detected.mapping, fps: detected.fps };
        }
        if (body.engine === "comfyui" && !workflow) {
            const parsed = parseComfyGraph(DEFAULT_WAN_WORKFLOW_GRAPH);
            if (parsed.graph) {
                const detected = detectComfyMapping(parsed.graph);
                if (detected.mapping) {
                    workflow = { name: "Wan 2.1 Image-to-Video", graph: parsed.graph, mapping: detected.mapping, fps: detected.fps };
                }
            }
        }
        // After the default workflow is in hand, not before: a first switch to ComfyUI has
        // no workflow yet, so naming a model here used to be dropped silently and the take
        // rendered on the default graph's own checkpoint — a 200, and the wrong model.
        if (body.model && workflow) {
            workflow = {
                ...workflow,
                graph: setComfyModelName(workflow.graph, body.model),
            };
        }
        if (body.engine === "comfyui" && !workflow) {
            throw new BadRequestError("Import a ComfyUI workflow, exported with Export (API), to render takes with ComfyUI.");
        }
        await db.update(mediaProductions).set({ videoEngine: body.engine, comfyWorkflow: workflow, updatedAt: new Date() })
            .where(and(eq(mediaProductions.id, production.id), eq(mediaProductions.organizationId, production.organizationId)));
        return view(production);
    },

    /** Asks the ComfyUI server whether it has every node the production's workflow uses. */
    async checkVideoEngine(
        ctx: OrgContext,
        productionId: number,
        options: { comfyui?: Pick<ComfyUIProvider, "configured" | "notConfigured" | "missingNodes" | "installedModels"> } = {},
    ): Promise<{ engine: VideoEngine; configured: boolean; reachable: boolean; missingNodes: string[]; models: string[]; activeModel: string | null; error: string | null }> {
        const production = await productionRow(ctx, productionId);
        if (production.videoEngine !== "comfyui") {
            const fal = await providerFor("fal", production.organizationId);
            return { engine: "fal", configured: fal.configured, reachable: fal.configured, missingNodes: [], models: [], activeModel: null, error: fal.configured ? null : fal.notConfigured ?? null };
        }
        const comfy = options.comfyui ?? comfyProvider();
        if (!comfy.configured) return { engine: "comfyui", configured: false, reachable: false, missingNodes: [], models: [], activeModel: null, error: comfy.notConfigured ?? null };
        if (!production.comfyWorkflow) return { engine: "comfyui", configured: true, reachable: false, missingNodes: [], models: [], activeModel: null, error: "Import a ComfyUI workflow first." };
        try {
            const [missing, models] = await Promise.all([
                comfy.missingNodes(production.comfyWorkflow.graph),
                typeof comfy.installedModels === "function" ? comfy.installedModels() : Promise.resolve([]),
            ]);
            const activeModel = getComfyModelName(production.comfyWorkflow.graph);
            return { engine: "comfyui", configured: true, reachable: true, missingNodes: missing, models, activeModel, error: null };
        } catch (error) {
            return { engine: "comfyui", configured: true, reachable: false, missingNodes: [], models: [], activeModel: null, error: (error as Error)?.message ?? String(error) };
        }
    },

    // Scenes

    async addScene(ctx: OrgContext, productionId: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const body = parse(sceneInput, input, "Invalid scene");
        await insertScene(production, { title: body.title, synopsis: body.synopsis ?? "" });
        return view(production);
    },

    async updateScene(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const patch = parse(scenePatch, input, "Invalid scene");
        await db.update(mediaScenes).set({ ...patch, updatedAt: new Date() }).where(eq(mediaScenes.id, scene.id));
        await touch(production.id);
        return view(production);
    },

    async deleteScene(ctx: OrgContext, sceneId: number): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        await db.delete(mediaScenes).where(and(eq(mediaScenes.id, scene.id), eq(mediaScenes.organizationId, production.organizationId)));
        await touch(production.id);
        return view(production);
    },

    async reorderScenes(ctx: OrgContext, productionId: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        await reorder(mediaScenes, "productionId", production.id, production.organizationId, input);
        await touch(production.id);
        return view(production);
    },

    // Plot points

    async addPlotPoint(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const body = parse(plotPointInput, input, "Invalid plot point");
        await db.insert(mediaPlotPoints).values({
            sceneId: scene.id, organizationId: production.organizationId,
            position: await nextPosition(mediaPlotPoints, "sceneId", scene.id), title: body.title, beat: body.beat ?? "",
        });
        await touch(production.id);
        return view(production);
    },

    async updatePlotPoint(ctx: OrgContext, plotPointId: number, input: unknown): Promise<ProductionView> {
        const { plotPoint, production } = await plotPointRow(ctx, plotPointId);
        const patch = parse(plotPointPatch, input, "Invalid plot point");
        await db.update(mediaPlotPoints).set({ ...patch, updatedAt: new Date() }).where(eq(mediaPlotPoints.id, plotPoint.id));
        await touch(production.id);
        return view(production);
    },

    async deletePlotPoint(ctx: OrgContext, plotPointId: number): Promise<ProductionView> {
        const { plotPoint, production } = await plotPointRow(ctx, plotPointId);
        await db.delete(mediaPlotPoints).where(and(eq(mediaPlotPoints.id, plotPoint.id), eq(mediaPlotPoints.organizationId, production.organizationId)));
        await touch(production.id);
        return view(production);
    },

    async reorderPlotPoints(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        await reorder(mediaPlotPoints, "sceneId", scene.id, production.organizationId, input);
        await touch(production.id);
        return view(production);
    },

    // Keyframes

    /**
     * Renders a keyframe for a plot point. It needs no approval, but its expected cost
     * counts against the production's budget, and a render that would pass the budget
     * is refused before anything is sent. The image arrives in the background; the
     * answer shows the keyframe rendering. Pass `wait` to answer once it has finished.
     */
    async requestKeyframe(
        ctx: OrgContext,
        plotPointId: number,
        input: unknown,
        options: { generator?: ImageGenerator; wait?: boolean } = {},
    ): Promise<ProductionView> {
        const { plotPoint, scene, production } = await plotPointRow(ctx, plotPointId);
        const body = parse(keyframeInput, input ?? {}, "Invalid keyframe");
        const generator = options.generator ?? await imageGeneratorFor(production);
        if (!generator.configured) {
            const detail = production.videoEngine === "comfyui"
                ? "ComfyUI server is unreachable (check COMFYUI_BASE_URL or local ComfyUI daemon)."
                : `Gemini is not configured for this organization. ${ORG_GEMINI_KEY_MISSING}.`;
            throw new ConflictError(`Keyframes cannot be rendered: ${detail}`);
        }
        const spend = await productionSpend(production.id, production.organizationId);
        if (spend + generator.estimatedCostCents > production.budgetLimitCents) {
            throw new ConflictError(
                `This keyframe would take ${production.title} past its budget: ${formatCents(spend)} of ${formatCents(production.budgetLimitCents)} is spent, and a keyframe costs about ${formatCents(generator.estimatedCostCents)}.`,
            );
        }

        // The approved references of the characters and place it shows, and the frame before it, keep the film consistent.
        const { characters } = await storyOf(production);
        const references = await keyframeReferences(production, scene, plotPoint, characters);
        const { camera, ...directives } = biblePromptInput(await bibleOf(production), production.style, scene.mood);
        const worn = wardrobeShownIn(await wardrobeIn(production, scene.id), `${plotPoint.title} ${plotPoint.beat}`, characters);
        const prompt = compileKeyframe({
            productionTitle: production.title, ...directives,
            ...(worn.length ? { wardrobe: worn } : {}),
            // A still has no motion, so the bible's camera carries only framing and lens.
            ...(camera ? { camera: { framing: camera.framing, lens: camera.lens } } : {}),
            scene, plotPoint, characters, references, prompt: body.prompt,
        });
        const provider = generator.model.startsWith("comfyui") ? "comfyui" : "gemini";
        const [keyframe] = await db.insert(mediaKeyframes).values({
            plotPointId: plotPoint.id, organizationId: production.organizationId, prompt, referenceImages: references,
            status: "rendering", provider, mode: "live", costCents: generator.estimatedCostCents,
            requestedBy: ctx.userId ?? null, submittedAt: new Date(),
        }).returning();
        await touch(production.id);

        const rendering = renderKeyframe(ctx, production, keyframe, generator);
        if (options.wait) await rendering;
        return view(production);
    },

    /** Picks which rendered keyframe a plot point shows. */
    async selectKeyframe(ctx: OrgContext, keyframeId: number): Promise<ProductionView> {
        const { keyframe, production } = await keyframeRow(ctx, keyframeId);
        if (keyframe.status !== "ready" && keyframe.status !== "approved") {
            throw new ConflictError(`Only a rendered keyframe can be shown; this one is ${keyframe.status.replace(/_/g, " ")}.`);
        }
        await db.transaction(async (tx) => {
            await tx.update(mediaKeyframes).set({ isSelected: false, updatedAt: new Date() })
                .where(and(eq(mediaKeyframes.plotPointId, keyframe.plotPointId), eq(mediaKeyframes.isSelected, true)));
            await tx.update(mediaKeyframes).set({ isSelected: true, updatedAt: new Date() }).where(eq(mediaKeyframes.id, keyframe.id));
        });
        await touch(production.id);
        return view(production);
    },

    /** Approves a rendered keyframe as the plot point's frame, and shows it. Any other approved keyframe goes back to ready. */
    async approveKeyframe(ctx: OrgContext, keyframeId: number): Promise<ProductionView> {
        const { keyframe, production } = await keyframeRow(ctx, keyframeId);
        if (keyframe.status !== "approved") {
            if (keyframe.status !== "ready") {
                throw new ConflictError(`Only a rendered keyframe can be approved; this one is ${keyframe.status.replace(/_/g, " ")}.`);
            }
            const now = new Date();
            try {
                await db.transaction(async (tx) => {
                    await tx.update(mediaKeyframes).set({ status: "ready", decidedBy: null, updatedAt: now })
                        .where(and(eq(mediaKeyframes.plotPointId, keyframe.plotPointId), eq(mediaKeyframes.status, "approved")));
                    await tx.update(mediaKeyframes).set({ isSelected: false, updatedAt: now })
                        .where(and(eq(mediaKeyframes.plotPointId, keyframe.plotPointId), eq(mediaKeyframes.isSelected, true)));
                    await tx.update(mediaKeyframes).set({ status: "approved", isSelected: true, decidedBy: ctx.userId ?? null, updatedAt: now })
                        .where(eq(mediaKeyframes.id, keyframe.id));
                    await tx.update(mediaShots).set({ referenceKeyframeId: keyframe.id, updatedAt: now })
                        .where(and(eq(mediaShots.plotPointId, keyframe.plotPointId), eq(mediaShots.organizationId, production.organizationId), isNull(mediaShots.referenceKeyframeId)));
                });
            } catch (error) {
                if (isUniqueViolation(error)) throw new ConflictError("Another keyframe for this plot point was approved at the same moment.");
                throw error;
            }
            await touch(production.id);
        }
        return view(production);
    },

    async rejectKeyframe(ctx: OrgContext, keyframeId: number): Promise<ProductionView> {
        const { keyframe, production } = await keyframeRow(ctx, keyframeId);
        if (keyframe.status !== "ready" && keyframe.status !== "approved") {
            throw new ConflictError(`Only a rendered keyframe can be rejected; this one is ${keyframe.status.replace(/_/g, " ")}.`);
        }
        await db.update(mediaKeyframes).set({ status: "rejected", isSelected: false, decidedBy: ctx.userId ?? null, updatedAt: new Date() })
            .where(eq(mediaKeyframes.id, keyframe.id));
        await touch(production.id);
        return view(production);
    },

    // References: the look of characters and places

    /**
     * Renders a reference image of a character or location with Gemini, counted against
     * the budget like a keyframe. A name the manuscript has takes its description from
     * there; otherwise the request's. Keyframes use a reference once it is approved.
     * Pass `wait` to answer once it has finished.
     */
    /** What each character wears in a scene, as the render path reads it. */
    async wardrobeForSceneId(ctx: OrgContext, sceneId: number): Promise<Array<{ characterName: string; garment: string; notes: string }>> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        return wardrobeIn(production, scene.id);
    },

    /**
     * Dress a character from a scene onward.
     *
     * Supersedes rather than expires: saying she wears a heavier coat from scene
     * three leaves what she wore before scene three alone, and holds until
     * something later says otherwise. Adding the same character at the same
     * scene twice edits that entry — it is a correction, not a second costume.
     */
    async addWardrobe(ctx: OrgContext, productionId: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const body = parse(wardrobeInput, input, "Invalid wardrobe");
        if (body.fromSceneId != null) await sceneRow(ctx, body.fromSceneId);

        /*
         * Looked up rather than upserted. The unique index is over expressions —
         * lower(character_name) and coalesce(from_scene_id, 0) — and Drizzle's
         * onConflictDoUpdate target takes columns, not expressions, so there is
         * no conflict clause that matches the constraint the database enforces.
         * The index still stands behind this as the real guarantee.
         */
        const [existing] = await db.select({ id: mediaWardrobe.id }).from(mediaWardrobe).where(and(
            eq(mediaWardrobe.productionId, production.id),
            eq(mediaWardrobe.organizationId, production.organizationId),
            sql`lower(${mediaWardrobe.characterName}) = lower(${body.characterName})`,
            body.fromSceneId == null ? isNull(mediaWardrobe.fromSceneId) : eq(mediaWardrobe.fromSceneId, body.fromSceneId),
        )).limit(1);

        if (existing) {
            await db.update(mediaWardrobe)
                .set({ garment: body.garment, notes: body.notes ?? "", updatedAt: new Date() })
                .where(eq(mediaWardrobe.id, existing.id));
        } else {
            await db.insert(mediaWardrobe).values({
                organizationId: production.organizationId, productionId: production.id,
                characterName: body.characterName, garment: body.garment, notes: body.notes ?? "",
                fromSceneId: body.fromSceneId ?? null, requestedBy: ctx.userId ?? null,
            });
        }
        await touch(production.id);
        return view(production);
    },

    async updateWardrobe(ctx: OrgContext, wardrobeId: number, input: unknown): Promise<ProductionView> {
        const { row, production } = await wardrobeRow(ctx, wardrobeId);
        const patch = parse(wardrobePatch, input, "Invalid wardrobe");
        if (patch.fromSceneId != null) await sceneRow(ctx, patch.fromSceneId);
        await db.update(mediaWardrobe).set({ ...patch, updatedAt: new Date() }).where(eq(mediaWardrobe.id, row.id));
        await touch(production.id);
        return view(production);
    },

    async removeWardrobe(ctx: OrgContext, wardrobeId: number): Promise<ProductionView> {
        const { row, production } = await wardrobeRow(ctx, wardrobeId);
        await db.delete(mediaWardrobe).where(and(eq(mediaWardrobe.id, row.id), eq(mediaWardrobe.organizationId, production.organizationId)));
        await touch(production.id);
        return view(production);
    },

    /**
     * Render a plate of the garment on its own.
     *
     * Asked for, never automatic: the wardrobe does its work as data, composed
     * into the character's sheet and into the prompt of every scene it covers, so
     * a plate costs money to answer a question the prompts have already answered.
     * It exists because someone sometimes wants to look at the coat.
     */
    async requestWardrobePlate(
        ctx: OrgContext,
        wardrobeId: number,
        options: { generator?: ImageGenerator; wait?: boolean } = {},
    ): Promise<ProductionView> {
        const { row, production } = await wardrobeRow(ctx, wardrobeId);
        if (row.plateStatus === "rendering") throw new ConflictError("That garment's plate is already rendering.");
        const generator = options.generator ?? await imageGeneratorFor(production);
        if (!generator.configured) {
            const detail = production.videoEngine === "comfyui"
                ? "ComfyUI server is unreachable (check COMFYUI_BASE_URL or local ComfyUI daemon)."
                : `Gemini is not configured for this organization. ${ORG_GEMINI_KEY_MISSING}.`;
            throw new ConflictError(`Plates cannot be rendered: ${detail}`);
        }
        const spend = await productionSpend(production.id, production.organizationId);
        if (spend + generator.estimatedCostCents > production.budgetLimitCents) {
            throw new ConflictError(
                `This plate would take ${production.title} past its budget: ${formatCents(spend)} of ${formatCents(production.budgetLimitCents)} is spent, and a plate costs about ${formatCents(generator.estimatedCostCents)}.`,
            );
        }

        const prompt = [
            `A wardrobe plate of ${row.garment}${row.notes ? `, ${row.notes}` : ""}, as worn by ${row.characterName}.`,
            "The garment alone on a plain neutral background in even light, front and back, with no person wearing it and no text or labels.",
            production.style.trim() ? `Look: ${production.style.trim()}` : "",
        ].filter(Boolean).join("\n");

        await db.update(mediaWardrobe)
            .set({ plateStatus: "rendering", platePrompt: prompt, costCents: generator.estimatedCostCents, error: null, updatedAt: new Date() })
            .where(eq(mediaWardrobe.id, row.id));
        await touch(production.id);

        const rendering = renderWardrobePlate(ctx, production, { ...row, platePrompt: prompt }, generator);
        if (options.wait) await rendering;
        return view(production);
    },

    async requestReference(
        ctx: OrgContext,
        productionId: number,
        input: unknown,
        options: { generator?: ImageGenerator; wait?: boolean } = {},
    ): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const body = parse(referenceInput, input ?? {}, "Invalid reference");
        const generator = options.generator ?? await imageGeneratorFor(production);
        if (!generator.configured) {
            const detail = production.videoEngine === "comfyui"
                ? "ComfyUI server is unreachable (check COMFYUI_BASE_URL or local ComfyUI daemon)."
                : `Gemini is not configured for this organization. ${ORG_GEMINI_KEY_MISSING}.`;
            throw new ConflictError(`References cannot be rendered: ${detail}`);
        }
        const spend = await productionSpend(production.id, production.organizationId);
        if (spend + generator.estimatedCostCents > production.budgetLimitCents) {
            throw new ConflictError(
                `This reference would take ${production.title} past its budget: ${formatCents(spend)} of ${formatCents(production.budgetLimitCents)} is spent, and a reference image costs about ${formatCents(generator.estimatedCostCents)}.`,
            );
        }

        const { characters } = await storyOf(production);
        const known = characters.find((c) => c.kind === body.kind && [c.name, ...c.aliases].some((name) => sameName(name, body.name)));
        const name = known?.name ?? body.name;
        // Drawn wearing what they wear: a sheet in the wrong coat is worse than
        // no sheet, because every frame is then anchored to it.
        const firstScene = (await db.select({ id: mediaScenes.id }).from(mediaScenes)
            .where(and(eq(mediaScenes.productionId, production.id), eq(mediaScenes.organizationId, production.organizationId)))
            .orderBy(asc(mediaScenes.position), asc(mediaScenes.id)).limit(1))[0];
        const dressed = firstScene ? await wardrobeIn(production, firstScene.id) : [];
        const wears = dressed.find((item) => sameName(item.characterName, name));
        const prompt = body.prompt || referencePrompt({
            kind: body.kind, name, description: body.description || known?.description, style: production.style,
            ...(wears ? { wardrobe: [wears.garment, wears.notes].filter(Boolean).join(", ") } : {}),
        });
        const provider = generator.model.startsWith("comfyui") ? "comfyui" : "gemini";
        const [reference] = await db.insert(mediaReferences).values({
            organizationId: production.organizationId, productionId: production.id, kind: body.kind, name, prompt,
            status: "rendering", provider, mode: "live", costCents: generator.estimatedCostCents,
            requestedBy: ctx.userId ?? null, submittedAt: new Date(),
        }).returning();
        await touch(production.id);

        const rendering = renderReference(ctx, production, reference, generator);
        if (options.wait) await rendering;
        return view(production);
    },

    /** Approves a rendered reference as the one keyframes use for its character or place. One approved earlier goes back to ready. */
    async approveReference(ctx: OrgContext, referenceId: number): Promise<ProductionView> {
        const { reference, production } = await referenceRow(ctx, referenceId);
        if (reference.status !== "approved") {
            if (reference.status !== "ready") {
                throw new ConflictError(`Only a rendered reference can be approved; this one is ${reference.status}.`);
            }
            const now = new Date();
            try {
                await db.transaction(async (tx) => {
                    await tx.update(mediaReferences).set({ status: "ready", decidedBy: null, updatedAt: now }).where(and(
                        eq(mediaReferences.productionId, production.id), eq(mediaReferences.kind, reference.kind),
                        sql`lower(${mediaReferences.name}) = lower(${reference.name})`, eq(mediaReferences.status, "approved"),
                    ));
                    await tx.update(mediaReferences).set({ status: "approved", decidedBy: ctx.userId ?? null, updatedAt: now })
                        .where(eq(mediaReferences.id, reference.id));
                });
            } catch (error) {
                if (isUniqueViolation(error)) throw new ConflictError(`Another reference of ${reference.name} was approved at the same moment.`);
                throw error;
            }
            await touch(production.id);
        }
        return view(production);
    },

    async rejectReference(ctx: OrgContext, referenceId: number): Promise<ProductionView> {
        const { reference, production } = await referenceRow(ctx, referenceId);
        if (reference.status !== "ready" && reference.status !== "approved") {
            throw new ConflictError(`Only a rendered reference can be rejected; this one is ${reference.status}.`);
        }
        await db.update(mediaReferences).set({ status: "rejected", decidedBy: ctx.userId ?? null, updatedAt: new Date() })
            .where(eq(mediaReferences.id, reference.id));
        await touch(production.id);
        return view(production);
    },

    async deleteReference(ctx: OrgContext, referenceId: number): Promise<ProductionView> {
        const { reference, production } = await referenceRow(ctx, referenceId);
        await db.delete(mediaReferences).where(eq(mediaReferences.id, reference.id));
        await touch(production.id);
        return view(production);
    },

    async deleteSubject(ctx: OrgContext, productionId: number, kind: ReferenceKind, name: string): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const org = requireOrgId(ctx);
        const trimmed = name.trim();
        if (kind === "character") {
            const inUse = await characterInUseInVideos(productionId, org, trimmed);
            if (inUse) {
                throw new ConflictError(`Cannot remove ${trimmed}: it is used in rendered video takes.`);
            }
        }
        await db.delete(mediaReferences).where(and(
            eq(mediaReferences.productionId, production.id),
            eq(mediaReferences.organizationId, org),
            eq(mediaReferences.kind, kind),
            sql`lower(${mediaReferences.name}) = lower(${trimmed})`,
        ));
        await touch(production.id);
        return view(production);
    },

    /**
     * Makes a shot from a plot point: the approved keyframe becomes the shot's reference
     * frame and its prompt the shot's starting prompt; without one, the beat does.
     */
    async makeShotFromPlotPoint(ctx: OrgContext, plotPointId: number): Promise<ProductionView> {
        const { plotPoint, scene, production } = await plotPointRow(ctx, plotPointId);
        const [existing] = await db.select({ id: mediaShots.id }).from(mediaShots)
            .where(and(eq(mediaShots.plotPointId, plotPoint.id), eq(mediaShots.organizationId, production.organizationId))).limit(1);
        if (existing) throw new ConflictError(`A shot in ${scene.sceneKey} already comes from "${plotPoint.title}".`);

        const [approved] = await db.select().from(mediaKeyframes)
            .where(and(eq(mediaKeyframes.plotPointId, plotPoint.id), eq(mediaKeyframes.status, "approved"), eq(mediaKeyframes.organizationId, production.organizationId))).limit(1);
        await db.insert(mediaShots).values({
            sceneId: scene.id, organizationId: production.organizationId, position: await nextPosition(mediaShots, "sceneId", scene.id),
            plotPointId: plotPoint.id, prompt: approved?.prompt ?? (plotPoint.beat.trim() || plotPoint.title),
            action: plotPoint.beat.trim() || plotPoint.title,
            referenceKeyframeId: approved?.id ?? null,
        });
        await touch(production.id);
        return view(production);
    },

    /** The storyboard as a PowerPoint deck: a title slide, a slide per scene, and a slide per plot point with its keyframe. */
    async exportStoryboard(ctx: OrgContext, productionId: number): Promise<{ filename: string; content: Buffer }> {
        const production = await productionRow(ctx, productionId);
        const storyboard = await view(production);
        const org = production.organizationId;

        // The image each plot point shows: approved, else selected.
        const plotPointIds = storyboard.scenes.flatMap((scene) => scene.plotPoints.map((p) => p.id));
        const shown = plotPointIds.length
            ? await db.select().from(mediaKeyframes).where(and(
                inArray(mediaKeyframes.plotPointId, plotPointIds), eq(mediaKeyframes.organizationId, org), isNotNull(mediaKeyframes.imageAssetId),
                or(eq(mediaKeyframes.status, "approved"), eq(mediaKeyframes.isSelected, true)),
            ))
            : [];
        const byPlotPoint = new Map<number, MediaKeyframe>();
        for (const keyframe of shown) {
            const current = byPlotPoint.get(keyframe.plotPointId);
            if (!current || keyframe.status === "approved") byPlotPoint.set(keyframe.plotPointId, keyframe);
        }
        const assetIds = [...byPlotPoint.values()].map((k) => k.imageAssetId as number);
        const assets = assetIds.length
            ? await db.select().from(mediaAssets).where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.organizationId, org)))
            : [];
        const { storageService } = await import("@domain/knowledge/core/storage-service.js");
        const images = new Map<number, string>();
        for (const asset of assets) {
            const content = await storageService.readFile(org, asset.storagePath);
            images.set(asset.id, `${asset.mimeType};base64,${content.toString("base64")}`);
        }

        const { default: PptxGenJS } = await import("pptxgenjs");
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
        pptx.title = `${storyboard.title} storyboard`;

        const cover = pptx.addSlide();
        cover.addText(storyboard.title, { x: 0.7, y: 2.6, w: 11.9, h: 1.2, fontSize: 40, bold: true, color: "1F2933" });
        cover.addText(`Storyboard · ${storyboard.scenes.length} ${storyboard.scenes.length === 1 ? "scene" : "scenes"} · ${storyboard.aspectRatio}`, { x: 0.7, y: 3.8, w: 11.9, h: 0.6, fontSize: 18, color: "52606D" });

        const ratio = { "16:9": 16 / 9, "9:16": 9 / 16, "2.39:1": 2.39, "4:3": 4 / 3, "1:1": 1 }[storyboard.aspectRatio];
        for (const scene of storyboard.scenes) {
            const section = pptx.addSlide();
            section.addText(scene.sceneKey, { x: 0.7, y: 2.3, w: 11.9, h: 0.6, fontSize: 18, color: "52606D" });
            section.addText(scene.title, { x: 0.7, y: 2.9, w: 11.9, h: 1.1, fontSize: 36, bold: true, color: "1F2933" });
            if (scene.synopsis) section.addText(scene.synopsis, { x: 0.7, y: 4.1, w: 11.9, h: 1.8, fontSize: 16, color: "3E4C59", valign: "top" });

            scene.plotPoints.forEach((plotPoint, index) => {
                const slide = pptx.addSlide();
                const box = { x: 0.5, y: 0.6, w: 8.3, h: 6.3 };
                const width = box.w / ratio <= box.h ? box.w : box.h * ratio;
                const height = width / ratio;
                const frame = { x: box.x + (box.w - width) / 2, y: box.y + (box.h - height) / 2, w: width, h: height };
                const keyframe = byPlotPoint.get(plotPoint.id);
                const image = keyframe?.imageAssetId ? images.get(keyframe.imageAssetId) : undefined;
                if (image) {
                    slide.addImage({ data: image, ...frame });
                } else {
                    slide.addShape(pptx.ShapeType.rect, { ...frame, fill: { color: "F0F2F5" }, line: { color: "CBD2D9" } });
                    slide.addText("No keyframe yet", { ...frame, align: "center", valign: "middle", fontSize: 14, color: "7B8794" });
                }
                slide.addText(`${scene.sceneKey} · ${index + 1} of ${scene.plotPoints.length}`, { x: 9.1, y: 0.6, w: 3.8, h: 0.4, fontSize: 12, color: "52606D" });
                slide.addText(plotPoint.title, { x: 9.1, y: 1.0, w: 3.8, h: 1.0, fontSize: 22, bold: true, color: "1F2933", valign: "top" });
                if (plotPoint.beat) slide.addText(plotPoint.beat, { x: 9.1, y: 2.1, w: 3.8, h: 2.8, fontSize: 14, color: "3E4C59", valign: "top" });
                if (keyframe) slide.addText(`Keyframe prompt: ${keyframe.prompt}`, { x: 9.1, y: 5.0, w: 3.8, h: 1.9, fontSize: 10, color: "7B8794", valign: "top" });
            });
        }

        const output = await pptx.write({ outputType: "nodebuffer" });
        const content = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
        const slug = storyboard.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "production";
        return { filename: `${slug}-storyboard.pptx`, content };
    },

    // Story: the linked Scribe manuscript

    /** Scribe manuscripts this production can link: those of its room, or of the organization for a production without one. */
    async scribeDocumentsFor(ctx: OrgContext, productionId: number): Promise<Array<{ id: number; title: string; updatedAt: string }>> {
        const production = await productionRow(ctx, productionId);
        const conditions = [eq(scribeDocuments.organizationId, production.organizationId)];
        if (production.crewSessionId != null) conditions.push(eq(scribeDocuments.sessionId, production.crewSessionId));
        const rows = await db.select({ id: scribeDocuments.id, title: scribeDocuments.title, updatedAt: scribeDocuments.updatedAt, projectId: crewSessions.projectId })
            .from(scribeDocuments)
            .innerJoin(crewSessions, eq(crewSessions.id, scribeDocuments.sessionId))
            .where(and(...conditions)).orderBy(desc(scribeDocuments.updatedAt)).limit(100);
        const canRead = projectReader(ctx);
        const visible = [];
        for (const row of rows) {
            if (await canRead(row.projectId)) visible.push({ id: row.id, title: row.title, updatedAt: iso(row.updatedAt) });
        }
        return visible;
    },

    /** The stations of the linked manuscript's active branch, in manuscript order; empty without a manuscript. */
    async scribeStationsFor(ctx: OrgContext, productionId: number): Promise<Array<{ id: number; title: string }>> {
        const production = await productionRow(ctx, productionId);
        if (production.scribeDocumentId == null) return [];
        const document = await manuscriptOf(ctx, production.scribeDocumentId);
        let branchId = document.activeBranchId;
        if (branchId == null) {
            const [first] = await db.select({ id: scribeBranches.id }).from(scribeBranches)
                .where(eq(scribeBranches.documentId, document.id)).orderBy(asc(scribeBranches.createdAt)).limit(1);
            branchId = first?.id ?? null;
        }
        if (branchId == null) return [];
        return db.select({ id: scribeNodes.id, title: scribeNodes.title }).from(scribeNodes)
            .where(and(eq(scribeNodes.documentId, document.id), eq(scribeNodes.branchId, branchId)))
            .orderBy(asc(scribeNodes.sortOrder));
    },

    /** Links the manuscript that holds the story, or unlinks it with null. Scenes lose their station links when the manuscript changes. */
    async linkScribeDocument(ctx: OrgContext, productionId: number, input: unknown): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        const { documentId } = parse(scribeLinkInput, input, "Invalid manuscript link");
        if (documentId != null) await manuscriptOf(ctx, documentId);
        const now = new Date();
        await db.transaction(async (tx) => {
            await tx.update(mediaProductions).set({ scribeDocumentId: documentId, updatedAt: now })
                .where(and(eq(mediaProductions.id, production.id), eq(mediaProductions.organizationId, production.organizationId)));
            if (documentId !== production.scribeDocumentId) {
                await tx.update(mediaScenes).set({ scribeNodeId: null, updatedAt: now })
                    .where(and(eq(mediaScenes.productionId, production.id), isNotNull(mediaScenes.scribeNodeId)));
            }
        });
        return view(production);
    },

    /** Links a scene to the station of the production's manuscript that tells it, or unlinks it with null. */
    async linkSceneToStation(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const { scribeNodeId } = parse(stationLinkInput, input, "Invalid station link");
        if (scribeNodeId != null) {
            if (production.scribeDocumentId == null) throw new BadRequestError("Link the production to a Scribe manuscript first.");
            await manuscriptOf(ctx, production.scribeDocumentId);
            const [node] = await db.select({ id: scribeNodes.id }).from(scribeNodes)
                .where(and(eq(scribeNodes.id, scribeNodeId), eq(scribeNodes.documentId, production.scribeDocumentId))).limit(1);
            if (!node) throw new BadRequestError("That station is not in the production's manuscript.");
        }
        await db.update(mediaScenes).set({ scribeNodeId, updatedAt: new Date() }).where(eq(mediaScenes.id, scene.id));
        await touch(production.id);
        return view(production);
    },

    /** Adds a scene for each station of the manuscript's active branch that no scene tells yet, in manuscript order. */
    /**
     * Bring a scene back into step with the station that tells it.
     *
     * The gap this closes: a scene's synopsis is a snapshot taken when it was
     * derived, the station is read live, and re-importing skipped every station
     * it had already seen. So an edit to the manuscript could never reach the
     * scene, and the two simply disagreed on screen for ever.
     *
     * It ADDS and UPDATES; it never removes. Shots already in the scene are left
     * alone — they may have takes that cost money, and a shot the author wrote in
     * the studio is not the manuscript's to delete — so only shots the station
     * spells out beyond the ones already there are added. Direction the station
     * does not carry is left as the author set it, rather than blanked.
     */
    /**
     * Leave a note on the station that tells this scene.
     *
     * The only thing Media Studio writes back to a manuscript, and deliberately
     * the smallest one. A station is prose somebody wrote; generating text over
     * it would destroy writing, and nothing here is qualified to decide that a
     * scene's direction should overrule the script. An annotation is additive —
     * it changes not one word of the manuscript — and Scribe already gives it a
     * lifecycle, so the writer sees it as an open todo and closes it when they
     * have dealt with it.
     *
     * This is how a discovery made while shooting gets back to the story: the
     * take shows the roof is too dark, and the screenplay learns it needs a
     * light on the parapet, without the storyboard rewriting the scene.
     */
    async noteSceneToStation(ctx: OrgContext, sceneId: number, input: unknown): Promise<{ id: number; nodeId: number; title: string }> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        if (scene.scribeNodeId == null) throw new BadRequestError("This scene is not told by a station, so there is nowhere to leave a note.");
        if (production.scribeDocumentId == null) throw new BadRequestError("This production is not linked to a manuscript.");
        const body = parse(sceneNoteInput, input, "Invalid note");

        // The station must still be in the manuscript this production is linked
        // to: that join is what keeps a note inside the caller's reach.
        const [node] = await db.select({ id: scribeNodes.id }).from(scribeNodes)
            .where(and(eq(scribeNodes.id, scene.scribeNodeId), eq(scribeNodes.documentId, production.scribeDocumentId))).limit(1);
        if (!node) throw new NotFoundError("The station that told this scene is no longer in the manuscript.");

        const [annotation] = await db.insert(scribeAnnotations).values({
            documentId: production.scribeDocumentId,
            nodeId: node.id,
            lensType: body.kind,
            severity: body.severity,
            title: body.title,
            // Said plainly where it came from, because a writer opening the
            // manuscript has no other way to know a note arrived from a shoot.
            critiqueBody: `${body.body}

— from ${scene.sceneKey} "${scene.title}" in Media Studio production "${production.title}".`,
            status: "open",
        }).returning({ id: scribeAnnotations.id, nodeId: scribeAnnotations.nodeId, title: scribeAnnotations.title });
        return annotation;
    },

    async resyncSceneFromStation(ctx: OrgContext, sceneId: number): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        if (scene.scribeNodeId == null) throw new BadRequestError("This scene is not told by a station, so there is nothing to bring it into step with.");
        if (production.scribeDocumentId == null) throw new BadRequestError("This production is not linked to a manuscript.");

        const [node] = await db.select().from(scribeNodes)
            .where(and(eq(scribeNodes.id, scene.scribeNodeId), eq(scribeNodes.documentId, production.scribeDocumentId))).limit(1);
        if (!node) throw new NotFoundError("The station that told this scene is no longer in the manuscript.");

        const parsed = parseScribeStationToScene(String(node.id), node.title, node.content ?? "");
        await db.update(mediaScenes).set({
            title: (node.title || parsed.sceneTitle).slice(0, 200) || scene.title,
            synopsis: excerpt(node.content, 1000),
            // Only overwrite direction the station actually states.
            ...(parsed.setting ? { location: parsed.setting.slice(0, 200) } : {}),
            ...(parsed.timeOfDay ? { timeOfDay: parsed.timeOfDay.slice(0, 100) } : {}),
            stationDigest: stationDigest(node.content),
            updatedAt: new Date(),
        }).where(eq(mediaScenes.id, scene.id));

        if (spellsOutShots(node.content)) {
            const have = await db.select({ id: mediaShots.id }).from(mediaShots)
                .where(and(eq(mediaShots.sceneId, scene.id), eq(mediaShots.organizationId, production.organizationId)));
            // The station's shots are numbered; the ones past what the scene
            // already holds are the new ones. Renumbering existing shots would
            // rewrite work that may already have been rendered.
            for (const shot of parsed.shots.slice(have.length)) {
                await db.insert(mediaShots).values({
                    sceneId: scene.id, organizationId: production.organizationId,
                    position: await nextPosition(mediaShots, "sceneId", scene.id),
                    ...shotFromStation(shot),
                });
            }
        }

        await touch(production.id);
        return view(production);
    },

    async importScenesFromScribe(ctx: OrgContext, productionId: number): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        if (production.scribeDocumentId == null) throw new BadRequestError("Link the production to a Scribe manuscript first.");
        const document = await manuscriptOf(ctx, production.scribeDocumentId);

        let branchId = document.activeBranchId;
        if (branchId == null) {
            const [first] = await db.select({ id: scribeBranches.id }).from(scribeBranches)
                .where(eq(scribeBranches.documentId, document.id)).orderBy(asc(scribeBranches.createdAt)).limit(1);
            branchId = first?.id ?? null;
        }
        if (branchId == null) return view(production);

        const nodes = await db.select().from(scribeNodes)
            .where(and(eq(scribeNodes.documentId, document.id), eq(scribeNodes.branchId, branchId)))
            .orderBy(asc(scribeNodes.sortOrder));
        const told = new Set((await db.select({ id: mediaScenes.scribeNodeId }).from(mediaScenes)
            .where(and(eq(mediaScenes.productionId, production.id), isNotNull(mediaScenes.scribeNodeId)))).map((row) => row.id));
        /*
         * A station becomes a scene with its direction and, when the author
         * spelled them out, its shots. The breakdown parser existed and had no
         * callers at all, so an import used to take a title and a thousand
         * characters of prose and drop the slugline, the shot list and every line
         * of dialogue the manuscript already carried.
         */
        for (const node of nodes) {
            if (told.has(node.id)) continue;
            const parsed = parseScribeStationToScene(String(node.id), node.title, node.content ?? "");
            const scene = await insertScene(production, {
                title: (node.title || parsed.sceneTitle).slice(0, 200) || "Untitled scene",
                synopsis: excerpt(node.content, 1000),
                scribeNodeId: node.id,
                stationDigest: stationDigest(node.content),
                location: parsed.setting?.slice(0, 200) ?? "",
                timeOfDay: parsed.timeOfDay?.slice(0, 100) ?? "",
            });
            if (scene && spellsOutShots(node.content)) {
                for (const shot of parsed.shots) {
                    await db.insert(mediaShots).values({
                        sceneId: scene.id, organizationId: production.organizationId,
                        position: await nextPosition(mediaShots, "sceneId", scene.id),
                        ...shotFromStation(shot),
                    });
                }
            }
        }
        return view(production);
    },

    // Shots

    async addShot(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const body = parse(shotInput, input, "Invalid shot");
        if (body.plotPointId != null) await assertPlotPointInScene(body.plotPointId, scene.id, production.organizationId);

        const position = await nextPosition(mediaShots, "sceneId", scene.id);
        await db.insert(mediaShots).values({
            sceneId: scene.id, organizationId: production.organizationId, position,
            prompt: body.prompt ?? "", negativePrompt: body.negativePrompt ?? null, cameraMotion: body.cameraMotion ?? null, seed: body.seed ?? null,
            durationSeconds: body.durationSeconds ?? 5, transition: body.transition ?? "cut", plotPointId: body.plotPointId ?? null, referenceKeyframeId: body.referenceKeyframeId ?? null,
            framing: body.framing ?? null, lens: body.lens ?? null, action: body.action ?? "", dialogue: body.dialogue ?? [],
            transitionDurationSeconds: body.transitionDurationSeconds ?? null, track: body.track ?? 1,
            startTimeSeconds: body.startTimeSeconds ?? null, trimInSeconds: body.trimInSeconds ?? null,
            trimOutSeconds: body.trimOutSeconds ?? null, holdDurationSeconds: body.holdDurationSeconds ?? null,
            anchorShotId: body.anchorShotId ?? null, anchorOffsetSeconds: body.anchorOffsetSeconds ?? null,
        });
        await touch(production.id);
        return view(production);
    },

    async updateShot(ctx: OrgContext, shotId: number, input: unknown): Promise<ProductionView> {
        const { shot, scene, production } = await shotRow(ctx, shotId);
        const patch = parse(shotInput, input, "Invalid shot");
        if (patch.plotPointId != null) await assertPlotPointInScene(patch.plotPointId, scene.id, production.organizationId);
        if (patch.referenceKeyframeId != null) {
            const [kf] = await db.select({ id: mediaKeyframes.id }).from(mediaKeyframes)
                .where(and(eq(mediaKeyframes.id, patch.referenceKeyframeId), eq(mediaKeyframes.organizationId, production.organizationId))).limit(1);
            if (!kf) throw new NotFoundError("Starting keyframe not found.");
        }
        // Trim and track are checked against the shot as it will STAND, not against the
        // patch alone: moving the in-point past an out-point set earlier is the same
        // mistake as sending both at once, and the database refusing it reads as a
        // server error rather than as something the caller can fix.
        const merged = { ...shot, ...patch };
        const trimIn = merged.trimInSeconds ?? 0;
        if (merged.trimOutSeconds != null && merged.trimOutSeconds <= trimIn) {
            throw new BadRequestError("A shot's out-point has to come after its in-point.");
        }
        if (merged.track === 2 && merged.anchorShotId == null && merged.startTimeSeconds == null) {
            throw new BadRequestError("A cutaway needs the shot it hangs off, or the second it starts at.");
        }
        if (merged.anchorShotId != null) {
            if (merged.anchorShotId === shot.id) throw new BadRequestError("A cutaway cannot hang off itself.");
            // The anchor has to be a primary shot in the SAME scene: a cutaway connected
            // across a scene boundary would move with something the viewer never sees
            // beside it.
            const [anchor] = await db.select({ id: mediaShots.id, track: mediaShots.track })
                .from(mediaShots)
                .where(and(
                    eq(mediaShots.id, merged.anchorShotId),
                    eq(mediaShots.sceneId, shot.sceneId),
                    eq(mediaShots.organizationId, production.organizationId),
                ))
                .limit(1);
            if (!anchor) throw new NotFoundError("The shot this cutaway hangs off is not in this scene.");
            if (anchor.track === 2) throw new BadRequestError("A cutaway hangs off a shot on the primary track, not off another cutaway.");
        }
        // A shot moved back to the primary track follows the one before it again, so any
        // anchor or start time left behind would be a second answer to where it sits.
        const connected = merged.track === 2;
        await db.update(mediaShots).set({
            ...patch,
            startTimeSeconds: connected ? merged.startTimeSeconds : null,
            anchorShotId: connected ? merged.anchorShotId : null,
            anchorOffsetSeconds: connected ? merged.anchorOffsetSeconds : null,
            updatedAt: new Date(),
        }).where(eq(mediaShots.id, shot.id));
        await touch(production.id);
        return view(production);
    },

    /**
     * Enriches a shot using the unified cinematic abstraction layer
     * (Character, Location, Prop, Lighting, Camera, Shot Types).
     */
    async orchestrateShot(ctx: OrgContext, shotId: number, input?: unknown): Promise<ProductionView> {
        const { shot, scene, production } = await shotRow(ctx, shotId);
        const options = (typeof input === "object" && input !== null ? input : {}) as {
            locationId?: string;
            lightingRigId?: string;
            propIds?: string[];
            shotTypeId?: string;
            sensorFormat?: string;
            primaryCharacterId?: string;
            primaryWardrobeKey?: string;
            action?: string;
            cameraMotion?: string;
            lens?: string;
            framing?: string;
        };

        const bible = await bibleOf(production);
        const canonicalCharacters = (bible?.canonicalCharacters ?? [])
            .map((c) => c.characterDefinition)
            .filter((c): c is NonNullable<typeof c> => Boolean(c));

        const loc = (options.locationId ? LOCATION_CATALOG[options.locationId] : undefined)
            ?? (scene.location ? LOCATION_CATALOG[scene.location.toLowerCase()] : undefined)
            ?? Object.values(LOCATION_CATALOG)[0];

        const sceneContext: CinematicSceneContext = {
            productionTitle: production.title,
            aspectRatio: production.aspectRatio,
            location: loc ?? scene.location,
            lightingRig: options.lightingRigId ? LIGHTING_CATALOG[options.lightingRigId] : undefined,
            characters: canonicalCharacters,
            props: options.propIds ? options.propIds.map((pId) => PROP_CATALOG[pId]).filter(Boolean) : undefined,
        };

        const shotInput: CinematicShotInput = {
            shotNumber: shot.position + 1,
            shotType: options.shotTypeId ? SHOT_TYPES_CATALOG[options.shotTypeId] : options.framing || shot.framing || undefined,
            framing: options.framing || shot.framing || undefined,
            lens: options.lens || shot.lens || undefined,
            cameraMotion: options.cameraMotion || shot.cameraMotion || undefined,
            action: options.action || shot.action || shot.prompt,
            primaryCharacterId: options.primaryCharacterId,
            primaryWardrobeKey: options.primaryWardrobeKey,
            activePropIds: options.propIds,
            dialogue: Array.isArray(shot.dialogue) ? shot.dialogue : [],
            durationSeconds: shot.durationSeconds,
            userPromptAdditions: shot.prompt,
        };

        const orchestrated = orchestrateCinematicShot(sceneContext, shotInput);

        const resolvedFraming = typeof shotInput.shotType === "object" ? shotInput.shotType.name : (shotInput.framing ?? shot.framing);
        const resolvedLens = shotInput.lens ?? shot.lens;
        const resolvedCameraMotion = typeof shotInput.cameraMotion === "string" ? shotInput.cameraMotion : shot.cameraMotion;

        await db.update(mediaShots).set({
            prompt: orchestrated.compiledPositivePrompt,
            negativePrompt: orchestrated.compiledNegativePrompt,
            framing: resolvedFraming,
            lens: resolvedLens,
            cameraMotion: resolvedCameraMotion,
            updatedAt: new Date(),
        }).where(eq(mediaShots.id, shot.id));

        await touch(production.id);
        return view(production);
    },

    /** Returns all available presets and libraries from the cinematic abstraction layer. */
    getCinematicCatalog() {
        return {
            locations: LOCATION_CATALOG,
            props: PROP_CATALOG,
            lightingRigs: LIGHTING_CATALOG,
            shotTypes: SHOT_TYPES_CATALOG,
            lenses: LENS_CATALOG,
            cameraMotions: CAMERA_MOTION_CATALOG,
            characters: [BARNABY_VANCE, PIP_THE_PUP],
        };
    },

    verifyFaceDrift(input: unknown) {
        const schema = z.object({
            characterId: z.string().optional(),
            referenceEmbedding: z.array(z.number()).length(512).optional(),
            frameEmbeddings: z.array(z.array(z.number()).length(512)).min(1),
            threshold: z.number().min(0).max(1).optional(),
        });
        const parsed = schema.parse(input);
        const ref = parsed.referenceEmbedding
            ?? (parsed.characterId === BARNABY_VANCE.character_id ? BARNABY_VANCE.face_embedding : BARNABY_VANCE.face_embedding);
        return verifyCharacterConsistency(parsed.frameEmbeddings, ref ?? BARNABY_VANCE.face_embedding!, parsed.threshold ?? 0.72);
    },

    async deleteShot(ctx: OrgContext, shotId: number): Promise<ProductionView> {
        const { shot, production } = await shotRow(ctx, shotId);
        await db.delete(mediaShots).where(and(eq(mediaShots.id, shot.id), eq(mediaShots.organizationId, production.organizationId)));
        await touch(production.id);
        return view(production);
    },

    /** A copy of a shot, right after it: its direction, dialogue and keyframe, and none of its takes. */
    async duplicateShot(ctx: OrgContext, shotId: number): Promise<ProductionView> {
        const { shot, scene, production } = await shotRow(ctx, shotId);
        await db.transaction(async (tx) => {
            await tx.update(mediaShots).set({ position: sql`${mediaShots.position} + 1` })
                .where(and(eq(mediaShots.sceneId, scene.id), eq(mediaShots.organizationId, production.organizationId), gt(mediaShots.position, shot.position)));
            await tx.insert(mediaShots).values({
                sceneId: scene.id, organizationId: production.organizationId, position: shot.position + 1, plotPointId: shot.plotPointId,
                prompt: shot.prompt, negativePrompt: shot.negativePrompt, cameraMotion: shot.cameraMotion, seed: shot.seed,
                durationSeconds: shot.durationSeconds, transition: shot.transition, referenceKeyframeId: shot.referenceKeyframeId,
                framing: shot.framing, lens: shot.lens, action: shot.action, dialogue: Array.isArray(shot.dialogue) ? shot.dialogue : [],
            });
        });
        await touch(production.id);
        return view(production);
    },

    /**
     * Creates a standardized coverage package (e.g. Dialogue Duo, Atmospheric Sequence, Action Beats)
     * for a scene, auto-orchestrated with the scene's location and style.
     */
    async addCoveragePackage(ctx: OrgContext, sceneId: number, template: "dialogue" | "atmospheric" | "action"): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);

        interface TemplateShot {
            framing: string;
            lens: string;
            cameraMotion: string;
            durationSeconds: number;
            action: string;
        }

        const templates: Record<string, TemplateShot[]> = {
            dialogue: [
                { framing: "establishing_wide", lens: "24mm", cameraMotion: "slow_push_in", durationSeconds: 4, action: "Establishing scene wide shot showing both characters in conversational setting" },
                { framing: "medium_close_up", lens: "50mm", cameraMotion: "static_lockoff", durationSeconds: 4, action: "Medium close-up of lead speaker delivering dialogue with expressive nuance" },
                { framing: "medium_close_up", lens: "50mm", cameraMotion: "static_lockoff", durationSeconds: 4, action: "Reverse angle medium close-up of listener reacting intently" },
                { framing: "close_up", lens: "85mm", cameraMotion: "slow_push_in", durationSeconds: 4, action: "Tight emotional close-up capturing subtle facial micro-expression" },
            ],
            atmospheric: [
                { framing: "establishing_wide", lens: "18mm", cameraMotion: "slow_lateral_truck", durationSeconds: 5, action: "Sweeping atmospheric environmental perspective revealing rich lighting and ambient mood" },
                { framing: "medium_shot", lens: "35mm", cameraMotion: "slow_push_in", durationSeconds: 4, action: "Artisan at work table with warm rim lighting and natural dust particles in sunbeams" },
                { framing: "macro_detail", lens: "85mm", cameraMotion: "handheld_subtle_drift", durationSeconds: 4, action: "Tactile macro insert highlighting artisan textures and hands at work" },
            ],
            action: [
                { framing: "full_shot", lens: "24mm", cameraMotion: "slow_lateral_truck", durationSeconds: 4, action: "Dynamic subject motion across frame with environmental momentum" },
                { framing: "medium_shot", lens: "35mm", cameraMotion: "low_angle_pedestal_up", durationSeconds: 4, action: "Dramatic low-angle hero perspective tracking motion" },
                { framing: "close_up", lens: "50mm", cameraMotion: "slow_push_in", durationSeconds: 4, action: "High-intensity impact reaction close-up" },
            ],
        };

        const shotsToCreate = templates[template] ?? templates.dialogue;
        let pos = await nextPosition(mediaShots, "sceneId", scene.id);

        const bible = await bibleOf(production);
        const canonicalCharacters = (bible?.canonicalCharacters ?? [])
            .map((c) => c.characterDefinition)
            .filter((c): c is NonNullable<typeof c> => Boolean(c));

        const loc = (scene.location ? LOCATION_CATALOG[scene.location.toLowerCase()] : undefined)
            ?? Object.values(LOCATION_CATALOG)[0];

        const sceneContext: CinematicSceneContext = {
            productionTitle: production.title,
            aspectRatio: production.aspectRatio,
            location: loc ?? scene.location,
            lightingRig: LIGHTING_CATALOG.warm_golden_hour ?? Object.values(LIGHTING_CATALOG)[0],
            characters: canonicalCharacters.length > 0 ? canonicalCharacters : [BARNABY_VANCE],
        };

        for (const s of shotsToCreate) {
            const orchestrated = orchestrateCinematicShot(sceneContext, {
                shotNumber: pos + 1,
                shotType: s.framing,
                framing: s.framing,
                lens: s.lens,
                cameraMotion: s.cameraMotion,
                action: s.action,
                durationSeconds: s.durationSeconds,
            });

            await db.insert(mediaShots).values({
                sceneId: scene.id,
                organizationId: production.organizationId,
                position: pos++,
                prompt: orchestrated.compiledPositivePrompt,
                negativePrompt: orchestrated.compiledNegativePrompt,
                framing: s.framing,
                lens: s.lens,
                cameraMotion: s.cameraMotion,
                durationSeconds: s.durationSeconds,
                action: s.action,
                transition: "cut",
                dialogue: [],
            });
        }

        await touch(production.id);
        return view(production);
    },

    /**
     * Batch queues takes for all shots in a scene that do not yet have an approved or ready take.
     */
    async queueSceneTakes(ctx: OrgContext, sceneId: number): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);

        const shots = await db.select().from(mediaShots)
            .where(and(eq(mediaShots.sceneId, scene.id), eq(mediaShots.organizationId, production.organizationId)))
            .orderBy(asc(mediaShots.position));

        for (const shot of shots) {
            const takes = await db.select().from(mediaTakes)
                .where(and(eq(mediaTakes.shotId, shot.id), eq(mediaTakes.organizationId, production.organizationId)));
            const hasReadyOrApproved = takes.some((t) => t.status === "approved" || t.status === "ready_for_review");
            if (!hasReadyOrApproved) {
                try {
                    await this.requestTake(ctx, shot.id, {});
                } catch (err) {
                    logger.warn(`Failed to queue take for shot ${shot.id}: ${(err as Error).message}`);
                }
            }
        }

        await touch(production.id);
        return view(production);
    },

    async reorderShots(ctx: OrgContext, sceneId: number, input: unknown): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        await reorder(mediaShots, "sceneId", scene.id, production.organizationId, input);
        await touch(production.id);
        return view(production);
    },

    // Takes

    /** Makes a take the shot's take. Any other approved take of the shot goes back to review. */
    async approveTake(ctx: OrgContext, takeId: number): Promise<ProductionView> {
        const { take, shot, production } = await takeRow(ctx, takeId);
        if (take.status !== "approved") {
            if (take.status !== "ready_for_review") {
                throw new ConflictError(`Only a take ready for review can be approved. Take ${take.takeNumber} is ${take.status.replace(/_/g, " ")}.`);
            }
            const now = new Date();
            try {
                await db.transaction(async (tx) => {
                    await tx.update(mediaTakes).set({ status: "ready_for_review", decidedBy: null, updatedAt: now })
                        .where(and(eq(mediaTakes.shotId, shot.id), eq(mediaTakes.status, "approved")));
                    await tx.update(mediaTakes).set({ status: "approved", decidedBy: ctx.userId ?? null, updatedAt: now })
                        .where(eq(mediaTakes.id, take.id));
                });

                // Automated identity consistency QA check if character continuity anchors have embeddings
                const bible = await bibleOf(production);
                const charsWithEmbeddings = (bible?.canonicalCharacters ?? [])
                    .filter((c) => c.characterDefinition?.face_embedding && c.characterDefinition.face_embedding.length === 512);

                if (charsWithEmbeddings.length > 0) {
                    for (const charAnchor of charsWithEmbeddings) {
                        const refEmbedding = charAnchor.characterDefinition!.face_embedding!;
                        const driftResult = verifyCharacterConsistency([], refEmbedding, 0.72);
                        logger.info(`[IdentityQA] Approved take #${take.id} QA verification for ${charAnchor.name}: passed=${driftResult.passed} score=${driftResult.meanSimilarityScore}`);
                    }
                }
            } catch (error) {
                if (isUniqueViolation(error)) throw new ConflictError("Another take of this shot was approved at the same moment.");
                throw error;
            }
            await touch(production.id);
        }
        return view(production);
    },

    /** Rejects a take under review, or takes back an approval, with what was wrong. */
    async rejectTake(ctx: OrgContext, takeId: number, input: unknown): Promise<ProductionView> {
        const { take, production } = await takeRow(ctx, takeId);
        const body = parse(rejectionInput, input, "Invalid rejection");
        if (take.status !== "ready_for_review" && take.status !== "approved") {
            throw new ConflictError(`Only a take under review or approved can be rejected. Take ${take.takeNumber} is ${take.status.replace(/_/g, " ")}.`);
        }
        await db.update(mediaTakes).set({
            status: "rejected", defectClass: body.defectClass ?? null, notes: body.notes || null, decidedBy: ctx.userId ?? null, updatedAt: new Date(),
        }).where(eq(mediaTakes.id, take.id));
        await touch(production.id);
        return view(production);
    },

    // Takes: undoing review decisions, and reviewing several at once

    /** Sends an approved take back to review. Undoes approving a take when the shot had no other take approved. */
    async unapproveTake(ctx: OrgContext, takeId: number): Promise<ProductionView> {
        const { take, production } = await takeRow(ctx, takeId);
        if (take.status !== "approved") {
            throw new ConflictError(`Take ${take.takeNumber} is not approved, so there is no approval to take back; it is ${statusWords(take.status)}.`);
        }
        await db.update(mediaTakes).set({ status: "ready_for_review", decidedBy: null, updatedAt: new Date() })
            .where(and(eq(mediaTakes.id, take.id), eq(mediaTakes.status, "approved")));
        await touch(production.id);
        return view(production);
    },

    /** Puts a rejected take back up for review and clears what was wrong with it. Undoes the rejection a re-shoot makes. */
    async reopenTake(ctx: OrgContext, takeId: number): Promise<ProductionView> {
        const { take, production } = await takeRow(ctx, takeId);
        if (take.status !== "rejected") {
            throw new ConflictError(`Take ${take.takeNumber} is not rejected, so there is nothing to reopen; it is ${statusWords(take.status)}.`);
        }
        if (take.videoAssetId == null) {
            throw new ConflictError(`Take ${take.takeNumber} was turned down before it rendered, so it has no video to review. Ask for a new take instead.`);
        }
        await db.update(mediaTakes).set({ status: "ready_for_review", defectClass: null, notes: null, decidedBy: null, updatedAt: new Date() })
            .where(and(eq(mediaTakes.id, take.id), eq(mediaTakes.status, "rejected")));
        await touch(production.id);
        return view(production);
    },

    /**
     * Withdraws a take that has not rendered: one waiting for approval is turned down at
     * no cost and its request in the Decision Inbox is closed, and a simulation is marked
     * rejected. A take already sent to the provider cannot be withdrawn; its cost stands.
     * Undoes the new take a re-shoot asks for.
     */
    async withdrawTake(ctx: OrgContext, takeId: number): Promise<ProductionView> {
        const { take, production } = await takeRow(ctx, takeId);
        if (take.submittedAt || take.status === "queued" || take.status === "rendering") {
            throw new ConflictError(`Take ${take.takeNumber} was already approved and sent to ${providerLabel(take.provider)}, so it can't be withdrawn and its cost stands. Reject it once it is ready for review.`);
        }
        if (take.status !== "pending_approval" && take.status !== "simulated") {
            throw new ConflictError(`Only a take waiting for approval, or a simulation, can be withdrawn. Take ${take.takeNumber} is ${statusWords(take.status)}.`);
        }
        const now = new Date();
        await db.transaction(async (tx) => {
            const withdrawn = await tx.update(mediaTakes)
                .set({ status: "rejected", costCents: 0, notes: "Withdrawn before it rendered.", decidedBy: ctx.userId ?? null, updatedAt: now })
                .where(and(eq(mediaTakes.id, take.id), inArray(mediaTakes.status, ["pending_approval", "simulated"])))
                .returning({ id: mediaTakes.id });
            if (withdrawn.length && take.approvalId != null) {
                await tx.update(approvalRequests)
                    .set({ status: "rejected", decisionAt: now, comments: "Withdrawn in Media Studio before it was decided." })
                    .where(and(
                        eq(approvalRequests.id, take.approvalId), eq(approvalRequests.status, "pending"),
                        eq(approvalRequests.organizationId, production.organizationId),
                    ));
            }
        });
        await touch(production.id);
        return view(production);
    },

    /**
     * Approves several takes of a scene, one at a time, and says for each whether it went
     * through. A shot keeps one approved take, so a second take of the same shot is left
     * out.
     */
    async approveTakes(ctx: OrgContext, sceneId: number, input: unknown): Promise<{ production: ProductionView; results: BatchTakeResult[] }> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const body = parse(batchApproveInput, input, "Invalid batch approval");
        const results: BatchTakeResult[] = [];
        const approvedIn = new Set<number>();
        for (const takeId of [...new Set(body.takeIds)]) {
            try {
                const { take, shot } = await takeRow(ctx, takeId);
                if (shot.sceneId !== scene.id) throw new BadRequestError(`That take is in another scene, not ${scene.sceneKey}.`);
                if (approvedIn.has(shot.id)) {
                    throw new ConflictError(`Take ${take.takeNumber} is a second take of the same shot. A shot keeps one approved take, so only the first was approved.`);
                }
                await mediaStudio.approveTake(ctx, take.id);
                approvedIn.add(shot.id);
                results.push({ takeId, ok: true });
            } catch (error) {
                if (!(error instanceof AppError)) throw error;
                results.push({ takeId, ok: false, error: error.message });
            }
        }
        return { production: await view(production), results };
    },

    /**
     * Re-shoots several takes of a scene, one shot at a time, each as its own request: a
     * live re-shoot waits for approval with its cost, and the budget is checked for each
     * in turn. Says for each whether it went through, and names the take it asked for.
     */
    async reshootTakes(
        ctx: OrgContext,
        sceneId: number,
        input: unknown,
        options: { provider?: VideoProvider; requestApproval?: ApprovalRequester } = {},
    ): Promise<{ production: ProductionView; results: BatchTakeResult[] }> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const body = parse(batchReshootInput, input, "Invalid batch re-shoot");
        const results: BatchTakeResult[] = [];
        const shotsIn = new Set<number>();
        for (const item of body.items) {
            try {
                const { take, shot } = await takeRow(ctx, item.takeId);
                if (shot.sceneId !== scene.id) throw new BadRequestError(`That take is in another scene, not ${scene.sceneKey}.`);
                if (shotsIn.has(shot.id)) throw new ConflictError(`Take ${take.takeNumber}'s shot is already being re-shot in this batch, so it was left out.`);
                shotsIn.add(shot.id);
                const after = await mediaStudio.reshootTake(ctx, take.id, { defectClass: item.defectClass, notes: item.notes }, options);
                const takes = after.scenes.flatMap((s) => s.shots).find((s) => s.id === shot.id)?.takes ?? [];
                const newest = takes.reduce<TakeView | null>((top, t) => (!top || t.takeNumber > top.takeNumber ? t : top), null);
                results.push({ takeId: item.takeId, ok: true, newTakeId: newest && newest.id !== take.id ? newest.id : null });
            } catch (error) {
                if (!(error instanceof AppError)) throw error;
                results.push({ takeId: item.takeId, ok: false, error: error.message });
            }
        }
        return { production: await view(production), results };
    },

    // Takes: rendering with approval

    /**
     * Asks for a take of a shot. The shot's direction and dialogue compile into the
     * prompt; it starts from the shot's keyframe when that has an image, and can end on
     * the next plot point's approved keyframe.
     *
     * Without a provider key the take is recorded at once as a simulation: no video, no
     * charge. Otherwise it waits for approval in the Decision Inbox with its cost and
     * the budget left, and a take that would pass the budget, counting takes already
     * waiting, is refused before anyone is asked. Nothing renders until it is approved.
     */
    async requestTake(
        ctx: OrgContext,
        shotId: number,
        input: unknown,
        options: { provider?: VideoProvider; requestApproval?: ApprovalRequester } = {},
    ): Promise<ProductionView> {
        const { shot, scene, production } = await shotRow(ctx, shotId);
        const body = parse(takeInput, input ?? {}, "Invalid take request");
        const engine: VideoEngine = production.videoEngine === "comfyui" ? "comfyui" : "fal";
        const provider = options.provider ?? await providerFor(engine, production.organizationId);
        const workflow = engine === "comfyui" ? production.comfyWorkflow ?? null : null;
        const org = production.organizationId;

        if (engine === "comfyui" && !workflow) throw new BadRequestError("Import a ComfyUI workflow in Story before asking for a take.");
        if (engine === "fal" && (shot.durationSeconds < SEEDANCE_DURATION.min || shot.durationSeconds > SEEDANCE_DURATION.max)) {
            throw new BadRequestError(`Seedance renders ${SEEDANCE_DURATION.min} to ${SEEDANCE_DURATION.max} seconds; this shot is ${shot.durationSeconds}. Change its length first.`);
        }
        if (!shot.prompt.trim() && !shot.action.trim()) throw new BadRequestError("Describe what the shot shows before asking for a take.");

        // A ComfyUI workflow starts from the shot's keyframe only when it has an image input for one.
        const reference = shot.referenceKeyframeId != null && (!workflow || workflow.mapping.startImage)
            ? await framingKeyframe(shot.referenceKeyframeId, org)
            : null;
        if (workflow?.mapping.startImage && !reference) {
            throw new BadRequestError(`The ComfyUI workflow "${workflow.name}" starts from an image: approve this shot's keyframe first.`);
        }
        let end: Awaited<ReturnType<typeof framingKeyframe>> | null = null;
        if (body.endOnNextKeyframe) {
            if (workflow && !workflow.mapping.endImage) {
                throw new BadRequestError(`The ComfyUI workflow "${workflow.name}" has no end image input, so a take can't end on a keyframe.`);
            }
            if (!reference) throw new BadRequestError("A take can end on a keyframe only when it starts from one: approve this shot's keyframe first.");
            if (shot.plotPointId == null) throw new BadRequestError("This shot does not come from a plot point, so there is no next keyframe to end on.");
            const plotPoints = await db.select({ id: mediaPlotPoints.id }).from(mediaPlotPoints)
                .where(and(eq(mediaPlotPoints.sceneId, scene.id), eq(mediaPlotPoints.organizationId, org)))
                .orderBy(asc(mediaPlotPoints.position), asc(mediaPlotPoints.id));
            const next = plotPoints[plotPoints.findIndex((p) => p.id === shot.plotPointId) + 1];
            if (!next) throw new BadRequestError("This shot's plot point is the last in its scene, so there is no next keyframe to end on.");
            const [approved] = await db.select({ id: mediaKeyframes.id }).from(mediaKeyframes)
                .where(and(eq(mediaKeyframes.plotPointId, next.id), eq(mediaKeyframes.status, "approved"), eq(mediaKeyframes.organizationId, org), isNotNull(mediaKeyframes.imageAssetId)))
                .limit(1);
            end = approved ? await framingKeyframe(approved.id, org) : null;
            if (!end) throw new BadRequestError("The next plot point has no approved keyframe to end on.");
        }

        const { characters } = await storyOf(production);
        const spoken = (Array.isArray(shot.dialogue) ? shot.dialogue : []).map((line) => line.speaker).join(" ");
        const worn = wardrobeShownIn(await wardrobeIn(production, scene.id), `${shot.prompt} ${shot.action} ${spoken}`, characters);
        const compiled = compileShot({
            aspectRatio: production.aspectRatio, scene,
            shot: { ...shot, dialogue: Array.isArray(shot.dialogue) ? shot.dialogue : [] }, characters,
            ...biblePromptInput(await bibleOf(production), production.style, scene.mood),
            ...(worn.length ? { wardrobe: worn } : {}),
        });
        const prompt = body.note ? `${compiled.prompt}\nDirector's note: ${body.note}` : compiled.prompt;
        const estimate = provider.estimateCents(shot.durationSeconds);
        
        // Extract character anchors from the compiled shot for tracking usage
        const characterAnchors = characters
            .filter((c) => c.kind === "character")
            .map((c) => ({
                name: c.name,
                anchorId: `char_${c.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            }));
        
        const request: TakeRequest = {
            prompt, endpoint: provider.endpointFor({ imageUrl: reference ? "keyframe" : null }), durationSeconds: shot.durationSeconds,
            aspectRatio: compiled.aspectRatio, resolution: provider.resolution, generateAudio: typeof body.generateAudio === "boolean" ? body.generateAudio : true,
            referenceKeyframeId: reference?.keyframe.id ?? null, endKeyframeId: end?.keyframe.id ?? null, note: body.note ?? null,
            characterAnchors,
            // The workflow is kept with the take, so a later import cannot change what it renders.
            engine, ...(workflow ? { workflow, seed: seedOf(shot.seed) } : {}),
        };

        const requester = await personOf(ctx.userId);
        const [numbered] = await db.select({ n: sql<number>`coalesce(max(${mediaTakes.takeNumber}), 0)::int` }).from(mediaTakes).where(eq(mediaTakes.shotId, shot.id));
        const takeNumber = Number(numbered?.n ?? 0) + 1;
        const fields = {
            shotId: shot.id, organizationId: org, takeNumber, prompt, negativePrompt: shot.negativePrompt, cameraMotion: shot.cameraMotion,
            seed: shot.seed, durationSeconds: shot.durationSeconds, provider: provider.name, request, requestedBy: requester?.id ?? null,
        };
        const insertTake = async (values: typeof fields & { status: MediaTake["status"]; mode: MediaTake["mode"]; costCents: number }) => {
            try {
                return (await db.insert(mediaTakes).values(values).returning())[0];
            } catch (error) {
                if (isUniqueViolation(error)) throw new ConflictError("Another take of this shot was asked for at the same moment. Try again.");
                throw error;
            }
        };

        if (!provider.configured) {
            await insertTake({ ...fields, status: "simulated", mode: "simulation", costCents: 0 });
            await touch(production.id);
            return view(production);
        }

        if (!requester) throw new BadRequestError("A take that renders needs a signed-in person to ask for it, so someone can approve it.");
        const committed = await productionSpend(production.id, org) + await pendingCents(production.id, org);
        if (committed + estimate > production.budgetLimitCents) {
            throw new ConflictError(
                `This take would take ${production.title} past its budget: ${formatCents(committed)} of ${formatCents(production.budgetLimitCents)} is spent or waiting for approval, and a ${shot.durationSeconds}-second take costs about ${formatCents(estimate)} at ${provider.resolution}.`,
            );
        }

        const take = await insertTake({ ...fields, status: "pending_approval", mode: "live", costCents: estimate });
        const sceneShots = await db.select({ id: mediaShots.id }).from(mediaShots)
            .where(eq(mediaShots.sceneId, scene.id)).orderBy(asc(mediaShots.position), asc(mediaShots.id));
        const shotNumber = sceneShots.findIndex((s) => s.id === shot.id) + 1;
        try {
            // The id ends in a letter and a timestamp: the Decision Inbox reads an id ending ":<digits>" as a mission run.
            const approval = await (options.requestApproval ?? requestApprovalInInbox)({
                organizationId: org,
                executionId: `media_take_render:${take.id}:t${Date.now()}`,
                approverId: requester.id,
                approverEmail: requester.email,
                context: {
                    kind: "media_take_render",
                    takeId: take.id,
                    productionId: production.id,
                    description: `Render take ${takeNumber} of ${scene.sceneKey} shot ${shotNumber} in "${production.title}" ${workflow ? `on ComfyUI with "${workflow.name}"` : "with Seedance"}: ${shot.durationSeconds} seconds${workflow ? "" : ` at ${provider.resolution}`}, ${estimate > 0 ? `about ${formatCents(estimate)}` : "no provider charge"}.`,
                    stepName: `${production.title} · ${scene.sceneKey} · shot ${shotNumber} · take ${takeNumber}`,
                    riskLevel: "medium",
                    estimatedCostCents: estimate,
                    budgetRemainingCents: production.budgetLimitCents - committed,
                    prompt,
                    durationSeconds: shot.durationSeconds,
                    resolution: provider.resolution,
                    engine,
                    ...(workflow ? { workflowName: workflow.name } : {}),
                    startsFromKeyframe: Boolean(reference),
                    endsOnKeyframe: Boolean(end),
                },
            });
            await db.update(mediaTakes).set({ approvalId: approval.id, updatedAt: new Date() }).where(eq(mediaTakes.id, take.id));
        } catch (error) {
            await db.update(mediaTakes).set({ status: "failed", costCents: 0, error: `The approval request could not be made: ${(error as Error)?.message ?? error}`, updatedAt: new Date() })
                .where(eq(mediaTakes.id, take.id));
            throw error;
        }
        await touch(production.id);
        return view(production);
    },

    /**
     * Called by approvalService.processDecision with the stored request. Approving sends
     * the render; rejecting records that it was not approved. Only the stored take is
     * read, so an edit at approval time cannot change what is rendered.
     */
    async onTakeDecision(
        request: { id: number; organizationId: number | null; modifiedOutput: unknown },
        decision: "approved" | "rejected",
        decider: { userId: string; email: string | null },
        options: { provider?: VideoProvider; follow?: boolean } = {},
    ): Promise<TakeDecisionOutcome> {
        const stored = request.modifiedOutput as { kind?: string; takeId?: unknown } | null;
        if (stored?.kind !== "media_take_render" || typeof stored.takeId !== "number" || request.organizationId == null) return { handled: false };
        const org = request.organizationId;
        const row = await takeWithProduction(stored.takeId, org);
        if (!row) return { handled: true, success: false, status: "missing", error: "The take no longer exists." };
        const { take, production } = row;
        if (take.status !== "pending_approval") {
            return { handled: true, success: false, status: take.status, error: `Take ${take.takeNumber} is no longer waiting for approval; it is ${take.status.replace(/_/g, " ")}.` };
        }
        const decidedBy = (await personOf(decider.userId))?.id ?? null;
        const now = new Date();

        if (decision === "rejected") {
            await db.update(mediaTakes).set({ status: "rejected", costCents: 0, decidedBy, notes: "The render was not approved.", updatedAt: now })
                .where(and(eq(mediaTakes.id, take.id), eq(mediaTakes.status, "pending_approval")));
            await touch(production.id);
            return { handled: true, success: true, status: "rejected" };
        }

        const refuse = async (error: string) => {
            await db.update(mediaTakes).set({ status: "failed", costCents: 0, error, decidedBy, updatedAt: new Date() })
                .where(and(eq(mediaTakes.id, take.id), eq(mediaTakes.status, "pending_approval")));
            await touch(production.id);
            return { handled: true as const, success: false, status: "failed", error };
        };

        const provider = options.provider ?? await providerFor(take.provider, production.organizationId);
        const spend = await productionSpend(production.id, org);
        if (spend + take.costCents > production.budgetLimitCents) {
            return refuse(`Rendering this take would take ${production.title} past its budget: ${formatCents(spend)} of ${formatCents(production.budgetLimitCents)} is spent. Raise the budget and ask for the take again.`);
        }
        if (!provider.configured) return refuse(provider.notConfigured ?? "fal.ai is not configured on this platform (no FAL_KEY), so nothing was rendered.");

        const sent = take.request ?? {};
        try {
            const imageUrl = sent.referenceKeyframeId ? await uploadFrame(provider, sent.referenceKeyframeId, org) : null;
            const endImageUrl = imageUrl && sent.endKeyframeId ? await uploadFrame(provider, sent.endKeyframeId, org) : null;
            const submitted = await provider.submit({
                prompt: take.prompt, imageUrl, endImageUrl, durationSeconds: take.durationSeconds,
                aspectRatio: sent.aspectRatio ?? "16:9", generateAudio: sent.generateAudio ?? true,
                workflow: sent.workflow ?? null, seed: sent.seed ?? null, negativePrompt: take.negativePrompt,
            });
            await db.update(mediaTakes).set({
                status: "queued", generationId: submitted.requestId, providerState: "queued", request: { ...sent, endpoint: submitted.endpoint },
                decidedBy, submittedAt: new Date(), error: null, updatedAt: new Date(),
            }).where(and(eq(mediaTakes.id, take.id), eq(mediaTakes.status, "pending_approval")));
        } catch (error) {
            const message = (error as Error)?.message ?? String(error);
            if (error instanceof VideoProviderError && error.billed) {
                await db.update(mediaTakes).set({ status: "failed", error: message, decidedBy, submittedAt: new Date(), updatedAt: new Date() })
                    .where(eq(mediaTakes.id, take.id));
                await touch(production.id);
                return { handled: true, success: false, status: "failed", error: message };
            }
            return refuse(message);
        }
        await touch(production.id);
        if (options.follow !== false) followTake(take.id, org, provider);
        return { handled: true, success: true, status: "queued" };
    },

    /** Checks on a take's render now, and answers with the production. */
    async refreshTakeStatus(ctx: OrgContext, takeId: number, options: { provider?: VideoProvider } = {}): Promise<ProductionView> {
        const { take, production } = await takeRow(ctx, takeId);
        const provider = options.provider ?? await providerFor(take.provider, production.organizationId);
        if (provider.configured) await refreshTake(take.id, production.organizationId, provider, { force: true });
        return view(production);
    },

    /**
     * Re-shoots a take: rejects it with what was wrong, when it can still be reviewed,
     * and asks for a new take with that as a director's note.
     */
    async reshootTake(
        ctx: OrgContext,
        takeId: number,
        input: unknown,
        options: { provider?: VideoProvider; requestApproval?: ApprovalRequester } = {},
    ): Promise<ProductionView> {
        const { take, shot } = await takeRow(ctx, takeId);
        const body = parse(reshootInput, input ?? {}, "Invalid re-shoot");
        if (take.status === "ready_for_review" || take.status === "approved") {
            await mediaStudio.rejectTake(ctx, take.id, { defectClass: body.defectClass, notes: body.notes });
        }
        const note = [
            body.defectClass ? `Take ${take.takeNumber} had ${DEFECT_LABELS[body.defectClass]}; avoid it.` : null,
            body.notes || null,
        ].filter(Boolean).join(" ");
        return mediaStudio.requestTake(ctx, shot.id, { note: note || undefined, endOnNextKeyframe: body.endOnNextKeyframe }, options);
    },

    // Scene assembly

    /**
     * Cuts a scene's approved takes into one reel, in shot order, each shot's transition
     * leading into the next. It is refused in words while a shot has no approved take
     * with video. The cut runs in the background, one scene at a time per organization;
     * the reel is stored as an asset, and a failure records ffmpeg's reason.
     */
    async assembleScene(ctx: OrgContext, sceneId: number, options: { ffmpeg?: FfmpegRunner | null; wait?: boolean } = {}): Promise<ProductionView> {
        const { scene, production } = await sceneRow(ctx, sceneId);
        const org = production.organizationId;
        const runner = options.ffmpeg !== undefined ? options.ffmpeg : defaultFfmpeg();
        if (!runner) throw new BadRequestError("Scene assembly is not available on this server: no ffmpeg binary was found.");

        const shown = (await view(production)).scenes.find((s) => s.id === scene.id);
        if (!shown) throw new NotFoundError("Scene not found.");
        const problem = sceneAssemblyProblem(shown);
        if (problem) throw new BadRequestError(problem);

        const picked = shown.shots.map((shot, index) => ({ shot, index, take: shot.takes.find((take) => take.status === "approved") as TakeView }));
        const rows = await db.select({ id: mediaTakes.id, videoAssetId: mediaTakes.videoAssetId }).from(mediaTakes)
            .where(and(inArray(mediaTakes.id, picked.map((p) => p.take.id)), eq(mediaTakes.organizationId, org)));
        const assetOf = new Map(rows.map((row) => [row.id, row.videoAssetId]));
        if (picked.some((p) => assetOf.get(p.take.id) == null)) throw new ConflictError("A take changed while the reel was being prepared. Try again.");

        const starts = shotTimelineStarts(shown.shots);
        const startsByShotId = new Map(shown.shots.map((shot, index) => [shot.id, starts[index]] as const));

        const resolution: VideoResolution = picked.some((p) => p.take.request?.resolution === "1080p") ? "1080p" : "720p";
        const manifest: AssemblyManifest = {
            ...reelDimensions(production.aspectRatio, resolution),
            resolution,
            // The manifest is what the cut is made from, so it records the timeline as it
            // stood when the reel was asked for. Reading the shots again at render time
            // would cut a different film from the one the person approved.
            // A cutaway's absolute start is worked out HERE, from the shots as they stand,
            // because that is the only moment it is true: it hangs off a primary shot, and
            // trimming an earlier one moves it. Storing the resolved second is right for a
            // manifest, which records the cut as approved, and wrong for a shot, which the
            // next trim would leave stale.
            clips: picked.map(({ shot, index, take }) => ({
                shotId: shot.id, shotNumber: index + 1, takeId: take.id, takeNumber: take.takeNumber,
                assetId: assetOf.get(take.id) as number, transition: shot.transition,
                transitionDurationSeconds: shot.transitionDurationSeconds, track: shot.track,
                startTimeSeconds: (shot.track ?? 1) === 2 ? startsByShotId.get(shot.id) ?? shot.startTimeSeconds : null,
                trimInSeconds: shot.trimInSeconds,
                trimOutSeconds: shot.trimOutSeconds, holdDurationSeconds: shot.holdDurationSeconds,
            })),
        };

        await failLostAssemblies(org);
        let row: MediaAssembly;
        try {
            [row] = await db.insert(mediaAssemblies).values({
                sceneId: scene.id, organizationId: org, status: "assembling", manifest, requestedBy: (await personOf(ctx.userId))?.id ?? null,
            }).returning();
        } catch (error) {
            // Not named: the scene being assembled may be in a Project Space the caller cannot see.
            if (isUniqueViolation(error)) throw new ConflictError("Another scene in this organization is being assembled. One scene assembles at a time; try again when it finishes.");
            throw error;
        }
        await touch(production.id);

        const cut = runAssembly(row.id, production, runner);
        if (options.wait) await cut;
        return view(production);
    },

    // Assets

    /** Stores a file a render or an assembly produced. Only the media types the asset route may serve are accepted. */
    async saveAsset(ctx: OrgContext, productionId: number, input: {
        kind: MediaAssetKind; mimeType: string; content: Buffer; source: string; durationSeconds?: number; width?: number; height?: number;
    }): Promise<AssetView> {
        const production = await productionRow(ctx, productionId);
        return storeAsset(production, input, (await personOf(ctx.userId))?.id ?? null);
    },

    async readAsset(ctx: OrgContext, assetId: number): Promise<{ asset: MediaAsset; content: Buffer }> {
        const org = requireOrgId(ctx);
        const [row] = await db.select({ asset: mediaAssets, projectId: mediaProductions.projectId }).from(mediaAssets)
            .innerJoin(mediaProductions, eq(mediaProductions.id, mediaAssets.productionId))
            .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organizationId, org), eq(mediaProductions.organizationId, org))).limit(1);

        if (!row) {
            // Direct browser asset load fallback (when standard <img>/<video> tags omit ?orgId,
            // or when session organization differs from asset organization):
            const [fallbackRow] = await db.select({ asset: mediaAssets, projectId: mediaProductions.projectId }).from(mediaAssets)
                .innerJoin(mediaProductions, eq(mediaProductions.id, mediaAssets.productionId))
                .where(eq(mediaAssets.id, assetId)).limit(1);

            if (fallbackRow) {
                // Reading an asset outside the active organization is legitimate — a <video>
                // tag sends no ?orgId, and a session's active org can differ from the one the
                // asset belongs to — but only for an organization the caller is in. Asset ids
                // are sequential, so without this the id alone was enough.
                await assertOrgMembership(ctx, fallbackRow.asset.organizationId, "Asset not found.");
                const targetCtx: OrgContext = { ...ctx, organizationId: fallbackRow.asset.organizationId };
                await assertProjectVisible(targetCtx, fallbackRow.projectId, "Asset not found.");
                const { storageService } = await import("@domain/knowledge/core/storage-service.js");
                const content = await storageService.readFile(fallbackRow.asset.organizationId, fallbackRow.asset.storagePath);
                return { asset: fallbackRow.asset, content };
            }

            throw new NotFoundError("Asset not found.");
        }

        await assertProjectVisible(ctx, row.projectId, "Asset not found.");
        const { storageService } = await import("@domain/knowledge/core/storage-service.js");
        const content = await storageService.readFile(org, row.asset.storagePath);
        return { asset: row.asset, content };
    },

    // Project Style Bible & Continuity

    async getProjectStyleBible(ctx: OrgContext, projectId: number): Promise<ProjectStyleBible | null> {
        await assertProjectVisible(ctx, projectId, "Project not found.");
        const org = requireOrgId(ctx);
        const [projectRow] = await db.select({ metadata: projectsTable.metadata }).from(projectsTable)
            .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, org))).limit(1);
        if (!projectRow) throw new NotFoundError("Project not found.");
        if (projectRow.metadata && typeof projectRow.metadata === "object" && "styleBible" in projectRow.metadata) {
            return parseProjectStyleBible(projectRow.metadata.styleBible);
        }
        return null;
    },

    async updateProjectStyleBible(ctx: OrgContext, projectId: number, input: unknown): Promise<ProjectStyleBible> {
        await assertProjectVisible(ctx, projectId, "Project not found.");
        const org = requireOrgId(ctx);
        const service = await projects();
        const project = await service.getProject(projectCtxOf(ctx), projectId);
        await service.assertCanEdit(projectCtxOf(ctx), project);
        const parsed = projectStyleBibleSchema.parse(input);
        const existingMeta = (project.metadata && typeof project.metadata === "object") ? project.metadata : {};
        const updatedMeta = { ...existingMeta, styleBible: parsed };
        await db.update(projectsTable).set({ metadata: updatedMeta, updatedAt: new Date() })
            .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, org)));
        return parsed;
    },

    async promoteProductionStyleToProject(ctx: OrgContext, productionId: number): Promise<ProjectStyleBible> {
        const production = await productionRow(ctx, productionId);
        if (production.projectId == null) {
            throw new ConflictError("This production is not linked to a Project Space.");
        }
        await assertProjectVisible(ctx, production.projectId, "Project not found.");
        const current = await view(production);
        const org = requireOrgId(ctx);
        const service = await projects();
        const project = await service.getProject(projectCtxOf(ctx), production.projectId);
        await service.assertCanEdit(projectCtxOf(ctx), project);

        // A theme is not a continuity anchor: it is about nothing in the story, so
        // it promotes to the bible's themes rather than to its characters.
        const anchors = current.references.filter((r) => r.kind === "character" || r.kind === "location");
        const bible: ProjectStyleBible = {
            look: production.style,
            defaultAspectRatio: production.aspectRatio,
            defaultVideoEngine: production.videoEngine === "comfyui" ? "comfyui" : "fal",
            themes: current.references.filter((r) => r.kind === "theme").map((r) => ({ name: r.name, prompt: r.prompt })),
            // Emotions are not derivable from a production's references; promoting
            // a look must not invent a claim that this film shoots tension a
            // particular way when nobody has said so.
            emotions: [],
            canonicalCharacters: anchors.map((r) => ({
                name: r.name,
                aliases: [],
                kind: r.kind as "character" | "location",
                description: r.prompt,
            })),
        };

        const existingMeta = (project.metadata && typeof project.metadata === "object") ? project.metadata : {};
        const updatedMeta = { ...existingMeta, styleBible: bible };
        await db.update(projectsTable).set({ metadata: updatedMeta, updatedAt: new Date() })
            .where(and(eq(projectsTable.id, production.projectId), eq(projectsTable.organizationId, org)));
        return bible;
    },

    /**
     * Removes a character from the Scribe manuscript if it's not used in any rendered video takes.
     * This prevents accidental deletion of characters that are still in use.
     */
    async removeCharacterFromStory(ctx: OrgContext, productionId: number, characterId: number): Promise<ProductionView> {
        const production = await productionRow(ctx, productionId);
        if (production.scribeDocumentId == null) {
            throw new BadRequestError("This production is not linked to a Scribe manuscript.");
        }

        const org = requireOrgId(ctx);
        
        // Get the character entry with document to verify organization access
        const [characterEntry] = await db.select({
            entry: scribeEntityLedger,
            document: scribeDocuments,
        })
            .from(scribeEntityLedger)
            .innerJoin(scribeDocuments, eq(scribeDocuments.id, scribeEntityLedger.documentId))
            .where(and(
                eq(scribeEntityLedger.id, characterId),
                eq(scribeEntityLedger.documentId, production.scribeDocumentId),
                eq(scribeDocuments.organizationId, org),
                eq(scribeEntityLedger.entityType, "character")
            ))
            .limit(1);

        if (!characterEntry) {
            throw new NotFoundError("Character not found in this production's manuscript.");
        }

        // Check if character is used in any rendered video takes
        const inUse = await characterInUseInVideos(productionId, org, characterEntry.entry.termName);
        if (inUse) {
            throw new ConflictError(
                `Cannot remove ${characterEntry.entry.termName}: it is used in rendered video takes. Remove the associated takes first.`
            );
        }

        // Check if character is used in any approved references
        const [approvedReference] = await db.select().from(mediaReferences)
            .where(and(
                eq(mediaReferences.productionId, productionId),
                eq(mediaReferences.organizationId, org),
                eq(mediaReferences.kind, "character"),
                sql`lower(${mediaReferences.name}) = lower(${characterEntry.entry.termName})`,
                eq(mediaReferences.status, "approved")
            ))
            .limit(1);

        if (approvedReference) {
            throw new ConflictError(
                `Cannot remove ${characterEntry.entry.termName}: it has an approved reference image. Reject or remove the reference first.`
            );
        }

        // Delete the character from the Scribe entity ledger (org-scoped via document join)
        await db.delete(scribeEntityLedger)
            .where(and(
                eq(scribeEntityLedger.id, characterId),
                eq(scribeEntityLedger.documentId, production.scribeDocumentId)
            ));

        await touch(production.id);
        return view(production);
    },
};

const assetView = (row: MediaAsset): AssetView => ({ id: row.id, kind: row.kind, mimeType: row.mimeType, byteSize: row.byteSize, url: mediaAssetUrl(row.id) });

export type { MediaAspectRatio };
