import { describe, it, expect } from "vitest";

import type { ImprovementStatus } from "@shared/schema/improvement/index.js";
import {
    LEGAL_TRANSITIONS,
    HUMAN_AUTHORIZED_TRANSITIONS,
    evaluateTransition,
    assertTransitionAllowed,
    requiresHumanAuthority,
    isTerminal,
    ImprovementTransitionError,
} from "./improvement-lifecycle.js";

const agent = { type: "agent" as const, id: "researcher-1" };
const service = { type: "service" as const, id: "ingestion" };
const humanNoAuthority = { type: "user" as const, id: "u-42" };
const humanWithAuthority = { type: "user" as const, id: "u-7", hasApprovalAuthority: true };

const ALL_STATUSES: ImprovementStatus[] = [
    "observed", "investigating", "proposed", "approved", "experimenting",
    "evaluating", "promoted", "revised", "rejected", "archived",
];

describe("legal transitions", () => {
    it("advances the happy path through to promotion", () => {
        const path: Array<[ImprovementStatus, ImprovementStatus]> = [
            ["observed", "investigating"],
            ["investigating", "proposed"],
            ["proposed", "approved"],
            ["approved", "experimenting"],
            ["experimenting", "evaluating"],
            ["evaluating", "promoted"],
        ];
        for (const [from, to] of path) {
            expect(evaluateTransition({ from, to, actor: humanWithAuthority }).allowed).toBe(true);
        }
    });

    it("routes a revision back through proposal", () => {
        expect(evaluateTransition({ from: "evaluating", to: "revised", actor: agent }).allowed).toBe(true);
        expect(evaluateTransition({ from: "revised", to: "proposed", actor: agent }).allowed).toBe(true);
    });

    it("refuses to skip the experiment", () => {
        const r = evaluateTransition({ from: "approved", to: "promoted", actor: humanWithAuthority });
        expect(r).toMatchObject({ allowed: false, code: "ILLEGAL_TRANSITION" });
    });

    it("refuses to jump straight from observed to proposed", () => {
        const r = evaluateTransition({ from: "observed", to: "proposed", actor: humanWithAuthority });
        expect(r).toMatchObject({ allowed: false, code: "ILLEGAL_TRANSITION" });
    });

    // A recorded human decision is not editable into a different one.
    it.each(["promoted", "rejected", "archived"] as ImprovementStatus[])(
        "treats '%s' as terminal with no outgoing transitions",
        (status) => {
            expect(isTerminal(status)).toBe(true);
            for (const to of ALL_STATUSES) {
                expect(evaluateTransition({ from: status, to, actor: humanWithAuthority }).allowed).toBe(false);
            }
        },
    );
});

describe("authority", () => {
    // Phase 0's stated requirement: agents cannot directly approve or promote.
    describe("agents and services cannot perform reserved transitions", () => {
        for (const key of HUMAN_AUTHORIZED_TRANSITIONS) {
            const [from, to] = key.split("→") as [ImprovementStatus, ImprovementStatus];

            it.each([agent, service])(`refuses ${key} for a %s actor`, (actor) => {
                const r = evaluateTransition({ from, to, actor });
                expect(r).toMatchObject({ allowed: false, code: "REQUIRES_HUMAN" });
            });

            it(`refuses ${key} for a human without authority`, () => {
                const r = evaluateTransition({ from, to, actor: humanNoAuthority });
                expect(r).toMatchObject({ allowed: false, code: "REQUIRES_AUTHORITY" });
            });

            it(`allows ${key} for an authorized human`, () => {
                expect(evaluateTransition({ from, to, actor: humanWithAuthority }).allowed).toBe(true);
            });
        }
    });

    // An agent claiming authority is the exact attack the flag defends against:
    // authority comes from the session layer, never from the actor's own say-so.
    it("ignores hasApprovalAuthority on a non-human actor", () => {
        const r = evaluateTransition({
            from: "proposed",
            to: "approved",
            actor: { type: "agent", id: "sneaky", hasApprovalAuthority: true },
        });
        expect(r).toMatchObject({ allowed: false, code: "REQUIRES_HUMAN" });
    });

    it("lets agents do the drafting work — investigate, propose, revise", () => {
        const allowedForAgents: Array<[ImprovementStatus, ImprovementStatus]> = [
            ["observed", "investigating"],
            ["investigating", "proposed"],
            ["proposed", "revised"],
            ["revised", "proposed"],
            ["approved", "experimenting"],
            ["experimenting", "evaluating"],
        ];
        for (const [from, to] of allowedForAgents) {
            expect(evaluateTransition({ from, to, actor: agent }).allowed).toBe(true);
        }
    });

    it("gates exactly the four reserved transitions and no others", () => {
        const gated: string[] = [];
        for (const from of ALL_STATUSES) {
            for (const to of LEGAL_TRANSITIONS[from]) {
                if (requiresHumanAuthority(from, to)) gated.push(`${from}→${to}`);
            }
        }
        expect(gated.sort()).toEqual([
            "evaluating→archived",
            "evaluating→promoted",
            "proposed→approved",
            "proposed→rejected",
        ]);
    });
});

describe("assertTransitionAllowed", () => {
    it("throws a typed error carrying the refusal code", () => {
        try {
            assertTransitionAllowed({ from: "proposed", to: "approved", actor: agent });
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(ImprovementTransitionError);
            expect((err as ImprovementTransitionError).code).toBe("REQUIRES_HUMAN");
        }
    });

    it("is silent when the transition is allowed", () => {
        expect(() =>
            assertTransitionAllowed({ from: "observed", to: "investigating", actor: agent }),
        ).not.toThrow();
    });
});

describe("state graph integrity", () => {
    it("declares every status, with no transition to an unknown state", () => {
        expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
        for (const targets of Object.values(LEGAL_TRANSITIONS)) {
            for (const target of targets) expect(ALL_STATUSES).toContain(target);
        }
    });

    it("keeps every gated transition legal — a gate on an impossible edge is dead", () => {
        for (const key of HUMAN_AUTHORIZED_TRANSITIONS) {
            const [from, to] = key.split("→") as [ImprovementStatus, ImprovementStatus];
            expect(LEGAL_TRANSITIONS[from]).toContain(to);
        }
    });
});
