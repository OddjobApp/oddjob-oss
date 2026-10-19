import { z, ZodError } from "zod";
import type { ToolContext, ToolDefinition } from "./types.js";
import { AppError } from "@server/utils/errors.js";
import { MEDIA_STUDIO_SELECTION_KINDS, type MediaStudioSelection } from "@shared/media-studio.js";
import {
    MEDIA_CHANGE_PROPOSAL, MEDIA_STORY_PROPOSAL, MEDIA_STUDIO_POD, MEDIA_STYLE_BIBLE_PROPOSAL,
    type MediaChangeProposal, type MediaStoryProposal, type MediaStyleBibleProposal,
} from "@shared/media-studio-crew.js";
import { toMediaStudioContext } from "./seedance.js";

/**
 * Drafting and applying a change, a story and a Style Bible in Media Studio, from a
 * CREW room.
 *
 * Like Form Studio's change tools, none of these is offered to an agent: the room's
 * direct path (crew-media-studio.service.ts) reaches them when a message asks for one,
 * and when the author presses Apply on the card it posted. No model can decide
 * mid-conversation to rewrite a storyboard, write a story, or change the look every
 * later render is made in.
 *
 * Every draft is read-safe and every apply carries the card's own payload, so what is
 * saved is what the author read — never what the message said afterwards.
 */

const selectionSchema = z.object({
    productionId: z.number().int().positive(),
    sceneId: z.number().int().positive(),
    sceneKey: z.string().min(1).max(20),
    kind: z.enum(MEDIA_STUDIO_SELECTION_KINDS),
    id: z.number().int().positive(),
    label: z.string().min(1).max(300),
});

const proposalSchema = z.object({
    proposalId: z.string().min(8).max(64),
    productionId: z.number().int().positive(),
    sceneId: z.number().int().positive(),
    sceneKey: z.string().min(1).max(20),
    baseDigest: z.string().min(1).max(128),
    edits: z.array(z.unknown()).min(1).max(50),
    changes: z.array(z.string()),
}).passthrough();

/**
 * A card's payload, checked only for the parts the apply path reads. The rest passes
 * through: the card is what says what gets written, and re-declaring its whole shape
 * here would let the two drift apart silently.
 */
const storyProposalSchema = z.object({
    proposalId: z.string().min(8).max(64),
    productionId: z.number().int().positive(),
    baseSceneKeys: z.array(z.string().max(20)).max(50),
    scenes: z.array(z.unknown()).min(1).max(12),
    summary: z.array(z.string()),
}).passthrough();

const bibleProposalSchema = z.object({
    proposalId: z.string().min(8).max(64),
    productionId: z.number().int().positive(),
    projectId: z.number().int().positive().nullable(),
    bible: z.object({ look: z.string() }).passthrough(),
    changes: z.array(z.string()),
}).passthrough();

