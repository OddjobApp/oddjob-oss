/**
 * Media Studio actions taken directly inside a crew room: opening the studio,
 * asking for a film's brief, drafting a story, drafting a change to a scene,
 * drafting the Style Bible, and applying any of the three the author approved.
 *
 * The same shape as Form Studio's (crew-form-studio.service.ts), whose turn
 * helpers it uses. What a message does is decided by decideMediaStudioAction, a
 * pure function in media-intent-resolver.service.ts; this file only carries it
 * out. Drafting and applying are reached from here and nowhere else, so no agent
 * can rewrite a storyboard on its own.
 *
 * Two things here are new, and both come from watching a room mount an empty
 * studio and then forget it existed for six rounds:
 *
 * `productionContext` reads the room's own history for the production a studio
 * is open on, and looks up what it actually holds. Nothing downstream can decide
 * whether "make it colder" means a scene without knowing whether there IS one.
 *
 * And every reply names the next thing to do, chosen from the state the
 * production is actually in, rather than telling an author with no scenes to go
 * and mark one.
 */

import type { AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
    FILM_BRIEF_POD, FILM_BRIEF_STAGE,
    findMediaChangeProposal, findMediaStoryProposal, findStyleBibleProposal,
    latestStoryDraft, latestStyleBibleDraft, mountedMediaProduction,
    type FilmIntake, type MediaChangeProposal, type MediaStoryProposal, type MediaStyleBibleProposal, type MountedMediaProduction,
} from "@shared/media-studio-crew.js";
import type { MediaStudioSelection } from "@shared/media-studio.js";
import {
    decideMediaStudioAction,
    type MediaIntentKind,
} from "@domain/intent-router/core/media-intent-resolver.service.js";
import { crewToolsService, type CrewArtifact } from "./crew-tools.service.js";
import { postTurn, publishTurn, registryTool, toolContext } from "./crew-form-studio.service.js";
import type { RoundContext } from "./crew-round-context.js";

const logger = createLogger("CrewMediaStudio");

type ToolRecord = Awaited<ReturnType<typeof crewToolsService.execute>>["record"];

/** The production open in this room, and the scenes it holds right now. */
export interface MediaProductionContext {
    production: MountedMediaProduction | null;
    scenes: Array<{ id: number; sceneKey: string; title: string }>;
}

/**
 * What the room is working on, read from its own transcript and then from the
 * production itself.
 *
 * The scene list is what makes the difference between a room that can act and
 * one that can only talk: a request against a production with no scenes is a
 * request for its story, and a request against one with five is a change to one
 * of them. Neither is knowable from the message.
 *
 * A production the room can no longer read — deleted, or moved out of reach —
 * comes back as no production at all rather than as an error, because the right
 * answer then is to mount the studio again, which the open path already does.
 */
export async function productionContext(ctx: RoundContext): Promise<MediaProductionContext> {
    const production = mountedMediaProduction(ctx.priorTurns as any);
    if (!production) return { production: null, scenes: [] };

    try {
        const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");
        const { toMediaStudioContext } = await import("@domain/tools/v1/capabilities/seedance.js");
        const view = await mediaStudio.getProduction(toMediaStudioContext(toolContext(ctx)), production.productionId);
        return {
            production: { ...production, productionTitle: view.title, aspectRatio: view.aspectRatio },
            scenes: view.scenes.map((scene) => ({ id: scene.id, sceneKey: scene.sceneKey, title: scene.title })),
        };
    } catch (err: any) {
        logger.warn(`Reading production ${production.productionId} for room ${ctx.sessionKey} failed: ${err?.message ?? err}`);
        return { production: null, scenes: [] };
    }
}

export async function runDirectMediaStudioAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;

    /*
     * The transcript read is free; the production read is not. So the message is
     * put to the resolver once against the room's history alone, and the
     * production is only looked up when that first pass says Media Studio is
     * involved at all. An ordinary conversation costs one regex pass.
     */
    const mounted = mountedMediaProduction(ctx.priorTurns as any);
    if (!mounted && decideMediaStudioAction(ctx.message, null).kind === "none") return false;

    const { production, scenes } = mounted ? await productionContext(ctx) : { production: null, scenes: [] };
    const action = decideMediaStudioAction(ctx.message, production, scenes);

    switch (action.kind) {
        case "apply":
            return applyMediaChangeFromCard(ctx, card, action.proposalId);
        case "apply_story":
            return applyMediaStoryFromCard(ctx, card, action.proposalId);
        case "apply_bible":
            return applyStyleBibleFromCard(ctx, card, action.proposalId);
        case "propose":
            return proposeMediaChange(ctx, card, action.selection, action.instruction);
        case "draft_story":
            return proposeMediaStory(ctx, card, action.productionId, action.premise);
        case "propose_bible":
            return proposeStyleBible(ctx, card, action.productionId, action.instruction);
        case "review":
            return reviewProduction(ctx, card, action.productionId, action.question);
        case "brief":
            return askForFilmBrief(ctx, card);
        case "open":
            return openMediaStudio(ctx, card, action.start, action.note, scenes.length);
        default:
            return false;
    }
}

