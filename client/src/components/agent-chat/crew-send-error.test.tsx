/**
 * Every structured crew failure used to read as "The crew could not respond."
 *
 * The panel branched on text inside the error message — msg.includes('429') and
 * msg.includes('503') — but apiRequest throws a ClientAppError whose message has been
 * REPLACED by the server's prose. "Please wait before sending another message."
 * contains no "429", so no branch could ever match and everything fell through to the
 * generic line. Two entirely different faults presented identically:
 *
 *   400 NO_CREW_MEMBERS      the room has no agents (a cross-org room fork)
 *   503 SERVICE_UNAVAILABLE  the org has no llm_models binding
 *
 * Both were named precisely by the server and discarded by the client.
 */
import { describe, it, expect } from "vitest";
import { crewSendErrorMessage } from "./crew-send-error";

/** Mirrors what apiRequest throws: server prose plus the real status. */
const clientError = (message: string, statusCode: number) =>
    Object.assign(new Error(message), { statusCode });

describe("crewSendErrorMessage", () => {
    it("shows the server's reason when a room has no agents", () => {
        const msg = "No agents in this crew — add at least one agent before starting a discussion.";
        expect(crewSendErrorMessage(clientError(msg, 400))).toBe(msg);
    });

    it("shows the server's reason when the room belongs to another organization", () => {
        const msg = 'Room not in this organization: "crew-abc" belongs to a different organization.';
        expect(crewSendErrorMessage(clientError(msg, 404))).toBe(msg);
    });

    it("shows the server's reason when the org is out of budget", () => {
        const msg = "Monthly spend limit reached.";
        expect(crewSendErrorMessage(clientError(msg, 402))).toBe(msg);
    });

    it("uses its own wording for a cooldown, which is about waiting rather than acting", () => {
        const out = crewSendErrorMessage(clientError("Please wait before sending another message.", 429));
        expect(out).toBe("The crew is still finishing the last round — try again in a moment.");
    });

    it("passes the provider-unavailable reason through on 503", () => {
        const msg = "No model provider is currently available. Please retry later.";
        expect(crewSendErrorMessage(clientError(msg, 503))).toBe(msg);
    });

    it("falls back to the generic line for a 500, whose prose may be internal", () => {
        const out = crewSendErrorMessage(clientError("TypeError: undefined is not a function", 500));
        expect(out).toBe("The crew could not respond. Please try again.");
    });

    it("falls back when there is no status at all, such as a network failure", () => {
        expect(crewSendErrorMessage(new Error("Failed to fetch"))).toBe(
            "The crew could not respond. Please try again.",
        );
        expect(crewSendErrorMessage(undefined)).toBe("The crew could not respond. Please try again.");
    });

    it("does not report a 400 as a cooldown just because its text contains 429", () => {
        // The exact confusion the old message-substring matching produced.
        const msg = "Agent card 429 is not enabled for this room.";
        expect(crewSendErrorMessage(clientError(msg, 400))).toBe(msg);
    });
});
