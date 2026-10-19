/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { AUTOMATCH_FLOOR, adaptGenericStepsToRecordedSteps, cleanSteps, describeStep, fallbackSynthesis, fillTemplate, inferParametersHeuristically, matchSkill, siteOf, skillReliability } from "./learned-skills.service.js";
import type { RecordedStep } from "./skill-recorder.js";
import { GoodQuestionEngine } from "../../ai/core/good-question-engine.js";

const step = (s: Partial<RecordedStep> & Pick<RecordedStep, "kind">): RecordedStep => ({ url: "https://www.wikipedia.org/", at: 0, ...s });

describe("cleanSteps", () => {
    it("keeps the typed-URL navigation and drops navigations the next page load caused", () => {
        const out = cleanSteps([
            step({ kind: "navigate", url: "https://www.wikipedia.org/", direct: true }),
            step({ kind: "navigate", url: "https://www.wikipedia.org/", direct: true }), // duplicate
            step({ kind: "fill", value: "Honolulu", target: { tag: "input", css: "input" } }),
            step({ kind: "press", key: "Enter", target: { tag: "input", css: "input" } }),
            step({ kind: "navigate", url: "https://en.wikipedia.org/wiki/Honolulu", direct: false }), // caused by Enter
            step({ kind: "press", key: "Tab" }),
        ]);
        expect(out.map((s) => s.kind)).toEqual(["navigate", "fill", "press"]);
    });

    it("keeps only the last of back-to-back direct navigations (the tab open at start led nowhere)", () => {
        const out = cleanSteps([
            step({ kind: "navigate", url: "https://example.com/", direct: true }),
            step({ kind: "navigate", url: "https://www.wikipedia.org/", direct: true }),
            step({ kind: "fill", value: "Honolulu", url: "https://www.wikipedia.org/", target: { tag: "input", css: "input" } }),
        ]);
        expect(out.map((s) => s.url)).toEqual(["https://www.wikipedia.org/", "https://www.wikipedia.org/"]);
    });

    it("takes the site from where the person interacted, not the first page seen", () => {
        expect(siteOf([
            step({ kind: "navigate", url: "https://example.com/", direct: true }),
            step({ kind: "fill", value: "x", url: "https://www.wikipedia.org/", target: { tag: "input", css: "input" } }),
        ])).toBe("www.wikipedia.org");
    });

    it("starts with a navigation to where the first interaction happened", () => {
        const out = cleanSteps([
            step({ kind: "fill", value: "Honolulu", url: "https://www.wikipedia.org/", target: { tag: "input", css: "input" } }),
        ]);
        expect(out.map((s) => [s.kind, s.url])).toEqual([["navigate", "https://www.wikipedia.org/"], ["fill", "https://www.wikipedia.org/"]]);
    });

    it("replaces a navigation in another tab with one to where the person acted", () => {
        const out = cleanSteps([
            step({ kind: "navigate", url: "https://example.com/", direct: true }),
            step({ kind: "click", url: "https://www.wikipedia.org/", target: { tag: "a", css: "a" } }),
        ]);
        expect(out.map((s) => [s.kind, s.url])).toEqual([["navigate", "https://www.wikipedia.org/"], ["click", "https://www.wikipedia.org/"]]);
    });

    it("strips any value that slipped into a secret step", () => {
        const out = cleanSteps([step({ kind: "fill", secret: "password", value: "leaked", target: { tag: "input", css: "input" } })]);
        expect(out[0].value).toBeUndefined();
    });
});

