/**
 * Doc Compiler Service (Path A output, part 1 of 2)
 * =================================================
 *
 * Translates a validated {@link CapabilityManifest} into pristine, scannable
 * Markdown. Two rendering paths:
 *
 *   - **LLM path** — a strict system prompt drives the platform's Gemini-first
 *     generator (`AIClientFactory`) to produce polished prose, then the output
 *     is sanitised to strip any conversational wrapper or code fences.
 *   - **Deterministic fallback** — if generation is unavailable or fails, a
 *     fully-formed template is rendered directly from the manifest, so the git
 *     pipeline always has content and the system works offline.
 *
 * Both paths emit the same skeleton: a metadata callout, horizontal rules,
 * parameter tables, and an explicit security-guardrail block.
 *
 * The generator is injectable so compilation can be unit-tested without a live
 * model.
 */

import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import {
    type CapabilityManifest,
    type CapabilityCategory,
} from "@shared/schema/capabilities/index.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("DocCompiler");

export const DOC_SYSTEM_PROMPT = `You are Oddjob's internal Technical Writer Agent. Your sole job is to translate a structured JSON Capability Manifest into clean, beautifully formatted GitHub Flavored Markdown documentation for an engineering audience.

Adhere strictly to these layout constraints:
- Begin immediately with a level-1 heading: "# <emoji> <display_name>".
- Directly under the title, render a blockquote metadata callout with the capability id, capability version, manifest schema version, category, owner, risk profile and execution environment.
- Separate every major section with a horizontal rule ("---").
- Render all inputs and outputs as GitHub Markdown tables with the columns "Name" and "Type".
- Render every guardrail as a "> [!WARNING]" callout block. If there are no guardrails, state "No explicit guardrails declared." in a "> [!NOTE]" block.
- Render business use cases as a bulleted list.
- Use clear, professional language. Do not invent fields that are not present.

Output rules:
- Return ONLY raw Markdown. No code fences around the whole document.
- Do NOT include any conversational meta-text, preamble, or trailing pleasantries (no "Here is", no "Let me know", no sign-off).`;

const CATEGORY_EMOJI: Partial<Record<CapabilityCategory, string>> = {
    "Data Operations": "🗄️",
    "Browser Automation": "🌐",
    "Financial Operations": "💳",
    "SaaS Connectors": "🔌",
    "System Utilities": "🛠️",
    Knowledge: "📚",
    "Custom JIT": "⚡",
};

/** Generation seam. Returns the raw model output, or null if unavailable. */
export type DocGenerateFn = (args: { system: string; user: string }) => Promise<string | null>;

async function defaultGenerate({ system, user }: { system: string; user: string }): Promise<string | null> {
    const client = AIClientFactory.getClient({ provider: "google" } as any);
    const result = await client.execute(
        {
            credentialId: 0,
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
            userPrompt: user,
            systemPrompt: system,
            requestType: "text",
            temperature: 0.2,
            useCache: false,
            enableQueryExpansion: false,
            maxTokens: 8192,
            saveOutputToFile: false,
        } as any,
        undefined,
        developmentProviderKey(),
    );
    if (!result.success) {
        logger.warn(`Doc generation failed: ${result.error}`);
        return null;
    }
    return result.output || null;
}

export class DocCompilerService {
    private readonly generate: DocGenerateFn;
    private readonly useLlm: boolean;

    constructor(deps: { generate?: DocGenerateFn; useLlm?: boolean } = {}) {
        this.generate = deps.generate ?? defaultGenerate;
        this.useLlm = deps.useLlm ?? process.env.ACDD_DOCS_LLM === "true";
    }

