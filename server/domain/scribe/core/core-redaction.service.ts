/**
 * CORE Redaction & Tokenization Service
 *
 * Intercepts manuscript content before cloud egress, extracts sensitive/sandboxed
 * prose blocks into the local vault, and substitutes them with deterministic semantic
 * surrogate markers that cloud models can reason around without filter violations.
 */

import crypto from "node:crypto";
import { scribeVaultService } from "./scribe-vault.service.js";
import { ephemeralVaultCache, type EphemeralVaultPayload } from "./ephemeral-vault-cache.service.js";
import type { ScribeVaultClassification, ScribeVaultMode } from "@shared/schema/scribe.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CoreRedactionService");

export interface RedactionResult {
    sanitizedText: string;
    extractedCount: number;
    tokens: Array<{
        tokenId: string;
        slug?: string;
        classification: ScribeVaultClassification;
        mode: ScribeVaultMode;
        summary: string;
        rawPayload: string;
    }>;
}

export interface RedactionOptions {
    organizationId: number;
    documentId: number;
    nodeId?: number | null;
    persistToDb?: boolean;
}

export class CoreRedactionService {
    /**
     * Regex matching container directive sandbox syntax:
     * :::sandbox [attributes]
     * [body content]
     * :::
     */
    private static readonly SANDBOX_BLOCK_REGEX = /:::sandbox\s+([^\r\n]+?)\r?\n([\s\S]*?)\r?\n:::/gi;

    /**
     * Parse key="value" or key='value' attributes from the sandbox directive line.
     */
    private parseAttributes(attrString: string): Record<string, string> {
        const attrs: Record<string, string> = {};
        const attrRegex = /([a-zA-Z0-9_\-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
        let match: RegExpExecArray | null;

        while ((match = attrRegex.exec(attrString)) !== null) {
            const key = match[1].toLowerCase();
            const value = match[2] ?? match[3] ?? match[4] ?? "";
            attrs[key] = value;
        }

        return attrs;
    }

    /**
     * Generate a deterministic surrogate marker containing the beat summary and token ID:
     * [SCENE_BEAT: Alice and Bob reconcile] <<ODDJOB_MASK:8f2a1c9e>>
     */
    static formatSurrogateMarker(tokenId: string, summary: string): string {
        const cleanSummary = summary.replace(/[\[\]]/g, "").trim();
        return `[SCENE_BEAT: ${cleanSummary}] <<${tokenId}>>`;
    }

    /**
     * Extract sandboxed blocks from text, vault their payloads, and return the sanitized string.
     */
    async redactText(text: string, options: RedactionOptions): Promise<RedactionResult> {
        const tokens: RedactionResult["tokens"] = [];
        let extractedCount = 0;

        const sanitizedText = text.replace(
            CoreRedactionService.SANDBOX_BLOCK_REGEX,
            (_fullMatch, attrStr, body) => {
                extractedCount++;
                const attrs = this.parseAttributes(attrStr);
                const slug = attrs.id || attrs.slug || `block_${extractedCount}`;
                const classification = (attrs.type || "confidential") as ScribeVaultClassification;
                const mode = (attrs.mode || "static_reinsert") as ScribeVaultMode;
                const summary = attrs.summary || "Protected confidential narrative scene.";
                const rawPayload = body.trim();

                // Unique 8-hex token ID: ODDJOB_MASK:8f2a1c9e
                const hexId = crypto.randomBytes(4).toString("hex");
                const tokenId = `ODDJOB_MASK:${hexId}`;

                tokens.push({
                    tokenId,
                    slug,
                    classification,
                    mode,
                    summary,
                    rawPayload,
                });

                return CoreRedactionService.formatSurrogateMarker(tokenId, summary);
            }
        );

        // Store tokens in ephemeral cache and optionally in the persistent database
        for (const t of tokens) {
            const payload: EphemeralVaultPayload = {
                tokenId: t.tokenId,
                organizationId: options.organizationId,
                documentId: options.documentId,
                nodeId: options.nodeId,
                classification: t.classification,
                mode: t.mode,
                summary: t.summary,
                rawPayload: t.rawPayload,
                createdAt: Date.now(),
            };

            await ephemeralVaultCache.set(payload);

            if (options.persistToDb) {
                await scribeVaultService.saveVaultRecord({
                    organizationId: options.organizationId,
                    documentId: options.documentId,
                    nodeId: options.nodeId,
                    tokenId: t.tokenId,
                    slug: t.slug,
                    classification: t.classification,
                    mode: t.mode,
                    summary: t.summary,
                    rawPayload: t.rawPayload,
                });
            }
        }

        if (extractedCount > 0) {
            logger.info(`Redacted ${extractedCount} sandbox blocks for doc #${options.documentId}`);
        }

        return {
            sanitizedText,
            extractedCount,
            tokens,
        };
    }
}

export const coreRedactionService = new CoreRedactionService();
