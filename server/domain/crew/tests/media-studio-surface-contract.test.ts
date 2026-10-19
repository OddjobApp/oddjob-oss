/**
 * The contract a Media Studio surface has to satisfy to reach a room, and the
 * governance line it must not cross.
 *
 * Two halves, and both have failed here before in the ways this repo keeps
 * rediscovering:
 *
 * A payload type missing from RICH_PAYLOAD_TYPES makes detectArtifact return
 * null, and the tool's JSON envelope reaches the transcript as prose — the card
 * never renders and nothing errors. Adding the type without a client branch is
 * the same bug wearing the other shoe: the artifact is detected and then
 * silently dropped at render.
 *
 * And the writing tools must stay unreachable by any agent. `propose_*` and
 * `apply_*` are reached from the room's direct path alone, which checks what the
 * message asked for and what the author approved. Listing one in
 * UNIVERSAL_PRESENTATION_TOOLS would let any model in any room rewrite a
 * storyboard, write a story into a production, or change the look every later
 * render is made in — none of which anyone asked for.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    ARTIFACT_TOOLS,
    RICH_PAYLOAD_TYPES,
    UNIVERSAL_PRESENTATION_TOOLS,
    detectArtifact,
} from "../core/crew-tools.service.js";
import { MEDIA_STUDIO_CHANGE_TOOLS } from "../../tools/v1/capabilities/media-studio-change-tools.js";
import {
    MEDIA_CHANGE_PROPOSAL, MEDIA_STORY_PROPOSAL, MEDIA_STUDIO_POD, MEDIA_STYLE_BIBLE_PROPOSAL,
} from "@shared/media-studio-crew.js";

const CARD_TYPES = [MEDIA_CHANGE_PROPOSAL, MEDIA_STORY_PROPOSAL, MEDIA_STYLE_BIBLE_PROPOSAL];

/** The client file that decides what each artifact type renders as. */
const turnRow = readFileSync(join(process.cwd(), "client/src/components/agent-chat/TurnRow.tsx"), "utf8");

describe("a Media Studio card's payload reaches the room", () => {
    it("is detected as an artifact rather than leaking its envelope as prose", () => {
        for (const type of [...CARD_TYPES, MEDIA_STUDIO_POD]) {
            expect(RICH_PAYLOAD_TYPES.has(type), `${type} is missing from RICH_PAYLOAD_TYPES`).toBe(true);

            const output = JSON.stringify({ type, proposalId: "mediachg_0123456789", productionId: 8 });
            expect(detectArtifact("propose_media_change", output)).toEqual({
                tool: "propose_media_change",
                payload: { type, proposalId: "mediachg_0123456789", productionId: 8 },
            });
        }
    });

    it("has a client branch, so a detected artifact is not dropped at render", () => {
        for (const type of CARD_TYPES) {
            expect(turnRow.includes(`p.type === '${type}'`), `TurnRow has no branch for ${type}`).toBe(true);
        }
    });
});

describe("the writing tools stay out of every agent's reach", () => {
    const names = Object.keys(MEDIA_STUDIO_CHANGE_TOOLS);

    it("covers drafting and applying a change, a story and a Style Bible, and reviewing", () => {
        expect(names.sort()).toEqual([
            "apply_media_change", "apply_media_story", "apply_style_bible",
            "propose_media_change", "propose_media_story", "propose_style_bible",
            "review_media_production",
        ]);
    });

    it("offers none of them to an agent, in any room", () => {
        for (const name of names) {
            expect(UNIVERSAL_PRESENTATION_TOOLS.includes(name), `${name} is offered to every agent`).toBe(false);
            expect(ARTIFACT_TOOLS.has(name), `${name} is in ARTIFACT_TOOLS`).toBe(false);
        }
    });

    it("declares what each one costs the author: drafts and reviews read, applies write", () => {
        for (const [name, tool] of Object.entries(MEDIA_STUDIO_CHANGE_TOOLS)) {
            if (name.startsWith("propose_") || name.startsWith("review_")) {
                expect(tool.idempotency, `${name} should write nothing`).toBe("read-safe");
                expect(tool.riskLevel).toBe("low");
            } else {
                expect(tool.idempotency, `${name} writes, so it is not idempotent`).toBe("none");
                expect(tool.riskLevel).toBe("medium");
            }
        }
    });

    it("keeps mounting the studio separate from writing to it", () => {
        // Mounting is how the room hands the studio over, so every agent has it.
        // That is the whole of what an agent may do to a production on its own.
        expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("mount_media_studio");
        expect(ARTIFACT_TOOLS.has("mount_media_studio")).toBe(true);
    });
});
