import { describe, expect, it } from "vitest";
import { resolveDirectiveTarget } from "./crew-supervisor-round.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

const card = (id: number, name: string) => ({ id, name }) as AgentCardRecord;
const resolve = (directive: string, members: AgentCardRecord[]) =>
    resolveDirectiveTarget(directive, members);

const room = [card(1, "Copilot"), card(2, "Research Lead"), card(3, "Research")];

describe("resolveDirectiveTarget", () => {
    it("finds the agent the supervisor addressed", () => {
        expect(resolve("@Copilot, please clarify the request.", room)?.name).toBe("Copilot");
    });

    it("prefers the longest matching name", () => {
        // A room holding both "Research" and "Research Lead" must not resolve
        // "@Research Lead" to the shorter prefix.
        expect(resolve("@Research Lead, take this one.", room)?.name).toBe("Research Lead");
    });

    it("matches regardless of case", () => {
        expect(resolve("@copilot, go ahead.", room)?.name).toBe("Copilot");
    });

    it("returns nothing for a directive addressed to the room", () => {
        // No @mention means no one in particular — the round ends as before.
        expect(resolve("The room should converge on a single position.", room)).toBeNull();
    });

    it("returns nothing for an agent who is not in this room", () => {
        // An @mention of someone absent must not pull them into the discussion.
        expect(resolve("@Auditor, please review.", room)).toBeNull();
    });

    it("returns nothing for an empty directive", () => {
        expect(resolve("", room)).toBeNull();
    });

    it("ignores a bare name with no @", () => {
        // "Copilot said X" is narration about an agent, not an instruction to it.
        expect(resolve("Copilot answered the question already.", room)).toBeNull();
    });

    it("finds the mention mid-sentence", () => {
        expect(resolve("Given the split, @Copilot should answer A or B.", room)?.name).toBe(
            "Copilot",
        );
    });
});
