import { describe, expect, it } from "vitest";
import { scribeConversationIntent } from "./scribe-conversation";

describe("natural authoring controls", () => {
    it.each(["Hold on", "Please pause.", "Let me change this", "stop the agents", "wait!"])("pauses on %s", (message) => {
        expect(scribeConversationIntent(message)).toBe("pause");
    });
    it.each(["Continue", "resume", "carry on", "keep going please"])("resumes on %s", (message) => {
        expect(scribeConversationIntent(message)).toBe("resume");
    });
    it.each(["Write a section about pause and resume", 'Insert "hold on" into the dialogue', "Do not pause", "How do I stop the agents?"])("does not execute quoted or discussed controls: %s", (message) => {
        expect(scribeConversationIntent(message)).not.toBe("pause");
    });
    it.each(["Review this section", "Audit the document", "Check continuity without editing", "Suggest a rewrite, don't edit"])("keeps review read-only: %s", (message) => {
        expect(scribeConversationIntent(message)).toBe("review");
    });
    it.each(["Can you review the introduction?", "Just proofread the draft", "Give feedback but don't change anything"])("recognizes a review request: %s", (message) => {
        expect(scribeConversationIntent(message)).toBe("review");
    });
    it.each([
        "Add a section about our audit process",
        "Add a table of contents and check the spelling",
        "Create a compliance review document",
        "Write the executive summary and assess the risks",
        "Update the security review section with the new findings",
        "Rewrite the intro without changing the meaning",
    ])("does not treat a review word inside an edit as review-only: %s", (message) => {
        expect(scribeConversationIntent(message)).not.toBe("review");
    });
    it("distinguishes review-and-apply from review only", () => {
        expect(scribeConversationIntent("Review this and apply the corrections")).not.toBe("review");
    });
    it.each(["Try that again, but less formal", "Keep the first paragraph", "Actually, change direction"])("recognizes revisions: %s", (message) => {
        expect(scribeConversationIntent(message)).toBe("revise");
    });
});
