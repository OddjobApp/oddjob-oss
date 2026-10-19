/**
 * Figures written in prose, and whether a document contradicts itself.
 *
 * The commonest numeric defect in a drafted agreement or board paper is not a
 * wrong number, it is the same number stated twice differently — a fee that is
 * £2.4M in the recital and £2.1M in the schedule, a term that is 24 months in
 * one clause and 36 in another. Nobody notices, because both readings look
 * correct in isolation.
 *
 * This is the groundwork for the ledger's dataBinding column too (checking a
 * figure against a live dataset value), but it stands on its own: comparing a
 * document against itself needs no dataset, no binding UI, and no model.
 *
 * Pure, so it belongs in Tier 1 and runs per keystroke.
 */

export interface ParsedFigure {
    /** Normalised to a plain number: "£2.4M" and "2,400,000" both give 2400000. */
    value: number;
    /** "£", "$", "€", "%" or null. Figures of different kinds never conflict. */
    unit: string | null;
    /** Exactly as written, for the marker. */
    raw: string;
    start: number;
    end: number;
}

const MULTIPLIERS: Record<string, number> = {
    k: 1_000,
    m: 1_000_000,
    bn: 1_000_000_000,
    b: 1_000_000_000,
};

/**
 * Currency or percent, then digits with optional thousands separators, then an
 * optional magnitude suffix.
 *
 * The lookahead on the suffix is load-bearing. Without it the m of "months" is
 * read as a magnitude, so "24 months" becomes 24 million and "5 members" five
 * million. A suffix only counts when no letter follows it.
 */
const FIGURE = /([£$€])?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(bn|[kmb])(?![a-z]))?(%)?/gi;

/** Every figure in the text, normalised. */
export function parseFigures(text: string): ParsedFigure[] {
    if (!text) return [];
    const out: ParsedFigure[] = [];

    const re = new RegExp(FIGURE.source, FIGURE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const [raw, currency, digits, suffix, percent] = m;

        const base = Number(digits.replace(/,/g, ""));
        if (!Number.isFinite(base)) continue;

        const multiplier = suffix ? MULTIPLIERS[suffix.toLowerCase()] ?? 1 : 1;
        out.push({
            value: base * multiplier,
            unit: percent ? "%" : currency ?? null,
            raw: raw.trim(),
            start: m.index,
            end: m.index + raw.length,
        });
    }
    return out;
}

/**
 * "the Annual Fee is", "Committed ARR of" — a capitalised phrase followed by a
 * connective. Only a defined-term-shaped label counts: keying on a bare noun
 * would pair up every unrelated number in the document.
 */
const LABEL = /\b([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,3})\s+(?:is|of|shall be|equals?|totals?|:)\s*$/;

/** The words immediately before a figure — what the figure is a figure OF. */
function labelBefore(text: string, start: number): string | null {
    const m = text.slice(Math.max(0, start - 60), start).match(LABEL);
    if (!m) return null;

    // The article or possessive is not part of the term. Keeping it would make
    // "The Annual Fee" or "Our Committed ARR" fail to match the canonical term.
    const label = m[1].replace(/^(?:The|An|A|Our|Their|Its|Your)\s+/i, "").trim();
    return label.length > 0 ? label : null;
}

export interface FigureConflict {
    label: string;
    /** How it was first written. */
    first: ParsedFigure;
    /** The later, different figure. */
    second: ParsedFigure;
}

export interface DataTether {
    termName: string;
    calculationNodeId?: number;
    datasetId?: number;
    field?: string;
    lastValue?: number | string;
    unit?: string | null;
    label?: string;
}

export interface TetherConflict {
    label: string;
    drafted: ParsedFigure;
    tetherValue: number;
    tetherRaw: string;
    calculationNodeId?: number;
}

/**
 * Format a number nicely matching the draft style or standard representation.
 */
export function formatFigureWithUnit(value: number, unit: string | null, styleHint?: string): string {
    let numStr: string;
    const lowerHint = (styleHint || "").toLowerCase();
    if (lowerHint.endsWith("m") && value >= 100_000 && value % 100_000 === 0) {
        numStr = `${value / 1_000_000}M`;
    } else if (lowerHint.endsWith("bn") && value >= 100_000_000 && value % 100_000_000 === 0) {
        numStr = `${value / 1_000_000_000}B`;
    } else if (lowerHint.endsWith("k") && value >= 1_000 && value % 1_000 === 0) {
        numStr = `${value / 1_000}k`;
    } else {
        numStr = value.toLocaleString("en-US");
    }

    if (!unit) return numStr;
    if (unit === "%") return `${numStr}%`;
    return `${unit}${numStr}`;
}

/**
 * Checks parsed figures in text against live data tethers registered in the ledger.
 * Flags any prose figure whose drafted value deviates from the tethered calculation source of truth.
 */
export function findDataTetherConflicts(text: string, tethers: DataTether[]): TetherConflict[] {
    if (!text || !tethers || tethers.length === 0) return [];

    // Map tethers case-insensitively by termName
    const tetherMap = new Map<string, DataTether>();
    for (const t of tethers) {
        if (t.termName) {
            tetherMap.set(t.termName.toLowerCase().trim(), t);
        }
    }

    const conflicts: TetherConflict[] = [];
    for (const fig of parseFigures(text)) {
        const label = labelBefore(text, fig.start);
        if (!label) continue;

        const tether = tetherMap.get(label.toLowerCase());
        if (!tether || tether.lastValue === undefined || tether.lastValue === null) continue;

        const tetherNumeric = typeof tether.lastValue === "number" ? tether.lastValue : Number(tether.lastValue);
        if (isNaN(tetherNumeric)) continue;

        // Compare normalized numeric value
        if (fig.value !== tetherNumeric) {
            const resolvedUnit = fig.unit ?? tether.unit ?? null;
            const formatted = formatFigureWithUnit(tetherNumeric, resolvedUnit, fig.raw);
            conflicts.push({
                label,
                drafted: fig,
                tetherValue: tetherNumeric,
                tetherRaw: formatted,
                calculationNodeId: tether.calculationNodeId,
            });
        }
    }

    return conflicts;
}

/**
 * The same label carrying two different values.
 *
 * Restating a figure identically is not a conflict, and neither is the same
 * amount written another way — "£2.4M" and "£2,400,000" normalise to the same
 * number, which is exactly why the parser normalises rather than comparing
 * strings.
 *
 * Figures of different kinds never conflict: a Fee of £2.4M and a Fee of 30%
 * are measuring different things, and pairing them would be noise.
 */
export function findFigureConflicts(text: string): FigureConflict[] {
    if (!text) return [];

    // Keyed case-insensitively so a mid-sentence restatement still matches, but
    // carrying the label as first written, for the marker the author reads.
    const byLabel = new Map<string, { label: string; figures: ParsedFigure[] }>();
    for (const fig of parseFigures(text)) {
        const label = labelBefore(text, fig.start);
        if (!label) continue;

        const key = label.toLowerCase();
        const entry = byLabel.get(key) ?? { label, figures: [] };
        entry.figures.push(fig);
        byLabel.set(key, entry);
    }

    const conflicts: FigureConflict[] = [];
    for (const { label, figures } of byLabel.values()) {
        if (figures.length < 2) continue;

        const first = figures[0];
        const clash = figures
            .slice(1)
            .find((later) => later.unit === first.unit && later.value !== first.value);

        // One conflict per label: an author fixes the discrepancy once.
        if (clash) conflicts.push({ label, first, second: clash });
    }
    return conflicts;
}

