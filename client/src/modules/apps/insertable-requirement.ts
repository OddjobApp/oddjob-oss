/**
 * What part of an agent's message belongs in the App Forge requirements.
 *
 * Mirrors Scribe Studio's `insertable-draft.ts`:
 * A turn that only announces what the agent is about to do or contains trivial
 * conversational banter offers nothing, and a turn that wraps an architecture
 * spec or requirements list in pleasantries contributes the specification alone.
 */

/** Enough prose or specification to be substantive rather than a passing remark. */
const MIN_REQUIREMENT_CHARS = 80;

/**
 * An opening that hands over rather than specifies:
 * "Here are the requirements:", "Certainly! I've analyzed the flowchart:", etc.
 */
const HANDOFF_OPENER =
    /^\s*(?:(?:certainly|sure|absolutely|of course|understood|got it|great|okay|ok)[!,.]?\s*)?(?:based on [^\n:,]+,\s*)?(?:here(?:'s| is| are)|i(?:'ve| have)?\s*(?:drafted|written|prepared|put together|analyzed|extracted|specified)|below is|the following is|as requested)\b[^\n:]{0,140}:\s*/i;

/**
 * A closing that asks rather than specifies:
 * "Let me know if you'd like to modify any fields.", "Would you like me to build this?"
 */
const HANDBACK_CLOSERS = [
    /\n\s*(?:let me know|would you like|shall i|do you want|happy to|feel free|i can (?:also|now)|if you'd like|hope this helps|shall we proceed|ready to scaffold|ready to build)\b[\s\S]*$/i,
    /^\s*(?:let me know|would you like|shall i|do you want|happy to|feel free|hope this helps|shall we proceed|ready to scaffold|ready to build)\b[\s\S]*$/i,
];

/**
 * A turn that is only an announcement — no spec anywhere in it.
 */
const ANNOUNCEMENT =
    /^\s*(?:i(?:'ll| will| am going to| can)|let me|allow me|one moment|working on|on it|mounting|opening|setting up|i'm analyzing|reviewing)\b/i;

/** Fenced blocks (markdown, json, yaml, sql, ts) are unambiguous specification content. */
function fencedBlocks(text: string): string[] {
    const out: string[] = [];
    const re = /```(?:[a-z0-9_-]*\n)?([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const body = m[1].trim();
        if (body) out.push(body);
    }
    return out;
}

/**
 * Extracts the substantive specification / requirements from an agent turn,
 * or returns null if the turn is only conversation.
 */
export function forgeRequirementFrom(content: string | null | undefined): string | null {
    if (typeof content !== "string") return null;

    const fenced = fencedBlocks(content);
    if (fenced.length > 0) {
        const joined = fenced.join("\n\n");
        return joined.length > 0 ? joined : null;
    }

    let body = content.trim();
    if (!body) return null;

    body = body.replace(HANDOFF_OPENER, "").trim();
    for (const closer of HANDBACK_CLOSERS) body = body.replace(closer, "").trim();

    // Check if remaining body is pure conversational announcement
    if (ANNOUNCEMENT.test(body) && body.length < 160) return null;

    // Must meet minimum character length to avoid passing conversational chatter
    if (body.length < MIN_REQUIREMENT_CHARS) return null;

    return body;
}

/** Whether to offer the 'Add to App Requirements' action on this turn. */
export function hasInsertableRequirement(content: string | null | undefined): boolean {
    return forgeRequirementFrom(content) !== null;
}
