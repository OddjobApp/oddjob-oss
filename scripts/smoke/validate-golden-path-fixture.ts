import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePath = resolve("fixtures/golden-path/governed-support-triage.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as any;
const errors: string[] = [];

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

if (errors.length > 0) {
    console.error("Golden path fixture validation failed:");
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log(`Golden path fixture valid: ${fixture.id} with ${fixture.knowledge.length} knowledge documents.`);

function requiredString(path: string, value: unknown) {
    if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`${path} must be a non-empty string`);
    }
}
