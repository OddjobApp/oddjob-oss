/**
 * What part of an agent's message, if any, belongs in the manuscript.
 *
 * Every agent turn over 25 characters grew an "Insert into Station" button, so
 * a room's opening exchange offered three of them — one on the greeting, one on
 * "I'll draft that for you now", one on the actual draft. They looked
 * identical, and the audit read them as duplicates. They were worse than
 * duplicates: two of the three offered to write chatter into the contract, and
 * the insert appends the turn verbatim.
 *
 * So the rule is not "is this long enough" but "is any of this a draft". A turn
 * that only announces what the agent is about to do offers nothing, and a turn
 * that wraps a draft in conversation contributes the draft alone.
 *
 * The bias is one-directional. Refusing a real draft costs the author a
 * copy-paste; accepting a line of chatter puts "Certainly! Here you go:" into a
 * signed agreement. So every ambiguous case resolves to "not a draft".
 */

/** Enough prose to be a passage rather than a remark. */
const MIN_DRAFT_CHARS = 120;

/**
 * Concise legal caveats, confidentiality statements, notes, or disclaimers.
 * These are valid document additions even when concise (e.g. 25-100 characters).
 */
export const DISCLAIMER_OR_NOTICE_PATTERN =
    /^\s*(?:[*_]{1,3}|>\s*|#+\s*)?(?:disclaimer|notice|confidential(?:ity)?|caution|warning|important\s*note|note|preamble)\b/i;

const MIN_DISCLAIMER_CHARS = 25;

/**
 * Leading supervisor deference or room deliberation that precedes a draft:
 * "My apologies, Supervisor... The Analyst's research... Regarding excerpt...:"
 */
const SUPERVISOR_ROOM_PREAMBLE =
    /^\s*(?:(?:my\s+)?apologies,?\s*(?:supervisor|team|crew)?[!.,]?|supervisor[,:]?)\b[\s\S]*?(?:(?:regarding (?:the )?excerpt[^\n:]*:\s*)|(?:here(?:'s| is| are)|i(?:'ve| have)?\s*(?:drafted|written|prepared|put together)|below is|the following is)[^\n:]{0,120}:\s*)/i;

/**
 * An excerpt question opener: "Regarding the excerpt... I recommend the following:"
 */
const REGARDING_EXCERPT_OPENER =
    /^\s*(?:regarding (?:the )?excerpt[^\n:]*:\s*)/i;

/**
 * An opening that hands over rather than says anything: "Here is the scope
 * section:", "Certainly! I've drafted the following:". Always ends by pointing
 * forward, which is what the trailing colon marks.
 */
const HANDOFF_OPENER =
    /^\s*(?:(?:certainly|sure|absolutely|of course|understood|got it|great|okay|ok)(?:[!,.]|\s*[—–-])?\s*)?(?:here(?:'s| is| are)|i(?:'ve| have)?\s*(?:drafted|written|prepared|put together)|below is|the following is|as requested)\b[^\n:]{0,120}:\s*/i;

/**
 * A closing that asks rather than states: "Let me know if you'd like changes."
 * Belongs in the room, never in the document.
 */
const HANDBACK_CLOSERS = [
    /\n\s*(?:let me know|would you like|shall i|do you want|happy to|feel free|i can (?:also|now)|if you'd like|hope this helps|these suggestions|these recommendations|this should help)\b[\s\S]*$/i,
    /^\s*(?:let me know|would you like|shall i|do you want|happy to|feel free|hope this helps|these suggestions|these recommendations|this should help)\b[\s\S]*$/i,
];

/**
 * When an agent answers an excerpt inquiry with bulleted recommendations,
 * rewrites advisory meta-instructions ("Emphasize how X...", "Frame the problem in terms of X...")
 * into direct declarative document prose suitable for the manuscript.
 */
function normalizeAdvisoryProse(text: string): string {
    return text
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:emphasize (?:how|that)\s+)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:frame the problem in terms of\s+)/gim, "$1Focuses on ")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:clearly identify stakeholders such as\s+)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:clearly identify\s+)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:specify that (?:this document )?)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:ensure (?:that )?)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)(?:detail (?:how )?)/gim, "$1")
        .replace(/^(\s*[-*]\s+\*\*([^*:]+)(?::\*\*|\*\*:)\s*)([a-z])/gm, (_m, prefix, _title, letter) => `${prefix}${letter.toUpperCase()}`);
}

/**
 * A whole turn that is only an announcement — no draft anywhere in it.
 *
 * Checked after the wrapper is stripped, because "I'll draft the scope section
 * now." leaves nothing behind once its own opener is gone.
 */
const ANNOUNCEMENT =
    /^\s*(?:i(?:'ll| will| am going to| can)|let me|allow me|one moment|working on|on it|mounting|opening|setting up|i'm)\b/i;

/**
 * Agent refusals, deferrals, or meta-commentary: "I am the Copilot. I defer to the GhostWriter...",
 * "Outside my SME domain", "I have nothing new to add".
 * These must NEVER be offered as draftable content for insertion into a document.
 */
const REFUSAL_OR_DEFERRAL =
    /\b(?:i am the copilot|i defer to|defer to (?:the )?ghostwriter|outside my (?:sme )?domain|i have nothing (?:new )?to add|as an ai language model|falls outside my area)\b/i;

/** Fenced blocks are unambiguous: the agent marked the draft itself. */
function fencedBlocks(text: string): string[] {
    const out: string[] = [];
    const re = /```(?:[a-z]*\n)?([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const body = m[1].trim();
        if (body) out.push(body);
    }
    return out;
}

/**
 * The passage inside a turn, or null when the turn is only conversation.
 *
 * Fences win outright — an agent that marked its own draft has answered the
 * question. Otherwise the conversational wrapper is peeled off and what remains
 * has to stand on its own as prose.
 */
export function draftableFrom(content: string | null | undefined): string | null {
    if (typeof content !== "string") return null;

    const fenced = fencedBlocks(content);
    if (fenced.length > 0) {
        const joined = fenced.join("\n\n");
        return joined.length > 0 ? joined : null;
    }

    let body = content.trim();
    if (!body) return null;

    body = body.replace(SUPERVISOR_ROOM_PREAMBLE, "").trim();
    body = body.replace(REGARDING_EXCERPT_OPENER, "").trim();
    body = body.replace(HANDOFF_OPENER, "").trim();
    for (const closer of HANDBACK_CLOSERS) body = body.replace(closer, "").trim();

    body = normalizeAdvisoryProse(body).trim();

    // Whatever is left is still just the agent narrating its own actions or refusing/deferring.
    if (ANNOUNCEMENT.test(body) || REFUSAL_OR_DEFERRAL.test(body)) return null;

    // Disclaimers, notices, and confidentiality warnings are valid even if concise.
    if (DISCLAIMER_OR_NOTICE_PATTERN.test(body) && body.length >= MIN_DISCLAIMER_CHARS) {
        return body;
    }

    // A remark, not a passage. Short real drafts are refused too: that costs a
    // copy-paste, where the opposite mistake costs a line of chatter in a
    // signed document.
    if (body.length < MIN_DRAFT_CHARS) return null;

    return body;
}

/** Whether to offer the insert action on this turn at all. */
export function hasInsertableDraft(content: string | null | undefined): boolean {
    return draftableFrom(content) !== null;
}
