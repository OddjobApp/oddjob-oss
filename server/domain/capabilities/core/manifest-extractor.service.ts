/**
 * Manifest Extractor Service (Path B input)
 * =========================================
 *
 * The upstream half of the bi-directional engine: parses a hand-written or
 * legacy Markdown capability doc back into a schema-valid
 * {@link CapabilityManifest}, so documentation can introduce or amend a
 * capability in the live vector router.
 *
 * Robustness is the whole job here — an LLM asked for JSON will sometimes wrap
 * it in prose or a code fence, or miss a field. So extraction:
 *   1. Prompts a local/Gemini-first model for JSON matching the manifest schema.
 *   2. Pulls the first balanced JSON object out of the response (fence/prose
 *      tolerant).
 *   3. Validates against the zod schema.
 *   4. On any failure, retries ONCE with a corrective prompt that quotes the
 *      exact validation error, then gives up with a typed error.
 *
 * The generator is injectable for deterministic unit testing.
 */

import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import {
    safeParseCapabilityManifest,
    CAPABILITY_CATEGORIES,
    RISK_PROFILES,
    EXECUTION_ENVIRONMENTS,
    type CapabilityManifest,
} from "@shared/schema/capabilities/index.js";
import type { DocGenerateFn } from "./doc-compiler.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("ManifestExtractor");

export const EXTRACTION_SYSTEM_PROMPT = `You are Oddjob's Capability Extraction Engine. You read a Markdown document describing a software capability and output a single JSON object that captures its structured contract.

Return ONLY one JSON object — no prose, no explanation, no code fences.

The JSON MUST have this exact shape:
{
  "schema_version": 1,
  "capability_version": "<semantic version such as 1.2.0; default 1.0.0>",
  "capability_id": "<lowercase_snake_case slug matching ^[a-z0-9_]+$>",
  "metadata": {
    "display_name": "<human readable name>",
    "category": <one of ${JSON.stringify(CAPABILITY_CATEGORIES)}>,
    "description": "<one sentence describing what it does>",
    "owner": "<team or person, or 'unassigned'>"
  },
  "technical_spec": {
    "inputs": { "<param_name>": "<type string>" },
    "outputs": { "<name>": "<type string>" }
  },
  "documentation_meta": {
    "summary": "<short business summary>",
    "business_use_cases": ["<use case>", "..."],
    "guardrails": ["<strict execution constraint>", "..."]
  },
  "runtime_context": {
    "risk_profile": <one of ${JSON.stringify(RISK_PROFILES)}>,
    "execution_environment": <one of ${JSON.stringify(EXECUTION_ENVIRONMENTS)}>,
    "dependencies": ["<dependency>", "..."]
  }
}

Rules:
- Derive capability_id from the title/id in the doc; lowercase it and replace spaces/hyphens with underscores.
- Preserve an explicit capability version from the metadata callout; otherwise use "1.0.0".
- Infer input/output types from parameter tables when present.
- Extract guardrails from any security/warning callouts.
- Do NOT invent categories, risk levels, or environments outside the allowed lists.
- If a field is genuinely absent, use a sensible default ("" for strings, [] for lists, "unassigned" owner, "Low" risk, "Host" environment).`;

export class ManifestExtractionError extends Error {
    constructor(message: string, readonly detail?: unknown) {
        super(message);
    }
}

async function defaultGenerate({ system, user }: { system: string; user: string }): Promise<string | null> {
    const client = AIClientFactory.getClient({ provider: "google" } as any);
    const result = await client.execute(
        {
            credentialId: 0,
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
            userPrompt: user,
            systemPrompt: system,
            requestType: "json",
            temperature: 0.1,
            useCache: false,
            enableQueryExpansion: false,
            maxTokens: 4096,
            saveOutputToFile: false,
        } as any,
        undefined,
        developmentProviderKey(),
    );
    if (!result.success) {
        logger.warn(`Extraction generation failed: ${result.error}`);
        return null;
    }
    return result.output || null;
}

export class ManifestExtractorService {
    private readonly generate: DocGenerateFn;
    private readonly maxAttempts: number;

    constructor(deps: { generate?: DocGenerateFn; maxAttempts?: number } = {}) {
        this.generate = deps.generate ?? defaultGenerate;
        this.maxAttempts = Math.max(1, deps.maxAttempts ?? 2);
    }

    /**
     * Extract a validated manifest from a Markdown capability doc.
     * @throws ManifestExtractionError if no valid manifest can be produced.
     */
    async extract(markdown: string): Promise<CapabilityManifest> {
        if (!markdown || !markdown.trim()) {
            throw new ManifestExtractionError("Cannot extract a manifest from empty Markdown.");
        }

        let lastError: unknown = null;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            const user =
                attempt === 1
                    ? `Markdown document:\n\n${markdown}`
                    : `Your previous response could not be parsed into the required schema. ` +
                      `Error: ${String(lastError)}\n\n` +
                      `Return ONLY a single valid JSON object matching the schema. Markdown document:\n\n${markdown}`;

            let raw: string | null;
            try {
                raw = await this.generate({ system: EXTRACTION_SYSTEM_PROMPT, user });
            } catch (err) {
                lastError = err;
                logger.warn(`Extraction attempt ${attempt} threw; ${attempt < this.maxAttempts ? "retrying" : "giving up"}.`);
                continue;
            }

            if (!raw) {
                lastError = new Error("model returned an empty response");
                continue;
            }

            const jsonText = extractJsonObject(raw);
            if (!jsonText) {
                lastError = new Error("no JSON object found in model response");
                continue;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(jsonText);
            } catch (err) {
                lastError = err;
                continue;
            }

            const result = safeParseCapabilityManifest(parsed);
            if (result.success) {
                logger.info(`Extracted manifest ${result.data.capability_id} from Markdown (attempt ${attempt}).`);
                return result.data;
            }
            lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        }

        throw new ManifestExtractionError(
            `Failed to extract a valid manifest after ${this.maxAttempts} attempt(s).`,
            lastError,
        );
    }
}

export const manifestExtractor = new ManifestExtractorService();

/**
 * Extract the first balanced JSON object from arbitrary text (tolerant of code
 * fences and surrounding prose), respecting string literals and escapes.
 */
export function extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}
