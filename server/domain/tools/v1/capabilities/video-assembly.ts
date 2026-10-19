/**
 * Video Assembly & Dailies Capabilities
 *
 * Scene assembly, a markdown Dailies summary, and opening Media Studio beside the
 * CREW conversation.
 *
 * assemble_scene_timeline cuts a saved Media Studio scene's approved takes into a
 * reel with ffmpeg (media-studio/core/assembly-plan.ts). It used to answer "success"
 * with a reel URL that was never created, from clip URLs the agent supplied.
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { AppError } from "@server/utils/errors.js";
import type { ProductionSummary, ProductionView } from "@shared/media-studio.js";
import { toMediaStudioContext } from "./seedance.js";

/** A production by its title, or the one whose title the text contains or is contained in. */
function productionByTitle(productions: ProductionSummary[], wanted: string): ProductionSummary | null {
    const text = wanted.trim().toLowerCase();
    if (!text) return null;
    return productions.find((p) => p.title.toLowerCase() === text)
        ?? productions.find((p) => p.title.length >= 3 && (text.includes(p.title.toLowerCase()) || p.title.toLowerCase().includes(text)))
        ?? null;
}

const ASPECT_RATIOS = ["16:9", "9:16", "2.39:1", "4:3", "1:1"] as const;

export const VIDEO_ASSEMBLY_TOOLS: Record<string, ToolDefinition> = {
    assemble_scene_timeline: {
        name: "assemble_scene_timeline",
        idempotency: "none",
        label: "Assemble a Scene Reel",
        group: "Video Content",
        description: "Cut a Media Studio scene's approved takes into one reel, in shot order with each shot's transition. Give the scene's id, or the production id and scene key (e.g. SCENE-01). It is refused, with the reason, while a shot has no approved take with video. The cut runs in the background and the reel appears in Media Studio's Film tab; do not describe a reel before it is ready. A message that begins with [Media Studio selection: {...}] carries the sceneId.",
        parameters: z.object({
            sceneId: z.number().int().positive().optional().describe("The Media Studio scene to assemble"),
            productionId: z.number().int().positive().optional().describe("The production, when giving a scene key instead of a scene id"),
            sceneKey: z.string().trim().max(20).optional().describe("The scene key within the production, e.g. SCENE-01"),
        }),
        execute: async (params, context) => {
            if (params.sceneId === undefined && (params.productionId === undefined || !params.sceneKey)) {
                return JSON.stringify({ error: true, message: "Give sceneId, or productionId and sceneKey." });
            }
            try {
                const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
                const ctx = toMediaStudioContext(context);
                let sceneId: number | undefined = params.sceneId;
                if (sceneId === undefined) {
                    const key = String(params.sceneKey).toUpperCase();
                    const found = await mediaStudio.getProduction(ctx, params.productionId);
                    sceneId = found.scenes.find((scene) => scene.sceneKey.toUpperCase() === key)?.id;
                    if (sceneId === undefined) return JSON.stringify({ error: true, message: `${found.title} has no ${key}.` });
                }
                const production = await mediaStudio.assembleScene(ctx, sceneId);
                const scene = production.scenes.find((s) => s.id === sceneId);
                return JSON.stringify({
                    status: scene?.assembly?.status ?? "assembling",
                    assemblyId: scene?.assembly?.id ?? null,
                    sceneId,
                    sceneKey: scene?.sceneKey ?? null,
                    message: `Assembling ${scene?.sceneKey ?? "the scene"} of ${production.title} from ${scene?.shots.length ?? 0} approved takes. The reel appears in Media Studio's Film tab when it is ready; it is not ready yet.`,
                }, null, 2);
            } catch (error) {
                return JSON.stringify({ error: true, message: (error as Error)?.message ?? String(error) });
            }
        },
    },

    render_dailies_deck: {
        name: "render_dailies_deck",
        idempotency: "read-safe",
        label: "Render Dailies Review Deck",
        group: "Video Content",
        description: "Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters.",
        parameters: z.object({
            sceneId: z.string().describe("Target Scene identifier (e.g. 'SCENE-01')"),
            sceneTitle: z.string().describe("Scene title from Scribe Studio"),
            budgetSpendUsd: z.number().optional().default(0).describe("Current spend for this scene"),
            shots: z.array(
                z.object({
                    shotNumber: z.number().int().min(1),
                    prompt: z.string(),
                    cameraMotion: z.string().optional(),
                    seed: z.union([z.string(), z.number()]).optional(),
                    videoUrl: z.string().optional(),
                    status: z.enum(["queued", "rendering", "ready_for_review", "approved", "rejected", "simulated"]),
                    costUsd: z.number().optional(),
                })
            ).min(1).describe("List of shots in the scene with their takes and review status"),
        }),
        execute: async (params) => {
            const shotRows = params.shots.map((shot: any) => {
                const statusBadge =
                    shot.status === "approved" ? "🟢 Approved" :
                    shot.status === "ready_for_review" ? "🟡 Ready for Review" :
                    shot.status === "rendering" ? "⚙️ Rendering" :
                    shot.status === "rejected" ? "🔴 Re-shoot Requested" :
                    shot.status === "simulated" ? "⚪ Simulated (no clip)" : "⚪ Queued";

                return `### Shot ${shot.shotNumber}: ${statusBadge}
- **Prompt**: *"${shot.prompt}"*
- **Camera Direction**: ${shot.cameraMotion || "Static / Default"}
- **Continuity Seed**: \`${shot.seed || "None"}\`
- **Video Take**: ${shot.videoUrl ? `[▶️ Preview Clip](${shot.videoUrl})` : "*No clip yet*"}`;
            }).join("\n\n---\n\n");

            return `## 🎬 Dailies Review Deck: ${params.sceneTitle} (${params.sceneId})
**Current Spend**: $${params.budgetSpendUsd.toFixed(2)} | **Total Shots**: ${params.shots.length}

${shotRows}

---
💡 **Director Controls**:
* Reply with the shots you approve.
* Reply with **"Re-shoot Shot [N] with [adjustments]"** to change a shot's prompt or camera direction.`;
        },
    },

    mount_media_studio: {
        name: "mount_media_studio",
        label: "Mount Media Studio",
        group: "Video Content",
        idempotency: "idempotent",
        riskLevel: "low",
        description:
            "Opens Media Studio beside the CREW conversation on a film production: its story, storyboard, shots, takes and reels. " +
            "Pass productionId, or productionTitle with the production's title. With neither, it opens this room's production, or " +
            "the studio's start form when the room has none. Pass create with productionTitle to start a production in this room " +
            "(an existing one with that title is opened instead). Opening renders, approves and assembles nothing, and takes no budget.",
        parameters: z.object({
            productionId: z.number().int().positive().optional().describe("Id of the production to open"),
            productionTitle: z.string().trim().min(1).max(200).optional().describe("The production's title, or the title of a new one"),
            create: z.boolean().optional().describe("Start a production titled productionTitle in this room"),
            aspectRatio: z.enum(ASPECT_RATIOS).optional().describe("Aspect ratio of a new production"),
            sceneId: z.string().trim().min(1).max(20).optional().describe("Scene key to open the Film tab on, e.g. SCENE-02"),
        }),
        execute: async (params, context) => {
            try {
                const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
                const ctx = toMediaStudioContext(context);
                const roomId = Number.isInteger(context?.sessionId) ? Number(context.sessionId) : undefined;
                let production: ProductionView | null = null;
                let created = false;

                if (params.productionId !== undefined) {
                    production = await mediaStudio.getProduction(ctx, params.productionId);
                } else if (params.productionTitle) {
                    const candidates = params.create
                        ? (roomId ? await mediaStudio.listProductions(ctx, { crewSessionId: roomId }) : [])
                        : await mediaStudio.listProductions(ctx);
                    const match = productionByTitle(candidates, params.productionTitle);
                    if (match) {
                        production = await mediaStudio.getProduction(ctx, match.id);
                    } else if (params.create) {
                        if (!roomId) return "A production is started from a CREW room, and this request did not come from one.";
                        production = await mediaStudio.createProduction(ctx, {
                            title: params.productionTitle, crewSessionId: roomId, ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
                        });
                        created = true;
                    } else {
                        const names = candidates.map((p) => p.title).slice(0, 15);
                        return names.length
                            ? `No production matches "${params.productionTitle}". This organization's productions: ${names.join(", ")}. Say which one to open, or ask to start "${params.productionTitle}" as a new production.`
                            : `There are no productions yet. Ask to start "${params.productionTitle}" as a new production.`;
                    }
                } else if (roomId) {
                    const [latest] = await mediaStudio.listProductions(ctx, { crewSessionId: roomId });
                    if (latest) production = await mediaStudio.getProduction(ctx, latest.id);
                }

                if (!production) {
                    // Nothing to open yet: the studio offers to start the room's first production.
                    return JSON.stringify({
                        type: "media_studio_pod", module: "MediaStudioPod", component: "MediaStudioPod",
                        title: "Media Studio", aspectRatio: params.aspectRatio ?? "16:9", sceneId: params.sceneId ?? "SCENE-01",
                        ...(params.productionTitle ? { sceneTitle: params.productionTitle } : {}),
                        created: false,
                        message: "Media Studio is open. This room has no production yet; start one in the studio, or say its title.",
                    }, null, 2);
                }
                const scene = production.scenes.find((s) => s.sceneKey === params.sceneId?.toUpperCase()) ?? production.scenes[0];
                return JSON.stringify({
                    type: "media_studio_pod", module: "MediaStudioPod", component: "MediaStudioPod",
                    title: production.title, productionId: production.id, productionTitle: production.title, created,
                    // What the production it OPENED holds. The room counts scenes before
                    // the round from the studio already mounted, which on a first mount is
                    // nothing at all — so a room told the author their production was empty
                    // while the tool was opening one with scenes in it.
                    sceneCount: production.scenes.length,
                    aspectRatio: production.aspectRatio, sceneId: scene?.sceneKey ?? "SCENE-01", sceneTitle: scene?.title ?? production.title,
                    message: created ? `Started "${production.title}" and opened it in Media Studio.` : `Media Studio is open on "${production.title}".`,
                }, null, 2);
            } catch (error) {
                if (error instanceof AppError) return `Media Studio did not open: ${error.message}`;
                throw error;
            }
        },
    },
};
