/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
    asStudioDefinition,
    parseStudioDefinition,
    studioDefinitionSchema,
    definitionIssues,
    evaluateStudio,
    evaluateDecision,
    evaluateResults,
    runStudioTests,
    legacyFieldsProjection,
    legacyConsumerWarnings,
    respondentDefinition,
} from "./form-studio";

/**
 * Version 2 Form Studio definitions: the upgrade from version 1 and plain forms,
 * structural checks, scales, stages, decision rules, result blocks, and what older
 * renderers and respondents receive.
 */

function v2(fields: unknown[], studio: Record<string, unknown> = {}) {
    return studioDefinitionSchema.parse({ fields, studio: { version: 2, pages: [{ id: "page_1", title: "Form" }], ...studio } });
}

describe("upgrading older definitions on read", () => {
    it("turns version 1 into version 2, keeping pages, issues and tests, and making reports reviewer narratives", () => {
        const upgraded = asStudioDefinition({
            fields: [{ key: "score", label: "Score", type: "number" }],
            studio: {
                version: 1,
                pages: [{ id: "intro", title: "Intro", html: "<p>Hi</p>" }],
                sources: [],
                issues: ["Scale undefined"],
                reports: [{ id: "summary", title: "Summary", html: "<p>{{score}}</p>" }],
                tests: [{ name: "t", inputs: { score: 1 }, expected: { score: 1 } }],
            },
        });
        expect(upgraded.studio.version).toBe(2);
        expect(upgraded.studio.pages).toEqual([{ id: "intro", title: "Intro", html: "<p>Hi</p>" }]);
        expect(upgraded.studio.results).toEqual([{ id: "summary", title: "Summary", type: "narrative", audience: "reviewer", html: "<p>{{score}}</p>" }]);
        expect(upgraded.studio.issues).toEqual(["Scale undefined"]);
        expect(upgraded.studio.tests[0].name).toBe("t");
        expect(upgraded.studio.navigation).toEqual({ mode: "paged", allowBack: true, reviewBeforeSubmit: true, showProgress: true });
        expect(upgraded.studio).toMatchObject({ groups: [], scales: [], stages: [], decisionRules: [], actions: [], dataset: null });
    });

    it("opens a plain Form Builder form as one page, keeping fields and keys it does not validate yet", () => {
        const legacy = asStudioDefinition({ fields: [{ key: "tags", label: "Tags", type: "tag_picker" }], sourceType: "app" });
        expect(legacy.fields).toHaveLength(1);
        expect((legacy as any).sourceType).toBe("app");
        expect(legacy.studio.pages).toEqual([{ id: "page_1", title: "Form", html: "" }]);
    });

    it("validates a plain form's fields when it is saved", () => {
        expect(() => parseStudioDefinition({ fields: [{ key: "tags", label: "Tags", type: "tag_picker" }] })).toThrow();
        expect(parseStudioDefinition({ fields: [{ key: "tags", label: "Tags", type: "multiselect", options: ["a"] }] }).studio.version).toBe(2);
    });

    it("accepts Org Forge fields whose unset properties are null", () => {
        const parsed = parseStudioDefinition({ fields: [{ key: "reason", label: "Reason", type: "textarea", required: true, placeholder: null, options: null }] });
        expect(parsed.fields[0]).toEqual({ key: "reason", label: "Reason", type: "textarea", required: true });
    });

    it("refuses a definition version it does not know", () => {
        expect(() => asStudioDefinition({ fields: [], studio: { version: 3 } })).toThrow(/Unsupported Form Studio definition version: 3/);
    });
});

