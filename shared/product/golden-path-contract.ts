import {
    evaluateAutonomyPolicy,
    type AutonomyPolicyEvaluation,
    type AutonomyRiskLevel,
} from "../governance/autonomy-policy";

export interface GoldenPathKnowledgeDocument {
    id: string;
    title: string;
    sourceConfidence: number;
    content: string;
}

export interface GovernedSupportTriageFixture {
    id: string;
    title: string;
    buyerQuestion: string;
    mission: {
        objective: string;
        mode: string;
        requiresApprovalFor: string[];
        expectedOutcome: string;
    };
    ticket: {
        id: string;
        customer: string;
        priority: string;
        subject: string;
        body: string;
        receivedAt: string;
        signals: string[];
    };
    knowledge: GoldenPathKnowledgeDocument[];
    approvalScenario: {
        trigger: string;
        policyFlag: string;
        expectedDecisionBeforeApproval: string;
        humanDecision: string;
        requiredAuditFields: string[];
    };
    expectedEvidence: string[];
    successCriteria: string[];
}

export type GoldenPathTimelineEventType =
    | "mission_created"
    | "knowledge_retrieved"
    | "issue_classified"
    | "action_proposed"
    | "approval_requested"
    | "approval_recorded"
    | "mission_completed";

export interface GoldenPathTimelineEvent {
    sequence: number;
    type: GoldenPathTimelineEventType;
    summary: string;
    evidenceRefs: string[];
}

export interface GoldenPathApprovalRecord {
    policyFlag: string;
    reviewReason: string;
    approver: string;
    decision: string;
    timestamp: string;
}

export interface GoldenPathContractResult {
    /** Explicit provenance: this result is synthesized from a fixture, not read from a mission run. */
    artifactKind: "fixture_contract";
    executedMission: false;
    fixtureId: string;
    status: "contract_validated";
    classification: string;
    riskLevel: AutonomyRiskLevel;
    policy: AutonomyPolicyEvaluation;
    citedKnowledge: Array<Pick<GoldenPathKnowledgeDocument, "id" | "title" | "sourceConfidence">>;
    proposedResponse: string;
    nextAction: string;
    approval: GoldenPathApprovalRecord;
    timeline: GoldenPathTimelineEvent[];
    evidenceRefs: string[];
    assertions: Array<{ id: string; passed: boolean; detail: string }>;
}

export function validateGovernedSupportTriageFixture(
    fixture: GovernedSupportTriageFixture,
): string[] {
    const errors: string[] = [];
    const requiredString = (path: string, value: unknown) => {
        if (typeof value !== "string" || value.trim().length === 0) {
            errors.push(`${path} must be a non-empty string`);
        }
    };

    requiredString("id", fixture.id);
    requiredString("title", fixture.title);
    requiredString("buyerQuestion", fixture.buyerQuestion);
    requiredString("mission.objective", fixture.mission?.objective);
    requiredString("mission.expectedOutcome", fixture.mission?.expectedOutcome);
    requiredString("ticket.id", fixture.ticket?.id);
    requiredString("ticket.subject", fixture.ticket?.subject);
    requiredString("approvalScenario.policyFlag", fixture.approvalScenario?.policyFlag);

    if (!Array.isArray(fixture.mission?.requiresApprovalFor) || fixture.mission.requiresApprovalFor.length === 0) {
        errors.push("mission.requiresApprovalFor must include at least one approval trigger");
    }
    if (!fixture.mission?.requiresApprovalFor?.includes(fixture.approvalScenario?.policyFlag)) {
        errors.push("approvalScenario.policyFlag must be included in mission.requiresApprovalFor");
    }
    if (!Array.isArray(fixture.ticket?.signals) || fixture.ticket.signals.length < 3) {
        errors.push("ticket.signals must include at least three operational signals");
    }
    if (!Array.isArray(fixture.knowledge) || fixture.knowledge.length < 2) {
        errors.push("knowledge must include at least two grounding documents");
    }
    for (const item of fixture.knowledge ?? []) {
        requiredString(`knowledge.${item?.id ?? "unknown"}.title`, item?.title);
        requiredString(`knowledge.${item?.id ?? "unknown"}.content`, item?.content);
        if (typeof item?.sourceConfidence !== "number" || item.sourceConfidence < 0 || item.sourceConfidence > 1) {
            errors.push(`knowledge.${item?.id ?? "unknown"}.sourceConfidence must be between 0 and 1`);
        }
    }
    if (!Array.isArray(fixture.expectedEvidence) || fixture.expectedEvidence.length < 4) {
        errors.push("expectedEvidence must include at least four evidence references");
    }
    if (!Array.isArray(fixture.successCriteria) || fixture.successCriteria.length < 4) {
        errors.push("successCriteria must include at least four checks");
    }

    return errors;
}

