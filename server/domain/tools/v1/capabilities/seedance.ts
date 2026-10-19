/**
 * Seedance video takes for Media Studio shots.
 *
 * A take is asked for, never sent: the shot's direction and dialogue compile into the
 * prompt, and nothing renders until a person approves it in the Decision Inbox, with
 * its cost counted against the production's budget. Renders go through fal.ai
 * (media-studio/core/video-provider.ts).
 *
 * These tools used to call api.seedance.ai, an endpoint that appears in no
 * documentation, spend without approval, keep jobs in memory, and price a second of
 * video at $0.04 when fal.ai lists $0.30 at 720p.
 */

import { z } from "zod";
import type { ToolContext, ToolDefinition } from "./types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";
import { SEEDANCE_CENTS_PER_SECOND, VIDEO_RESOLUTIONS, estimateTakeCents, formatCents, type ProductionView, type TakeView, type VideoResolution } from "@shared/media-studio.js";

/** The calling room's organization and person, for Media Studio. */
export function toMediaStudioContext(context: ToolContext): OrgContext {
    return {
        userId: (context as { userId?: string })?.userId ?? "agent",
        organizationId: requireToolOrgId(context),
        isAdmin: Boolean((context as { isAdmin?: boolean })?.isAdmin),
        // A room never reaches another tenant's productions.
        isSuperAdmin: false,
        isOrgAdmin: Boolean((context as { isOrgAdmin?: boolean })?.isOrgAdmin),
    };
}

function takeIn(production: ProductionView, find: (take: TakeView, shotId: number) => boolean): { take: TakeView; sceneKey: string } | null {
    for (const scene of production.scenes) {
        for (const shot of scene.shots) {
            const take = shot.takes.find((candidate) => find(candidate, shot.id));
            if (take) return { take, sceneKey: scene.sceneKey };
        }
    }
    return null;
}

const failure = (error: unknown) => JSON.stringify({ error: true, message: (error as Error)?.message ?? String(error) });

export const SEEDANCE_TOOLS: Record<string, ToolDefinition> = {
    seedance_estimate_cost: {
        name: "seedance_estimate_cost",
        idempotency: "read-safe",
        label: "Estimate Seedance Take Cost",
        group: "Video Content",
        description: "Estimate what Seedance takes will cost at fal.ai's list price for Seedance 2.0. A take is charged only when it renders.",
        parameters: z.object({
            shotCount: z.number().int().min(1).describe("Number of takes"),
            durationSeconds: z.number().int().min(4).max(15).optional().default(5).describe("Seconds per take (Seedance renders 4 to 15)"),
            resolution: z.enum(VIDEO_RESOLUTIONS).optional().default("720p").describe("Resolution"),
        }),
        execute: async (params) => {
            const perTakeCents = estimateTakeCents(params.durationSeconds, params.resolution);
            const totalCents = perTakeCents * params.shotCount;
            return JSON.stringify({
                takes: params.shotCount,
                durationSeconds: params.durationSeconds,
                resolution: params.resolution,
                centsPerSecond: SEEDANCE_CENTS_PER_SECOND[params.resolution as VideoResolution],
                perTakeCents,
                totalCents,
                summary: `${params.shotCount} ${params.shotCount === 1 ? "take" : "takes"} of ${params.durationSeconds} seconds at ${params.resolution} cost about ${formatCents(totalCents)} on fal.ai (${formatCents(perTakeCents)} each).`,
            }, null, 2);
        },
    },

    seedance_submit_shot: {
        name: "seedance_submit_shot",
        idempotency: "none",
        label: "Ask for a Seedance Take",
        group: "Video Content",
        description: "Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered. A message that begins with [Media Studio selection: {...}] names the scene, shot or take it is about by id.",
        parameters: z.object({
            shotId: z.number().int().positive().describe("The Media Studio shot to render"),
            note: z.string().max(1000).optional().describe("A director's note for this take only"),
            endOnNextKeyframe: z.boolean().optional().describe("End on the next plot point's approved keyframe"),
        }),
        execute: async (params, context) => {
            try {
                const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
                const production = await mediaStudio.requestTake(toMediaStudioContext(context), params.shotId, { note: params.note, endOnNextKeyframe: params.endOnNextKeyframe });
                const latest = takeIn(production, (_take, shotId) => shotId === params.shotId);
                const takes = production.scenes.flatMap((s) => s.shots).find((s) => s.id === params.shotId)?.takes ?? [];
                const take = takes.at(-1) ?? latest?.take;
                if (!take) return JSON.stringify({ error: true, message: "The take was asked for, but it could not be read back." });
                return JSON.stringify({
                    takeId: take.id,
                    takeNumber: take.takeNumber,
                    status: take.status,
                    mode: take.mode,
                    estimatedCostCents: take.costCents,
                    message: take.status === "simulated"
                        ? "Simulation only: fal.ai is not configured, so no video will be rendered and nothing is charged. Tell the user."
                        : `Take ${take.takeNumber} is waiting for approval in the Decision Inbox (about ${formatCents(take.costCents)}). Nothing renders until someone approves it.`,
                }, null, 2);
            } catch (error) {
                return failure(error);
            }
        },
    },

    seedance_check_status: {
        name: "seedance_check_status",
        idempotency: "read-safe",
        label: "Check a Seedance Take",
        group: "Video Content",
        description: "Check on a Media Studio take by its takeId: whether it is waiting for approval, rendering, ready for review (with its video), failed, or a simulation.",
        parameters: z.object({
            takeId: z.number().int().positive().describe("The take to check"),
        }),
        execute: async (params, context) => {
            try {
                const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
                const production = await mediaStudio.refreshTakeStatus(toMediaStudioContext(context), params.takeId);
                const found = takeIn(production, (take) => take.id === params.takeId);
                if (!found) return JSON.stringify({ error: true, message: `No take ${params.takeId} was found.` });
                return JSON.stringify({
                    takeId: found.take.id,
                    sceneKey: found.sceneKey,
                    takeNumber: found.take.takeNumber,
                    status: found.take.status,
                    videoUrl: found.take.videoUrl,
                    error: found.take.error,
                }, null, 2);
            } catch (error) {
                return failure(error);
            }
        },
    },
};
