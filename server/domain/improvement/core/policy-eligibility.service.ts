/**
 * §7.2 eligibility: may an approval pattern even be CONSIDERED for policy review?
 *
 * This runs before any shadow evaluation, and it exists to stop the inference
 * the platform has already made by hand: six tool classes were auto-approved on
 * the stated grounds of a "100% historical approval rate, never rejected".
 *
 * Two structural problems make that grounds weaker than it looks, and both are
 * checked here as first-class criteria:
 *
 *  - **A decision set with no rejections cannot discriminate.** If nothing has
 *    ever been rejected, an approval rate is 1.0 by construction and carries no
 *    information about safety. It is not weak evidence; it is no evidence.
 *  - **Auto-approval destroys its own evidence.** Once a tool is auto-approved
 *    it stops producing approval requests, so the record needed to re-examine
 *    the decision stops accumulating the moment the decision is made.
 *
 * Every criterion returns `pass`, `fail`, or `unavailable`. `unavailable` is
 * never counted as a pass: an unmeasured guardrail cannot testify that nothing
 * went wrong.
 */

export type CriterionVerdict = "pass" | "fail" | "unavailable";

export interface EligibilityCriterion {
    id: string;
    verdict: CriterionVerdict;
    detail: string;
}

export interface PolicyEligibilityResult {
    patternKey: string;
    eligible: boolean;
    criteria: EligibilityCriterion[];
    /** Criteria that must be resolved before this pattern can be reconsidered. */
    blockers: string[];
}

/** Defaults are governance heuristics, not statistical thresholds. */
export interface EligibilityThresholds {
    minResolvedRequests: number;
    minObservationDays: number;
}

export const DEFAULT_ELIGIBILITY_THRESHOLDS: EligibilityThresholds = {
    minResolvedRequests: 30,
    minObservationDays: 14,
};

/** One resolved approval decision, normalized. */
export interface ApprovalRecord {
    toolName: string | null;
    status: string;
    createdAt: Date | string;
    decisionAt?: Date | string | null;
    /** True when the approver altered the request before approving it. */
    remediated?: boolean;
    organizationId?: number | null;
}

/**
 * Static properties of a candidate rule — knowable without any decision data.
 *
 * Supplied by whoever proposes the pattern, because they are claims about the
 * rule's shape rather than measurements of its history.
 */
export interface PatternDescriptor {
    key: string;
    /** Distinct action/resource classes the rule can fire on. */
    actionClasses: string[];
    /** The rule fires regardless of which action is requested. */
    unboundedActionClass: boolean;
    /** Parameter limits can be written as a deterministic predicate. */
    parameterBoundsExpressible: boolean;
    /** A named human owns the intended policy scope. */
    ownerId?: string | null;
    /** Scope is fixed to specific ids in code rather than declared as policy. */
    hardcodedScope?: string | null;
}

/** Linked incident signal. `null` means "not checked", never "none found". */
export interface IncidentSignal {
    checked: boolean;
    unresolvedCriticalCount?: number;
}

