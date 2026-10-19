/**
 * Declared-topic tag grammar for CREW rooms and messaging bridges.
 *
 * Two spellings, one concept:
 *   #[Multi Word Topic]   bracketed — spaces allowed, e.g. "compare #[vendor a] to #[vendor b]"
 *   #single-word          bare — [a-zA-Z0-9][a-zA-Z0-9_-]*, e.g. "#pricing"
 *
 * Both normalize to a title-cased label ("q4-launch" -> "Q4 Launch") that binds
 * to a knowledge_topics row. This is a DECLARED topic — what the speaker says
 * the text is about — and stays separate from crew_turns.topic, which holds
 * the intent router's classified TopicCategory. The two vocabularies must not
 * be merged into one column: the router, hand-raise affinities, and
 * crew_intent_observations all read the classified value.
 *
 * Shared by client (composer preview, chip rendering) and server (turn
 * persistence), so this module must stay free of server-only imports — the
 * same constraint agent-personas.ts documents.
 *
 * Tags are not extracted from fenced code, inline code, URLs, @mentions, or
 * markdown headings ("# Heading"). A bare tag that parses as a pure hex color
 * (#abc123) is rejected — CSS hex is the dominant false-positive source.
 */

/** Maximum tags honored per turn — bounds taxonomy pollution from pasted dumps. */
export const MAX_TOPIC_TAGS_PER_TURN = 5;

export interface ExtractedTopicTag {
    /** Exactly as typed, e.g. "q4-launch" or "Vendor A". */
    raw: string;
    /** Normalized display label, e.g. "Q4 Launch" / "Vendor A". */
    label: string;
    /** Character offset where the tag (including "#"/"#[") starts. */
    start: number;
    /** Character offset one past the tag's end. */
    end: number;
}

/** Segments of the input that cannot contain a tag. */
type MaskedRange = { start: number; end: number };

function collectMaskedRanges(text: string): MaskedRange[] {
    const ranges: MaskedRange[] = [];

    const patterns: RegExp[] = [
        /```[\s\S]*?```/g, // fenced code
        /`[^`\n]*`/g, // inline code
        /https?:\/\/\S+/g, // URLs — a trailing #fragment is not a tag
        /<https?:\/\/[^|]+\|[^>]+>/g, // Slack-style link with display text
        /<@[^>]+>/g, // Slack mentions
        /@[a-zA-Z0-9][a-zA-Z0-9_-]*/g, // bare @mentions
        /#[0-9a-fA-F]{3,8}\b/g, // hex colors — masked so they never become tags
    ];

    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) break;
            ranges.push({ start: m.index, end: m.index + m[0].length });
        }
    }

    ranges.sort((a, b) => a.start - b.start);
    return ranges;
}

function isMasked(ranges: MaskedRange[], start: number, end: number): boolean {
    return ranges.some((r) => start < r.end && end > r.start);
}

/**
 * Word-boundary rule: a tag must not be preceded by a word character.
 * "see#pricing" is prose, not a tag; "see #pricing" is a tag.
 */
function hasWordCharBefore(text: string, index: number): boolean {
    if (index === 0) return false;
    return /[a-zA-Z0-9_]/.test(text[index - 1]);
}

// "# Heading" can never match BARE_TAG_RE (it requires an alnum right after
// "#"), so headings need no explicit exclusion.

const BRACKET_TAG_RE = /#\[([^\]#,]+?)\]/g; // no nested # or ] — first ] closes
const BARE_TAG_RE = /#([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;

/**
 * Convert a raw tag to its canonical label: hyphens/underscores become spaces,
 * each word is title-cased. Case-insensitive matching happens downstream
 * (knowledge_topics lookup), so the label is display form, not a key.
 */
export function normalizeTagLabel(raw: string): string {
    return raw
        .trim()
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract declared-topic tags from message text.
 * Returns at most MAX_TOPIC_TAGS_PER_TURN unique tags (deduped by
 * case-insensitive normalized label), in order of appearance.
 */
export function extractTopicTags(text: string): ExtractedTopicTag[] {
    if (!text || typeof text !== "string") return [];

    const masked = collectMaskedRanges(text);
    const tags: ExtractedTopicTag[] = [];
    const seen = new Set<string>();

    const push = (raw: string, start: number, end: number) => {
        const label = normalizeTagLabel(raw);
        if (!label) return;
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        tags.push({ raw: raw.trim(), label, start, end });
    };

    // Bracketed form first — it wins at overlapping offsets ("#[a b] #x").
    let m: RegExpExecArray | null;
    while ((m = BRACKET_TAG_RE.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isMasked(masked, start, end)) continue;
        if (hasWordCharBefore(text, start)) continue;
        const inner = m[1].trim();
        if (inner.length === 0 || inner.length > 80) continue;
        push(inner, start, end);
    }

    while ((m = BARE_TAG_RE.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isMasked(masked, start, end)) continue;
        if (hasWordCharBefore(text, start)) continue;
        // A bare tag sitting inside an already-claimed bracket tag — the
        // bracket's "[a" prefix matches BARE_TAG_RE at "#[" — is dropped by the
        // dedupe only if its label collides; an offset check is cleaner.
        if (tags.some((t) => start >= t.start && start < t.end)) continue;
        push(m[1], start, end);
    }

    return tags.slice(0, MAX_TOPIC_TAGS_PER_TURN);
}

/**
 * Remove tag markup from text, collapsing the whitespace it leaves behind.
 * Used for KB document bodies (the conversational bridge's contract); room
 * turn content keeps its tags — the literal "#[x]" is the chip's ground truth.
 */
export function stripTopicTags(text: string): string {
    if (!text) return "";
    const tags = extractTopicTags(text);
    if (tags.length === 0) return text.trim();
    let out = "";
    let cursor = 0;
    for (const t of tags) {
        out += text.slice(cursor, t.start);
        cursor = t.end;
    }
    out += text.slice(cursor);
    return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