describe("structural checks", () => {
    it("names unknown groups and scales, and a scale on a text field", () => {
        const def = v2(
            [
                { key: "a", label: "A", type: "number", group: "missing_group" },
                { key: "b", label: "B", type: "text", scale: "likert" },
                { key: "c", label: "C", type: "rating", scale: "nope" },
            ],
            { scales: [{ id: "likert", label: "Agreement", min: 1, max: 5 }] },
        );
        expect(definitionIssues(def)).toEqual(expect.arrayContaining([
            "a: group missing_group does not exist.",
            "b: only number, rating and slider fields can use a scale.",
            "c: scale nope does not exist.",
        ]));
    });

    it("checks stages: pages exist, no page is in two, every page is in one, and a stage only sees earlier ones", () => {
        const def = v2([], {
            pages: [{ id: "self", title: "Self" }, { id: "manager", title: "Manager" }, { id: "hr", title: "HR" }],
            stages: [
                { id: "candidate", title: "Candidate", pageIds: ["self", "ghost"], assignee: { type: "respondent" }, sees: ["panel"] },
                { id: "panel", title: "Panel", pageIds: ["manager", "self"], assignee: { type: "role", role: "talent_committee" } },
            ],
        });
        expect(definitionIssues(def)).toEqual(expect.arrayContaining([
            "Stage candidate: page ghost does not exist.",
            "Page self is in both stage candidate and stage panel.",
            "Page hr is not in any stage, so nobody is asked to fill it in.",
            "Stage candidate: can only see earlier stages, and panel is not one.",
        ]));
    });

    it("checks results, rules and bindings against the fields and actions that exist", () => {
        const def = v2([{ key: "score", label: "Score", type: "number" }], {
            results: [
                { id: "headline", title: "Headline", type: "score", field: "scroe", bands: [{ min: 10, max: 5, label: "Odd" }] },
                { id: "box", title: "Box", type: "grid", x: { field: "score", label: "X", cuts: [5, 3] }, y: { field: "score", label: "Y", cuts: [5] }, cells: [["a", "b", "c"]] },
                { id: "note", title: "Note", type: "narrative", html: "<p>{{total}}</p>" },
            ],
            decisionRules: [{ id: "high", when: "score > 5", status: "HIGH", actions: ["escalate"] }],
        });
        expect(definitionIssues(def)).toEqual(expect.arrayContaining([
            "Result headline: unknown field scroe.",
            'Result headline: band "Odd" starts above where it ends.',
            "Result box: X cut points must increase.",
            "Result box: needs 2 rows of 3 cells.",
            "Result note: unknown field total.",
            "Rule high: action escalate does not exist.",
        ]));
        expect(definitionIssues(v2([], { results: [{ id: "outcome", title: "Outcome", type: "status" }] })))
            .toEqual(["Result outcome: the form has no decision rules, so name the field that holds the status."]);
    });
});

describe("answers", () => {
    it("holds a rating to its scale's range", () => {
        const def = v2([{ key: "q1", label: "Q1", type: "rating", scale: "likert", required: true }], { scales: [{ id: "likert", label: "Agreement", min: 1, max: 5 }] });
        expect(evaluateStudio(def, { q1: 6 }, true).errors.q1).toBe("Enter a number within the allowed range.");
        expect(evaluateStudio(def, { q1: 4 }, true).errors).toEqual({});
    });

    it("checks every choice of a multiselect", () => {
        const def = v2([{ key: "regions", label: "Regions", type: "multiselect", options: ["EU", "US"] }]);
        expect(evaluateStudio(def, { regions: ["EU", "US"] }, true).errors).toEqual({});
        expect(evaluateStudio(def, { regions: ["EU", "APAC"] }, true).errors.regions).toBe("Choose an available option.");
    });

    it("requires only the questions on the stage being submitted", () => {
        const def = v2(
            [
                { key: "self_rating", label: "Self", type: "number", required: true, pageId: "self" },
                { key: "manager_rating", label: "Manager", type: "number", required: true, pageId: "manager" },
            ],
            {
                pages: [{ id: "self", title: "Self" }, { id: "manager", title: "Manager" }],
                stages: [
                    { id: "candidate", title: "Candidate", pageIds: ["self"], assignee: { type: "respondent" } },
                    { id: "review", title: "Review", pageIds: ["manager"], assignee: { type: "role", role: "manager" }, sees: ["candidate"] },
                ],
            },
        );
        expect(definitionIssues(def)).toEqual([]);
        expect(evaluateStudio(def, { self_rating: 4 }, true, { stageId: "candidate" }).errors).toEqual({});
        expect(evaluateStudio(def, { self_rating: 4 }, true, { stageId: "review" }).errors).toEqual({ manager_rating: "This field is required." });
        expect(() => evaluateStudio(def, {}, true, { stageId: "board" })).toThrow(/Stage board does not exist/);
    });

    it("does not require a question in a group that does not apply", () => {
        const def = v2(
            [
                { key: "has_lending", label: "Lending?", type: "boolean" },
                { key: "apr", label: "APR", type: "number", required: true, group: "lending" },
            ],
            { groups: [{ id: "lending", title: "Lending", visibleWhen: "has_lending" }] },
        );
        expect(evaluateStudio(def, { has_lending: false }, true).errors).toEqual({});
        expect(evaluateStudio(def, { has_lending: true }, true).errors).toEqual({ apr: "This field is required." });
    });
});

