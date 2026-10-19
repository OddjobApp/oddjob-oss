/**
 * Defined-term tracking — the check contract authors actually need.
 *
 * scribe_entity_ledger has carried a schema for this since the feature landed
 * (entityType 'defined_term', termName, definitionText, firstDefinedNodeId,
 * aliases, a unique index on document+term) and getDocument loads it into
 * FullDocumentView.entityLedger. Nothing has ever written a row. The read path
 * was built, the UI can reach it, and the ledger is empty.
 *
 * The defect it exists to catch is the commonest one in a drafted agreement: a
 * capitalised term used as though it were defined, which is not. In a contract
 * that is not a style nit — an undefined "Confidential Information" is a term
 * with no agreed meaning, and the whole clause turns on it.
 *
 * Pure and model-free, so it belongs in Tier 1 and runs per keystroke. The
 * thing that decides whether it is worth shipping is precision, not recall: a
 * rule that flags ordinary prose teaches authors to ignore the gutter, and the
 * measured false-positive rate is in defined-terms.precision.test.ts.
 */

/** How a contract announces a definition. */
const DEFINITION_PATTERNS: RegExp[] = [
    // "Confidential Information" means / shall mean / refers to
    /"([A-Z][A-Za-z0-9 ]{2,60}?)"\s+(?:means|shall mean|refers to|has the meaning)/g,
    // (the "Agreement") / (collectively, the "Parties")
    /\((?:the |collectively,? the |each an? |together the )?"([A-Z][A-Za-z0-9 ]{2,60}?)"\)/g,
    // Confidential Information means ... — unquoted, capitalised
    /\b([A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*){0,4})\s+(?:means|shall mean)\b/g,
    // ... defines "Confidential Information" as ... / defined as "..."
    /\bdefine[sd]?\s+(?:as\s+)?"([A-Z][A-Za-z0-9 ]{2,60}?)"/g,
    // "Confidential Information" is defined as / shall have the meaning
    /"([A-Z][A-Za-z0-9 ]{2,60}?)"\s+(?:is defined|shall have|will have|has the same meaning)/g,
];

/*
 * Recognising one definition form too many costs recall — a genuinely
 * undefined term goes unflagged. Recognising one too few costs trust, because
 * the marker appears beside a term the author did define. The precision harness
 * caught exactly that: `defines "X" as` was missing, so a correct passage was
 * flagged. Between the two failures, err toward treating text as defined.
 */

/** Words that begin a sentence and are capitalised for that reason alone. */
const SENTENCE_STARTERS = new Set([
    "The", "This", "That", "These", "Those", "A", "An", "In", "On", "At", "If",
    "When", "Where", "While", "Any", "All", "Each", "No", "Not", "Such", "It",
    "We", "They", "He", "She", "You", "Notwithstanding", "Except", "Subject",
    "Upon", "During", "For", "To", "As", "By", "Under", "Without", "Provided",
    "However", "Therefore", "Accordingly", "Furthermore", "Moreover",
]);

/** Capitalised words that are never defined terms. */
const COMMON_PROPER = new Set([
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "Exhibit", "Schedule", "Annex", "Appendix", "Section", "Article", "Clause",
]);

export interface DefinedTerm {
    term: string;
    /** Character offset of the definition, for jumping to it. */
    start: number;
}

/** Definitions announced in this text. */
export function extractDefinedTerms(text: string): DefinedTerm[] {
    if (!text) return [];
    const seen = new Map<string, number>();

    for (const pattern of DEFINITION_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const term = m[1]?.trim();
            if (!term) continue;
            // A single capitalised word before "means" is usually a sentence
            // subject, not a definition: "Vendor means" is, "Payment means" is
            // not reliably. Quoted forms are unambiguous and stay.
            if (!term.includes(" ") && SENTENCE_STARTERS.has(term)) continue;
            if (!seen.has(term)) seen.set(term, m.index);
        }
    }

    return [...seen.entries()]
        .map(([term, start]) => ({ term, start }))
        .sort((a, b) => a.start - b.start);
}

export interface TermUsage {
    term: string;
    start: number;
    end: number;
}

/**
 * Capitalised multi-word phrases used as though defined.
 *
 * Deliberately requires two or more capitalised words. A single capitalised
 * word is a proper noun, a sentence opener, or a heading far more often than it
 * is a defined term, and flagging those was the difference between a rule
 * authors read and one they switch off.
 */
export function extractTermUsages(text: string): TermUsage[] {
    if (!text) return [];
    const out: TermUsage[] = [];

    // Two to five capitalised words in sequence.
    const re = /\b([A-Z][a-z]+(?: [A-Z][a-z]+){1,4})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const phrase = m[1];
        const words = phrase.split(" ");

        // Drop a phrase that only exists because a sentence started.
        const atSentenceStart =
            m.index === 0 || /[.!?]\s+$/.test(text.slice(Math.max(0, m.index - 3), m.index));
        const trimmed = atSentenceStart && SENTENCE_STARTERS.has(words[0])
            ? words.slice(1).join(" ")
            : phrase;

        if (!trimmed.includes(" ")) continue;
        if (words.some((w) => COMMON_PROPER.has(w))) continue;

        const offset = phrase.length - trimmed.length;
        out.push({ term: trimmed, start: m.index + offset, end: m.index + phrase.length });
    }
    return out;
}

