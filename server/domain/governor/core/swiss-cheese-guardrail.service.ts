import { createLogger } from "@server/utils/logger.js";
import { governorService } from "./governor-service.js";
import { capabilityPolicyLoader } from "./capability-policy-loader.service.js";

const logger = createLogger("SwissCheeseGuardrail");

export interface GuardrailContext {
    organizationId: number;
    userId?: string;
    agentId?: string | number;
    sessionId?: string;
    missionId?: number;
    jobId?: number;
    ipAddress?: string;
}

export interface GuardrailLayerResult {
    layerNumber: 1 | 2 | 3 | 4 | 5;
    layerName: string;
    passed: boolean;
    reasoning?: string;
    sanitizedData?: any;
    violations: string[];
    riskScore: number; // 0 (safe) - 100 (critical threat)
    redactionSummary?: Record<string, number>;
    redactedCategories?: string[];
}

export interface RemediationChip {
    id: string;
    label: string;
    actionType: "request_override" | "downgrade_scope" | "escalate_hil" | "sanitize_prompt" | "retry_with_redaction";
    suggestedPayload?: any;
    description: string;
}

export interface SwissCheeseValidationResult {
    allowed: boolean;
    blockedAtLayer?: number;
    blockedLayerName?: string;
    finalPayload: any;
    layerResults: GuardrailLayerResult[];
    overallRiskScore: number;
    remediationChips?: RemediationChip[];
    forensicAuditLog: {
        timestamp: string;
        decision: "allow" | "deny" | "redact";
        summary: string;
    };
}

const KNOWN_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior)\s+(instructions|prompts|rules)/i,
    /disregard\s+(all\s+)?(safety|governance|system)\s+protocols/i,
    /system\s+override\s*:\s*admin/i,
    /you\s+are\s+now\s+in\s+unrestricted\s+developer\s+mode/i,
    /bypass\s+governance\s+checks/i,
    /reveal\s+(the\s+)?(system\s+prompt|master\s+secret|api_key|password)/i,
];

const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
    { name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED_SSN]" },
    { name: "CreditCard", regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: "[REDACTED_CC]" },
    { name: "API_Key_Secret", regex: /\b(sk-[a-zA-Z0-9]{20,}|AIzaSy[a-zA-Z0-9_-]{33}|ghp_[a-zA-Z0-9]{36})\b/g, replacement: "[REDACTED_SECRET_KEY]" },
    { name: "Private_Key", regex: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" }
];

interface SessionRiskEvent {
    timestamp: number;
    riskScore: number;
}

const sessionRiskHistory = new Map<string, SessionRiskEvent[]>();
const SLIDING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SUSTAINED_PROBING_THRESHOLD = 3; // 3 or more moderate/high risk attempts

function normalizeAndDeobfuscate(text: string): { normalized: string; decodedSamples: string[] } {
    // 1. Strip zero-width and invisible formatting characters completely
    let cleaned = text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, "");

    // 2. Normalize non-standard whitespace and excessive spaces
    cleaned = cleaned.replace(/[\u00A0\u2000-\u200A\s]+/g, " ").trim();

    // 3. URL decode if percent-encoded sequences are present
    if (/%[0-9a-fA-F]{2}/.test(cleaned)) {
        try {
            cleaned = decodeURIComponent(cleaned.replace(/\+/g, " "));
        } catch {
            // Ignore malformed URL escape sequences
        }
    }

    // 4. Scan for Base64 encoded payload segments
    const decodedSamples: string[] = [];
    const base64Regex = /(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
    let match: RegExpExecArray | null;
    while ((match = base64Regex.exec(text)) !== null) {
        try {
            const decoded = Buffer.from(match[0], "base64").toString("utf-8");
            if (/^[\x20-\x7E\s]+$/.test(decoded) && decoded.length > 6) {
                decodedSamples.push(decoded);
            }
        } catch {
            // Ignore invalid base64 segments
        }
    }

    return { normalized: cleaned, decodedSamples };
}

