/**
 * Blackboard Content Classifier
 *
 * Pure, synchronous function. No React. Fully testable in isolation.
 * Runs type detection heuristics in order of specificity.
 */

export type ContentType =
    | "markdown_document"
    | "code_block"
    | "search_results"
    | "conversation_thread"
    | "structured_dataset"
    | "timeline_events"
    | "url_value"
    | "error_object"
    | "key_value_map"
    | "status_scalar"
    | "empty"
    | "json_tree";

export interface ClassificationResult {
    type: ContentType;
    confidence: number;
    metadata: {
        language?: string;
        rowCount?: number;
        columnNames?: string[];
        isTruncated?: boolean;
    };
}

const KEY_NAME_BOOSTS: Record<string, Partial<Record<ContentType, number>>> = {
    result:                 { markdown_document: 0.05 },
    high_value_deliverable: { markdown_document: 0.05 },
    report:                 { markdown_document: 0.05 },
    summary:                { markdown_document: 0.05 },
    output:                 { markdown_document: 0.03 },
    deliverable:            { markdown_document: 0.05 },
    messages:               { conversation_thread: 0.05 },
    thread:                 { conversation_thread: 0.05 },
    chat:                   { conversation_thread: 0.05 },
};

function boost(key: string, type: ContentType, base: number): number {
    return base + (KEY_NAME_BOOSTS[key]?.[type] ?? 0);
}