function toTime(v: Date | string | null | undefined): number | null {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

const DAY_MS = 86_400_000;

export function evaluatePolicyEligibility(
    descriptor: PatternDescriptor,
    records: ApprovalRecord[],
    incidents: IncidentSignal = { checked: false },
    thresholds: EligibilityThresholds = DEFAULT_ELIGIBILITY_THRESHOLDS,
): PolicyEligibilityResult {
    const criteria: EligibilityCriterion[] = [];
    const add = (id: string, verdict: CriterionVerdict, detail: string) =>
        criteria.push({ id, verdict, detail });

    const resolved = records.filter(r => r.status !== "pending");

    // 1. Volume.
    add(
        "minimum_resolved_requests",
        resolved.length >= thresholds.minResolvedRequests ? "pass" : "fail",
        `${resolved.length} resolved request(s); threshold is ${thresholds.minResolvedRequests}.` +
            (resolved.length === 0
                ? " No decision record exists for this pattern at all — if the action is already auto-approved, it stopped producing one."
                : ""),
    );

    // 2. Observation window.
    const times = resolved.map(r => toTime(r.createdAt)).filter((t): t is number => t !== null);
    if (times.length === 0) {
        add("minimum_observation_window", "unavailable", "No dated records; the window cannot be measured.");
    } else {
        const spanDays = (Math.max(...times) - Math.min(...times)) / DAY_MS;
        add(
            "minimum_observation_window",
            spanDays >= thresholds.minObservationDays ? "pass" : "fail",
            `${spanDays.toFixed(1)} day(s) observed; threshold is ${thresholds.minObservationDays}.`,
        );
    }

    // 3. Narrow action class. §7.2 requires ONE action and resource class.
    if (descriptor.unboundedActionClass) {
        add(
            "narrow_action_class",
            "fail",
            "The rule fires regardless of which action is requested, so its action class is unbounded.",
        );
    } else {
        add(
            "narrow_action_class",
            descriptor.actionClasses.length === 1 ? "pass" : "fail",
            `${descriptor.actionClasses.length} action class(es): ${descriptor.actionClasses.join(", ") || "none declared"}.`,
        );
    }

    // 4. Incidents. Unchecked is not "none".
    if (!incidents.checked) {
        add(
            "no_unresolved_critical_incident",
            "unavailable",
            "Incident linkage was not checked. Absence of a recorded incident is not evidence of no harm.",
        );
    } else {
        const n = incidents.unresolvedCriticalCount ?? 0;
        add(
            "no_unresolved_critical_incident",
            n === 0 ? "pass" : "fail",
            `${n} unresolved critical incident(s) linked to this pattern.`,
        );
    }

    // 5. Remediation separated from unchanged approval.
    const remediated = resolved.filter(r => r.remediated === true).length;
    const unknownRemediation = resolved.filter(r => r.remediated === undefined).length;
    if (resolved.length === 0) {
        add("remediation_separated", "unavailable", "No resolved records to separate.");
    } else if (unknownRemediation === resolved.length) {
        add(
            "remediation_separated",
            "unavailable",
            "No record distinguishes an approval-as-requested from an approval-after-remediation, so the two cannot be analysed separately.",
        );
    } else {
        add(
            "remediation_separated",
            "pass",
            `${remediated} remediated and ${resolved.length - remediated - unknownRemediation} unchanged approval(s) are separable.`,
        );
    }

    // 6. Parameter bounds.
    add(
        "parameter_bounds_expressible",
        descriptor.parameterBoundsExpressible ? "pass" : "fail",
        descriptor.parameterBoundsExpressible
            ? "Parameter limits can be written deterministically."
            : "Parameter limits cannot be expressed deterministically, so the rule's real scope is unbounded.",
    );

    // 7. Named owner.
    add(
        "named_owner",
        descriptor.ownerId?.trim() ? "pass" : "fail",
        descriptor.ownerId?.trim()
            ? `Owner: ${descriptor.ownerId}.`
            : "No named human owns the intended policy scope.",
    );

    // 8. Discriminative power — not in §7.2's list, and the reason the list is
    //    not sufficient on its own. An approval rate computed over a decision
    //    set containing no rejections is 1.0 by construction.
    const rejected = resolved.filter(r => r.status === "rejected").length;
    if (resolved.length === 0) {
        add("discriminative_power", "unavailable", "No decisions to assess.");
    } else if (rejected === 0) {
        add(
            "discriminative_power",
            "fail",
            `All ${resolved.length} decision(s) are approvals; nothing was ever rejected. An approval rate over this set is 1.0 by construction and carries no information about safety.`,
        );
    } else {
        add(
            "discriminative_power",
            "pass",
            `${rejected} rejection(s) among ${resolved.length} decisions, so the rate can vary.`,
        );
    }

    // 9. Scope declared as policy rather than pinned in code.
    if (descriptor.hardcodedScope) {
        add(
            "scope_declared_not_hardcoded",
            "fail",
            `Scope is pinned in code (${descriptor.hardcodedScope}) rather than declared as reviewable policy.`,
        );
    } else {
        add("scope_declared_not_hardcoded", "pass", "Scope is not pinned to hardcoded identifiers.");
    }

    // Only an all-pass set is eligible. `unavailable` blocks: §7.2 is a gate,
    // and a gate that opens on missing information is not a gate.
    const blockers = criteria.filter(c => c.verdict !== "pass").map(c => c.id);
    return { patternKey: descriptor.key, eligible: blockers.length === 0, criteria, blockers };
}

/**
 * The seven predicates that constitute the live auto-approval policy, described
 * as candidate patterns.
 *
 * Transcribed from `server/domain/governor/core/decision-router.ts`. These are
 * the descriptors §7's first deliverable evaluates: not to promote them, but to
 * establish which would qualify today under the rules the spec sets out.
 */
export const LIVE_AUTO_APPROVAL_PATTERNS: PatternDescriptor[] = [
    {
        key: "isTrustedSystemShell",
        actionClasses: ["shell"],
        unboundedActionClass: false,
        parameterBoundsExpressible: true,
        ownerId: null,
    },
    {
        key: "isSafeDiagnosticShellCommand",
        actionClasses: ["shell"],
        unboundedActionClass: false,
        // Bounded by a SAFE_COMMANDS allow-list and a sensitive-path regex.
        parameterBoundsExpressible: true,
        ownerId: null,
    },
    {
        key: "isReadOnlyFileTool",
        actionClasses: ["file_read", "view_file", "read_file", "file_list", "get_blackboard"],
        unboundedActionClass: false,
        parameterBoundsExpressible: false,
        ownerId: null,
    },
    {
        key: "isLowRiskRoutineTool",
        actionClasses: [
            "browse_web", "google_search", "update_blackboard", "swarm_bid_approval",
            "neural_log_extractor", "gms_core_synthesizer", "behavioral_resonance_detector",
        ],
        unboundedActionClass: false,
        parameterBoundsExpressible: false,
        ownerId: null,
    },
    {
        key: "isAutoApprovedForgeBuild",
        actionClasses: ["FORGE_BUILD_CONTAINER"],
        unboundedActionClass: false,
        parameterBoundsExpressible: true,
        ownerId: null,
        hardcodedScope: "AUTO_APPROVE_FORGE_BUILD_ORG_IDS env allow-list",
    },
    {
        key: "isErrorReview",
        // Scoped to the escalation tool. It previously also fired on
        // params.type === 'error_review' for ANY tool.
        actionClasses: ["error_escalation"],
        unboundedActionClass: false,
        parameterBoundsExpressible: false,
        ownerId: null,
    },
    {
        key: "isSupervisorJob",
        actionClasses: [],
        unboundedActionClass: true,
        parameterBoundsExpressible: false,
        ownerId: null,
        hardcodedScope: "organizationId === 291",
    },
];
