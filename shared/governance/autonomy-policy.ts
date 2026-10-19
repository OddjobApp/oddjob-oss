export type AutonomyRiskLevel = "low" | "medium" | "high" | "critical";
export type AutonomyDecision = "allow" | "review" | "block";
export type AutonomyDomain =
    | "computer_use"
    | "mission"
    | "tool"
    | "app_forge"
    | "integration"
    | "unknown";

export interface AutonomyRiskFlag {
    code: string;
    level: AutonomyRiskLevel;
    message: string;
    requiresReview: boolean;
    domains: AutonomyDomain[];
}

export interface AutonomyPolicyInput {
    domain?: AutonomyDomain;
    goal?: string;
    instruction?: string;
    text?: string;
    action?: string;
    targetLabel?: string;
    allowSensitive?: boolean;
    metadata?: Record<string, unknown>;
}

export interface AutonomyPolicyEvaluation {
    decision: AutonomyDecision;
    maxRiskLevel: AutonomyRiskLevel;
    flags: AutonomyRiskFlag[];
    requiredReview: string[];
    rationale: string;
}

export interface AutonomyPolicyRule {
    code: string;
    level: AutonomyRiskLevel;
    message: string;
    requiresReview: boolean;
    domains: AutonomyDomain[];
    pattern: RegExp;
}

const ALL_DOMAINS: AutonomyDomain[] = [
    "computer_use",
    "mission",
    "tool",
    "app_forge",
    "integration",
    "unknown",
];

const RISK_RANK: Record<AutonomyRiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
};

export const AUTONOMY_POLICY_RULES: AutonomyPolicyRule[] = [
    {
        code: "credential_input",
        level: "critical",
        message: "Instruction or text appears to involve credentials, passwords, passcodes, or login PINs.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        pattern: /\b(password|passcode|credential|login\s+pin|pin\s+code)\b/i,
    },
    {
        code: "secret_input",
        level: "critical",
        message: "Instruction or text appears to involve API keys, secrets, or private credentials.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        // Deliberately excludes plain "token" — too many false positives (OAuth tokens, auth tokens, etc.)
        // Use more specific phrases like "api key", "access key", "secret key" instead
        pattern: /\b(api[-_\s]?key|secret[-_\s]?key|private\s+key|access\s+key|auth\s+secret|bearer\s+token|refresh\s+token|signing\s+secret)\b/i,
    },
    {
        code: "financial_or_identity_data",
        level: "critical",
        message: "Instruction or text appears to involve financial, identity, or regulated personal data.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        pattern: /\b(ssn|social\s+security|credit\s+card|card\s+number|routing\s+number|bank\s+account|tax\s+id)\b/i,
    },
    {
        code: "destructive_action",
        level: "high",
        message: "Instruction may perform a destructive or difficult-to-reverse action.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        pattern: /\b(delete|remove|drop|destroy|wipe|terminate|purge|deprovision|disable)\b/i,
    },
    {
        code: "financial_action",
        level: "high",
        message: "Instruction may perform a financial transaction or payment-related action.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        pattern: /\b(purchase|buy|payment|pay|transfer|wire|checkout|refund|charge|invoice)\b/i,
    },
    {
        code: "external_commitment",
        level: "high",
        message: "Instruction may send, publish, deploy, merge, or release changes to an external system or recipient.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        // Excludes: submit (too broad — fires on any form), post (internal comments), message (internal notes),
        //           share (internal sharing). Focuses on clear external-delivery verbs.
        pattern: /\b(send\s+email|send\s+message|send\s+notification|publish|deploy|merge\s+to|release\s+to|push\s+to\s+prod|invite\s+user|broadcast)\b/i,
    },
    {
        code: "sensitive_environment",
        level: "medium",
        message: "Instruction references a production environment, regulated data context, or compliance workflow.",
        requiresReview: true,
        domains: ALL_DOMAINS,
        // Excludes: security (too broad — fires on "security settings"), customer (too broad — fires on any CRM task)
        pattern: /\b(production\s+environment|prod\s+database|prod\s+server|legal\s+hold|compliance\s+review|regulated\s+data|gdpr|hipaa|pci[-_\s]?dss|sox\s+audit)\b/i,
    },
];

