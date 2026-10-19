/**
 * Deal Synthesis — pure logic (Act II, the Semantic Deep-Dive).
 *
 * Kept free of DB / AI-client imports so it can be unit-tested in isolation and
 * reused by the controller. All functions are deterministic and grounded: they
 * only describe what the supplied rows actually contain.
 */

export const BULLET_KEYS = ["silence_gaps", "dark_social", "competitor_signals"] as const;
export type BulletKey = (typeof BULLET_KEYS)[number];
export type Severity = "low" | "medium" | "high";

export interface SynthesisBullet {
    key: BulletKey;
    label: string;
    detail: string;
    severity: Severity;
}

export interface SynthesisCore {
    bullets: SynthesisBullet[];
    verdict: string;
}

export const BULLET_LABEL: Record<BulletKey, string> = {
    silence_gaps: "Silence Gaps",
    dark_social: "Dark Social",
    competitor_signals: "Competitor Signals",
};

const COMPETITOR_TERMS = [
    "competitor", "competing", "competition", "alternative", "incumbent", "rfp",
    "bake-off", "bakeoff", "other vendor", "another vendor", "evaluating",
    "evaluation", "shortlist", "vs.", " vs ", "versus", "poc with", "trialing",
];

const DAY_MS = 86_400_000;

export interface DealFeatures {
    dealName: string;
    stage: string;
    amount: number;
    currency: string;
    ceiling: number | null;
    windowStatus: string | null;
    graceHours: number | null;
    deadlineInDays: number | null;
    silenceDays: number | null;
    lastActivityType: string | null;
    proposalOpens: number;
    replies: number;
    meetings: number;
    competitorHits: string[];
    activityLines: string[];
    activityCount: number;
}

function daysSince(iso: string | undefined, now: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((now - t) / DAY_MS));
}

function signedDaysUntil(iso: string | undefined, now: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.round((t - now) / DAY_MS);
}

export function extractFeatures(
    opp: Record<string, any>,
    activities: Record<string, any>[],
    window: Record<string, any> | null,
    now: number,
): DealFeatures {
    const sorted = [...activities].sort(
        (a, b) => new Date(b.occurred_at ?? 0).getTime() - new Date(a.occurred_at ?? 0).getTime(),
    );
    const last = sorted[0];
    const upper = (s: unknown) => String(s ?? "").toUpperCase();

    const proposalOpens = activities.filter((a) => upper(a.type) === "PROPOSAL_OPENED").length;
    const replies = activities.filter((a) => upper(a.type) === "REPLY").length;
    const meetings = activities.filter((a) => ["MEETING", "DEMO", "CALL"].includes(upper(a.type))).length;

    const competitorHits: string[] = [];
    for (const a of activities) {
        const text = String(a.summary ?? "").toLowerCase();
        if (!text) continue;
        for (const term of COMPETITOR_TERMS) {
            if (text.includes(term.trim())) {
                competitorHits.push(String(a.summary).trim());
                break;
            }
        }
    }

    return {
        dealName: String(opp.name ?? opp.opportunity_id ?? "this deal"),
        stage: String(opp.stage ?? "UNKNOWN"),
        amount: Number(opp.amount) || 0,
        currency: String(opp.currency ?? "USD"),
        ceiling: window && typeof window.current_ceiling === "number" ? window.current_ceiling : null,
        windowStatus: window ? String(window.status ?? "") : null,
        graceHours: window && typeof window.grace_period_hours === "number" ? window.grace_period_hours : null,
        deadlineInDays: window ? signedDaysUntil(window.next_gate_deadline, now) : null,
        silenceDays: daysSince(last?.occurred_at, now),
        lastActivityType: last ? String(last.type ?? "") : null,
        proposalOpens,
        replies,
        meetings,
        competitorHits: competitorHits.slice(0, 5),
        activityLines: sorted.slice(0, 12).map((a) => `${a.occurred_at ?? "?"} · ${a.type ?? "?"} · ${a.summary ?? ""}`.trim()),
        activityCount: activities.length,
    };
}