describe("matchSkill", () => {
    const skill = (over: Record<string, unknown>) => ({
        id: "s", organizationId: 1, name: "Search Wikipedia for an article", description: "Opens Wikipedia and searches",
        site: "www.wikipedia.org", goalExample: "Search Wikipedia for Honolulu", status: "active", ...over,
    }) as any;

    it("matches a similar goal on the same site", () => {
        expect(matchSkill([skill({})], "Search Wikipedia for Paris")?.id).toBe("s");
    });

    it("matches a goal that asks for more than the skill does (a live run missed this)", () => {
        const s = skill({ name: "Search wikipedia", inputs: [{ name: "search_query", example: "Honolulu" }] });
        expect(matchSkill([s], "Search Wikipedia for Tokyo and tell me the population figure shown in its infobox")?.id).toBe("s");
    });

    it("ignores drafts, other sites and unrelated goals", () => {
        expect(matchSkill([skill({ status: "draft" })], "Search Wikipedia for Paris")).toBeUndefined();
        expect(matchSkill([skill({})], "Search LinkedIn for Paris")).toBeUndefined();
        expect(matchSkill([skill({})], "Order a pizza on Wikipedia")).toBeUndefined();
    });

    it("prefers the closest skill", () => {
        const a = skill({ id: "a", name: "Wikipedia random article", description: "", goalExample: "" });
        const b = skill({ id: "b" });
        expect(matchSkill([a, b], "Search Wikipedia for an article about Paris")?.id).toBe("b");
    });
});

describe("fillTemplate", () => {
    it("fills inputs and refuses to run with one missing", () => {
        expect(fillTemplate("{{search_term}}", { search_term: "Paris" })).toBe("Paris");
        expect(fillTemplate("to {{a}} and {{b}}", { a: "x" })).toBeUndefined();
        expect(fillTemplate("literal", {})).toBe("literal");
    });
});

describe("fallback synthesis", () => {
    it("writes a procedure from the steps, and says a person enters secrets", () => {
        const steps = [
            step({ kind: "navigate", url: "https://www.linkedin.com/login", direct: true }),
            step({ kind: "fill", secret: "password", url: "https://www.linkedin.com/login", target: { tag: "input", label: "Password", css: "input" } }),
            step({ kind: "click", url: "https://www.linkedin.com/login", target: { tag: "button", role: "button", name: "Sign in", css: "button" } }),
        ];
        const out = fallbackSynthesis(steps, "Log in to LinkedIn");
        expect(siteOf(steps)).toBe("www.linkedin.com");
        expect(out.procedure).toBe([
            "1. Go to https://www.linkedin.com/login",
            '2. Ask the user to enter their password in "Password"',
            '3. Click "Sign in"',
        ].join("\n"));
        expect(describeStep(steps[1])).not.toContain("undefined");
    });
});

describe("how much a skill has earned the right to run on its own", () => {
    const counted = (successCount: number, failureCount: number) => ({ successCount, failureCount });

    it("trusts an approved skill that has not run yet, because a person approved it", () => {
        // Otherwise a skill could never be chosen automatically: it would need runs it is
        // not allowed to have.
        expect(skillReliability(counted(0, 0))).toBe(0.5);
        expect(skillReliability(counted(0, 0))).toBeGreaterThan(AUTOMATCH_FLOOR);
    });

    it("does not call one success proof", () => {
        // One run is one data point, not a 100% record.
        expect(skillReliability(counted(1, 0))).toBeLessThan(0.3);
        expect(skillReliability(counted(8, 0))).toBeGreaterThan(0.6);
    });

    it("drops a skill that keeps failing below the floor, and keeps a mostly-good one", () => {
        expect(skillReliability(counted(1, 2))).toBeLessThan(AUTOMATCH_FLOOR);
        expect(skillReliability(counted(9, 1))).toBeGreaterThan(AUTOMATCH_FLOOR);
    });

    it("stops choosing a failing skill for a goal it claims, leaving the planner to drive", () => {
        const failing = { id: "s", organizationId: 1, name: "Search Wikipedia for an article", description: "",
            site: "www.wikipedia.org", goalExample: "Search Wikipedia for Honolulu", status: "active",
            successCount: 1, failureCount: 4 } as any;
        expect(matchSkill([failing], "Search Wikipedia for Paris")).toBeUndefined();

        // Named explicitly it still runs; only automatic selection is withdrawn.
        expect(skillReliability(failing)).toBeLessThan(AUTOMATCH_FLOOR);
    });

    it("prefers the skill with the better record when two claim the same goal", () => {
        const base = { organizationId: 1, name: "Search Wikipedia for an article", description: "",
            site: "www.wikipedia.org", goalExample: "Search Wikipedia for Honolulu", status: "active" };
        const proven = { ...base, id: "proven", successCount: 9, failureCount: 0 } as any;
        const unproven = { ...base, id: "unproven", successCount: 0, failureCount: 0 } as any;
        expect(matchSkill([unproven, proven], "Search Wikipedia for Paris")?.id).toBe("proven");
    });
});