    /**
     * Compile a manifest to Markdown. Never throws for generation problems —
     * degrades to the deterministic renderer so the git pipeline can proceed.
     *
     * Deterministic by default. These docs are committed to the repository and
     * recompiled on every capability sync, so the LLM path rewrote all ~166 of
     * them on each run: same manifests, same information, different prose and
     * table padding every time, because a model does not emit byte-identical
     * Markdown twice. Three incompatible spellings of one header line
     * ("Manifest Schema", "Manifest Schema Version", "Manifest Schema:") were
     * in the tree at once. That churn buries real documentation changes in a
     * diff nobody can read, and it comes back on every restart.
     *
     * Set ACDD_DOCS_LLM=true to opt back into generated prose, or pass
     * `useLlm` explicitly. The LLM path is unchanged when enabled.
     */
    async compile(manifest: CapabilityManifest): Promise<string> {
        if (!this.useLlm) return renderFallback(manifest);

        try {
            const raw = await this.generate({
                system: DOC_SYSTEM_PROMPT,
                user: `Capability Manifest (JSON):\n\n${JSON.stringify(manifest, null, 2)}`,
            });
            if (raw) {
                const cleaned = sanitize(raw);
                if (cleaned) return cleaned;
                logger.warn(`LLM produced empty doc for ${manifest.capability_id}; using fallback.`);
            }
        } catch (err) {
            logger.warn(
                `Doc generation threw for ${manifest.capability_id}; using deterministic fallback.`,
                { err },
            );
        }
        return renderFallback(manifest);
    }
}

export const docCompiler = new DocCompilerService();

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Strip a wrapping code fence and any leading conversational chatter. */
export function sanitize(raw: string): string {
    let text = raw.trim();

    if (text.startsWith("```")) {
        const lines = text.split(/\r?\n/);
        lines.shift(); // drop opening fence
        if (lines.length && lines[lines.length - 1]!.trim().startsWith("```")) {
            lines.pop(); // drop closing fence
        }
        text = lines.join("\n").trim();
    }

    if (!text.startsWith("#")) {
        const index = text.indexOf("\n# ");
        if (index !== -1) text = text.slice(index + 1).trim();
    }

    return text;
}

/** Deterministically render Markdown without an LLM. */
export function renderFallback(manifest: CapabilityManifest): string {
    const emoji = CATEGORY_EMOJI[manifest.metadata.category] ?? "🧩";
    const { metadata, documentation_meta: doc, runtime_context: runtime, technical_spec: spec } = manifest;

    const parts: string[] = [];
    parts.push(`# ${emoji} ${metadata.display_name}`);
    parts.push("");
    parts.push(
        `> **Capability ID:** \`${manifest.capability_id}\`  \n` +
            `> **Capability Version:** \`${manifest.capability_version}\`  \n` +
            `> **Manifest Schema:** \`v${manifest.schema_version}\`  \n` +
            `> **Category:** ${metadata.category}  \n` +
            `> **Owner:** ${metadata.owner}  \n` +
            `> **Risk Profile:** ${runtime.risk_profile}  \n` +
            `> **Execution Environment:** ${runtime.execution_environment}`,
    );
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("## Overview");
    parts.push("");
    parts.push(metadata.description);
    // Both producers that build a manifest from code — the tool registry and the
    // pipeline canvas — have only one piece of prose, and set summary and
    // description to the same string. Printing both rendered every such page
    // with its overview paragraph duplicated verbatim.
    if (doc.summary && doc.summary.trim() !== metadata.description.trim()) {
        parts.push("");
        parts.push(doc.summary);
    }
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("## Inputs");
    parts.push("");
    parts.push(renderTable(spec.inputs));
    parts.push("");
    parts.push("## Outputs");
    parts.push("");
    parts.push(renderTable(spec.outputs));
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("## Business Use Cases");
    parts.push("");
    if (doc.business_use_cases.length) {
        for (const useCase of doc.business_use_cases) parts.push(`- ${useCase}`);
    } else {
        parts.push("_No business use cases documented._");
    }
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("## Security Guardrails");
    parts.push("");
    if (doc.guardrails.length) {
        for (const guardrail of doc.guardrails) {
            parts.push("> [!WARNING]");
            parts.push(`> ${guardrail}`);
            parts.push("");
        }
    } else {
        parts.push("> [!NOTE]");
        parts.push("> No explicit guardrails declared.");
        parts.push("");
    }
    if (runtime.dependencies.length) {
        parts.push("---");
        parts.push("");
        parts.push("## Dependencies");
        parts.push("");
        for (const dependency of runtime.dependencies) parts.push(`- \`${dependency}\``);
        parts.push("");
    }

    return parts.join("\n").replace(/\s+$/, "") + "\n";
}

function renderTable(fields: Record<string, string>): string {
    const keys = Object.keys(fields);
    if (!keys.length) return "_None._";
    const rows = ["| Name | Type |", "| --- | --- |"];
    for (const name of keys) {
        const safeType = String(fields[name]).replace(/\|/g, "\\|");
        rows.push(`| \`${name}\` | \`${safeType}\` |`);
    }
    return rows.join("\n");
}