export const MEDIA_STUDIO_CHANGE_TOOLS: Record<string, ToolDefinition> = {
    propose_media_change: {
        name: "propose_media_change",
        label: "Draft a Media Studio Change",
        group: "Video Content",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts a change to a Media Studio scene (its direction, plot points, shots and dialogue) about something the author marked, " +
            "and returns it as a card for the author to apply. Writes nothing.",
        parameters: z.object({
            selection: selectionSchema,
            instruction: z.string().min(1).max(4000),
        }),
        execute: async (params: { selection: MediaStudioSelection; instruction: string }, context: ToolContext) => {
            const { draftMediaChange } = await import("@domain/media-studio/core/media-change.js");
            try {
                const drafted = await draftMediaChange(toMediaStudioContext(context), params.selection, params.instruction);
                return "refused" in drafted ? drafted.refused : JSON.stringify({ type: MEDIA_CHANGE_PROPOSAL, ...drafted });
            } catch (error) {
                if (error instanceof AppError) return `I couldn't draft that change: ${error.message}`;
                throw error;
            }
        },
    },

    apply_media_change: {
        name: "apply_media_change",
        label: "Apply a Media Studio Change",
        group: "Video Content",
        idempotency: "none",
        riskLevel: "medium",
        description:
            "Saves the edits on a Media Studio change card the author applied. Refused when the scene has changed since the card was drafted.",
        parameters: z.object({ proposal: proposalSchema }),
        execute: async (params: { proposal: MediaChangeProposal }, context: ToolContext) => {
            const { applyMediaChange } = await import("@domain/media-studio/core/media-change.js");
            const proposal = params.proposal;
            try {
                const production = await applyMediaChange(toMediaStudioContext(context), proposal);
                const scene = production.scenes.find((s) => s.id === proposal.sceneId);
                return JSON.stringify({
                    type: MEDIA_STUDIO_POD,
                    module: "MediaStudioPod",
                    component: "MediaStudioPod",
                    title: scene?.title ?? proposal.sceneKey,
                    sceneId: scene?.sceneKey ?? proposal.sceneKey,
                    sceneTitle: scene?.title ?? proposal.sceneKey,
                    aspectRatio: production.aspectRatio,
                    productionId: production.id,
                    proposalId: proposal.proposalId,
                    lastChange: { status: "applied", changes: proposal.changes },
                });
            } catch (error) {
                if (error instanceof AppError) return `Not applied: ${error.message}`;
                if (error instanceof ZodError) return "Not applied: the card's edits are not valid.";
                throw error;
            }
        },
    },

    propose_media_story: {
        name: "propose_media_story",
        label: "Draft a Media Studio Story",
        group: "Video Content",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts scenes for a Media Studio production from what the author described — each with its direction, beats, shots " +
            "and dialogue — and returns them as a card for the author to apply. Writes nothing.",
        parameters: z.object({
            productionId: z.number().int().positive(),
            premise: z.string().min(1).max(4000),
            /** Scenes already on a card the author has not applied; the premise refines these. */
            basedOn: z.array(z.unknown()).max(12).optional(),
        }),
        execute: async (params: { productionId: number; premise: string; basedOn?: unknown[] }, context: ToolContext) => {
            const { draftMediaStory } = await import("@domain/media-studio/core/media-story.js");
            try {
                const drafted = await draftMediaStory(toMediaStudioContext(context), params.productionId, params.premise, {
                    basedOn: (params.basedOn ?? null) as never,
                });
                return "refused" in drafted ? drafted.refused : JSON.stringify({ type: MEDIA_STORY_PROPOSAL, ...drafted });
            } catch (error) {
                if (error instanceof AppError) return `I couldn't draft that story: ${error.message}`;
                throw error;
            }
        },
    },

    apply_media_story: {
        name: "apply_media_story",
        label: "Write a Drafted Story into Media Studio",
        group: "Video Content",
        idempotency: "none",
        riskLevel: "medium",
        description:
            "Writes the scenes on a Media Studio story card the author applied. Refused when the production's scenes have " +
            "changed since the card was drafted.",
        parameters: z.object({ proposal: storyProposalSchema }),
        execute: async (params: { proposal: MediaStoryProposal }, context: ToolContext) => {
            const { applyMediaStory } = await import("@domain/media-studio/core/media-story.js");
            const proposal = params.proposal;
            try {
                const production = await applyMediaStory(toMediaStudioContext(context), proposal);
                // Open the studio on the first scene this card added, not on the
                // production's first: the author should land on what they just made.
                const first = production.scenes[(proposal.baseSceneKeys ?? []).length] ?? production.scenes[0];
                return JSON.stringify({
                    type: MEDIA_STUDIO_POD,
                    module: "MediaStudioPod",
                    component: "MediaStudioPod",
                    title: production.title,
                    productionId: production.id,
                    productionTitle: production.title,
                    aspectRatio: production.aspectRatio,
                    sceneId: first?.sceneKey ?? "SCENE-01",
                    sceneTitle: first?.title ?? production.title,
                    proposalId: proposal.proposalId,
                    lastChange: { status: "applied", changes: proposal.summary },
                });
            } catch (error) {
                if (error instanceof AppError) return `Not written: ${error.message}`;
                if (error instanceof ZodError) return "Not written: the card's scenes are not valid.";
                throw error;
            }
        },
    },

    propose_style_bible: {
        name: "propose_style_bible",
        label: "Draft a Media Studio Style Bible",
        group: "Video Content",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts the Style Bible a production is shot in — its look, period, wardrobe rules, negative prompt and character " +
            "continuity anchors — and returns it as a card for the author to apply. Writes nothing.",
        parameters: z.object({
            productionId: z.number().int().positive(),
            instruction: z.string().min(1).max(4000),
            /** A bible on a card the author has not applied; the instruction refines this. */
            basedOn: z.record(z.unknown()).optional(),
        }),
        execute: async (params: { productionId: number; instruction: string; basedOn?: Record<string, unknown> }, context: ToolContext) => {
            const { draftStyleBible } = await import("@domain/media-studio/core/media-style-bible.js");
            try {
                const drafted = await draftStyleBible(toMediaStudioContext(context), params.productionId, params.instruction, {
                    basedOn: (params.basedOn ?? null) as never,
                });
                return "refused" in drafted ? drafted.refused : JSON.stringify({ type: MEDIA_STYLE_BIBLE_PROPOSAL, ...drafted });
            } catch (error) {
                if (error instanceof AppError) return `I couldn't draft a Style Bible: ${error.message}`;
                throw error;
            }
        },
    },

    apply_style_bible: {
        name: "apply_style_bible",
        label: "Save a Drafted Style Bible",
        group: "Video Content",
        idempotency: "none",
        riskLevel: "medium",
        description:
            "Saves the Style Bible on a card the author applied, to the production's Project Space and to the production's own " +
            "look. Every keyframe and take rendered afterwards is prompted with it.",
        parameters: z.object({ proposal: bibleProposalSchema }),
        execute: async (params: { proposal: MediaStyleBibleProposal }, context: ToolContext) => {
            const { applyStyleBible } = await import("@domain/media-studio/core/media-style-bible.js");
            const proposal = params.proposal;
            try {
                const { production, savedToProject } = await applyStyleBible(toMediaStudioContext(context), proposal);
                return JSON.stringify({
                    type: MEDIA_STUDIO_POD,
                    module: "MediaStudioPod",
                    component: "MediaStudioPod",
                    title: production.title,
                    productionId: production.id,
                    productionTitle: production.title,
                    aspectRatio: production.aspectRatio,
                    sceneId: production.scenes[0]?.sceneKey ?? "SCENE-01",
                    sceneTitle: production.scenes[0]?.title ?? production.title,
                    proposalId: proposal.proposalId,
                    savedToProject,
                    lastChange: { status: "applied", changes: proposal.changes },
                });
            } catch (error) {
                if (error instanceof AppError) return `Not saved: ${error.message}`;
                if (error instanceof ZodError) return "Not saved: the card's Style Bible is not valid.";
                throw error;
            }
        },
    },

    review_media_production: {
        name: "review_media_production",
        label: "Say What a Production Needs",
        group: "Video Content",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Reads a Media Studio production — its story, scenes, shots, look and what has been rendered — and answers a question " +
            "about it in words. Proposes nothing and changes nothing.",
        parameters: z.object({
            productionId: z.number().int().positive(),
            question: z.string().min(1).max(4000),
        }),
        execute: async (params: { productionId: number; question: string }, context: ToolContext) => {
            const { reviewMediaProduction } = await import("@domain/media-studio/core/media-review.js");
            try {
                return await reviewMediaProduction(toMediaStudioContext(context), params.productionId, params.question);
            } catch (error) {
                if (error instanceof AppError) return `I couldn't review that: ${error.message}`;
                throw error;
            }
        },
    },
};
