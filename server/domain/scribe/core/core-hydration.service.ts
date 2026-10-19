/**
 * CORE Hydration Service
 *
 * Reassembles sanitized text buffers and streams back into complete manuscripts.
 * Handles exact surrogate matching, token drift (regex AST fallback),
 * and automatic stripping of model-hallucinated beat summary echoes.
 */

import { ephemeralVaultCache } from "./ephemeral-vault-cache.service.js";
import { scribeVaultService } from "./scribe-vault.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CoreHydrationService");

export interface HydrationOptions {
    organizationId: number;
    documentId: number;
    stripBeatEchoes?: boolean;
    localGenerator?: (prompt: { summary: string; precedingContext: string }) => Promise<string>;
}

export class CoreHydrationService {
    /**
     * Exact token regex: <<ODDJOB_MASK:8f2a1c9e>>
     */
    private static readonly EXACT_TOKEN_REGEX = /<<ODDJOB_MASK:([a-zA-Z0-9_\-]+)>>/gi;

    /**
     * Resilient fallback regex for token drift:
     * Catches any markdown escaping (e.g. \<\<), brackets ([[ODDJOB_MASK:...]]),
     * or custom punctuation wrappers and whitespace injected by generative models.
     */
    private static readonly DRIFT_TOKEN_REGEX = /[^a-zA-Z0-9_\s]{1,6}\s*ODDJOB_MASK:\s*([a-zA-Z0-9_\-]+)\s*[^a-zA-Z0-9_\s]{1,6}/gi;

    /**
     * Regex matching model-hallucinated beat echoes:
     * [SCENE_BEAT: ...] or [BEAT: ...]
     */
    private static readonly BEAT_ECHO_REGEX = /\[(?:SCENE_)?BEAT:\s*[^\]]+\]\s*/gi;

    /**
     * Replaces matches asynchronously using matchAll index slicing to avoid
     * shared regex state mutation or double-replace bugs.
     */
    private async replaceAsync(
        str: string,
        regex: RegExp,
        asyncFn: (match: string, ...args: any[]) => Promise<string>
    ): Promise<string> {
        const cloned = new RegExp(regex.source, regex.flags);
        const matches = Array.from(str.matchAll(cloned));
        if (matches.length === 0) return str;

        const replacements = await Promise.all(
            matches.map((m) => asyncFn(m[0], ...m.slice(1)))
        );

        let result = "";
        let lastIdx = 0;

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const start = m.index ?? 0;
            const end = start + m[0].length;

            result += str.slice(lastIdx, start) + replacements[i];
            lastIdx = end;
        }

        result += str.slice(lastIdx);
        return result;
    }


    /**
     * Rehydrates a text buffer with original vaulted content.
     */
    async rehydrateText(text: string, options: HydrationOptions): Promise<string> {
        let processed = text;

        // 1. Strip hallucinated beat echoes if requested (default: true)
        if (options.stripBeatEchoes !== false) {
            processed = processed.replace(CoreHydrationService.BEAT_ECHO_REGEX, "");
        }

        // 2. Exact token replacement pass
        processed = await this.replaceAsync(processed, CoreHydrationService.EXACT_TOKEN_REGEX, async (_match, rawUuid) => {
            const tokenId = `ODDJOB_MASK:${rawUuid.toLowerCase()}`;
            return this.resolveTokenContent(tokenId, options);
        });

        // 3. Resilient drift replacement pass (handles markdown escaping, double brackets, etc.)
        processed = await this.replaceAsync(processed, CoreHydrationService.DRIFT_TOKEN_REGEX, async (_match, rawUuid) => {
            const tokenId = `ODDJOB_MASK:${rawUuid.toLowerCase()}`;
            return this.resolveTokenContent(tokenId, options);
        });

        return processed;
    }

    /**
     * Resolves the replacement content for a single token ID.
     */
    private async resolveTokenContent(tokenId: string, options: HydrationOptions): Promise<string> {
        // 1. Try ephemeral cache first
        const cached = await ephemeralVaultCache.get(options.organizationId, options.documentId, tokenId);
        if (cached) {
            if (cached.mode === "generate_local" && options.localGenerator) {
                try {
                    return await options.localGenerator({
                        summary: cached.summary,
                        precedingContext: "",
                    });
                } catch (err: any) {
                    logger.warn(`Local generator failed for token ${tokenId} (${err.message}); falling back to raw payload.`);
                }
            }
            return cached.rawPayload;
        }

        // 2. Try persistent database vault
        const persisted = await scribeVaultService.getVaultRecord(options.organizationId, options.documentId, tokenId);
        if (persisted) {
            return persisted.rawPayload;
        }

        // 3. Fallback if token is unknown: preserve token and warn
        logger.warn(`Unresolved token during rehydration: ${tokenId} in doc #${options.documentId}`);
        return `<<${tokenId}>>`;
    }
}

export const coreHydrationService = new CoreHydrationService();