export function runGovernedSupportTriageContract(
    fixture: GovernedSupportTriageFixture,
): GoldenPathContractResult {
    const validationErrors = validateGovernedSupportTriageFixture(fixture);
    if (validationErrors.length > 0) {
        throw new Error(`Invalid governed support triage fixture:\n- ${validationErrors.join("\n- ")}`);
    }

    const citedKnowledge = [...fixture.knowledge]
        .sort((left, right) => right.sourceConfidence - left.sourceConfidence)
        .map(({ id, title, sourceConfidence }) => ({ id, title, sourceConfidence }));
    const classification = fixture.ticket.signals.includes("workflow_failure")
        ? "workflow_instability"
        : "support_escalation";
    const policy = evaluateAutonomyPolicy({
        domain: "mission",
        goal: fixture.mission.objective,
        instruction: fixture.approvalScenario.trigger,
        action: "send message to customer",
    });

    if (policy.decision !== fixture.approvalScenario.expectedDecisionBeforeApproval) {
        throw new Error(
            `Golden path policy decision drifted: expected ${fixture.approvalScenario.expectedDecisionBeforeApproval}, received ${policy.decision}.`,
        );
    }
    if (!policy.flags.some((flag) => flag.code === fixture.approvalScenario.policyFlag)) {
        throw new Error(`Golden path did not produce required policy flag: ${fixture.approvalScenario.policyFlag}.`);
    }

    const approval: GoldenPathApprovalRecord = {
        policyFlag: fixture.approvalScenario.policyFlag,
        reviewReason: policy.rationale,
        approver: "golden-path-operator",
        decision: fixture.approvalScenario.humanDecision,
        timestamp: fixture.ticket.receivedAt,
    };
    const evidenceRefs = [
        fixture.ticket.id,
        ...citedKnowledge.map((item) => item.id),
        `policy:${approval.policyFlag}`,
        `approval:${approval.decision}`,
        `replay:${fixture.id}`,
    ];
    const timeline: GoldenPathTimelineEvent[] = [
        event(1, "mission_created", "Fixture expects a governed support mission to be created.", [fixture.ticket.id]),
        event(2, "knowledge_retrieved", `Fixture supplies ${citedKnowledge.length} grounding sources.`, citedKnowledge.map((item) => item.id)),
        event(3, "issue_classified", `Contract classifier produced ${classification}.`, [fixture.ticket.id]),
        event(4, "action_proposed", "Fixture includes a customer-safe proposed response.", citedKnowledge.map((item) => item.id)),
        event(5, "approval_requested", `Policy engine requires ${policy.decision}; no approval request was opened.`, [`policy:${approval.policyFlag}`]),
        event(6, "approval_recorded", `Fixture supplies the expected human decision: ${approval.decision}.`, [`approval:${approval.decision}`]),
        event(7, "mission_completed", "Fixture declares the expected completion and replay reference; neither was executed.", [`replay:${fixture.id}`]),
    ];

    const assertions = [
        assertion("classification", classification === "workflow_instability", `classification=${classification}`),
        assertion("grounding_fixture", citedKnowledge.length >= 2, `${citedKnowledge.length} fixture sources available`),
        assertion("approval_gate", policy.decision === "review", `decision=${policy.decision}`),
        assertion("approval_shape", fixture.approvalScenario.requiredAuditFields.every((field) => field in approval), "fixture-derived approval has all required fields"),
        assertion("expected_timeline_shape", timeline.some((item) => item.type === "mission_completed"), `${timeline.length} expected event shapes generated`),
    ];

    if (assertions.some((item) => !item.passed)) {
        throw new Error(`Golden path contract failed:\n${assertions.filter((item) => !item.passed).map((item) => `- ${item.id}: ${item.detail}`).join("\n")}`);
    }

    return {
        artifactKind: "fixture_contract",
        executedMission: false,
        fixtureId: fixture.id,
        status: "contract_validated",
        classification,
        riskLevel: policy.maxRiskLevel,
        policy,
        citedKnowledge,
        proposedResponse: "We identified workflow instability after the payment retries. An operator should verify account access before any customer commitment is sent.",
        nextAction: "Review the drafted customer response and verify account access state.",
        approval,
        timeline,
        evidenceRefs,
        assertions,
    };
}

function event(
    sequence: number,
    type: GoldenPathTimelineEventType,
    summary: string,
    evidenceRefs: string[],
): GoldenPathTimelineEvent {
    return { sequence, type, summary, evidenceRefs };
}

function assertion(id: string, passed: boolean, detail: string) {
    return { id, passed, detail };
}