/** Deterministic, grounded synthesis — the AI fallback and the AI's hint. */
export function heuristicSynthesis(f: DealFeatures): SynthesisCore {
    // Silence gaps
    let silenceDetail: string;
    let silenceSev: Severity;
    if (f.silenceDays === null) {
        silenceDetail = "No engagement has ever been logged on this opportunity — it has been dark since it opened.";
        silenceSev = "high";
    } else {
        const graceDays = f.graceHours != null ? Math.round(f.graceHours / 24) : null;
        const past = graceDays != null && f.silenceDays > graceDays;
        silenceDetail =
            `Last touch was ${f.silenceDays} day${f.silenceDays === 1 ? "" : "s"} ago` +
            (f.lastActivityType ? ` (${f.lastActivityType})` : "") +
            (f.deadlineInDays != null
                ? `; the ceiling steps down ${f.deadlineInDays <= 0 ? "now" : `in ${f.deadlineInDays} day${f.deadlineInDays === 1 ? "" : "s"}`}.`
                : ".");
        silenceSev = f.silenceDays >= 14 || past || (f.deadlineInDays != null && f.deadlineInDays <= 2)
            ? "high" : f.silenceDays >= 7 ? "medium" : "low";
    }

    // Dark social
    let darkDetail: string;
    let darkSev: Severity;
    if (f.proposalOpens > 0 && f.replies === 0) {
        darkDetail =
            `The buyer opened the proposal ${f.proposalOpens} time${f.proposalOpens === 1 ? "" : "s"} but has sent zero replies — ` +
            `active interest that is being routed around you (internal forwarding, no direct response).`;
        darkSev = "high";
    } else if (f.proposalOpens > f.replies) {
        darkDetail =
            `Proposal opens (${f.proposalOpens}) outpace replies (${f.replies}); the deal is being read and circulated more than it is being discussed with you.`;
        darkSev = "medium";
    } else if (f.meetings === 0 && f.activityCount > 0) {
        darkDetail = "Engagement is entirely asynchronous — no meetings, demos, or calls on record to read the room.";
        darkSev = "medium";
    } else {
        darkDetail = "No dark-social pattern detected: proposal opens and direct replies are roughly balanced.";
        darkSev = "low";
    }

    // Competitor signals
    let compDetail: string;
    let compSev: Severity;
    if (f.competitorHits.length > 0) {
        compDetail =
            `${f.competitorHits.length} activit${f.competitorHits.length === 1 ? "y" : "ies"} reference a competing evaluation — e.g. “${f.competitorHits[0]}”.`;
        compSev = f.competitorHits.length >= 2 ? "high" : "medium";
    } else {
        compDetail = "No explicit competitor language in the engagement feed. Absence of signal, not proof of a clear field.";
        compSev = "low";
    }

    const drivers = [
        silenceSev === "high" ? "prolonged silence" : null,
        darkSev === "high" ? "one-sided proposal activity" : null,
        compSev !== "low" ? "an active competing evaluation" : null,
    ].filter(Boolean);
    const verdict = drivers.length
        ? `Slipping on ${drivers.join(" + ")}. Re-arm with a committed next step before the ceiling steps down.`
        : "Holding steady — no acute slip drivers in the current feed. Keep cadence to protect the ceiling.";

    return {
        bullets: [
            { key: "silence_gaps", label: BULLET_LABEL.silence_gaps, detail: silenceDetail, severity: silenceSev },
            { key: "dark_social", label: BULLET_LABEL.dark_social, detail: darkDetail, severity: darkSev },
            { key: "competitor_signals", label: BULLET_LABEL.competitor_signals, detail: compDetail, severity: compSev },
        ],
        verdict,
    };
}

export function buildPrompt(f: DealFeatures, heuristic: SynthesisCore): string {
    const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: f.currency, maximumFractionDigits: 0 }).format(f.amount);
    return [
        `You are a Deal Risk Analyst. Synthesize WHY a sales opportunity is slipping, in exactly three bullets.`,
        `Ground every claim in the FACTS below. Do NOT invent figures, names, or events not present. Be terse and specific.`,
        ``,
        `DEAL: ${f.dealName} — ${fmtMoney}, stage ${f.stage}` +
            (f.ceiling != null ? `, live win-probability ceiling ${f.ceiling}% (${f.windowStatus}).` : "."),
        `SILENCE: ${f.silenceDays == null ? "no activity ever logged" : `${f.silenceDays} days since last touch (${f.lastActivityType ?? "n/a"})`}` +
            (f.deadlineInDays != null ? `; ceiling steps down in ${f.deadlineInDays} days.` : "."),
        `ENGAGEMENT SHAPE: ${f.proposalOpens} proposal-opens, ${f.replies} replies, ${f.meetings} live meetings, ${f.activityCount} total activities.`,
        `COMPETITOR MENTIONS: ${f.competitorHits.length ? f.competitorHits.map((c) => `"${c}"`).join("; ") : "none found in feed"}.`,
        ``,
        `RECENT ACTIVITY FEED (newest first):`,
        f.activityLines.length ? f.activityLines.map((l) => `- ${l}`).join("\n") : "- (empty)",
        ``,
        `Return STRICT JSON only, no markdown fences, in this exact shape:`,
        `{"bullets":[`,
        `  {"key":"silence_gaps","detail":"<one sentence>","severity":"low|medium|high"},`,
        `  {"key":"dark_social","detail":"<one sentence on proposal-opens vs replies / async-only engagement>","severity":"low|medium|high"},`,
        `  {"key":"competitor_signals","detail":"<one sentence grounded in the mentions above>","severity":"low|medium|high"}`,
        `],"verdict":"<one imperative sentence: the single most important next move>"}`,
        ``,
        `For reference, a deterministic read of the same facts is: ${JSON.stringify(heuristic)}. Improve on its phrasing but keep it grounded.`,
    ].join("\n");
}

function coerceSeverity(v: unknown): Severity {
    return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

/**
 * Parse the model's JSON into a synthesis. Requires all three bullet keys;
 * missing keys/details fall back to the deterministic heuristic so the shape is
 * always complete. Returns null only when no JSON object is recoverable at all.
 */
export function parseAiSynthesis(output: string, heuristic: SynthesisCore): SynthesisCore | null {
    const cleaned = output.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    let parsed: any;
    try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!parsed || !Array.isArray(parsed.bullets)) return null;

    const byKey = new Map<string, any>();
    for (const b of parsed.bullets) {
        if (b && typeof b.key === "string") byKey.set(b.key, b);
    }
    const bullets: SynthesisBullet[] = [];
    for (const key of BULLET_KEYS) {
        const b = byKey.get(key);
        const fallbackBullet = heuristic.bullets.find((h) => h.key === key)!;
        const detail = b && typeof b.detail === "string" && b.detail.trim() ? b.detail.trim() : fallbackBullet.detail;
        bullets.push({
            key,
            label: BULLET_LABEL[key],
            detail,
            severity: b ? coerceSeverity(b.severity) : fallbackBullet.severity,
        });
    }
    const verdict = typeof parsed.verdict === "string" && parsed.verdict.trim() ? parsed.verdict.trim() : heuristic.verdict;
    return { bullets, verdict };
}
