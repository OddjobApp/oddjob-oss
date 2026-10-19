import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs, users } from "./auth.js";
import { projects } from "./projects.js";
import { crewSessions } from "./crew.js";
import { scribeDocuments, scribeNodes } from "./scribe.js";
import type {
    AssemblyManifest, AssemblyStatus, DefectClass, DialogueLine, KeyframeReference, KeyframeStatus, MediaAspectRatio, MediaAssetKind, MediaDecisionKind, ReferenceKind, ReferenceStatus, WardrobePlateStatus,
    RenderMode, ShotTransition, TakeRequest, TakeStatus, VideoEngine,
} from "../media-studio.js";
import type { ComfyWorkflow } from "../comfy-workflow.js";

/**
 * Media Studio (migration 0115).
 *
 * A production has a storyboard (scenes → plot points → keyframe renders) and a film
 * (scenes → shots → takes). Images, videos and reels are assets in storage, served by
 * the platform. Every row carries its organization and is read by equality; a
 * production in a private Project Space is visible only to that project's members.
 * Money is integer cents: drizzle's decimal() comes back as a string.
 */

export const mediaProductions = pgTable("media_productions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    crewSessionId: integer("crew_session_id").references(() => crewSessions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    aspectRatio: text("aspect_ratio").$type<MediaAspectRatio>().notNull().default("16:9"),
    budgetLimitCents: integer("budget_limit_cents").notNull().default(10000),
    /** Scene keys come from this counter, so a deleted scene's key is never reused. */
    sceneCounter: integer("scene_counter").notNull().default(0),
    /** The Scribe manuscript that holds the story (0116). */
    scribeDocumentId: integer("scribe_document_id").references(() => scribeDocuments.id, { onDelete: "set null" }),
    /** The production's look: style, palette and light, added to every keyframe and take prompt (0119). */
    style: text("style").notNull().default(""),
    /** How takes render: "fal" for Seedance on fal.ai, or "comfyui" with the imported workflow (0120). */
    videoEngine: text("video_engine").$type<VideoEngine>().notNull().default("fal"),
    /** The ComfyUI workflow imported for this production, with what a take fills in (0120). */
    comfyWorkflow: jsonb("comfy_workflow").$type<ComfyWorkflow>(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("media_productions_org_idx").on(table.organizationId),
    sessionIdx: index("media_productions_session_idx").on(table.crewSessionId),
    aspectCheck: check("media_productions_aspect_check", sql`aspect_ratio IN ('16:9', '9:16', '2.39:1', '4:3', '1:1')`),
    budgetCheck: check("media_productions_budget_check", sql`budget_limit_cents >= 0`),
    videoEngineCheck: check("media_productions_video_engine_check", sql`video_engine IN ('fal', 'comfyui')`),
}));

export const mediaScenes = pgTable("media_scenes", {
    id: serial("id").primaryKey(),
    productionId: integer("production_id").notNull().references(() => mediaProductions.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sceneKey: text("scene_key").notNull(),
    title: text("title").notNull(),
    synopsis: text("synopsis").notNull().default(""),
    /** The manuscript station that tells this scene (0116). */
    scribeNodeId: integer("scribe_node_id").references(() => scribeNodes.id, { onDelete: "set null" }),
    /** The station as it read when this scene was last derived from it; null if never derived. */
    stationDigest: text("station_digest"),
    location: text("location").notNull().default(""),
    timeOfDay: text("time_of_day").notNull().default(""),
    mood: text("mood").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    keyUnique: uniqueIndex("media_scenes_production_key_unique").on(table.productionId, table.sceneKey),
    orderIdx: index("media_scenes_production_position_idx").on(table.productionId, table.position),
}));

export const mediaPlotPoints = pgTable("media_plot_points", {
    id: serial("id").primaryKey(),
    sceneId: integer("scene_id").notNull().references(() => mediaScenes.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    beat: text("beat").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orderIdx: index("media_plot_points_scene_position_idx").on(table.sceneId, table.position),
}));

