import { describe, expect, it } from "vitest";
import { ambientGqeService } from "../ambient-gqe.service.js";

describe("AmbientGQEService", () => {
    it("generates station questions for SOW scope_in_out station", () => {
        const questions = ambientGqeService.generateStationQuestions(
            "sow_statement_of_work",
            "scope_in_out",
            "",
            {}
        );

        expect(questions.length).toBeGreaterThan(0);
        const scopeOutQ = questions.find((q) => q.questionId === "sow_scope_out");
        expect(scopeOutQ).toBeDefined();
        expect(scopeOutQ?.isResolved).toBe(false);
        expect(scopeOutQ?.quickOptions).toContain("End-User Training");
        expect(scopeOutQ?.scaffoldingTemplate).toContain("{option}");
    });

    it("marks question as resolved if content contains matching keywords", () => {
        const content = "The following items are out of scope: training and hardware procurement.";
        const questions = ambientGqeService.generateStationQuestions(
            "sow_statement_of_work",
            "scope_in_out",
            content,
            {}
        );

        const scopeOutQ = questions.find((q) => q.questionId === "sow_scope_out");
        expect(scopeOutQ?.isResolved).toBe(true);
    });

    it("generates questions for enterprise_sop prerequisites station", () => {
        const questions = ambientGqeService.generateStationQuestions(
            "enterprise_sop",
            "prerequisites_access",
            "",
            {}
        );

        expect(questions.length).toBeGreaterThan(0);
        expect(questions[0].quickOptions?.length).toBeGreaterThan(0);
    });
});
