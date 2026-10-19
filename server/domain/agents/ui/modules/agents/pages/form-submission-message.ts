/**
 * The form submit path sends "[FORM_SUBMISSION] Execute pipeline with nonce …
 * and inputs: {json}" as the user turn — that string is the contract the server
 * routes and the agent prompt key off, so it is persisted verbatim in
 * agent_chat_messages. These helpers pull the payload back out so the public
 * chat renders the submission as a summary instead of raw protocol text.
 */

export interface ParsedFormSubmission {
    nonce: string | null;
    inputs: Record<string, unknown> | null;
}

const FORM_SUBMISSION_RE = /^\[FORM_SUBMISSION\] Execute pipeline with nonce ([a-zA-Z0-9-]+) and inputs: ([\s\S]*)$/;

export function parseFormSubmissionMessage(content: unknown): ParsedFormSubmission | null {
    if (typeof content !== "string" || !content.startsWith("[FORM_SUBMISSION]")) return null;
    const match = content.match(FORM_SUBMISSION_RE);
    if (!match) return { nonce: null, inputs: null };
    let inputs: Record<string, unknown> | null = null;
    try {
        const parsed = JSON.parse(match[2]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) inputs = parsed;
    } catch {
        // A truncated or hand-written marker still renders as a submission.
    }
    return { nonce: match[1], inputs };
}

/**
 * Agent turns that are nothing but a JSON object/array — status payloads the
 * parser has no dedicated card for. Only whole-content JSON counts: JSON inside
 * prose or a fenced code block is authored content and stays as markdown.
 */
export function parseStructuredJsonMessage(content: unknown): Record<string, unknown> | unknown[] | null {
    // A persisted/transport hiccup can deliver the payload already parsed.
    if (content && typeof content === "object") return content as Record<string, unknown> | unknown[];
    if (typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed;
    } catch {
        // Not JSON — render as ordinary text.
    }
    return null;
}

export function humanizeFieldKey(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatSubmissionValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    if (Array.isArray(value)) return value.map(formatSubmissionValue).join(", ");
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => `${humanizeFieldKey(k)}: ${formatSubmissionValue(v)}`);
        return entries.length ? entries.join(", ") : "—";
    }
    return String(value);
}