/**
 * What to do next in this production, in words, chosen from what it actually
 * holds.
 *
 * The line this replaces told every author to "mark a scene, plot point or shot
 * in the studio and tell me what to change" — including the authors whose
 * production had no scenes at all, for whom there was nothing to mark and
 * therefore nothing they could do. Being told to do an impossible thing is how a
 * room loses someone.
 */
function nextStep(sceneCount: number, note?: MediaIntentKind): string {
    if (sceneCount === 0) {
        return "It has no scenes yet, so tell me what the film is about — a sentence is enough — and I'll draft its story for you to look over.";
    }
    switch (note) {
        case "render_keyframes":
            return "Open a scene's Storyboard tab and press Render on a plot point to draw its keyframe. Each render is priced before it runs.";
        case "shoot_takes":
            return "Open a scene's Shots tab and press Shoot on a shot. Every video render is approved and priced before anything is spent.";
        case "assemble_reel":
            return "Once a scene's takes are approved, press Assemble on the scene to cut them into its reel.";
        case "review_dailies":
            return "Open Dailies to watch the takes and approve or reshoot them.";
        default:
            return "Tell me what to change and I'll show it before anything is saved — or mark something in the studio to be exact about what you mean.";
    }
}

/**
 * Open the studio on the room's production, or start one from a brief.
 *
 * A card without the tool leaves the round to the speakers.
 */
async function openMediaStudio(
    ctx: RoundContext,
    card: AgentCardRecord,
    start: FilmIntake | undefined,
    note: MediaIntentKind | undefined,
    sceneCount: number,
): Promise<boolean> {
    const tools = ctx.prefetch.toolsMap.get(card.id) ?? [];
    if (!tools.some((tool) => tool.definition.name === "mount_media_studio")) return false;

    const params = start
        ? { productionTitle: start.productionTitle, create: true, ...(start.aspectRatio ? { aspectRatio: start.aspectRatio } : {}) }
        : {};
    const { record, output, artifact } = await crewToolsService.execute("mount_media_studio", params, tools, toolContext(ctx));
    ctx.cost.toolCalls++;
    if (!record.ok) return false;

    if (!artifact) {
        await postTurn(ctx, card, { content: output, record });
        return true;
    }
    const p = artifact.payload as { productionId?: number; productionTitle?: string; created?: boolean; sceneCount?: number };
    /*
     * What the production the tool OPENED holds, not what the round counted
     * beforehand. The round counts scenes from the studio already mounted, which
     * on a first mount is nothing — so this told an author with a story already
     * imported that their production had no scenes yet. A production just created
     * has none whatever anything says.
     */
    const scenes = p.created ? 0 : (typeof p.sceneCount === "number" ? p.sceneCount : sceneCount);
    const content = p.created
        ? `Started "${p.productionTitle}" in Media Studio beside the conversation. ${nextStep(0)} Every video render asks for approval before anything is spent.`
        : p.productionId
            ? `Media Studio is open on "${p.productionTitle}". ${nextStep(scenes, note)}`
            : "Media Studio is open beside the conversation. This room has no production yet: tell me what film you want to make and I'll start it.";
    await postTurn(ctx, card, { content, artifact, record });
    return true;
}

/**
 * Ask what film to make, as the brief rather than as a question.
 *
 * "I want to make a video" carries an intent and no title. Answering it by
 * inventing one — "New Video Production", which is what a model reaching for the
 * mount tool on its own actually called it — looks like a decision was taken when
 * nothing was learned. Mounting the same brief the Make a Film playbook uses asks
 * for the two things a production needs and starts it on the author's answer.
 */
async function askForFilmBrief(ctx: RoundContext, card: AgentCardRecord): Promise<boolean> {
    const tools = ctx.prefetch.toolsMap.get(card.id) ?? [];
    if (!tools.some((tool) => tool.definition.name === "mount_builder_pod")) return false;

    const { record, output, artifact } = await crewToolsService.execute(
        "mount_builder_pod",
        { podComponent: FILM_BRIEF_POD, stageId: FILM_BRIEF_STAGE, title: "🎬 Make a Film", props: {} },
        tools,
        toolContext(ctx),
    );
    ctx.cost.toolCalls++;
    if (!record.ok || !artifact) {
        if (record.ok) await postTurn(ctx, card, { content: output, record });
        return record.ok;
    }

    await postTurn(ctx, card, {
        content:
            "Let's make it. Give the production a title and the shape you want it in, and I'll open Media Studio on it — " +
            "then tell me what the film is about and I'll draft its story. Nothing renders until you approve it.",
        artifact,
        record,
    });
    return true;
}