function detectLanguage(s: string): string {
    if (/\bdef \w+\(|^import \w+|^\s*from \w+ import|:\s*$|^\s{4}\w/m.test(s)) return "python";
    if (/\bSELECT\b|\bFROM\b|\bWHERE\b|\bINSERT INTO\b|\bCREATE TABLE\b/i.test(s)) return "sql";
    if (/^#!\/|^\$\s|\becho\b.*\$|chmod\b|curl\s/m.test(s)) return "bash";
    if (/interface\s+\w+|: string\b|: number\b|=> \{|<\w+>/m.test(s)) return "typescript";
    if (/\bconst\b|\blet\b|\bvar\b|\bfunction\b|\barrow\b|=>/m.test(s)) return "javascript";
    return "text";
}

function sampleArray(arr: unknown[], n = 10): unknown[] {
    if (arr.length <= n) return arr;
    return arr.slice(0, n);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function objectDepth(v: unknown, current = 0): number {
    if (!isPlainObject(v) && !Array.isArray(v)) return current;
    if (current >= 3) return current;
    const children = isPlainObject(v) ? Object.values(v) : (v as unknown[]);
    return Math.max(...children.map(c => objectDepth(c, current + 1)), current);
}

function keyOverlap(a: Record<string, unknown>, b: Record<string, unknown>): number {
    const ka = new Set(Object.keys(a));
    const kb = new Set(Object.keys(b));
    if (ka.size === 0 || kb.size === 0) return 0;
    let shared = 0;
    ka.forEach(k => { if (kb.has(k)) shared++; });
    return shared / Math.max(ka.size, kb.size);
}

export function classifyValue(key: string, value: unknown): ClassificationResult {
    const ok = <M extends Record<string, unknown>>(
        type: ContentType, conf: number, metadata: M = {} as M
    ): ClassificationResult => ({
        type,
        confidence: Math.min(boost(key, type, conf), 1.0),
        metadata,
    });

    // ── 1. Empty ──────────────────────────────────────────────────────────────
    if (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        (isPlainObject(value) && Object.keys(value).length === 0)
    ) return ok("empty", 1.0);

    // ── 2. URL value ──────────────────────────────────────────────────────────
    if (typeof value === "string" && /^https?:\/\/[^\s\n]{10,}$/.test(value.trim())) {
        return ok("url_value", 1.0);
    }

    // ── 3. Error object ───────────────────────────────────────────────────────
    if (isPlainObject(value)) {
        const v = value as Record<string, unknown>;
        if (
            typeof v.message === "string" &&
            (typeof v.stack === "string" || typeof v.code !== "undefined" || /Error$/i.test(String(v.name ?? "")))
        ) return ok("error_object", 0.9);
    }

    // ── 4. Code block ─────────────────────────────────────────────────────────
    if (typeof value === "string") {
        const s = value.trimStart();
        const isTruncated = value.startsWith("[TRUNCATED:");
        let score = 0;
        if (s.startsWith("```")) score += 0.6;
        // Primary keyword signals (any one is sufficient with structural corroboration)
        const keywords = [
            "function ", "def ", "class ", "const ", "let ", "var ",
            "import ", "export ", "SELECT ", "FROM ", "WHERE ",
            "CREATE ", "INSERT ", "UPDATE ", "DELETE ", "#!/",
            "interface ", "type ", "async ", "await ",
        ];
        const kwMatches = keywords.filter(kw => s.includes(kw)).length;
        score += kwMatches * 0.12;
        // Structural signals
        if ((s.match(/\{|\}/g) ?? []).length > 2) score += 0.12;
        if (/=>/.test(s)) score += 0.12;
        if (/:\s*(string|number|boolean|void|any|unknown)\b/.test(s)) score += 0.15;
        if ((s.match(/;\s*$/m) ?? []).length >= 1) score += 0.10;
        if (/^\s{2,}/m.test(s) && /\n/.test(s)) score += 0.08; // indented multi-line
        // Language-specific fast paths
        if (/\bSELECT\b.+\bFROM\b|\bINSERT\s+INTO\b|\bCREATE\s+TABLE\b/i.test(s)) score = Math.max(score, 0.75);
        if (/\bdef \w+\s*\(|\bclass \w+.*:/m.test(s) && /\breturn\b|\bimport\b/.test(s)) score = Math.max(score, 0.70);
        if (score >= 0.35) {
            const lang = detectLanguage(s);
            return ok("code_block", Math.min(score, 0.95), { language: lang, isTruncated });
        }
    }

    // ── 5. Markdown document ──────────────────────────────────────────────────
    if (typeof value === "string") {
        const isTruncated = value.startsWith("[TRUNCATED:");
        // Treat truncated strings as potentially long
        const effectiveLength = isTruncated ? 9999 : value.length;
        if (effectiveLength >= 80) {
            const sample = isTruncated
                ? value.slice(value.indexOf("]") + 1, 600).trim()
                : value.slice(0, 600);
            const tokens = [
                /(?:^|\n)#+\s/.test(sample),
                /(?:^|\n)[-*]\s/.test(sample),
                /\*\*[^*]+\*\*/.test(sample),
                /(?:^|\n)\|.+\|/.test(sample),
                /```/.test(sample),
                /\[[^\]]+\]\(https?:/.test(sample),
                /__[^_]+__/.test(sample),
            ];
            const matchCount = tokens.filter(Boolean).length;
            if (matchCount >= 2) {
                const conf = Math.min(0.70 + 0.05 * matchCount, 0.95);
                return ok("markdown_document", conf, { isTruncated });
            }
        }
    }

    // ── Array types ───────────────────────────────────────────────────────────
    if (Array.isArray(value)) {
        const sample = sampleArray(value);

        // 6. Conversation thread
        const convScore = sample.filter(
            item => isPlainObject(item) &&
                typeof (item as any).role === "string" &&
                /^(user|assistant|system|human|agent|bot|model)$/i.test((item as any).role) &&
                (item as any).content !== undefined
        ).length / sample.length;
        if (convScore >= 0.7) return ok("conversation_thread", boost(key, "conversation_thread", convScore * 0.95));

        // 7. Timeline events
        const timeScore = sample.filter(item => {
            if (!isPlainObject(item)) return false;
            const v = item as Record<string, unknown>;
            const hasTs = typeof v.timestamp !== "undefined";
            const hasEvent = typeof v.event !== "undefined" || typeof v.type !== "undefined" ||
                             typeof v.note !== "undefined" || typeof v.action !== "undefined";
            return hasTs && hasEvent;
        }).length / sample.length;
        if (timeScore >= 0.6) return ok("timeline_events", timeScore * 0.90);

        // 8. Search results
        const searchScore = sample.filter(item => {
            if (!isPlainObject(item)) return false;
            const v = item as Record<string, unknown>;
            const hasTitle = typeof v.title === "string";
            const hasUrl = typeof v.url === "string" || typeof v.link === "string";
            const hasSnippet = typeof v.snippet === "string" || typeof v.description === "string" || typeof v.content === "string";
            return [hasTitle, hasUrl, hasSnippet].filter(Boolean).length >= 2;
        }).length / sample.length;
        if (searchScore >= 0.6) return ok("search_results", searchScore * 0.92);

        // 9. Structured dataset
        if (value.length >= 3) {
            const objs = sample.filter(isPlainObject) as Record<string, unknown>[];
            if (objs.length >= Math.min(3, sample.length)) {
                const overlap01 = keyOverlap(objs[0], objs[1] ?? objs[0]);
                const overlap02 = objs[2] ? keyOverlap(objs[0], objs[2]) : overlap01;
                const avgOverlap = (overlap01 + overlap02) / 2;
                const maxDepthOk = objs.every(o => objectDepth(o) <= 2);
                if (avgOverlap >= 0.8 && maxDepthOk) {
                    const columnNames = Object.keys(objs[0]);
                    return ok("structured_dataset", 0.88, { rowCount: value.length, columnNames });
                }
            }
        }
    }

    // ── 10. Status scalar ─────────────────────────────────────────────────────
    if (typeof value !== "object" && (typeof value !== "string" || value.length < 100)) {
        const isTruncated = typeof value === "string" && value.startsWith("[TRUNCATED:");
        return ok("status_scalar", 0.95, { isTruncated });
    }

    // ── 11. Key-value map ─────────────────────────────────────────────────────
    if (isPlainObject(value)) {
        const v = value as Record<string, unknown>;
        const keys = Object.keys(v);
        if (keys.length >= 2 && keys.length <= 20) {
            const allShallow = Object.values(v).every(
                val => typeof val !== "object" || val === null ||
                    (isPlainObject(val) && Object.keys(val).length <= 5 && objectDepth(val) <= 1)
            );
            if (allShallow) return ok("key_value_map", 0.80);
        }
    }

    // ── 12. JSON tree fallback ────────────────────────────────────────────────
    return ok("json_tree", 0.5);
}