describe("decision rules", () => {
    const def = v2(
        [
            { key: "line", label: "Line", type: "select", options: ["lending", "insurance"], required: true },
            { key: "apr", label: "APR", type: "number" },
            { key: "score", label: "Score", type: "number" },
        ],
        {
            decisionRules: [
                { id: "apr_cap", when: "line == 'lending' && apr > 36", status: "REVIEW", actions: ["notify_supervisor"] },
                { id: "pass", when: "score >= 95", status: "CERTIFIED" },
            ],
            defaultStatus: "REVIEW",
            actions: [{ id: "notify_supervisor", label: "Tell the supervisor", type: "notify", channel: "inbox", to: "compliance_supervisor", message: "APR above the cap" }],
        },
    );

    it("decides by the first rule that holds, and names its actions", () => {
        const { values } = evaluateStudio(def, { line: "lending", apr: 40, score: 99 });
        expect(evaluateDecision(def, values)).toEqual({ state: "decided", status: "REVIEW", ruleId: "apr_cap", actions: ["notify_supervisor"] });
    });

    it("does not wait on an APR for a line of business that has none", () => {
        expect(evaluateStudio(def, { line: "insurance", score: 99 }).decision).toEqual({ state: "decided", status: "CERTIFIED", ruleId: "pass", actions: [] });
    });

    it("waits instead of falling through to a later rule when a rule cannot be answered yet", () => {
        expect(evaluateStudio(def, { line: "lending", score: 99 }).decision).toEqual({ state: "pending", ruleId: "apr_cap", waitingOn: ["apr"] });
    });

    it("uses the default status when no rule holds", () => {
        expect(evaluateStudio(def, { line: "insurance", score: 50 }).decision).toEqual({ state: "decided", status: "REVIEW", ruleId: null, actions: [] });
    });

    it("reports a rule that cannot be evaluated", () => {
        const broken = v2([{ key: "a", label: "A", type: "number" }], { decisionRules: [{ id: "ratio", when: "10 / a > 1", status: "X" }] });
        expect(evaluateStudio(broken, { a: 0 }).decision).toEqual({ state: "error", ruleId: "ratio", message: "Division by zero" });
    });

    it("is undecided with no holding rule and no default, and has no decision without rules", () => {
        const noDefault = v2([{ key: "a", label: "A", type: "number" }], { decisionRules: [{ id: "big", when: "a > 10", status: "BIG" }] });
        expect(evaluateStudio(noDefault, { a: 1 }).decision).toEqual({ state: "undecided" });
        expect(evaluateStudio(v2([]), {}).decision).toEqual({ state: "none" });
    });

    it("fails a test whose expected status is not reached", () => {
        const tested = studioDefinitionSchema.parse({
            ...def,
            studio: {
                ...def.studio,
                tests: [
                    { name: "certified", inputs: { line: "insurance", score: 99 }, expectedStatus: "CERTIFIED" },
                    { name: "wrong", inputs: { line: "insurance", score: 10 }, expectedStatus: "CERTIFIED" },
                ],
            },
        });
        expect(runStudioTests(tested).map((t) => [t.name, t.passed, t.actualStatus])).toEqual([["certified", true, "CERTIFIED"], ["wrong", false, "REVIEW"]]);
    });
});