export class SwissCheeseGuardrailService {
    /**
     * Layer 1: Input Sanitization & Threat/Injection Detection (Obfuscation-Resilient)
     */
    static evaluateLayer1_Input(input: any): GuardrailLayerResult {
        const violations: string[] = [];
        let riskScore = 0;
        let sanitized = input;

        const checkText = (raw: string, contextLabel = "") => {
            const { normalized, decodedSamples } = normalizeAndDeobfuscate(raw);
            const targetsToCheck = [
                { text: raw, source: contextLabel ? `${contextLabel} (raw)` : "raw input" },
                { text: normalized, source: contextLabel ? `${contextLabel} (normalized)` : "normalized input" },
                ...decodedSamples.map((d, i) => ({ text: d, source: contextLabel ? `${contextLabel} (base64 segment #${i + 1})` : `base64 segment #${i + 1}` }))
            ];

            for (const target of targetsToCheck) {
                for (const pattern of KNOWN_INJECTION_PATTERNS) {
                    if (pattern.test(target.text)) {
                        violations.push(`Detected prompt injection / policy override attempt in ${target.source}: ${pattern}`);
                        riskScore = Math.max(riskScore, 85);
                    }
                }
            }
        };

        if (typeof input === "string") {
            checkText(input);
        } else if (input && typeof input === "object") {
            const jsonStr = JSON.stringify(input);
            checkText(jsonStr, "structured payload");
        }

        const passed = violations.length === 0;
        return {
            layerNumber: 1,
            layerName: "Input Threat & Injection Sanitization",
            passed,
            violations,
            riskScore,
            sanitizedData: sanitized,
            reasoning: passed ? "Input passed security heuristics." : violations.join("; ")
        };
    }

    /**
     * Layer 2: Pre-Execution Policy & Capability RBAC Checks
     */
    static async evaluateLayer2_Policy(toolName?: string, params?: any, context?: GuardrailContext): Promise<GuardrailLayerResult> {
        const violations: string[] = [];
        let riskScore = 0;

        if (toolName && context?.organizationId && capabilityPolicyLoader.has(context.organizationId)) {
            try {
                const { loadOrganizationRoles } = await import("@server/utils/organization-permissions.js");
                const roles = context.userId
                    ? await loadOrganizationRoles(context.organizationId, context.userId)
                    : [];

                const rolesToCheck: string[] = roles.length > 0 ? roles : ["__unassigned__"];

                let allowed = false;
                let lastReason: string | undefined;

                for (const role of rolesToCheck) {
                    const capabilityResult = governorService.validateFromPolicy(
                        context.organizationId,
                        role,
                        { type: "tool", value: toolName }
                    );

                    if (capabilityResult.allowed) {
                        allowed = true;
                        break;
                    }
                    lastReason = capabilityResult.reason;
                }

                if (!allowed) {
                    const held = roles.length > 0 ? `roles [${roles.join(", ")}]` : "no assigned role";
                    violations.push(
                        `Governor policy violation: ${lastReason || "Tool execution blocked by capability policy"} ` +
                        `(user holds ${held})`
                    );
                    riskScore = Math.max(riskScore, 75);
                }
            } catch (err: any) {
                violations.push(`Governor policy violation: ${err?.message || "Tool execution blocked"}`);
                riskScore = Math.max(riskScore, 75);
            }
        }

        const passed = violations.length === 0;
        return {
            layerNumber: 2,
            layerName: "Policy & Capability Pre-Execution RBAC",
            passed,
            violations,
            riskScore,
            sanitizedData: params,
            reasoning: passed ? "Tool and action authorized under tenant policies." : violations.join("; ")
        };
    }

    /**
     * Layer 3: Runtime Anomaly & Circuit Breakers (with Session Sliding-Window Anomaly Tracking)
     */
    static evaluateLayer3_Runtime(
        executionMetrics?: { loopCount?: number; executionTimeMs?: number; circuitOpen?: boolean },
        context?: GuardrailContext
    ): GuardrailLayerResult {
        const violations: string[] = [];
        let riskScore = 0;

        if (executionMetrics?.circuitOpen) {
            violations.push("Circuit breaker is currently OPEN for target service/tool.");
            riskScore = 90;
        }

        if (executionMetrics?.loopCount && executionMetrics.loopCount > 15) {
            violations.push(`Recursive execution loop anomaly detected (${executionMetrics.loopCount} iterations).`);
            riskScore = 80;
        }

        // Sliding-window session anomaly tracking
        const sessionKey = context?.sessionId || (context?.userId ? `user:${context.userId}` : undefined);
        if (sessionKey) {
            const now = Date.now();
            const history = sessionRiskHistory.get(sessionKey) || [];
            const activeEvents = history.filter(e => now - e.timestamp <= SLIDING_WINDOW_MS);

            // If 3 or more elevated risk events occurred in the sliding window
            const elevatedEvents = activeEvents.filter(e => e.riskScore >= 40);
            if (elevatedEvents.length >= SUSTAINED_PROBING_THRESHOLD) {
                violations.push(`Sustained adversarial probing anomaly detected (${elevatedEvents.length} elevated risk events in active session window).`);
                riskScore = Math.max(riskScore, 85);
            }
        }

        const passed = violations.length === 0;
        return {
            layerNumber: 3,
            layerName: "Runtime Anomaly & Circuit Breakers",
            passed,
            violations,
            riskScore,
            reasoning: passed ? "Runtime telemetry within nominal operational thresholds." : violations.join("; ")
        };
    }