/** Case- and whitespace-insensitive, so "Confidential information" matches. */
function normalise(term: string): string {
    return term.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface UndefinedTermFinding {
    term: string;
    start: number;
    end: number;
}

/**
 * Terms used here that the document has not defined anywhere.
 *
 * `knownTerms` is the document's ledger plus anything defined in this station,
 * so an author who defines a term further down is not scolded for using it
 * above — that ordering is normal in a contract and flagging it would be noise.
 */
export function findUndefinedTerms(
    text: string,
    knownTerms: string[],
): UndefinedTermFinding[] {
    const known = new Set(knownTerms.map(normalise));
    for (const d of extractDefinedTerms(text)) known.add(normalise(d.term));

    const seen = new Set<string>();
    const out: UndefinedTermFinding[] = [];

    for (const usage of extractTermUsages(text)) {
        const key = normalise(usage.term);
        if (known.has(key)) continue;
        // One marker per term per station: five uses of the same undefined term
        // is one problem, not five.
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(usage);
    }
    return out;
}

export interface TermDriftFinding {
    /** The canonical term, as the document defined it. */
    canonical: string;
    /** How it was written here. */
    variant: string;
    start: number;
    end: number;
    kind: "casing" | "spacing";
}

/** Compare on letters and digits only, so casing, spaces and hyphens all fall away. */
function driftKey(term: string): string {
    return term.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A defined term written a second way.
 *
 * "Confidential Information" defined and "confidential information" used, or
 * "Sub-Processor" defined and "Sub Processor" used. In an agreement these read
 * as two different things to a court, and the drafter almost never meant two.
 *
 * Multi-word terms ONLY, and this restriction is the rule rather than an
 * optimisation. Single-word terms are genuinely ambiguous in contracts: a
 * document defines "Services" and then quite deliberately writes "services" for
 * the generic sense. Flagging that would put a marker on correct drafting
 * several times a paragraph, which is how a gutter stops being read.
 *
 * `aliases` is the ledger's own column for forms the author has blessed; those
 * never drift.
 */
export function findTermDrift(
    text: string,
    definedTerms: string[],
    aliases: string[] = [],
): TermDriftFinding[] {
    if (!text) return [];

    /**
     * Exact spellings, not normalised ones.
     *
     * Keying this by driftKey stripped the casing, so accepting "Confidential
     * information" also silently accepted "confidential information" — two
     * different spellings in a contract, and the author only approved one. An
     * alias is a specific form somebody signed off, so it is matched as one.
     */
    const blessed = new Set(aliases);
    // Canonical form per key, from the terms the document actually defined.
    const canonicalByKey = new Map<string, string>();
    for (const term of [...definedTerms, ...extractDefinedTerms(text).map((d) => d.term)]) {
        // Multi-word, where a hyphen joins words just as a space does. Testing
        // for a space alone silently excluded every hyphenated term —
        // "Sub-Processor" is exactly the kind that drifts, and it was skipped.
        if (term.split(/[\s-]+/).filter(Boolean).length < 2) continue;
        const key = driftKey(term);
        if (!canonicalByKey.has(key)) canonicalByKey.set(key, term);
    }
    if (canonicalByKey.size === 0) return [];

    const out: TermDriftFinding[] = [];
    const reported = new Set<string>();

    for (const [key, canonical] of canonicalByKey) {
        // Match the same letters with any casing, and either a space or a
        // hyphen between the words.
        const words = canonical.split(/[\s-]+/).map((w) => w.replace(/[^A-Za-z0-9]/g, ""));
        if (words.length < 2 || words.some((w) => !w)) continue;
        const pattern = words
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[\\s-]+");
        const re = new RegExp(`\\b${pattern}\\b`, "gi");

        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const variant = m[0];
            if (variant === canonical) continue;            // written correctly
            if (blessed.has(variant)) continue;             // an approved spelling

            // The definition site itself is canonical by construction; a quoted
            // occurrence is the author naming the term, not using it.
            const before = text[m.index - 1];
            const after = text[m.index + variant.length];
            if (before === '"' && after === '"') continue;

            // One marker per distinct spelling, not per occurrence. Lowercasing
            // the key here would collapse "confidential information" and
            // "Confidential information" into one finding, and they are two
            // separate things for the author to fix.
            const dedupe = `${key}:${variant}`;
            if (reported.has(dedupe)) continue;
            reported.add(dedupe);

            out.push({
                canonical,
                variant,
                start: m.index,
                end: m.index + variant.length,
                // Same letters in the same case means only the separator moved.
                kind: variant.toLowerCase() === canonical.toLowerCase() ? "casing" : "spacing",
            });
        }
    }

    return out.sort((a, b) => a.start - b.start);
}