describe("result blocks", () => {
    const def = v2(
        [
            { key: "vision", label: "Vision", type: "number" },
            { key: "talent", label: "Talent", type: "number" },
            { key: "flight_points", label: "Flight", type: "number" },
            { key: "index", label: "Index", type: "computed", formula: "(3 * vision + 2 * talent) / 5" },
            { key: "name", label: "Name", type: "text" },
        ],
        {
            decisionRules: [{ id: "ready", when: "index >= 85", status: "READY" }],
            defaultStatus: "DEVELOP",
            results: [
                { id: "headline", title: "Readiness", type: "score", audience: "respondent", field: "index", bands: [{ min: 85, max: 100, label: "Ready now", tone: "good" }, { min: 0, max: 84.99, label: "Develop", tone: "warning" }] },
                { id: "outcome", title: "Outcome", type: "status", audience: "respondent", labels: { READY: "Ready for the role" } },
                { id: "flight", title: "Flight risk", type: "breakdown", items: [{ field: "flight_points", label: "Flight risk", weight: 15 }] },
                { id: "stops", title: "Hard stops", type: "gates", items: [{ label: "Low talent", trippedWhen: "talent < 50" }, { label: "Flight", trippedWhen: "flight_points < 30" }] },
                { id: "box", title: "9-box", type: "grid", x: { field: "vision", label: "Performance", cuts: [60, 85] }, y: { field: "talent", label: "Potential", cuts: [60, 85] }, cells: [["Risk", "Effective", "Trusted"], ["Inconsistent", "Core", "High performer"], ["Enigma", "Growth", "Star"]] },
                { id: "note", title: "Note", type: "narrative", audience: "respondent", html: "<p>{{name}} scored {{index}}.</p>", visibleWhen: "index >= 0" },
            ],
        },
    );
    const answers = { vision: 90, talent: 70, name: "<Ana>" };

    it("gives respondents only their blocks, and escapes answers placed into HTML", () => {
        expect(definitionIssues(def)).toEqual([]);
        const { values, decision } = evaluateStudio(def, answers);
        const respondent = evaluateResults(def, values, decision, "respondent");
        expect(respondent.map((b) => b.id)).toEqual(["headline", "outcome", "note"]);
        expect(respondent[0]).toMatchObject({ type: "score", value: 82, band: { label: "Develop", tone: "warning" } });
        expect(respondent[1]).toMatchObject({ type: "status", status: "DEVELOP", label: "DEVELOP", waitingOn: [] });
        expect(respondent[2]).toMatchObject({ type: "narrative", html: "<p>&lt;Ana&gt; scored 82.</p>" });
    });

    it("gives reviewers every block, with gates and the grid resolved", () => {
        const { values, decision } = evaluateStudio(def, answers);
        const reviewer = evaluateResults(def, values, decision, "reviewer");
        expect(reviewer.map((b) => b.id)).toEqual(["headline", "outcome", "flight", "stops", "box", "note"]);
        expect(reviewer.find((b) => b.id === "stops")).toMatchObject({
            items: [{ label: "Low talent", state: "clear" }, { label: "Flight", state: "pending", detail: "Waiting on flight_points" }],
        });
        expect(reviewer.find((b) => b.id === "box")).toMatchObject({ cell: { row: 1, column: 2, label: "High performer" } });
    });
});

describe("what older renderers and respondents receive", () => {
    const def = v2(
        [{ key: "q1", label: "Q1", type: "rating", scale: "likert", pageId: "p2", group: "block", visibleWhen: "true", source: "Spec §3" }],
        {
            pages: [{ id: "p1", title: "One" }, { id: "p2", title: "Two" }],
            groups: [{ id: "block", title: "Block" }],
            scales: [{ id: "likert", label: "Agreement", min: 1, max: 5 }],
            results: [
                { id: "mine", title: "Mine", type: "narrative", audience: "respondent", html: "" },
                { id: "theirs", title: "Theirs", type: "narrative", html: "" },
            ],
            decisionRules: [{ id: "high", when: "q1 > 3", status: "HIGH" }],
            actions: [{ id: "go", label: "Go", type: "start_pipeline", pipelineId: 7 }],
            dataset: { datasetId: 3 },
            sources: [{ id: 1, title: "Spec", updatedAt: "2026-09-01", digest: "abc" }],
            issues: ["Norms undefined"],
            tests: [{ name: "t", inputs: {}, expected: {} }],
        },
    );

    it("projects fields for older renderers, filling in the scale's range", () => {
        expect(legacyFieldsProjection(def)).toEqual({ fields: [{ key: "q1", label: "Q1", type: "rating", min: 1, max: 5 }] });
    });

    it("warns about what older renderers will not show", () => {
        expect(legacyConsumerWarnings(def)).toEqual([
            "Older form renderers show every page's questions on one page.",
            "Older form renderers ignore conditions and show every question, including ones that do not apply.",
            "Older form renderers show no result blocks.",
            "Older form renderers do not evaluate decision rules.",
        ]);
    });

    it("sends respondents no sources, tests, issues, reviewer results, rules, actions or dataset", () => {
        const sent = respondentDefinition(def);
        expect(sent.studio).toMatchObject({ sources: [], tests: [], issues: [], decisionRules: [], actions: [], dataset: null });
        expect(sent.studio.results.map((r) => r.id)).toEqual(["mine"]);
        expect(sent.studio.defaultStatus).toBeUndefined();
        expect(sent.fields[0].source).toBeUndefined();
        expect(def.studio.actions).toHaveLength(1);
    });
});