/**
 * Draft a change to a scene and post it as a card.
 *
 * Drafting runs a model, so the room answers now and the card arrives as its own
 * turn on the stream the client already appends from.
 */
async function proposeMediaChange(ctx: RoundContext, card: AgentCardRecord, selection: MediaStudioSelection, instruction: string): Promise<boolean> {
    return draftInBackground(ctx, card, {
        tool: "propose_media_change",
        params: { selection, instruction },
        opening: `Drafting that change to ${selection.label}. I'll show it here before anything is saved.`,
        describe: (payload) => describeMediaChangeProposal(payload as unknown as MediaChangeProposal),
        failure: "I couldn't draft that change",
    });
}

/**
 * Draft the production's story, and post it as a card.
 *
 * A story card the room has not applied is the thing a follow-up is about. Say
 * "make the ending darker" while one is on screen and it refines THAT, instead
 * of re-drafting from the production and throwing away everything just read.
 */
async function proposeMediaStory(ctx: RoundContext, card: AgentCardRecord, productionId: number, premise: string): Promise<boolean> {
    const open = latestStoryDraft(ctx.priorTurns as any);
    const refining = open?.productionId === productionId ? open.scenes : null;
    return draftInBackground(ctx, card, {
        tool: "propose_media_story",
        params: { productionId, premise, ...(refining?.length ? { basedOn: refining } : {}) },
        opening: refining?.length
            ? "Reworking the scenes on that card. I'll show you the new version before anything is saved."
            : "Writing that into scenes now. I'll show you the story before anything is saved.",
        describe: (payload) => describeMediaStoryProposal(payload as unknown as MediaStoryProposal),
        failure: "I couldn't draft that story",
    });
}

/**
 * Say what the production needs, and change nothing.
 *
 * Reading it runs a model over the whole production, so the room answers now and
 * the note arrives as its own turn — the same shape the drafts use. It posts no
 * artifact on purpose: the author asked to be told, and a card would be the one
 * thing they said not to do.
 */
async function reviewProduction(ctx: RoundContext, card: AgentCardRecord, productionId: number, question: string): Promise<boolean> {
    return draftInBackground(ctx, card, {
        tool: "review_media_production",
        params: { productionId, question },
        opening: "Reading it through now — I'll give you notes, and change nothing.",
        describe: () => "",
        failure: "I couldn't review that",
    });
}

/** Draft the look the production is shot in, and post it as a card. Refines an unapplied one. */
async function proposeStyleBible(ctx: RoundContext, card: AgentCardRecord, productionId: number, instruction: string): Promise<boolean> {
    const open = latestStyleBibleDraft(ctx.priorTurns as any);
    const refining = open?.productionId === productionId ? open.bible : null;
    return draftInBackground(ctx, card, {
        tool: "propose_style_bible",
        params: { productionId, instruction, ...(refining ? { basedOn: refining } : {}) },
        opening: refining
            ? "Reworking the Style Bible on that card. I'll show you the new version before anything is saved."
            : "Drafting the Style Bible for this production — the look, the period, wardrobe, camera and the anchors that keep faces the same between shots. I'll show it before anything is saved.",
        describe: (payload) => describeStyleBibleProposal(payload as unknown as MediaStyleBibleProposal),
        failure: "I couldn't draft a Style Bible",
    });
}

/**
 * The shape all three drafts share: answer the room now, run the model after.
 *
 * Drafting takes a model call or two — a minute or more for a story — and
 * awaiting it inside the round held the whole room silent while it ran, so the
 * author had no sign their request had even been understood. Everything the
 * background turn needs is captured before the round can move on, because by the
 * time it publishes, ctx has been mutated by the rest of the round.
 */
async function draftInBackground(
    ctx: RoundContext,
    card: AgentCardRecord,
    spec: {
        tool: string;
        params: Record<string, unknown>;
        opening: string;
        describe: (payload: Record<string, unknown>) => string;
        failure: string;
    },
): Promise<boolean> {
    const allowed = await registryTool(spec.tool, "declared-read-safe");
    if (!allowed) return false;

    const started = await postTurn(ctx, card, { content: spec.opening });
    if (!started) return false;

    const context = toolContext(ctx);
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;
    ctx.cost.toolCalls++;

    setImmediate(async () => {
        let content: string;
        let artifact: CrewArtifact | null = null;
        let record: ToolRecord | null = null;
        try {
            const result = await crewToolsService.execute(spec.tool, spec.params, allowed, context);
            record = result.record;
            artifact = result.artifact;
            content = artifact
                ? spec.describe(artifact.payload as Record<string, unknown>)
                : result.record.ok ? result.output : `${spec.failure}: ${result.record.error ?? result.output}`;
        } catch (err: any) {
            logger.error(`${spec.tool} failed: ${err?.message ?? err}`);
            content = `${spec.failure}: ${err?.message ?? err}`;
        }
        await publishTurn({ sessionId, orgId, sessionKey, round, topic, intent, replyTo, card, content, artifact, record });
    });
    return true;
}

