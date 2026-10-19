/**
 * Studio Deliverable Job Configuration Schemas
 *
 * Contains schemas for pipeline steps that produce studio deliverables:
 * - Scribe Publish (publish an existing Scribe document as a release artifact)
 * - Media Take (request Media Studio renders and wait on approval/render)
 */

import { z } from "zod";

// ============================================================================
// SCRIBE PUBLISH
// ============================================================================

export const scribePublishConfigSchema = z.object({
    documentId: z.number().int().positive(),
    format: z.enum(["markdown", "word"]).default("markdown"),
    versionTag: z.string().max(64).optional(),
    releaseNotes: z.string().max(2000).optional(),
    /** When set, the resolved text (templated from prior step outputs) is fed to crystallizeFromContext before publishing, so a workflow can hand the document what upstream steps produced. */
    contextParagraph: z.string().max(20000).optional(),
    branchId: z.number().int().positive().optional(),
});

export type ScribePublishConfig = z.infer<typeof scribePublishConfigSchema>;

// ============================================================================
// MEDIA TAKE
// ============================================================================

export const mediaTakeConfigSchema = z.object({
    productionId: z.number().int().positive(),
    /** Either a scene (all its shots) or explicit shots. At least one required. */
    sceneId: z.number().int().positive().optional(),
    shotIds: z.array(z.number().int().positive()).optional(),
    /** Resolve the step only once a human APPROVED each take (default) — or as soon as it is ready for review. */
    waitFor: z.enum(["approved", "ready_for_review"]).default("approved"),
    endOnNextKeyframe: z.boolean().optional(),
    /** A director's note added to every take's prompt. */
    note: z.string().trim().max(1000).optional(),
    generateAudio: z.boolean().optional(),
    /** Safety: max number of takes this step may request. */
    maxTakes: z.number().int().positive().max(50).default(10),
}).refine(c => c.sceneId != null || (c.shotIds != null && c.shotIds.length > 0), {
    message: "sceneId or shotIds is required",
});

export type MediaTakeConfig = z.infer<typeof mediaTakeConfigSchema>;
