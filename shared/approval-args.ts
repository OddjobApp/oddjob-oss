/**
 * What an approval card should show a reviewer.
 *
 * Google Workspace, Calendar and outbound-message proposals store a routing
 * envelope — { type: 'approval_request', kind, actionName, args, title,
 * reason, status, projectId, sessionKey, ... } — in toolArgs. The envelope is
 * plumbing: the only thing a reviewer can act on is `args` (or, for
 * outbound_message, the envelope's own send fields). Rendering the envelope
 * verbatim is how raw JSON ended up on screen in the Decision Inbox.
 */

export interface ApprovalField {
    label: string;
    value: string;
}

/**
 * Envelope plumbing — transport and bookkeeping keys that mean nothing to a
 * reviewer. Applies only to the envelope object itself: the same words are
 * legitimate tool arguments inside `args` (a proposal's `title` is the
 * document being created), so args skip nothing but the integrity blobs.
 */
const ENVELOPE_KEYS = new Set([
    "type", "kind", "actionName", "status", "sessionKey", "projectId",
    "organizationId", "proposalId", "agentCardId", "agentName", "sendTool",
    "messageId", "threadTs", "thread", "trigger", "title", "reason",
    "reviewed_raw",
]);

export function isApprovalEnvelope(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object"
        && ((value as any).type === "approval_request" || typeof (value as any).kind === "string");
}

/** snake_case and camelCase arg keys into a label a reviewer recognizes. */
export function humanizeApprovalKey(key: string): string {
    const words = key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Plain text out of a decoded Gmail message snapshot (gmail_send_draft). */
function decodedMessageText(message: any): string {
    const walk = (part: any): string[] => {
        if (!part || typeof part !== "object") return [];
        const own = part.mimeType === "text/plain" && typeof part.decodedText === "string"
            ? [part.decodedText]
            : [];
        return [...own, ...(Array.isArray(part.parts) ? part.parts : []).flatMap(walk)];
    };
    return walk(message.payload).join("\n\n") || message.snippet || "";
}

/** Any proposal arg or execution result into readable text — never raw JSON past two levels. */
export function formatApprovalValue(value: unknown, depth = 0): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        if (value.every(v => v == null || typeof v !== "object")) {
            return value.filter(v => v != null && String(v).trim()).join(", ");
        }
        // Attendee lists and similar email-keyed rows read as addresses.
        if (value.every(v => v && typeof v === "object" && typeof (v as any).email === "string")) {
            return value.map((v: any) => v.displayName ? `${v.displayName} <${v.email}>` : v.email).join(", ");
        }
        return value.map(v => formatApprovalValue(v, depth + 1)).filter(Boolean).join("\n");
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (depth >= 2) {
            if (typeof obj.dateTime === 'string') return obj.dateTime;
            if (typeof obj.date === 'string') return String(obj.date);
            if (typeof obj.email === 'string') return String(obj.email);
            if ('crewApprovalId' in obj || 'crewArgsHash' in obj) return "";
            return JSON.stringify(value);
        }
        return Object.entries(obj)
            .filter(([k]) => k !== 'extendedProperties' && k !== 'extended_properties' && k !== 'conferenceDataVersion')
            .map(([k, v]) => `${humanizeApprovalKey(k)}: ${formatApprovalValue(v, depth + 1)}`)
            .filter(line => !line.trimEnd().endsWith(":"))
            .join("\n");
    }
    return String(value);
}

/**
 * The args of a proposal as labeled, readable fields. Plumbing keys are
 * dropped; a reviewed_message snapshot collapses to To/Subject/Body.
 */
export function approvalArgFields(args: unknown): ApprovalField[] {
    if (!args || typeof args !== "object") return [];
    const fields: ApprovalField[] = [];
    const push = (label: string, value: unknown) => {
        const text = typeof value === "string" ? value : formatApprovalValue(value);
        if (text.trim()) fields.push({ label, value: text });
    };
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
        if (key === "reviewed_raw" || key === "extendedProperties" || key === "extended_properties" || key === "conferenceDataVersion") continue;
        if (key === "reviewed_message" && value && typeof value === "object") {
            const headers = Array.isArray((value as any).payload?.headers) ? (value as any).payload.headers : [];
            const header = (n: string) => headers.find((h: any) => h?.name === n)?.value;
            push("To", header("To"));
            push("Subject", header("Subject"));
            push("Body", decodedMessageText(value));
            continue;
        }
        push(humanizeApprovalKey(key), value);
    }
    return fields;
}

/**
 * A stored approval's reviewable fields, in reading order: the proposal title
 * and reason first, then the tool arguments one field at a time. Returns null
 * when the value is not an approval envelope, so callers can keep their
 * generic rendering for other request shapes.
 */
export function approvalReviewFields(envelope: unknown): ApprovalField[] | null {
    if (!isApprovalEnvelope(envelope)) return null;
    const fields: ApprovalField[] = [];
    const push = (label: string, value: unknown) => {
        const text = typeof value === "string" ? value : formatApprovalValue(value);
        if (text.trim()) fields.push({ label, value: text });
    };
    push("Planned action", envelope.title);
    push("Reasoning", envelope.reason);
    // google_workspace_action / calendar_action nest under `args`;
    // outbound_message carries its send fields on the envelope itself.
    if (envelope.args && typeof envelope.args === "object") {
        fields.push(...approvalArgFields(envelope.args));
        return fields;
    }
    for (const [key, value] of Object.entries(envelope)) {
        if (ENVELOPE_KEYS.has(key)) continue;
        const text = typeof value === "string" ? value : formatApprovalValue(value);
        if (text.trim()) fields.push({ label: humanizeApprovalKey(key), value: text });
    }
    return fields;
}
