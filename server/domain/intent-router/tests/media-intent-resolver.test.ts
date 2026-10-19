import { describe, expect, it } from "vitest";
import {
    decideMediaStudioAction, mediaIntentResolver, resolveSceneTarget,
} from "@domain/intent-router/core/media-intent-resolver.service.js";
import {
    applyMediaChangeMessage, applyMediaStoryMessage, applyStyleBibleMessage, type MountedMediaProduction,
} from "@shared/media-studio-crew.js";
import { mediaStudioScopePrefix } from "@shared/media-studio.js";

/**
 * The cases in here are the conversation that prompted this resolver, turn by
 * turn. Session 410 opened with "I want to make a video", mounted an empty
 * production a model named "New Video Production", and then spent six rounds
 * building a Scribe document and a database migration about AI video style
 * guides while the empty storyboard sat beside it. Every `it` below pins one of
 * the decisions that went wrong.
 */

const open: MountedMediaProduction = { productionId: 8, productionTitle: "Rooftop chase", aspectRatio: "2.39:1", sceneKey: "SCENE-02" };

const scenes = [
    { id: 21, sceneKey: "SCENE-01", title: "Arrival" },
    { id: 22, sceneKey: "SCENE-02", title: "The rooftop" },
    { id: 23, sceneKey: "SCENE-03", title: "The stairwell" },
];

const selection = { productionId: 8, sceneId: 22, sceneKey: "SCENE-02", kind: "scene" as const, id: 22, label: "SCENE-02: The rooftop" };
const marked = (text: string) => `${mediaStudioScopePrefix(selection)} ${text}`;

describe("round 1 of the conversation this fixes", () => {
    it('asks for the brief rather than inventing "New Video Production"', () => {
        expect(decideMediaStudioAction("I want to make a video", null)).toEqual({ kind: "brief" });
        expect(decideMediaStudioAction("can we make a short film", null)).toEqual({ kind: "brief" });
        expect(decideMediaStudioAction("I'd like to produce a commercial", null)).toEqual({ kind: "brief" });
    });

    it("starts the film outright when the author already said what it is", () => {
        expect(decideMediaStudioAction("make a video about a rooftop chase", null))
            .toEqual({ kind: "open", start: { productionTitle: "Rooftop chase" } });
        expect(decideMediaStudioAction('make a short film called "The Archive"', null))
            .toEqual({ kind: "open", start: { productionTitle: "The Archive" } });
    });
});

describe("round 2: a studio open on an empty production", () => {
    const empty: MountedMediaProduction = { productionId: 8, productionTitle: "New Video Production" };

    it("treats anything substantive about an empty production as a request for its story", () => {
        // Every one of these previously fell through to a crew that did not know
        // the production existed. There is nothing to change, shoot or cut in a
        // production with no scenes, so the only useful answer is its story.
        for (const message of [
            "it's about a courier who steals a file",
            "make it darker and more tense",
            "add a scene where she reaches the roof",
            "tighten the opening",
        ]) {
            expect(decideMediaStudioAction(message, empty, [])).toEqual({ kind: "draft_story", productionId: 8, premise: message });
        }
    });

    it("continues the open production rather than starting a second one", () => {
        expect(decideMediaStudioAction("let's make a video about a heist", empty, []))
            .toMatchObject({ kind: "draft_story", productionId: 8 });

        // Only an explicit restart forges a second production.
        expect(decideMediaStudioAction("actually, start over with a new film about a heist", empty, []))
            .toEqual({ kind: "open", start: { productionTitle: "Heist" } });
    });
});

describe("rounds 3 to 7: the Style Bible the room rebuilt as a SQL migration", () => {
    it("routes style-bible language to the Style Bible Media Studio already keeps", () => {
        for (const message of [
            "what would a good style bible for this look like",
            "we need a look book for the whole thing",
            "set the colour palette and wardrobe rules",
            "how do we keep her face consistent between shots",
        ]) {
            expect(decideMediaStudioAction(message, open, scenes)).toMatchObject({ kind: "propose_bible", productionId: 8 });
        }
    });

    it("does not reach for a bible with no production open — that is the room's conversation", () => {
        expect(decideMediaStudioAction("what makes a good style bible", null)).toEqual({ kind: "none" });
    });
});