describe("adaptGenericStepsToRecordedSteps", () => {
    it("converts agent navigation, click, and fill steps into standard RecordedStep objects", () => {
        const rawSteps = [
            { action: "goto", value: "https://oddjob.ai/login" },
            { action: "type", selector: "#email-input", value: "agent@oddjob.ai" },
            { action: "type", selector: "#password-input", value: "HIDDEN_CAPTCHA_SOL" },
            { action: "click", selector: "button[type='submit']" },
            { action: "wait" }
        ];

        const adapted = adaptGenericStepsToRecordedSteps(rawSteps, "oddjob.ai");
        expect(adapted).toHaveLength(5);
        expect(adapted[0]).toMatchObject({ kind: "navigate", url: "https://oddjob.ai/login", direct: true });
        expect(adapted[1]).toMatchObject({ kind: "fill", url: "https://oddjob.ai/login", value: "agent@oddjob.ai" });
        expect(adapted[2]).toMatchObject({ kind: "fill", url: "https://oddjob.ai/login", secret: "password" });
        expect(adapted[2].value).toBeUndefined(); // Secrets must never leak values
        expect(adapted[3]).toMatchObject({ kind: "click", url: "https://oddjob.ai/login" });
        expect(adapted[3].target?.css).toBe("button[type='submit']");
        expect(adapted[4]).toMatchObject({ kind: "wait" });
    });

    it("preserves already-valid RecordedSteps", () => {
        const validStep: RecordedStep = { kind: "navigate", url: "https://example.com", at: 500, direct: true };
        const adapted = adaptGenericStepsToRecordedSteps([validStep]);
        expect(adapted[0]).toEqual(validStep);
    });
});

describe("inferParametersHeuristically", () => {
    it("extracts parameters with goal matching and semantic targets", () => {
        const steps = [
            step({ kind: "navigate", url: "https://www.wikipedia.org/" }),
            step({ kind: "fill", url: "https://www.wikipedia.org/", value: "Honolulu", target: { tag: "input", name: "search", css: "input#searchInput" } }),
            step({ kind: "fill", url: "https://www.wikipedia.org/", value: "agent@oddjob.ai", target: { tag: "input", name: "email", css: "input#email" } }),
            step({ kind: "fill", url: "https://www.wikipedia.org/", secret: "password", target: { tag: "input", name: "pwd", css: "input#pwd" } }),
        ];

        const result = inferParametersHeuristically(steps, "Search Wikipedia for Honolulu");
        expect(result.inputs).toHaveLength(2);
        expect(result.inputs[0].name).toBe("search");
        expect(result.inputs[0].example).toBe("Honolulu");
        expect(result.inputs[1].name).toBe("email");
        expect(result.inputs[1].example).toBe("agent@oddjob.ai");

        // The step values should be templated
        expect(result.steps[1].value).toBe("{{search}}");
        expect(result.steps[2].value).toBe("{{email}}");
        // Secret must not be touched or templated
        expect(result.steps[3].value).toBeUndefined();
    });

    it("flags ambiguous UI static values for Socratic clarification when entropy is high", () => {
        const steps = [
            step({ kind: "navigate", url: "https://example.com" }),
            step({ kind: "fill", url: "https://example.com", value: "active", target: { tag: "input", css: "div.unknown > input" } })
        ];

        const result = inferParametersHeuristically(steps, "Filter table");
        expect(result.inputs).toHaveLength(0);
        expect(result.ambiguousCandidates).toHaveLength(1);
        expect(result.ambiguousCandidates[0].entropy).toBeGreaterThan(0.60);
        expect(result.ambiguousCandidates[0].recordedValue).toBe("active");

        // Test GoodQuestionEngine integration for the ambiguous candidate
        const questionCard = GoodQuestionEngine.synthesizeSkillParameterQuestion(
            "Filter table",
            result.ambiguousCandidates[0]
        );
        expect(questionCard.headline).toContain("Filter table");
        expect(questionCard.formAgentPayload.fields[0].id).toBe("parameter_decision");
        expect(questionCard.formAgentPayload.fields[0].options?.[0]).toContain(result.ambiguousCandidates[0].inputName);
    });
});

