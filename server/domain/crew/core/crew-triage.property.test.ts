/**
 * Property-Based Tests: Triage gating and speaker selection.
 *
 * Triage decides whether a message is worth convening the crew over. Getting it
 * wrong is expensive in both directions: too permissive and a greeting costs
 * four model calls and writes junk into agent knowledge graphs; too strict and
 * real questions get a single conversational reply.
 *
 * Speaker selection decides who talks. The invariant that matters is that an
 * explicit @mention wins outright — if a user names who they want, affinity
 * scoring must not override them.
 *
 * Uses fast-check with a minimum of 100 iterations per property.
 */

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

// The orchestrator module pulls in the database at import time; selectSpeakers
// and parseMentions are pure, so the connection is stubbed out.
vi.mock("@server/database_service.js", () => ({ db: {} }));

import { crewTriageService } from "./crew-triage.service.js";
import { CrewOrchestratorService } from "./crew-orchestrator.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

const orchestrator = new CrewOrchestratorService();

function card(
    id: number,
    name: string,
    topics: string[] = [],
    intents: string[] = [],
): AgentCardRecord {
    return {
        id,
        name,
        topicAffinities: topics,
        intentAffinities: intents,
    } as unknown as AgentCardRecord;
}

// ─── Triage ───────────────────────────────────────────────────────────────────

describe("crewTriageService.assess", () => {
    it("routes bare pleasantries to a conversational reply", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    "hi", "Hi", "hello", "hey", "thanks", "Thanks!", "ok", "cool",
                    "yes", "no", "bye", "good morning", "got it", "cheers",
                ),
                (greeting) => crewTriageService.assess(greeting).mode === "conversational",
            ),
            { numRuns: 100 },
        );
    });

    it("routes very short input to a conversational reply", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom("a", "the", "it", "yes"), { minLength: 1, maxLength: 2 }),
                (words) => crewTriageService.assess(words.join(" ")).mode === "conversational",
            ),
            { numRuns: 100 },
        );
    });

    it("convenes the crew for a substantive question", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    "Should we require code review on every production deployment, or allow hotfixes to bypass it?",
                    "Why did our checkout conversion drop after the last release, and what should we do?",
                    "How should we prioritise the model retraining backlog this quarter?",
                    "What are the biggest risks in our current deployment process?",
                    "Compare the tradeoffs between canary deployments and blue-green for our stack.",
                ),
                (q) => crewTriageService.assess(q).mode === "discussion",
            ),
            { numRuns: 100 },
        );
    });

    it("convenes the crew for an explicit discussion invitation", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    "Lets talk about QA",
                    "Let's discuss release quality",
                    "Can we brainstorm test coverage",
                    "Start a discussion about accessibility",
                ),
                (message) => crewTriageService.assess(message).mode === "discussion",
            ),
            { numRuns: 100 },
        );
    });

    it("always convenes the crew when an agent is @mentioned", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("AI Trainer", "QA Planner", "Security Auditor"),
                fc.constantFrom("what do you think", "please weigh in here", "can you check this"),
                (name, rest) =>
                    crewTriageService.assess(`@${name} ${rest}`).mode === "discussion",
            ),
            { numRuns: 100 },
        );
    });

    it("always reports substance within [0, 1]", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 400 }), (s) => {
                const { substance } = crewTriageService.assess(s);
                return substance >= 0 && substance <= 1;
            }),
            { numRuns: 300 },
        );
    });

    it("gives a reason for every decision", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200 }), (s) => {
                const r = crewTriageService.assess(s);
                return typeof r.reason === "string" && r.reason.length > 0;
            }),
            { numRuns: 200 },
        );
    });
});

// ─── Mentions ─────────────────────────────────────────────────────────────────

describe("parseMentions", () => {
    const roster = [
        card(1, "AI"),
        card(2, "AI Trainer"),
        card(3, "AI Trainer Deluxe"),
        card(4, "QA Planner"),
    ];

    it("matches the longest name, so a short name does not shadow a longer one", () => {
        const hit = orchestrator.parseMentions("@AI Trainer Deluxe please look", roster);
        expect(hit[0].name).toBe("AI Trainer Deluxe");
    });

    it("is case-insensitive", () => {
        expect(orchestrator.parseMentions("@qa planner hello", roster)[0].name).toBe("QA Planner");
    });

    it("returns nothing when no @ is present", () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 80 }).filter((s) => !s.includes("@")),
                (s) => orchestrator.parseMentions(s, roster).length === 0,
            ),
            { numRuns: 200 },
        );
    });

    it("never returns an agent absent from the roster", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 80 }), (s) => {
                const ids = new Set(roster.map((r) => r.id));
                return orchestrator.parseMentions(s, roster).every((m) => ids.has(m.id));
            }),
            { numRuns: 200 },
        );
    });
});

// ─── Speaker selection ────────────────────────────────────────────────────────

describe("selectSpeakers", () => {
    const roster = [
        card(1, "Coder", ["Code"], ["Code Execution"]),
        card(2, "Analyst", ["Finance"], ["Analysis"]),
        card(3, "Generalist", [], []),
        card(4, "Auditor", ["Legal"], ["Alert"]),
        card(5, "Writer", ["Media"], ["Chat"]),
    ];

    it("an @mention overrides affinity entirely", () => {
        // Writer has no affinity for Code, but was named.
        const picked = orchestrator.selectSpeakers(roster, "Code", "Code Execution", "@Writer look at this");
        expect(picked.map((p) => p.name)).toEqual(["Writer"]);
    });

    it("never returns more than the per-round cap", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("Code", "Finance", "Legal", "Media", "General"),
                fc.constantFrom("Code Execution", "Analysis", "Alert", "Chat"),
                (topic, intent) =>
                    orchestrator.selectSpeakers(roster, topic, intent, "no mention here").length <= 3,
            ),
            { numRuns: 200 },
        );
    });

    it("only ever returns members of the roster, without duplicates", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("Code", "Finance", "Legal", "Media", "General"),
                fc.constantFrom("Code Execution", "Analysis", "Alert", "Chat"),
                (topic, intent) => {
                    const picked = orchestrator.selectSpeakers(roster, topic, intent, "");
                    const ids = picked.map((p) => p.id);
                    const rosterIds = new Set(roster.map((r) => r.id));
                    return (
                        new Set(ids).size === ids.length && ids.every((id) => rosterIds.has(id))
                    );
                },
            ),
            { numRuns: 200 },
        );
    });

    it("puts the best-matching agent first", () => {
        // Coder matches both topic and intent; nobody else matches either.
        const picked = orchestrator.selectSpeakers(roster, "Code", "Code Execution", "");
        expect(picked[0].name).toBe("Coder");
    });

    it("is deterministic — the same inputs give the same order", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("Code", "Finance", "Legal"),
                fc.constantFrom("Analysis", "Alert", "Chat"),
                (topic, intent) => {
                    const a = orchestrator.selectSpeakers(roster, topic, intent, "");
                    const b = orchestrator.selectSpeakers(roster, topic, intent, "");
                    return a.map((x) => x.id).join() === b.map((x) => x.id).join();
                },
            ),
            { numRuns: 100 },
        );
    });

    it("still fields speakers when nobody has a matching affinity", () => {
        const picked = orchestrator.selectSpeakers(roster, "Health", "Video", "");
        expect(picked.length).toBeGreaterThan(0);
    });
});