    /**
     * Layer 4: Output Validation, PII & Harmful Content Redaction (with Structured Telemetry)
     */
    static evaluateLayer4_Output(output: any): GuardrailLayerResult {
        const violations: string[] = [];
        const redactionSummary: Record<string, number> = {};
        const redactedCategoriesSet = new Set<string>();
        let riskScore = 0;
        let sanitized = output;

        const recordRedaction = (category: string, matchCount: number) => {
            redactionSummary[category] = (redactionSummary[category] || 0) + matchCount;
            redactedCategoriesSet.add(category);
        };

        if (typeof output === "string") {
            for (const { name, regex, replacement } of PII_PATTERNS) {
                regex.lastIndex = 0;
                const matches = output.match(regex);
                if (matches && matches.length > 0) {
                    recordRedaction(name, matches.length);
                    violations.push(`Redacted ${matches.length} sensitive data pattern(s) (${name})`);
                    regex.lastIndex = 0;
                    sanitized = sanitized.replace(regex, replacement);
                    riskScore = Math.max(riskScore, 40);
                }
                regex.lastIndex = 0;
            }
        } else if (output && typeof output === "object") {
            let serialized = JSON.stringify(output);
            let modified = false;

            for (const { name, regex, replacement } of PII_PATTERNS) {
                regex.lastIndex = 0;
                const matches = serialized.match(regex);
                if (matches && matches.length > 0) {
                    recordRedaction(name, matches.length);
                    violations.push(`Redacted ${matches.length} sensitive data pattern(s) in JSON response (${name})`);
                    regex.lastIndex = 0;
                    serialized = serialized.replace(regex, replacement);
                    modified = true;
                    riskScore = Math.max(riskScore, 40);
                }
                regex.lastIndex = 0;
            }

            if (modified) {
                try {
                    sanitized = JSON.parse(serialized);
                } catch {
                    sanitized = serialized;
                }
            }
        }

        const redactedCategories = Array.from(redactedCategoriesSet);

        return {
            layerNumber: 4,
            layerName: "Output Validation & PII Redaction",
            passed: true,
            violations,
            riskScore,
            sanitizedData: sanitized,
            redactionSummary,
            redactedCategories,
            reasoning: violations.length > 0 ? `Output sanitized: ${violations.join(", ")}` : "Output clear of PII/secret patterns."
        };
    }

    /**
     * Layer 5: Post-Execution Impact Audit & Forensic Tracing
     */
    static evaluateLayer5_Audit(context: GuardrailContext, actionDescription: string, layerResults: GuardrailLayerResult[]): GuardrailLayerResult {
        const totalRisk = Math.max(0, ...layerResults.map(l => l.riskScore));
        const timestamp = new Date().toISOString();

        // Update sliding-window session risk tracking
        const sessionKey = context?.sessionId || (context?.userId ? `user:${context.userId}` : undefined);
        if (sessionKey && totalRisk > 0) {
            const now = Date.now();
            const history = (sessionRiskHistory.get(sessionKey) || []).filter(e => now - e.timestamp <= SLIDING_WINDOW_MS);
            history.push({ timestamp: now, riskScore: totalRisk });
            sessionRiskHistory.set(sessionKey, history);
        }

        logger.info(`[SwissCheese Audit] Action: "${actionDescription}" | Org: ${context.organizationId} | Risk: ${totalRisk}/100 | Layers Passed: ${layerResults.filter(l => l.passed).length}/4`);

        return {
            layerNumber: 5,
            layerName: "Post-Execution Impact & Forensic Audit",
            passed: true,
            violations: [],
            riskScore: totalRisk,
            reasoning: `Audit record captured at ${timestamp} with aggregate risk score ${totalRisk}.`
        };
    }

    /**
     * Helper to clear or reset session risk history (useful for testing and tenant lifecycle)
     */
    static clearSessionRiskHistory(sessionKey?: string): void {
        if (sessionKey) {
            sessionRiskHistory.delete(sessionKey);
        } else {
            sessionRiskHistory.clear();
        }
    }

