import { describe, it, expect } from "vitest";
import { isGreetingMessage, isTrivialChatMessage } from "@domain/agents/core/chat-intent.js";

// Regression guard for the assistant fast-path routing. The bug we are locking out:
// a message that merely STARTS with a trigger word ("help me create a mission",
// "test the pipeline") must NOT be treated as trivial chat — it needs the agent loop.

describe("isGreetingMessage", () => {
    it("matches standalone greetings / thanks / acknowledgements", () => {
        for (const m of ["hi", "hello!", "hey", "thanks", "thank you", "how are you?", "ok", "got it.", "morning", "bye"]) {
            expect(isGreetingMessage(m), m).toBe(true);
        }
    });

    /**
     * "test" and "ping" were in the list above, and are exactly the words
     * GREETING_RE deliberately excludes — its comment says so: a word that
     * could plausibly start a real command must not be a greeting, or
     * "test pipeline 3" silently receives a canned reply. They belong here.
     */
    it("does NOT match short ambiguous words that could open a command", () => {
        for (const m of ["test", "ping", "run", "go"]) {
            expect(isGreetingMessage(m), m).toBe(false);
        }
    });

    it("does NOT match real commands that start with a trigger word", () => {
        for (const m of ["test the pipeline", "ok deploy now", "ping the api server", "morning report please", "got it working yet?", "hey can you build X"]) {
            expect(isGreetingMessage(m), m).toBe(false);
        }
    });

    it("ignores empty / whitespace and overly long messages", () => {
        expect(isGreetingMessage("")).toBe(false);
        expect(isGreetingMessage("   ")).toBe(false);
        expect(isGreetingMessage("thanks " + "x".repeat(40))).toBe(false); // > 25 chars
    });
});

describe("isTrivialChatMessage", () => {
    const noJob = { hasJob: false };

    it("matches standalone small-talk / identity / help outside a job", () => {
        for (const m of ["help", "how are you?", "what can you do", "who are you", "good morning", "thanks", "what's your name"]) {
            expect(isTrivialChatMessage(m, noJob), m).toBe(true);
        }
    });

    it("does NOT match real requests that start with a trigger word", () => {
        for (const m of ["help me create a mission", "help debug the pipeline", "good morning, run the report", "thanks, now show missions", "who are you assigning this to"]) {
            expect(isTrivialChatMessage(m, noJob), m).toBe(false);
        }
    });

    it("never fast-paths inside a job context (tools may be needed)", () => {
        expect(isTrivialChatMessage("help", { hasJob: true })).toBe(false);
        expect(isTrivialChatMessage("how are you?", { hasJob: true })).toBe(false);
    });

    it("respects the 120-char cap and empty input", () => {
        expect(isTrivialChatMessage("", noJob)).toBe(false);
        expect(isTrivialChatMessage("help " + "x".repeat(130), noJob)).toBe(false);
    });
});