/**
 * Apply a drafted change, from the card the author pressed Apply on. What is
 * saved comes from the card's artifact, never from the message.
 */
async function applyMediaChangeFromCard(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findMediaChangeProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That change isn't in this room, so there is nothing to apply." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That change to ${found.proposal.sceneKey} has already been applied.` });
        return true;
    }

    const allowed = await registryTool("apply_media_change", "declared-agent-tool");
    if (!allowed) return false;

    const { proposal } = found;
    const { record, output, artifact } = await crewToolsService.execute("apply_media_change", { proposal }, allowed, toolContext(ctx));
    ctx.cost.toolCalls++;

    await postTurn(ctx, card, {
        content: artifact
            ? `Applied to ${proposal.sceneKey} of "${proposal.productionTitle}": ${proposal.changes.join("; ")}. It is in Media Studio now.`
            : record.ok ? output : `The change was not applied: ${record.error ?? output}`,
        artifact,
        record,
    });
    return true;
}

/** Write a drafted story into the production, from the card the author applied. */
async function applyMediaStoryFromCard(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findMediaStoryProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That story isn't in this room, so there is nothing to write." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That story has already been written into "${found.proposal.productionTitle}".` });
        return true;
    }

    const allowed = await registryTool("apply_media_story", "declared-agent-tool");
    if (!allowed) return false;

    const { proposal } = found;
    const { record, output, artifact } = await crewToolsService.execute("apply_media_story", { proposal }, allowed, toolContext(ctx));
    ctx.cost.toolCalls++;

    const count = proposal.scenes.length;
    await postTurn(ctx, card, {
        content: artifact
            ? `Wrote ${count} scene${count === 1 ? "" : "s"} into "${proposal.productionTitle}": ${proposal.summary.join("; ")}. ` +
              `They are in Media Studio now — render a plot point's keyframe to see it, or tell me what to change.`
            : record.ok ? output : `The story was not written: ${record.error ?? output}`,
        artifact,
        record,
    });
    return true;
}

/** Save a drafted Style Bible, from the card the author applied. */
async function applyStyleBibleFromCard(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findStyleBibleProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That Style Bible isn't in this room, so there is nothing to save." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That Style Bible has already been saved for "${found.proposal.productionTitle}".` });
        return true;
    }

    const allowed = await registryTool("apply_style_bible", "declared-agent-tool");
    if (!allowed) return false;

    const { proposal } = found;
    const { record, output, artifact } = await crewToolsService.execute("apply_style_bible", { proposal }, allowed, toolContext(ctx));
    ctx.cost.toolCalls++;

    const savedToProject = Boolean((artifact?.payload as { savedToProject?: boolean } | undefined)?.savedToProject);
    await postTurn(ctx, card, {
        content: artifact
            ? `Saved the Style Bible${savedToProject ? " to this Project Space" : ` for "${proposal.productionTitle}"`}: ${proposal.changes.join("; ")}. ` +
              `Every keyframe and take rendered from here is prompted with it.`
            : record.ok ? output : `The Style Bible was not saved: ${record.error ?? output}`,
        artifact,
        record,
    });
    return true;
}

export function describeMediaChangeProposal(proposal: MediaChangeProposal): string {
    const skipped = proposal.skipped?.length ? ` Left out: ${proposal.skipped.join(" ")}` : "";
    return `Here is the change to ${proposal.sceneKey} "${proposal.sceneTitle}": ${proposal.changes.join("; ")}.${skipped} Press Apply to save it.`;
}

export function describeMediaStoryProposal(proposal: MediaStoryProposal): string {
    const count = proposal.scenes.length;
    const skipped = proposal.skipped?.length ? ` Left out: ${proposal.skipped.join(" ")}` : "";
    return (
        `Here is the story for "${proposal.productionTitle}", in ${count} scene${count === 1 ? "" : "s"}: ${proposal.summary.join(" ")}` +
        `${skipped} Press Apply to write it into the production. Nothing renders until you ask for it.`
    );
}

export function describeStyleBibleProposal(proposal: MediaStyleBibleProposal): string {
    return (
        `Here is the Style Bible for "${proposal.productionTitle}": ${proposal.changes.join("; ")}. ` +
        `Press Apply to save it${proposal.projectId != null ? " to this Project Space" : ""} — every keyframe and take rendered afterwards is prompted with it.`
    );
}
