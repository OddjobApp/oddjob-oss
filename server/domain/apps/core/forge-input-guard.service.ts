/**
 * Forge Input Guard Service
 *
 * Defends against prompt injection attacks and sanitizes user input
 * before it reaches the AI code generation pipeline.
 *
 * Detects:
 * - Prompt injection attempts (ignore previous instructions, etc.)
 * - Jailbreak patterns (DAN, developer mode, etc.)
 * - Role confusion attacks
 * - Delimiter confusion attacks
 * - Multi-language obfuscation
 * - Indirect injection via data references
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeInputGuard");

export interface GuardResult {
  allowed: boolean;
  sanitized?: string;
  reason?: string;
  detectedPatterns?: string[];
  riskScore: number; // 0-100, higher = more risky
  suggestions?: string[];
}

export interface SanitizationOptions {
  maxLength?: number;
  removeHtml?: boolean;
  removeControlChars?: boolean;
  normalizeWhitespace?: boolean;
  escapeSpecialChars?: boolean;
}

// Prompt injection patterns
const INJECTION_PATTERNS = [
  // Classic injection phrases
  {
    pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|commands?|context)/i,
    name: "ignore_previous_instructions",
    severity: "critical",
    description: "Attempt to override system instructions",
  },
  {
    pattern: /disregard\s+(all\s+)?(instructions?|rules?|constraints?)/i,
    name: "disregard_instructions",
    severity: "critical",
    description: "Attempt to dismiss safety guidelines",
  },
  {
    pattern: /forget\s+(everything|all|your)\s+(you know|instructions?|training)/i,
    name: "forget_instructions",
    severity: "critical",
    description: "Attempt to reset model behavior",
  },
  {
    pattern: /system\s*[:\s]+\s*you\s+are\s+now/i,
    name: "system_override",
    severity: "critical",
    description: "Attempt to inject new system prompt",
  },
  {
    pattern: /new\s+system\s*[:\s]+/i,
    name: "new_system_prompt",
    severity: "critical",
    description: "Attempt to establish new system context",
  },

  // Role confusion
  {
    pattern: /you\s+are\s+(?:now\s+)?(?:an?\s+)?(?:unrestricted?|uncensored?|unfiltered?|limitless?)/i,
    name: "role_unrestricted",
    severity: "high",
    description: "Attempt to remove safety constraints",
  },
  {
    pattern: /you\s+are\s+(?:now\s+)?(?:a\s+)?developer\s+mode/i,
    name: "developer_mode",
    severity: "high",
    description: "Attempt to enable unrestricted mode",
  },
  {
    pattern: /(?:enter|switch\s+to)\s+(?:developer|debug|admin|root)\s+mode/i,
    name: "mode_switch",
    severity: "high",
    description: "Attempt to access privileged mode",
  },
  {
    pattern: /you\s+are\s+not\s+(?:an?\s+)?(?:ai|assistant|bot|language\s+model)/i,
    name: "role_denial",
    severity: "high",
    description: "Attempt to change AI identity",
  },
  {
    pattern: /act\s+as\s+(?:if\s+)?you\s+(?:are|were|have\s+no)/i,
    name: "roleplay_manipulation",
    severity: "medium",
    description: "Roleplay scenario that may bypass constraints",
  },

  // Jailbreak patterns
  {
    pattern: /DAN\s*[:\s]/i,
    name: "dan_jailbreak",
    severity: "critical",
    description: "DAN (Do Anything Now) jailbreak attempt",
  },
  {
    pattern: /STAN\s*[:\s]|DUDE\s*[:\s]/i,
    name: "alternative_jailbreak",
    severity: "critical",
    description: "Alternative jailbreak persona",
  },
  {
    pattern: /jailbreak|hypothetically|pretend\s+that\s+no\s+rules/i,
    name: "jailbreak_keyword",
    severity: "high",
    description: "Jailbreak terminology detected",
  },
  {
    pattern: /sudo\s+(?:ignore|bypass|override|grant)/i,
    name: "sudo_bypass",
    severity: "high",
    description: "Attempt to use 'sudo' metaphor for privilege escalation",
  },
  {
    pattern: /root\s+access|admin\s+privileges?/i,
    name: "privilege_escalation",
    severity: "high",
    description: "Privilege escalation terminology",
  },

  // Delimiter confusion
  {
    pattern: /\"\"\"[\s\S]*?system[\s\S]*?\"\"\"/i,
    name: "triple_quote_injection",
    severity: "high",
    description: "Triple quote delimiter manipulation",
  },
  {
    pattern: /```[\s\S]*?system[\s\S]*?```/i,
    name: "code_block_injection",
    severity: "high",
    description: "Code block delimiter manipulation",
  },
  {
    pattern: /\{\{[\s\S]*?SYSTEM[\s\S]*?\}\}/i,
    name: "template_injection",
    severity: "high",
    description: "Template syntax injection",
  },
  {
    pattern: /<\/?(?:system|instruction|prompt)[^>]*>/i,
    name: "xml_tag_injection",
    severity: "high",
    description: "XML-style tag injection",
  },
  {
    pattern: /\[\s*(?:system|instructions?)\s*\]/i,
    name: "bracket_injection",
    severity: "medium",
    description: "Bracket-style injection attempt",
  },

  // Multi-language / encoding tricks
  {
    pattern: /[\u200B-\u200D\uFEFF]/, // Zero-width characters
    name: "zero_width_chars",
    severity: "medium",
    description: "Zero-width characters detected (possible encoding attack)",
  },
  {
    pattern: /[\u202A-\u202E]/, // Bi-directional override
    name: "bidi_override",
    severity: "high",
    description: "Bi-directional text override detected",
  },
  {
    pattern: /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF]/, // Combining characters
    name: "combining_chars",
    severity: "low",
    description: "Combining characters detected",
  },
  {
    pattern: /\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/,
    name: "unicode_escape",
    severity: "medium",
    description: "Unicode escape sequences detected",
  },

  // Indirect injection
  {
    pattern: /https?:\/\/\S+\?(?:prompt|instruction|system)\s*=/i,
    name: "url_param_injection",
    severity: "medium",
    description: "URL containing prompt parameters",
  },
  {
    pattern: /file:\/\/\/\S+\.(?:txt|md|prompt|system)/i,
    name: "file_reference",
    severity: "low",
    description: "File path that may contain instructions",
  },
  {
    pattern: /data:\s*text\/plain[^,]+,/,
    name: "data_uri",
    severity: "medium",
    description: "Data URI that may contain encoded instructions",
  },

  // Social engineering
  {
    pattern: /this\s+is\s+(?:a\s+)?test\s+of\s+your\s+(?:abilities?|capabilities?)/i,
    name: "capability_test",
    severity: "medium",
    description: "Testing boundaries of AI capabilities",
  },
  {
    pattern: /emergency\s+situation|life\s+or\s+death/i,
    name: "urgency_manipulation",
    severity: "medium",
    description: "Attempt to create false urgency",
  },
  {
    pattern: /i\s+(?:order|command|demand)\s+you\s+to/i,
    name: "authority_claim",
    severity: "low",
    description: "False authority assertion",
  },

  // Leakage attempts
  {
    pattern: /repeat\s+(?:after\s+me|the\s+word|this\s+exactly)/i,
    name: "exact_repetition",
    severity: "medium",
    description: "Attempt to extract system prompt through repetition",
  },
  {
    pattern: /what\s+(?:were|are)\s+your\s+(?:original\s+)?instructions?/i,
    name: "instruction_leak",
    severity: "medium",
    description: "Attempt to extract system instructions",
  },
  {
    pattern: /translate\s+this\s+to\s+(?:english|plain\s+text)/i,
    name: "translation_extraction",
    severity: "low",
    description: "Attempt to extract hidden content via translation",
  },

  // Obfuscation
  {
    pattern: /\b(i g n o r e|i-g-n-o-r-e|i\.g\.n\.o\.r\.e)\b/i,
    name: "spaced_obfuscation",
    severity: "high",
    description: "Spaced/obfuscated injection keyword",
  },
  {
    pattern: /\b(iⓝⓢⓣⓡⓤⓒⓣⓘⓞⓝⓢ?)\b/iu,
    name: "unicode_obfuscation",
    severity: "high",
    description: "Unicode character obfuscation",
  },
  {
    pattern: /base64\s*[:=]\s*([a-zA-Z0-9+/]{50,}={0,2})/,
    name: "base64_encoded",
    severity: "medium",
    description: "Base64 encoded content that may hide instructions",
  },
];

// Allowed patterns that look like injection but are legitimate
const ALLOWLIST_PATTERNS = [
  // Documentation references
  /ignore\s+the\s+above\s+example/i,
  /as\s+shown\s+in\s+the\s+previous\s+section/i,
  /disregard\s+the\s+placeholder\s+values?/i,

  // Valid use cases
  /act\s+as\s+a\s+(?:user|customer|admin|manager)/i,
  /developer\s+tools?|developer\s+experience/i,
  /system\s+(?:requirements?|specifications?|design)/i,
  /emergency\s+(?:contact|procedure|response)/i,

  // URLs with legitimate prompt-related params
  /\?prompt=\d+|\?prompt=(?:true|false)/i,
];

export const forgeInputGuard = {
  /**
   * Main entry point - scan and optionally sanitize input
   */
  scanInput(input: string, options: SanitizationOptions = {}): GuardResult {
    const maxLength = options.maxLength || 10000;

    // Check length
    if (input.length > maxLength) {
      return {
        allowed: false,
        reason: `Input exceeds maximum length of ${maxLength} characters`,
        riskScore: 100,
      };
    }

    // Detect injection patterns
    const detections: { pattern: string; severity: string }[] = [];
    let totalRiskScore = 0;

    for (const pattern of INJECTION_PATTERNS) {
      pattern.pattern.lastIndex = 0;
      if (pattern.pattern.test(input)) {
        // Check allowlist
        const isAllowed = ALLOWLIST_PATTERNS.some(allowed =>
          allowed.test(input)
        );

        if (!isAllowed) {
          detections.push({
            pattern: pattern.name,
            severity: pattern.severity,
          });

          // Add to risk score based on severity
          const severityWeights: Record<string, number> = {
            critical: 50,
            high: 30,
            medium: 15,
            low: 5,
          };
          totalRiskScore += severityWeights[pattern.severity] || 5;
        }
      }
    }

    // Cap risk score at 100
    totalRiskScore = Math.min(totalRiskScore, 100);

    // If critical patterns detected, block immediately
    const hasCritical = detections.some(d => d.severity === "critical");
    const hasHigh = detections.some(d => d.severity === "high");

    if (hasCritical) {
      return {
        allowed: false,
        reason: "Critical security pattern detected - possible prompt injection attack",
        detectedPatterns: detections.map(d => d.pattern),
        riskScore: totalRiskScore,
        suggestions: [
          "Remove phrases attempting to override system instructions",
          "Avoid using 'ignore previous instructions' or similar language",
          "Rephrase without system prompt manipulation attempts",
        ],
      };
    }

    // Sanitize if allowed but has detections
    let sanitized = input;
    if (detections.length > 0 || options.removeHtml || options.removeControlChars) {
      sanitized = this.sanitizeInput(input, options);
    }

    // Allow if no high/critical, but warn
    const allowed = !hasHigh || totalRiskScore < 50;

    return {
      allowed,
      sanitized: sanitized !== input ? sanitized : undefined,
      reason: allowed
        ? detections.length > 0
          ? "Suspicious patterns detected but risk level acceptable"
          : undefined
        : "High-risk patterns detected",
      detectedPatterns: detections.length > 0 ? detections.map(d => d.pattern) : undefined,
      riskScore: totalRiskScore,
      suggestions: detections.length > 0
        ? [
            "Review your prompt for unintentional injection patterns",
            "Avoid phrases that might be interpreted as system commands",
          ]
        : undefined,
    };
  },

  /**
   * Sanitize input for safe inclusion in prompts
   */
  sanitizeInput(input: string, options: SanitizationOptions = {}): string {
    let sanitized = input;

    // Remove control characters
    if (options.removeControlChars !== false) {
      sanitized = sanitized.replace(
        /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g,
        ""
      );
    }

    // Remove zero-width characters
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Remove bi-directional overrides
    sanitized = sanitized.replace(/[\u202A-\u202E]/g, "");

    // Remove HTML tags
    if (options.removeHtml) {
      sanitized = sanitized.replace(/<[^>]+>/g, "");
    }

    // Escape special characters
    if (options.escapeSpecialChars) {
      sanitized = sanitized
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    }

    // Normalize whitespace
    if (options.normalizeWhitespace !== false) {
      sanitized = sanitized.replace(/\s+/g, " ").trim();
    }

    // Length limit
    const maxLength = options.maxLength || 10000;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + "... [truncated]";
    }

    return sanitized;
  },

  /**
   * Check if input is safe for direct inclusion in prompts
   */
  isSafeForPrompt(input: string): boolean {
    const result = this.scanInput(input);
    return result.allowed && result.riskScore < 20;
  },

  /**
   * Get detailed analysis of input
   */
  analyzeInput(input: string): {
    riskScore: number;
    patterns: string[];
    severity: "low" | "medium" | "high" | "critical";
    recommendations: string[];
  } {
    const result = this.scanInput(input);

    let severity: "low" | "medium" | "high" | "critical" = "low";
    if (result.riskScore >= 80) severity = "critical";
    else if (result.riskScore >= 50) severity = "high";
    else if (result.riskScore >= 20) severity = "medium";

    const recommendations: string[] = [];

    if (result.detectedPatterns?.includes("ignore_previous_instructions")) {
      recommendations.push("Remove 'ignore previous instructions' - this is a common injection pattern");
    }

    if (result.detectedPatterns?.includes("dan_jailbreak")) {
      recommendations.push("Remove jailbreak terminology like 'DAN'");
    }

    if (result.detectedPatterns?.includes("zero_width_chars")) {
      recommendations.push("Remove invisible unicode characters");
    }

    if (result.riskScore > 0 && result.riskScore < 20) {
      recommendations.push("Input is generally safe but review flagged patterns");
    }

    return {
      riskScore: result.riskScore,
      patterns: result.detectedPatterns || [],
      severity,
      recommendations,
    };
  },

  /**
   * Log security event for monitoring
   */
  logSecurityEvent(input: string, result: GuardResult, metadata?: Record<string, any>): void {
    if (result.riskScore > 0) {
      logger.warn("[ForgeInputGuard] Security event detected", {
        riskScore: result.riskScore,
        patterns: result.detectedPatterns,
        allowed: result.allowed,
        inputLength: input.length,
        ...metadata,
      });
    }
  },

  /**
   * Batch scan multiple inputs
   */
  scanBatch(inputs: string[]): {
    results: GuardResult[];
    blocked: number;
    totalRisk: number;
    highestRisk: number;
  } {
    const results = inputs.map(input => this.scanInput(input));

    return {
      results,
      blocked: results.filter(r => !r.allowed).length,
      totalRisk: results.reduce((sum, r) => sum + r.riskScore, 0),
      highestRisk: Math.max(...results.map(r => r.riskScore)),
    };
  },
};

export default forgeInputGuard;
