import {
    ODDJOB_CANONICAL_DEMOS,
    ODDJOB_CAPABILITIES,
    ODDJOB_COPILOT_GUIDE,
    ODDJOB_PILLARS,
    ODDJOB_READINESS_CHECKS,
} from "../../shared/product/oddjob-capability-manifest.js";

const errors: string[] = [];

assertUnique("pillar", ODDJOB_PILLARS.map((pillar) => pillar.id));
assertUnique("capability", ODDJOB_CAPABILITIES.map((capability) => capability.id));
assertUnique("canonical demo", ODDJOB_CANONICAL_DEMOS.map((demo) => demo.id));
assertUnique("Copilot command", ODDJOB_COPILOT_GUIDE.commands.map((command) => command.id));
assertUnique("Copilot trust question", ODDJOB_COPILOT_GUIDE.trustQuestions.map((question) => question.id));
assertUnique("readiness check", ODDJOB_READINESS_CHECKS.map((check) => check.id));

const pillarIds = new Set(ODDJOB_PILLARS.map((pillar) => pillar.id));
const capabilityIds = new Set(ODDJOB_CAPABILITIES.map((capability) => capability.id));

for (const capability of ODDJOB_CAPABILITIES) {
    if (!pillarIds.has(capability.pillar)) {
        errors.push(`Capability ${capability.id} references unknown pillar ${capability.pillar}`);
    }
    if (capability.primarySurfaces.length === 0) {
        errors.push(`Capability ${capability.id} must expose at least one primary surface`);
    }
    if (capability.hardeningFocus.length === 0) {
        errors.push(`Capability ${capability.id} must declare at least one hardening focus`);
    }
    if (capability.copilotNextActions.length === 0) {
        errors.push(`Capability ${capability.id} must declare at least one Copilot next action`);
    }
}

for (const demo of ODDJOB_CANONICAL_DEMOS) {
    if (demo.capabilityIds.length === 0) {
        errors.push(`Demo ${demo.id} must reference at least one capability`);
    }
    for (const capabilityId of demo.capabilityIds) {
        if (!capabilityIds.has(capabilityId)) {
            errors.push(`Demo ${demo.id} references unknown capability ${capabilityId}`);
        }
    }
    if (demo.successCriteria.length < 2) {
        errors.push(`Demo ${demo.id} should have at least two success criteria`);
    }
    if (!demo.guidedPrompt.trim()) {
        errors.push(`Demo ${demo.id} must define a guided prompt`);
    }
}

for (const check of ODDJOB_READINESS_CHECKS) {
    if (!pillarIds.has(check.pillar)) {
        errors.push(`Readiness check ${check.id} references unknown pillar ${check.pillar}`);
    }
}

// Claim-integrity guard: a fixture-only check must never be described as an
// executed mission. This is intentionally explicit because auditability claims
// lose credibility when proof provenance is ambiguous.
const goldenPathContract = ODDJOB_READINESS_CHECKS.find(
    (check) => check.command === "npm run smoke:golden-path",
);
if (!goldenPathContract) {
    errors.push("Golden-path fixture contract readiness check is missing");
} else {
    const disclosure = goldenPathContract.expected.toLowerCase();
    if (!disclosure.includes("deterministic contract check over a fixture")) {
        errors.push("Golden-path smoke check must disclose that it is fixture-derived");
    }
    if (!disclosure.includes("does not create, pause, or resume a real mission")) {
        errors.push("Golden-path smoke check must disclose that it does not execute a real mission lifecycle");
    }
    if (/mission (executes|completed|resumed)/i.test(goldenPathContract.label)) {
        errors.push("Golden-path smoke-check label must not imply mission execution");
    }
}

const demoIds = new Set(ODDJOB_CANONICAL_DEMOS.map((demo) => demo.id));
for (const guidedFlow of ODDJOB_COPILOT_GUIDE.guidedFlows) {
    if (!demoIds.has(guidedFlow)) {
        errors.push(`Copilot guide references unknown guided flow ${guidedFlow}`);
    }
}

for (const command of ODDJOB_COPILOT_GUIDE.commands) {
    if (!pillarIds.has(command.pillar)) {
        errors.push(`Copilot command ${command.id} references unknown pillar ${command.pillar}`);
    }
    if (command.suggestedTools.length === 0) {
        errors.push(`Copilot command ${command.id} must suggest at least one tool`);
    }
    if (command.requiresApproval && command.riskLevel === "low") {
        errors.push(`Copilot command ${command.id} requires approval but is labeled low risk`);
    }
}

for (const question of ODDJOB_COPILOT_GUIDE.trustQuestions) {
    if (question.answerShouldInclude.length < 2) {
        errors.push(`Copilot trust question ${question.id} should include at least two answer requirements`);
    }
}

if (errors.length > 0) {
    console.error("Capability manifest validation failed:");
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log(`Capability manifest valid: ${ODDJOB_PILLARS.length} pillars, ${ODDJOB_CAPABILITIES.length} capabilities, ${ODDJOB_CANONICAL_DEMOS.length} demos, ${ODDJOB_COPILOT_GUIDE.commands.length} Copilot commands.`);

function assertUnique(label: string, values: string[]) {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            errors.push(`Duplicate ${label} id: ${value}`);
        }
        seen.add(value);
    }
}
