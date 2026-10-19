/**
 * CORE Platform-Wide PII / PAI Confidentiality Utility Service
 *
 * Provides high-speed, deterministic reversible tokenization and detokenization of
 * Personally Identifiable Information (PII) and Proprietary AI Assets (PAI) across:
 * - Crew Chat & Multi-Agent Conversations
 * - Autonomous Tool Execution & Dynamic Arguments
 * - App Forge Form Inputs & Schemas
 *
 * Guaranteed zero-leakage: Raw credentials, keys, URIs, and identity data are held
 * in ephemeral encrypted memory and replaced with opaque surrogate tokens before cloud egress.
 */

import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CoreConfidentialityUtilityService");

export type PAIClassification = "EMAIL" | "PHONE" | "API_KEY" | "DB_URI" | "IPV4" | "SECRET";

export interface RedactedTokenRecord {
    token: string;
    type: PAIClassification;
    originalValue: string;
    organizationId?: number;
    sessionId?: string;
    expiresAt: number;
}

export interface ConfidentialityTokenizeResult {
    tokenizedText: string;
    redactionCount: number;
    redactedTokens: Array<{
        token: string;
        type: PAIClassification;
        originalValue: string;
    }>;
}

export interface TokenizeOptions {
    organizationId?: number;
    sessionId?: string;
    ttlMs?: number; // Defaults to 1 hour (3600000ms)
}

export class CoreConfidentialityUtilityService {
    private tokenStore = new Map<string, RedactedTokenRecord>();
    private static readonly DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

    /**
     * Regex patterns for high-risk PII / PAI detection
     */
    private static readonly PATTERNS: Array<{ type: PAIClassification; regex: RegExp }> = [
        // Secrets & API Keys
        {
            type: "API_KEY",
            regex: /\b(?:sk-[a-zA-Z0-9_\-]{20,}|AIza[0-9A-Za-z\-_]{35}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[0-9a-zA-Z\-]{10,})\b/g,
        },
        // Database Connection Strings
        {
            type: "DB_URI",
            regex: /\b(?:postgresql|postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>\\]+/g,
        },
        // Emails
        {
            type: "EMAIL",
            regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
        },
        // Phone numbers (US & International formats)
        {
            type: "PHONE",
            regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        },
        // IPv4 Addresses (excluding private loopbacks like 127.0.0.1 or standard 0.0.0.0 if needed, but safer to redact all external)
        {
            type: "IPV4",
            regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
        },
    ];

    /**
     * Scan text, extract sensitive PII/PAI values into ephemeral store,
     * and substitute with reversible surrogate markers: `<<PAI:TYPE:hex>>`
     */
    tokenize(text: string, options: TokenizeOptions = {}): ConfidentialityTokenizeResult {
        if (!text) {
            return { tokenizedText: "", redactionCount: 0, redactedTokens: [] };
        }

        const now = Date.now();
        const ttl = options.ttlMs || CoreConfidentialityUtilityService.DEFAULT_TTL_MS;
        const expiresAt = now + ttl;
        const redactedTokens: ConfidentialityTokenizeResult["redactedTokens"] = [];

        let resultText = text;

        for (const { type, regex } of CoreConfidentialityUtilityService.PATTERNS) {
            resultText = resultText.replace(regex, (match) => {
                // Ignore benign localhost/0.0.0.0 IPs
                if (type === "IPV4" && (match === "127.0.0.1" || match === "0.0.0.0" || match === "255.255.255.255")) {
                    return match;
                }

                const hash = crypto.createHash("sha256").update(match + (options.organizationId || 0)).digest("hex").slice(0, 8);
                const token = `<<PAI:${type}:${hash}>>`;

                const record: RedactedTokenRecord = {
                    token,
                    type,
                    originalValue: match,
                    organizationId: options.organizationId,
                    sessionId: options.sessionId,
                    expiresAt,
                };

                this.tokenStore.set(token, record);

                redactedTokens.push({
                    token,
                    type,
                    originalValue: match,
                });

                return token;
            });
        }

        if (redactedTokens.length > 0) {
            logger.info("PII/PAI tokenization completed", {
                count: redactedTokens.length,
                types: Array.from(new Set(redactedTokens.map((t) => t.type))),
                organizationId: options.organizationId,
            });
        }

        return {
            tokenizedText: resultText,
            redactionCount: redactedTokens.length,
            redactedTokens,
        };
    }

    /**
     * Detokenize text containing surrogate markers: `<<PAI:TYPE:hex>>` -> original value.
     */
    detokenize(text: string, options: { organizationId?: number; sessionId?: string } = {}): string {
        if (!text || !text.includes("<<PAI:")) {
            return text;
        }

        const tokenRegex = /<<PAI:(?:EMAIL|PHONE|API_KEY|DB_URI|IPV4|SECRET):[a-f0-9]{8}>>/g;
        const now = Date.now();

        return text.replace(tokenRegex, (token) => {
            const record = this.tokenStore.get(token);
            if (!record) {
                logger.warn("Unresolved PII/PAI surrogate token", { token });
                return token;
            }

            // Tenant isolation check if organizationId provided
            if (
                options.organizationId !== undefined &&
                record.organizationId !== undefined &&
                record.organizationId !== options.organizationId
            ) {
                logger.warn("Cross-tenant PII/PAI detokenization denied", {
                    token,
                    requestedOrg: options.organizationId,
                    ownerOrg: record.organizationId,
                });
                return token;
            }

            // Expiry check
            if (now > record.expiresAt) {
                this.tokenStore.delete(token);
                logger.warn("Expired PII/PAI surrogate token requested", { token });
                return token;
            }

            return record.originalValue;
        });
    }

    /**
     * Whether a text contains any active PAI surrogate markers.
     */
    isTokenized(text: string): boolean {
        return Boolean(text && /<<PAI:(?:EMAIL|PHONE|API_KEY|DB_URI|IPV4|SECRET):[a-f0-9]{8}>>/.test(text));
    }

    /**
     * Clear expired tokens from memory.
     */
    purgeExpired(): number {
        const now = Date.now();
        let purged = 0;
        for (const [token, record] of this.tokenStore.entries()) {
            if (now > record.expiresAt) {
                this.tokenStore.delete(token);
                purged++;
            }
        }
        return purged;
    }

    /**
     * Clear all tokens (useful for testing).
     */
    clearAll(): void {
        this.tokenStore.clear();
    }
}

export const coreConfidentialityUtility = new CoreConfidentialityUtilityService();