export function evaluateAutonomyPolicy(input: AutonomyPolicyInput): AutonomyPolicyEvaluation {
    const content = searchablePolicyText(input);
    const flags: AutonomyRiskFlag[] = [];

    for (const rule of AUTONOMY_POLICY_RULES) {
        if (ruleApplies(rule, input.domain ?? "unknown") && rule.pattern.test(content)) {
            flags.push(ruleToFlag(rule));
        }
    }

    if (input.text && input.text.length > 1000) {
        flags.push({
            code: "large_text_input",
            level: "medium",
            message: "Text input is large enough to deserve review before it is entered into another system.",
            requiresReview: true,
            domains: [input.domain ?? "unknown"],
        });
    }

    const clipboardText = typeof input.metadata?.clipboardText === "string"
        ? input.metadata.clipboardText
        : undefined;
    if (clipboardText && clipboardText.length > 1000) {
        flags.push({
            code: "large_clipboard_input",
            level: "medium",
            message: "Clipboard input is large enough to deserve review before it is written into another system.",
            requiresReview: true,
            domains: [input.domain ?? "unknown"],
        });
    }

    const deduped = dedupeFlags(flags);
    const maxRiskLevel = maxRisk(deduped);
    const criticalFlags = deduped.filter((flag) => flag.level === "critical");
    const reviewFlags = deduped.filter((flag) => flag.requiresReview);

    let decision: AutonomyDecision = "allow";
    if (criticalFlags.length > 0 && !input.allowSensitive) {
        decision = "block";
    } else if (reviewFlags.length > 0) {
        decision = "review";
    }

    return {
        decision,
        maxRiskLevel,
        flags: deduped,
        requiredReview: reviewFlags.map((flag) => flag.message),
        rationale: buildRationale(decision, maxRiskLevel, deduped, input.allowSensitive ?? false),
    };
}

function ruleApplies(rule: AutonomyPolicyRule, domain: AutonomyDomain): boolean {
    return rule.domains.includes(domain);
}

function ruleToFlag(rule: AutonomyPolicyRule): AutonomyRiskFlag {
    return {
        code: rule.code,
        level: rule.level,
        message: rule.message,
        requiresReview: rule.requiresReview,
        domains: [...rule.domains],
    };
}

function searchablePolicyText(input: AutonomyPolicyInput): string {
    // Scan intent fields only (goal, instruction, action labels).
    // Do NOT scan payload data (text typed, clipboard content) — those are user data,
    // not agent intent, and would create false positives (e.g. pasting a doc that mentions "password").
    return [
        input.domain,
        input.goal,
        input.instruction,
        input.action,
        input.targetLabel,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function dedupeFlags(flags: AutonomyRiskFlag[]): AutonomyRiskFlag[] {
    const seen = new Set<string>();
    return flags.filter((flag) => {
        if (seen.has(flag.code)) return false;
        seen.add(flag.code);
        return true;
    });
}

function maxRisk(flags: AutonomyRiskFlag[]): AutonomyRiskLevel {
    return flags.reduce<AutonomyRiskLevel>((current, flag) => (
        RISK_RANK[flag.level] > RISK_RANK[current] ? flag.level : current
    ), "low");
}

function buildRationale(
    decision: AutonomyDecision,
    maxRiskLevel: AutonomyRiskLevel,
    flags: AutonomyRiskFlag[],
    allowSensitive: boolean,
): string {
    if (flags.length === 0) {
        return "No shared autonomy policy risks were detected.";
    }

    if (decision === "block") {
        return "Shared autonomy policy blocked the request because critical sensitive-data risk was detected.";
    }

    if (decision === "review" && maxRiskLevel === "critical" && allowSensitive) {
        return "Shared autonomy policy allows sensitive handling only after human review.";
    }

    if (decision === "review") {
        return "Shared autonomy policy requires review before execution.";
    }

    return "Shared autonomy policy detected risk flags but does not require review for this request.";
}
