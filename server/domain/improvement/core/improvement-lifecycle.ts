/**
 * Improvement lifecycle: which transitions are legal, and who may perform them.
 *
 * Deliberately pure — no database, no I/O. The authority rules are the product
 * contract's load-bearing claim (§5: agents may create observations, hypotheses,
 * drafts and recommendations; only authorized humans may approve an experiment,
 * activate a candidate policy, publish an app, promote a capability, or conclude
 * that a commitment should be made). A rule that can only be checked by reading
 * a service method is a rule nobody can test; this one is a table.
 */

import type { ImprovementActorType, ImprovementStatus } from "@shared/schema/improvement/index.js";

/** Who is attempting a transition. */
export interface ImprovementActor {
    type: ImprovementActorType;
    id: string;
    /**
     * Whether this actor holds the authority a gated transition requires.
     *
     * Supplied by the caller from the session/permission layer — never inferred
     * from agent output, and never from a timestamp embedded in a payload.
     */
    hasApprovalAuthority?: boolean;
}

export interface TransitionRequest {
    from: ImprovementStatus;
    to: ImprovementStatus;
    actor: ImprovementActor;
}

export type TransitionRefusalCode =
    | "ILLEGAL_TRANSITION"
    | "REQUIRES_HUMAN"
    | "REQUIRES_AUTHORITY";

export type TransitionResult =
    | { allowed: true }
    | { allowed: false; code: TransitionRefusalCode; reason: string };

/**
 * The legal state graph, exactly as specified.
 *
 * Terminal states (`promoted`, `rejected`, `archived`) have no outgoing edges:
 * reopening is a new opportunity citing the old one, not a status edit that
 * erases the fact a human already decided.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<ImprovementStatus, readonly ImprovementStatus[]>> = {
    observed: ["investigating", "archived"],
    investigating: ["proposed", "archived"],
    proposed: ["approved", "rejected", "revised"],
    approved: ["experimenting"],
    experimenting: ["evaluating"],
    evaluating: ["promoted", "revised", "archived"],
    revised: ["proposed"],
    promoted: [],
    rejected: [],
    archived: [],
};

/**
 * Transitions that only an authorized human may perform.
 *
 * Each corresponds to a §5 reserved authority:
 *  - `proposed → approved`   authorizes a bounded experiment to run;
 *  - `proposed → rejected`   is a recorded human disposition;
 *  - `evaluating → promoted` promotes a result into production standing;
 *  - `evaluating → archived` concludes the line of work.
 *
 * `→ revised` and `→ experimenting` are absent on purpose: revision is drafting,
 * and experimenting is executing an envelope a human already approved.
 */
export const HUMAN_AUTHORIZED_TRANSITIONS: ReadonlySet<string> = new Set([
    "proposed→approved",
    "proposed→rejected",
    "evaluating→promoted",
    "evaluating→archived",
]);

export function transitionKey(from: ImprovementStatus, to: ImprovementStatus): string {
    return `${from}→${to}`;
}

export function requiresHumanAuthority(from: ImprovementStatus, to: ImprovementStatus): boolean {
    return HUMAN_AUTHORIZED_TRANSITIONS.has(transitionKey(from, to));
}

/**
 * Decide whether a transition may proceed.
 *
 * Refuses in a fixed order — legality first, then actor kind, then authority —
 * so a refusal reason names the first thing actually wrong rather than the
 * most alarming thing.
 */
export function evaluateTransition(request: TransitionRequest): TransitionResult {
    const { from, to, actor } = request;

    const legal = LEGAL_TRANSITIONS[from];
    if (!legal || !legal.includes(to)) {
        return {
            allowed: false,
            code: "ILLEGAL_TRANSITION",
            reason: `'${from}' cannot transition to '${to}'.`,
        };
    }

    if (!requiresHumanAuthority(from, to)) {
        return { allowed: true };
    }

    // An agent or a service may propose this transition; it may not perform it.
    if (actor.type !== "user") {
        return {
            allowed: false,
            code: "REQUIRES_HUMAN",
            reason: `'${transitionKey(from, to)}' is reserved to an authorized human; actor type was '${actor.type}'.`,
        };
    }

    if (actor.hasApprovalAuthority !== true) {
        return {
            allowed: false,
            code: "REQUIRES_AUTHORITY",
            reason: `'${transitionKey(from, to)}' requires approval authority, which '${actor.id}' does not hold.`,
        };
    }

    return { allowed: true };
}

/** Throwing wrapper for call sites that treat a refusal as an error. */
export class ImprovementTransitionError extends Error {
    constructor(readonly code: TransitionRefusalCode, message: string) {
        super(message);
        this.name = "ImprovementTransitionError";
    }
}

export function assertTransitionAllowed(request: TransitionRequest): void {
    const result = evaluateTransition(request);
    if (!result.allowed) {
        throw new ImprovementTransitionError(result.code, result.reason);
    }
}

/** Terminal states carry a recorded human decision and are not re-openable. */
export function isTerminal(status: ImprovementStatus): boolean {
    return LEGAL_TRANSITIONS[status].length === 0;
}