export const mediaAssets = pgTable("media_assets", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    productionId: integer("production_id").notNull().references(() => mediaProductions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MediaAssetKind>().notNull(),
    /** Relative to the organization's storage root; the same path works for GCS and local disk. */
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    durationSeconds: integer("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    /** What produced it, e.g. "seedance", "gemini", "assembly". */
    source: text("source").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    productionIdx: index("media_assets_production_idx").on(table.productionId),
    kindCheck: check("media_assets_kind_check", sql`kind IN ('image', 'video', 'reel')`),
}));

export const mediaKeyframes = pgTable("media_keyframes", {
    id: serial("id").primaryKey(),
    plotPointId: integer("plot_point_id").notNull().references(() => mediaPlotPoints.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    status: text("status").$type<KeyframeStatus>().notNull().default("draft"),
    provider: text("provider"),
    mode: text("mode").$type<RenderMode>(),
    costCents: integer("cost_cents").notNull().default(0),
    imageAssetId: integer("image_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    approvalId: integer("approval_id"),
    error: text("error"),
    isSelected: boolean("is_selected").notNull().default(false),
    /** The reference images the render was sent with, in order (0119). */
    referenceImages: jsonb("reference_images").$type<KeyframeReference[]>().notNull().default(sql`'[]'::jsonb`),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when a render was actually sent to a provider; only then does its cost count. */
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    plotPointIdx: index("media_keyframes_plot_point_idx").on(table.plotPointId),
    selectedUnique: uniqueIndex("media_keyframes_selected_unique").on(table.plotPointId).where(sql`is_selected = true`),
    approvedUnique: uniqueIndex("media_keyframes_approved_unique").on(table.plotPointId).where(sql`status = 'approved'`),
    statusCheck: check("media_keyframes_status_check", sql`status IN ('draft', 'pending_approval', 'rendering', 'ready', 'approved', 'rejected', 'failed')`),
    modeCheck: check("media_keyframes_mode_check", sql`mode IS NULL OR mode IN ('live', 'simulation')`),
    costCheck: check("media_keyframes_cost_check", sql`cost_cents >= 0`),
}));

/**
 * A reference image of a character or location (0119), rendered and approved like a
 * keyframe. A production uses one approved reference per character or place, matched
 * by name; it is sent with each keyframe that shows them.
 */
export const mediaReferences = pgTable("media_references", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    productionId: integer("production_id").notNull().references(() => mediaProductions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ReferenceKind>().notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").$type<ReferenceStatus>().notNull().default("rendering"),
    provider: text("provider"),
    mode: text("mode").$type<RenderMode>(),
    costCents: integer("cost_cents").notNull().default(0),
    imageAssetId: integer("image_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    error: text("error"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when the render was actually sent; only then does its cost count. */
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    productionIdx: index("media_references_production_idx").on(table.productionId),
    approvedUnique: uniqueIndex("media_references_approved_unique").on(table.productionId, table.kind, sql`lower(${table.name})`).where(sql`status = 'approved'`),
    kindCheck: check("media_references_kind_check", sql`kind IN ('character', 'location', 'theme')`),
    statusCheck: check("media_references_status_check", sql`status IN ('rendering', 'ready', 'approved', 'rejected', 'failed')`),
    modeCheck: check("media_references_mode_check", sql`mode IS NULL OR mode IN ('live', 'simulation')`),
    costCheck: check("media_references_cost_check", sql`cost_cents >= 0`),
}));

export const mediaShots = pgTable("media_shots", {
    id: serial("id").primaryKey(),
    sceneId: integer("scene_id").notNull().references(() => mediaScenes.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    plotPointId: integer("plot_point_id").references(() => mediaPlotPoints.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull().default(""),
    negativePrompt: text("negative_prompt"),
    cameraMotion: text("camera_motion"),
    seed: text("seed"),
    durationSeconds: integer("duration_seconds").notNull().default(5),
    /** The transition into the next shot. */
    transition: text("transition").$type<ShotTransition>().notNull().default("cut"),
    /** How long that transition runs. Null leaves it at the transition's own length. */
    transitionDurationSeconds: real("transition_duration_seconds"),
    /** 1 = the primary magnetic track, 2 = the overlay/cutaway track (0123). */
    track: integer("track").notNull().default(1),
    /** Where an overlay sits on the timeline. Null on track 1, which follows the shot before it. */
    startTimeSeconds: real("start_time_seconds"),
    /** In and out points within the take, in seconds. Null means the whole take. */
    trimInSeconds: real("trim_in_seconds"),
    trimOutSeconds: real("trim_out_seconds"),
    /** Seconds of frozen last frame added after the trimmed span. */
    holdDurationSeconds: real("hold_duration_seconds"),
    /** The primary shot a cutaway hangs off, and how far into it it begins (0125). */
    anchorShotId: integer("anchor_shot_id"),
    anchorOffsetSeconds: real("anchor_offset_seconds"),
    referenceKeyframeId: integer("reference_keyframe_id").references(() => mediaKeyframes.id, { onDelete: "set null" }),
    /** e.g. "close-up", "over the shoulder" (0116). */
    framing: text("framing"),
    lens: text("lens"),
    /** What happens in the shot: blocking and movement. */
    action: text("action").notNull().default(""),
    /** Lines the video model speaks, in order. */
    dialogue: jsonb("dialogue").$type<DialogueLine[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orderIdx: index("media_shots_scene_position_idx").on(table.sceneId, table.position),
    durationCheck: check("media_shots_duration_check", sql`duration_seconds BETWEEN 1 AND 60`),
    transitionCheck: check("media_shots_transition_check", sql`transition IN ('cut', 'crossfade', 'dip_to_black')`),
    dialogueCheck: check("media_shots_dialogue_array_check", sql`jsonb_typeof(dialogue) = 'array'`),
}));

export const mediaTakes = pgTable("media_takes", {
    id: serial("id").primaryKey(),
    shotId: integer("shot_id").notNull().references(() => mediaShots.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    takeNumber: integer("take_number").notNull(),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    cameraMotion: text("camera_motion"),
    seed: text("seed"),
    durationSeconds: integer("duration_seconds").notNull(),
    status: text("status").$type<TakeStatus>().notNull(),
    mode: text("mode").$type<RenderMode>().notNull(),
    generationId: text("generation_id"),
    /** Who rendered it, e.g. "fal" (0117). */
    provider: text("provider"),
    /** Exactly what was, or would be, sent: prompt, endpoint, length, framing keyframes (0117). */
    request: jsonb("request").$type<TakeRequest>().notNull().default(sql`'{}'::jsonb`),
    /** The provider's last reported state: queued, running, completed or failed (0117). */
    providerState: text("provider_state"),
    videoAssetId: integer("video_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    costCents: integer("cost_cents").notNull().default(0),
    defectClass: text("defect_class").$type<DefectClass>(),
    notes: text("notes"),
    approvalId: integer("approval_id"),
    error: text("error"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when the render was actually sent to a provider; only then does its cost count. */
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    numberUnique: uniqueIndex("media_takes_shot_number_unique").on(table.shotId, table.takeNumber),
    approvedUnique: uniqueIndex("media_takes_approved_unique").on(table.shotId).where(sql`status = 'approved'`),
    statusCheck: check("media_takes_status_check", sql`status IN ('pending_approval', 'queued', 'rendering', 'ready_for_review', 'approved', 'rejected', 'failed', 'simulated')`),
    modeCheck: check("media_takes_mode_check", sql`mode IN ('live', 'simulation')`),
    defectCheck: check("media_takes_defect_check", sql`defect_class IS NULL OR defect_class IN ('character_drift', 'unnatural_motion', 'wrong_framing', 'lighting_mismatch', 'artifact_glitch')`),
    costCheck: check("media_takes_cost_check", sql`cost_cents >= 0`),
}));

export const mediaAssemblies = pgTable("media_assemblies", {
    id: serial("id").primaryKey(),
    sceneId: integer("scene_id").notNull().references(() => mediaScenes.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    status: text("status").$type<AssemblyStatus>().notNull(),
    /** What the reel was cut from: each shot's take and transition, the frame, and once cut its length. */
    manifest: jsonb("manifest").$type<AssemblyManifest>().notNull().default(sql`'{}'::jsonb`),
    reelAssetId: integer("reel_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    error: text("error"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    sceneIdx: index("media_assemblies_scene_idx").on(table.sceneId),
    /** One scene assembles at a time per organization (0118). */
    oneRunningPerOrg: uniqueIndex("media_assemblies_one_running_per_org").on(table.organizationId).where(sql`status = 'assembling'`),
    statusCheck: check("media_assemblies_status_check", sql`status IN ('assembling', 'ready', 'failed')`),
}));

/**
 * How a production came to look the way it does.
 *
 * Applying a change, a story or a Style Bible used to write the change and keep
 * no trace of it. What the author asked for, in their own words, and what it
 * altered lived only in the CREW room's transcript — invisible to anyone reading
 * the production, and gone with the room. One row per applied card, keyed by the
 * card's own id so applying twice records once.
 */
export const mediaDecisions = pgTable("media_decisions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    productionId: integer("production_id").notNull().references(() => mediaProductions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MediaDecisionKind>().notNull(),
    proposalId: text("proposal_id").notNull(),
    /** The scene it was about, when it was about one. Kept if that scene is deleted. */
    sceneId: integer("scene_id").references(() => mediaScenes.id, { onDelete: "set null" }),
    sceneKey: text("scene_key"),
    /** What the author asked for, in their own words. */
    instruction: text("instruction").notNull().default(""),
    /** What it changed, one line each, as the card described it. */
    summary: jsonb("summary").$type<string[]>().notNull().default([]),
    /** Parts of the request that were not carried out, and why. */
    skipped: jsonb("skipped").$type<string[]>().notNull().default([]),
    crewSessionId: integer("crew_session_id").references(() => crewSessions.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    productionIdx: index("media_decisions_production_idx").on(table.productionId, table.createdAt),
    proposalUnique: uniqueIndex("media_decisions_proposal_unique").on(table.proposalId),
    kindCheck: check("media_decisions_kind_check", sql`kind IN ('story', 'scene_change', 'style_bible')`),
}));

/**
 * What a character wears, from one scene onward.
 *
 * Supersedes rather than expires: the garment holds until another entry for the
 * same character starts at a later scene, so a costume change is one new row and
 * there is no end date to keep in step. A null `fromSceneId` is worn from the
 * production's first scene.
 */
export const mediaWardrobe = pgTable("media_wardrobe", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    productionId: integer("production_id").notNull().references(() => mediaProductions.id, { onDelete: "cascade" }),
    /** Who wears it, matched by name against the production's characters. */
    characterName: text("character_name").notNull(),
    garment: text("garment").notNull(),
    notes: text("notes").notNull().default(""),
    /** Worn from this scene onward; null means from the beginning. */
    fromSceneId: integer("from_scene_id").references(() => mediaScenes.id, { onDelete: "set null" }),
    /** A plate of the garment on its own, when one was asked for. */
    imageAssetId: integer("image_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    plateStatus: text("plate_status").$type<WardrobePlateStatus>().notNull().default("none"),
    platePrompt: text("plate_prompt"),
    costCents: integer("cost_cents").notNull().default(0),
    error: text("error"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    productionIdx: index("media_wardrobe_production_idx").on(table.productionId),
    characterSceneUnique: uniqueIndex("media_wardrobe_character_scene_unique")
        .on(table.productionId, sql`lower(${table.characterName})`, sql`coalesce(${table.fromSceneId}, 0)`),
    plateStatusCheck: check("media_wardrobe_plate_status_check", sql`plate_status IN ('none', 'rendering', 'ready', 'failed')`),
}));

export type MediaProduction = typeof mediaProductions.$inferSelect;
export type MediaDecision = typeof mediaDecisions.$inferSelect;
export type MediaWardrobe = typeof mediaWardrobe.$inferSelect;
export type MediaScene = typeof mediaScenes.$inferSelect;
export type MediaPlotPoint = typeof mediaPlotPoints.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type MediaKeyframe = typeof mediaKeyframes.$inferSelect;
export type MediaReference = typeof mediaReferences.$inferSelect;
export type MediaShotRow = typeof mediaShots.$inferSelect;
export type MediaTake = typeof mediaTakes.$inferSelect;
export type MediaAssembly = typeof mediaAssemblies.$inferSelect;