    /**
     * Execute full 5-Layer Swiss Cheese Validation
     */
    static async validateFullPipeline(
        input: any,
        toolName?: string,
        context: GuardrailContext = { organizationId: 1 },
        runtimeMetrics?: { loopCount?: number; executionTimeMs?: number; circuitOpen?: boolean }
    ): Promise<SwissCheeseValidationResult> {
        const layerResults: GuardrailLayerResult[] = [];

        // Layer 1: Input
        const l1 = this.evaluateLayer1_Input(input);
        layerResults.push(l1);
        if (!l1.passed) {
            return this.buildResult(false, 1, l1.layerName, input, layerResults, "Prompt injection / threat blocked at Layer 1", context);
        }

        // Layer 2: Policy
        const l2 = await this.evaluateLayer2_Policy(toolName, l1.sanitizedData, context);
        layerResults.push(l2);
        if (!l2.passed) {
            return this.buildResult(false, 2, l2.layerName, l1.sanitizedData, layerResults, "Policy/RBAC authorization blocked at Layer 2", context);
        }

        // Layer 3: Runtime
        const l3 = this.evaluateLayer3_Runtime(runtimeMetrics, context);
        layerResults.push(l3);
        if (!l3.passed) {
            return this.buildResult(false, 3, l3.layerName, l1.sanitizedData, layerResults, "Runtime anomaly/circuit-breaker blocked at Layer 3", context);
        }

        // Layer 4: Output / PII Redaction
        const l4 = this.evaluateLayer4_Output(l1.sanitizedData);
        layerResults.push(l4);

        // Layer 5: Audit
        const l5 = this.evaluateLayer5_Audit(context, `Tool: ${toolName || "Agent Thought"}`, layerResults);
        layerResults.push(l5);

        const overallRisk = Math.max(0, ...layerResults.map(l => l.riskScore));

        return {
            allowed: true,
            finalPayload: l4.sanitizedData,
            layerResults,
            overallRiskScore: overallRisk,
            remediationChips: l4.violations.length > 0 ? this.generateRemediationChips(undefined, layerResults, context) : undefined,
            forensicAuditLog: {
                timestamp: new Date().toISOString(),
                decision: l4.violations.length > 0 ? "redact" : "allow",
                summary: `Successfully verified across all 5 Swiss Cheese layers. (Risk score: ${overallRisk})`
            }
        };
    }

    static generateRemediationChips(blockedLayer?: number, layerResults: GuardrailLayerResult[] = [], context?: GuardrailContext): RemediationChip[] {
        const chips: RemediationChip[] = [];
        if (blockedLayer === 1) {
            chips.push({
                id: "strip_prompt_injection",
                label: "Sanitize & Rephrase Prompt",
                actionType: "sanitize_prompt",
                description: "Strip control tokens and restart session with normalized input."
            });
        } else if (blockedLayer === 2) {
            chips.push(
                {
                    id: "request_rbac_override",
                    label: "Request Admin Scope Grant",
                    actionType: "request_override",
                    description: "Submit a 1-click privilege elevation request to the compliance officer."
                },
                {
                    id: "downgrade_to_readonly",
                    label: "Downgrade to Read-Only",
                    actionType: "downgrade_scope",
                    description: "Execute step using safe read-only introspection without state mutation."
                }
            );
        } else if (blockedLayer === 3) {
            chips.push(
                {
                    id: "escalate_to_hil",
                    label: "Escalate to Human Supervisor",
                    actionType: "escalate_hil",
                    description: "Handoff the blocked execution to the HIL Action Center for manual review."
                },
                {
                    id: "reset_circuit_breaker",
                    label: "Reset Loop Watchdog",
                    actionType: "request_override",
                    description: "Clear execution loop counter and resume guarded step."
                }
            );
        } else if (blockedLayer === 4 || layerResults.some(l => l.layerNumber === 4 && l.violations.length > 0)) {
            chips.push({
                id: "auto_redact_pii",
                label: "Proceed with Auto-Redaction",
                actionType: "retry_with_redaction",
                description: "Mask detected secrets, API keys, or personal identifiers before downstream dispatch."
            });
        }
        return chips;
    }

    private static buildResult(
        allowed: boolean,
        blockedLayer: number,
        layerName: string,
        payload: any,
        layerResults: GuardrailLayerResult[],
        summary: string,
        context?: GuardrailContext
    ): SwissCheeseValidationResult {
        const overallRisk = Math.max(0, ...layerResults.map(l => l.riskScore));
        
        // Track the risk event in session history even on early block
        const sessionKey = context?.sessionId || (context?.userId ? `user:${context.userId}` : undefined);
        if (sessionKey && overallRisk > 0) {
            const now = Date.now();
            const history = (sessionRiskHistory.get(sessionKey) || []).filter(e => now - e.timestamp <= SLIDING_WINDOW_MS);
            history.push({ timestamp: now, riskScore: overallRisk });
            sessionRiskHistory.set(sessionKey, history);
        }

        return {
            allowed,
            blockedAtLayer: blockedLayer,
            blockedLayerName: layerName,
            finalPayload: payload,
            layerResults,
            overallRiskScore: overallRisk,
            remediationChips: this.generateRemediationChips(blockedLayer, layerResults, context),
            forensicAuditLog: {
                timestamp: new Date().toISOString(),
                decision: "deny",
                summary
            }
        };
    }
}

export const swissCheeseGuardrailService = SwissCheeseGuardrailService;
