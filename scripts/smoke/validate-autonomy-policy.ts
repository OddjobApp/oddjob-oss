import {
    evaluateAutonomyPolicy,
    type AutonomyDecision,
} from "../../shared/governance/autonomy-policy.js";

interface PolicyCase {
    label: string;
    expectedDecision: AutonomyDecision;
    expectedFlag?: string;
    result: ReturnType<typeof evaluateAutonomyPolicy>;
}

const cases: PolicyCase[] = [
    // ── Allow cases ───────────────────────────────────────────────────────────
    {
        label: "harmless wait action",
        expectedDecision: "allow",
        result: evaluateAutonomyPolicy({
            domain: "computer_use",
            instruction: "wait for 2 seconds",
            action: "wait",
        }),
    },
    {
        label: "form submission should not be flagged (false positive regression)",
        expectedDecision: "allow",
        result: evaluateAutonomyPolicy({
            domain: "computer_use",
            instruction: "fill out the contact form and click submit",
        }),
    },
    {
        label: "internal note should not be flagged (false positive regression)",
        expectedDecision: "allow",
        result: evaluateAutonomyPolicy({
            domain: "tool",
            instruction: "write a message in the ticket notes field",
        }),
    },
    {
        label: "OAuth token reference should not be blocked (false positive regression)",
        expectedDecision: "allow",
        result: evaluateAutonomyPolicy({
            domain: "integration",
            instruction: "refresh the OAuth access token",
        }),
    },
    {
        label: "customer lookup should not be flagged (false positive regression)",
        expectedDecision: "allow",
        result: evaluateAutonomyPolicy({
            domain: "tool",
            instruction: "look up the customer record in the CRM",
        }),
    },
    // ── Block cases ───────────────────────────────────────────────────────────
    {
        label: "credential entry without sensitive opt-in",
        expectedDecision: "block",
        expectedFlag: "credential_input",
        result: evaluateAutonomyPolicy({
            domain: "computer_use",
            instruction: "type the password into the login form",
        }),
    },
    // ── Review cases ──────────────────────────────────────────────────────────
    {
        label: "destructive operation",
        expectedDecision: "review",
        expectedFlag: "destructive_action",
        result: evaluateAutonomyPolicy({
            domain: "mission",
            goal: "delete stale records from the database",
        }),
    },
    {
        label: "external email commitment",
        expectedDecision: "review",
        expectedFlag: "external_commitment",
        result: evaluateAutonomyPolicy({
            domain: "tool",
            instruction: "send email to the customer with the proposed refund",
        }),
    },
    {
        label: "external deploy commitment",
        expectedDecision: "review",
        expectedFlag: "external_commitment",
        result: evaluateAutonomyPolicy({
            domain: "tool",
            instruction: "deploy the hotfix to production",
        }),
    },
    {
        label: "api key handling with sensitive opt-in",
        expectedDecision: "review",
        expectedFlag: "secret_input",
        result: evaluateAutonomyPolicy({
            domain: "integration",
            instruction: "paste the API key into the integration settings",
            allowSensitive: true,
        }),
    },
    {
        label: "financial transaction",
        expectedDecision: "review",
        expectedFlag: "financial_action",
        result: evaluateAutonomyPolicy({
            domain: "tool",
            instruction: "process the payment and issue a refund",
        }),
    },
];

const errors: string[] = [];

for (const policyCase of cases) {
    if (policyCase.result.decision !== policyCase.expectedDecision) {
        errors.push(
            `${policyCase.label}: expected ${policyCase.expectedDecision}, got ${policyCase.result.decision}`,
        );
    }
    if (
        policyCase.expectedFlag
        && !policyCase.result.flags.some((flag) => flag.code === policyCase.expectedFlag)
    ) {
        errors.push(`${policyCase.label}: expected flag ${policyCase.expectedFlag}`);
    }
}

if (errors.length > 0) {
    console.error("Autonomy policy validation failed:");
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log(`Autonomy policy valid: ${cases.length} canonical cases.`);