describe("a change to a scene, without anything marked", () => {
    it("acts on the scene the message names", () => {
        expect(decideMediaStudioAction("make scene 1 colder", open, scenes))
            .toMatchObject({ kind: "propose", selection: { sceneId: 21, sceneKey: "SCENE-01" } });
        expect(decideMediaStudioAction("the last scene needs to end on her face", open, scenes))
            .toMatchObject({ kind: "propose", selection: { sceneId: 23 } });
        expect(decideMediaStudioAction("cut a line from The stairwell", open, scenes))
            .toMatchObject({ kind: "propose", selection: { sceneId: 23 } });
    });

    it('falls back to the scene the studio is open on — which is what "it" means', () => {
        expect(decideMediaStudioAction("make the mood colder", open, scenes))
            .toMatchObject({ kind: "propose", selection: { sceneId: 22 }, instruction: "make the mood colder" });
    });

    it("reads a reported problem as a change, not just an instruction", () => {
        // People report far more often than they instruct. None of these begins
        // with a change verb, so the leading-verb regex this replaces read every
        // one of them as ordinary conversation.
        for (const message of ["the second shot drags", "her coat should be red", "the mood feels flat"]) {
            expect(decideMediaStudioAction(message, open, scenes)).toMatchObject({ kind: "propose" });
        }
    });

    it("prefers what the author actually marked over anything it could infer", () => {
        expect(decideMediaStudioAction(marked("make the mood colder"), open, scenes))
            .toEqual({ kind: "propose", selection, instruction: "make the mood colder" });
    });

    it("asks rather than guessing when several scenes could be meant", () => {
        const noSceneOpen: MountedMediaProduction = { productionId: 8, productionTitle: "Rooftop chase" };
        expect(decideMediaStudioAction("make the mood colder", noSceneOpen, scenes)).toEqual({ kind: "none" });
        // One scene is unambiguous, so it needs no marker.
        expect(decideMediaStudioAction("make the mood colder", noSceneOpen, [scenes[0]]))
            .toMatchObject({ kind: "propose", selection: { sceneId: 21 } });
    });
});

describe("what the room must not act on", () => {
    it("never turns an explicit request for discussion into a change", () => {
        // These now reach the read-only review path rather than being dropped
        // (see "asking to be told" below). What must never happen is a proposal.
        for (const message of ["just suggest how to tighten scene 2, don't change anything", "only review the shots for now"]) {
            expect(decideMediaStudioAction(message, open, scenes).kind).toBe("review");
        }
    });

    it("answers a question about the film instead of rewriting it", () => {
        // Below the writing threshold, so no proposal — but the resolver still
        // knows it is a film question, which is what the room lacked.
        expect(decideMediaStudioAction("what does scene 2 need?", open, scenes)).toEqual({ kind: "none" });
        expect(mediaIntentResolver.resolve("what does scene 2 need?", { production: open, sceneCount: 3 }))
            .toMatchObject({ intent: "change_scene", confidence: 0.65 });
    });

    it("leaves an ordinary conversation to the room", () => {
        for (const message of ["how is the sprint going", "who owns the billing service", "thanks, that's great"]) {
            expect(decideMediaStudioAction(message, open, scenes)).toEqual({ kind: "none" });
        }
    });

    it("never spends money: rendering, shooting and cutting open the control instead", () => {
        expect(decideMediaStudioAction("render the keyframes", open, scenes)).toEqual({ kind: "open", note: "render_keyframes" });
        expect(decideMediaStudioAction("shoot scene 2", open, scenes)).toEqual({ kind: "open", note: "shoot_takes" });
        expect(decideMediaStudioAction("cut it together into a reel", open, scenes)).toEqual({ kind: "open", note: "assemble_reel" });
        expect(decideMediaStudioAction("let's review the dailies", open, scenes)).toEqual({ kind: "open", note: "review_dailies" });
    });
});

describe("the approvals a card sends", () => {
    it("are read before anything else gets to reinterpret them", () => {
        expect(decideMediaStudioAction(applyMediaChangeMessage("mediachg_0123456789"), open, scenes))
            .toEqual({ kind: "apply", proposalId: "mediachg_0123456789" });
        expect(decideMediaStudioAction(applyMediaStoryMessage("mediastory_12345678"), open, scenes))
            .toEqual({ kind: "apply_story", proposalId: "mediastory_12345678" });
        expect(decideMediaStudioAction(applyStyleBibleMessage("mediabible_12345678"), open, scenes))
            .toEqual({ kind: "apply_bible", proposalId: "mediabible_12345678" });
    });

    it("opens the studio on a film started from the brief", () => {
        expect(decideMediaStudioAction('I completed stage "film-brief" with configuration: {"productionTitle":"Rooftop chase","aspectRatio":"2.39:1"}', null))
            .toEqual({ kind: "open", start: { productionTitle: "Rooftop chase", aspectRatio: "2.39:1" } });
    });
});

