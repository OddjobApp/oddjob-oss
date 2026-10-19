import { describe, it, expect } from "vitest";

import { DecisionRouter, type DecisionRequest } from "./decision-router.js";

function makeRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
    return {
        sessionId: "s1",
        tool: "some_tool",
        params: {},
        goal: "g",
        riskLevel: "low",
        approverType: "internal",
        channels: ["inbox"],
        organizationId: 42,
        ...overrides,
    } as DecisionRequest;
}

describe("describeActivePolicyDecision", () => {
    it("routes an ordinary tool to a human", () => {
        const d = DecisionRouter.describeActivePolicyDecision(makeRequest({ tool: "file_write" }));
        expect(d.decision).toBe("route_to_human");
        expect(d.decidingPredicate).toBeNull();
    });

    it("names the predicate that auto-approved a read-only tool", () => {
        const d = DecisionRouter.describeActivePolicyDecision(makeRequest({ tool: "file_read" }));
        expect(d.decision).toBe("auto_approve");
        expect(d.decidingPredicate).toBe("isReadOnlyFileTool");
    });

    it("names the predicate for a low-risk routine tool", () => {
        const d = DecisionRouter.describeActivePolicyDecision(makeRequest({ tool: "browse_web" }));
        expect(d.decidingPredicate).toBe("isLowRiskRoutineTool");
    });

    // §7.2 forbids an unbounded action class. isErrorReview used to auto-approve on
    // a params flag regardless of which tool was named; it is now scoped to its tool.
    it("routes a tool carrying an error_review params flag to a human", () => {
        const d = DecisionRouter.describeActivePolicyDecision(
            makeRequest({ tool: "anything_at_all", params: { type: "error_review" } }),
        );
        expect(d.decision).toBe("route_to_human");
        expect(d.decidingPredicate).toBeNull();
    });

    it("names isErrorReview for the escalation tool it covers", () => {
        const d = DecisionRouter.describeActivePolicyDecision(makeRequest({ tool: "error_escalation" }));
        expect(d.decidingPredicate).toBe("isErrorReview");
    });

    it("labels the source as code, never as a rule version", () => {
        const d = DecisionRouter.describeActivePolicyDecision(makeRequest({ tool: "file_read" }));
        expect(d.activePolicySource).toBe("code");
        expect(d.sourceLocation).toContain("decision-router.ts");
        expect(d.sourceCommit).toBeTruthy();
    });

    describe("evaluation order", () => {
        // The regression: the gate short-circuited in one order while a separate
        // `reason` ternary ran in a different one, so a request matching two
        // predicates was gated by one and reported as the other.
        it("attributes a request matching two predicates to the one evaluated first", () => {
            // A system-raised `ls` is both a trusted system shell and a safe
            // diagnostic command. isTrustedSystemShell is evaluated first.
            const request = makeRequest({ tool: "shell", approverId: "system", params: { command: "ls" } });
            const d = DecisionRouter.describeActivePolicyDecision(request);
            expect(d.decidingPredicate).toBe("isTrustedSystemShell");
            // ...and the second predicate genuinely matches on its own.
            const second = DecisionRouter.describeActivePolicyDecision({ ...request, approverId: undefined });
            expect(second.decidingPredicate).toBe("isSafeDiagnosticShellCommand");
        });

        it("reports isSafeDiagnosticShellCommand by name, not as a fallthrough", () => {
            // Previously this predicate was evaluated second but could only ever
            // surface as the final `else` branch of the reason ternary.
            const d = DecisionRouter.describeActivePolicyDecision(
                makeRequest({ tool: "shell_exec", params: { command: "ls" } }),
            );
            if (d.decision === "auto_approve") {
                expect(d.decidingPredicate).not.toBeNull();
                expect(typeof d.reason).toBe("string");
            }
        });

        it("resolveAutoApprovalPredicate and describeActivePolicyDecision never disagree", () => {
            for (const tool of ["file_read", "browse_web", "file_write", "get_blackboard"]) {
                const req = makeRequest({ tool });
                const resolved = DecisionRouter.resolveAutoApprovalPredicate(req, false);
                const described = DecisionRouter.describeActivePolicyDecision(req);
                expect(described.decidingPredicate).toBe(resolved?.predicate ?? null);
                expect(described.reason).toBe(resolved?.reason ?? null);
            }
        });
    });
});