describe("opening the studio", () => {
    it("needs no writer's confidence, because it writes nothing", () => {
        expect(decideMediaStudioAction("open Media Studio", null)).toEqual({ kind: "open" });
        expect(decideMediaStudioAction("can you pull up the storyboard", null)).toEqual({ kind: "open" });
        expect(decideMediaStudioAction("take me back to the shot list", open, scenes)).toEqual({ kind: "open" });
    });
});

describe("which scene a message is about", () => {
    const production: MountedMediaProduction = { productionId: 8, sceneKey: "SCENE-02" };

    it("reads a scene key, a number, an ordinal and a title, strongest evidence first", () => {
        expect(resolveSceneTarget("change SCENE-03", production, scenes)).toMatchObject({ sceneId: 23 });
        expect(resolveSceneTarget("change scene 1", production, scenes)).toMatchObject({ sceneId: 21 });
        expect(resolveSceneTarget("the second scene drags", production, scenes)).toMatchObject({ sceneId: 22 });
        expect(resolveSceneTarget("the opening scene drags", production, scenes)).toMatchObject({ sceneId: 21 });
        expect(resolveSceneTarget("Arrival should be shorter", production, scenes)).toMatchObject({ sceneId: 21 });
    });

    it("labels what it resolved, so the card says what the change is about", () => {
        expect(resolveSceneTarget("change scene 1", production, scenes)).toEqual({
            productionId: 8, sceneId: 21, sceneKey: "SCENE-01", kind: "scene", id: 21, label: "SCENE-01: Arrival",
        });
    });

    it("gives up rather than guessing", () => {
        expect(resolveSceneTarget("make it colder", { productionId: 8 }, scenes)).toBeNull();
        expect(resolveSceneTarget("change scene 9", { productionId: 8 }, scenes)).toBeNull();
        expect(resolveSceneTarget("make it colder", production, [])).toBeNull();
    });
});

/**
 * The room runs this resolver before App Studio's, Form Studio's and Scribe's,
 * so anything it claims, they never see. These pin the boundary.
 */
describe("the studios it must not speak for", () => {
    it("leaves the other studios' mounts alone", () => {
        for (const message of ["open App Studio", "open Form Studio", "open the app studio", "mount scribe studio", "open the builder"]) {
            expect(decideMediaStudioAction(message, null)).toEqual({ kind: "none" });
        }
    });

    it("leaves app and document work alone, even with a production open", () => {
        for (const message of [
            "build me a dashboard for orders",
            "add a page to the app",
            "write a PRD for the billing service",
            "make the header sticky",
            "publish the app",
        ]) {
            expect(decideMediaStudioAction(message, open, scenes)).toEqual({ kind: "none" });
        }
    });

    it("claims a film surface by name, wherever it is asked for", () => {
        expect(decideMediaStudioAction("open Media Studio", null)).toEqual({ kind: "open" });
        expect(decideMediaStudioAction("show me the storyboard", null)).toEqual({ kind: "open" });
    });
});

describe("asking to be told rather than to have it changed", () => {
    it("answers about the production instead of dropping the round", () => {
        // Each of these previously returned none, so the round fell to a crew
        // that had never heard of the production — asking for an opinion got a
        // worse answer than asking for a change.
        for (const message of [
            "just suggest how to tighten scene 2, don't change anything",
            "only review the shots for now",
            "just tell me what this needs, don't edit it",
        ]) {
            expect(decideMediaStudioAction(message, open, scenes)).toEqual({
                kind: "review", productionId: 8, question: message,
            });
        }
    });

    it("still writes nothing, and still says nothing with no production open", () => {
        expect(mediaIntentResolver.resolve("just review the shots", { production: open, sceneCount: 3 }))
            .toMatchObject({ intent: "review_production" });
        expect(decideMediaStudioAction("just review the shots for now", null)).toEqual({ kind: "none" });
    });
});
