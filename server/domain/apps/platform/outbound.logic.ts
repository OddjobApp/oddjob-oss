/**
 * Outbound Rescue — pure draft logic (Act III, the Agentic Outbound Rescue).
 *
 * Generates the followup PROMPT (the agent's grounded instruction context) and
 * an editable EMAIL DRAFT (subject + body) for a slipping deal. DB/AI-free so it
 * unit-tests in isolation; the controller injects rows and the AI client. Every
 * line is grounded in the deal's own record — no invented figures or events.
 */

export interface OutboundContext {
    opportunityId: string;
    dealName: string;
    accountName: string;
    stage: string;
    amount: number;
    currency: string;
    ceiling: number | null;
    windowStatus: string | null;
    silenceDays: number | null;
    lastActivityType: string | null;
    lastActivitySummary: string | null;
    competitorHit: string | null;
    ownerRep: string | null;
    recipientName: string | null;
    recipientEmail: string | null;
}

export interface OutboundDraft {
    prompt: string;
    subject: string;
    body: string;
    rationale: string;
}

const DAY_MS = 86_400_000;

const COMPETITOR_TERMS = [
    "competitor", "competing", "competition", "alternative", "incumbent", "rfp",
    "bake-off", "bakeoff", "other vendor", "another vendor", "evaluating",
    "evaluation", "shortlist", "versus", "trialing",
];

function daysSince(iso: string | undefined, now: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((now - t) / DAY_MS));
}

function firstName(full: string | null): string {
    if (!full) return "there";
    const n = full.trim().split(/\s+/)[0];
    return n || "there";
}

export function buildOutboundContext(
    opp: Record<string, any>,
    account: Record<string, any> | null,
    lead: Record<string, any> | null,
    activities: Record<string, any>[],
    window: Record<string, any> | null,
    now: number,
): OutboundContext {
    const sorted = [...activities].sort(
        (a, b) => new Date(b.occurred_at ?? 0).getTime() - new Date(a.occurred_at ?? 0).getTime(),
    );
    const last = sorted[0];

    let competitorHit: string | null = null;
    for (const a of activities) {
        const text = String(a.summary ?? "").toLowerCase();
        if (text && COMPETITOR_TERMS.some((t) => text.includes(t))) {
            competitorHit = String(a.summary).trim();
            break;
        }
    }

    return {
        opportunityId: String(opp.opportunity_id ?? ""),
        dealName: String(opp.name ?? opp.opportunity_id ?? "this opportunity"),
        accountName: String(account?.name ?? opp.account_id ?? "your team"),
        stage: String(opp.stage ?? "UNKNOWN"),
        amount: Number(opp.amount) || 0,
        currency: String(opp.currency ?? "USD"),
        ceiling: window && typeof window.current_ceiling === "number" ? window.current_ceiling : null,
        windowStatus: window ? String(window.status ?? "") : null,
        silenceDays: daysSince(last?.occurred_at, now),
        lastActivityType: last ? String(last.type ?? "") : null,
        lastActivitySummary: last?.summary ? String(last.summary) : null,
        competitorHit,
        ownerRep: opp.owner_rep ? String(opp.owner_rep) : account?.owner_rep ? String(account.owner_rep) : null,
        recipientName: lead?.name ? String(lead.name) : null,
        recipientEmail: lead?.email ? String(lead.email) : null,
    };
}

/** Deterministic, grounded draft — the AI fallback and the AI's phrasing hint. */
export function heuristicDraft(c: OutboundContext): OutboundDraft {
    const who = firstName(c.recipientName);
    const silence = c.silenceDays == null ? "a while" : `${c.silenceDays} day${c.silenceDays === 1 ? "" : "s"}`;
    const rep = c.ownerRep || "the team";

    const subject = c.competitorHit
        ? `${c.accountName} — quick gut-check before you decide`
        : `${c.accountName} — still worth a fast next step?`;

    const bodyLines = [
        `Hi ${who},`,
        ``,
        `It's been ${silence} since we last connected on ${c.dealName}` +
            (c.lastActivityType ? ` (last: ${c.lastActivityType.toLowerCase().replace(/_/g, " ")})` : "") +
            `, and I don't want it to stall on my account.`,
        c.competitorHit
            ? `I know you're weighing options — happy to put our differences in writing so you can compare like-for-like, no spin.`
            : `If priorities have shifted that's completely fine — a one-line reply either way helps me help you.`,
        `Would a 15-minute call this week to lock the next step work? I can send two slots.`,
        ``,
        `Best,`,
        rep,
    ];

    const rationale = [
        c.silenceDays != null && c.silenceDays >= 7 ? `${c.silenceDays}d of silence` : null,
        c.competitorHit ? "active competitor signal" : null,
        c.ceiling != null ? `ceiling at ${c.ceiling}%` : null,
    ].filter(Boolean).join(", ") || "re-open the conversation";

    return {
        prompt: buildDraftPrompt(c),
        subject,
        body: bodyLines.join("\n"),
        rationale: `Grounded re-engagement — ${rationale}.`,
    };
}

/** The agent PROMPT context revealed at the breakpoint (and sent to Gemini). */
export function buildDraftPrompt(c: OutboundContext): string {
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency, maximumFractionDigits: 0 }).format(c.amount);
    return [
        `You are ${c.ownerRep || "a sales rep"} writing a SHORT re-engagement email to rescue a slipping deal.`,
        `Tone: warm, direct, low-pressure, no marketing fluff. 90 words max. Give the buyer an easy out.`,
        `Ground everything in these facts — invent nothing:`,
        `- Deal: ${c.dealName} (${c.accountName}), ${money}, stage ${c.stage}` +
            (c.ceiling != null ? `, live win-probability ceiling ${c.ceiling}%.` : "."),
        `- Silence: ${c.silenceDays == null ? "no recent contact logged" : `${c.silenceDays} days since last touch`}` +
            (c.lastActivityType ? ` (${c.lastActivityType}).` : "."),
        c.lastActivitySummary ? `- Last note: "${c.lastActivitySummary}".` : `- No last note.`,
        c.competitorHit ? `- Competitor signal: "${c.competitorHit}".` : `- No explicit competitor signal.`,
        `- Recipient: ${c.recipientName ?? "the buyer"}${c.recipientEmail ? ` <${c.recipientEmail}>` : ""}.`,
        ``,
        `Return STRICT JSON only, no markdown fences: {"subject":"<=60 chars","body":"greeting → why now → single ask → sign-off as ${c.ownerRep || "the rep"}"}.`,
    ].join("\n");
}

export function parseDraft(output: string, fallback: OutboundDraft): { subject: string; body: string } {
    const cleaned = output.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return { subject: fallback.subject, body: fallback.body };
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        const subject = typeof parsed.subject === "string" && parsed.subject.trim() ? parsed.subject.trim() : fallback.subject;
        const body = typeof parsed.body === "string" && parsed.body.trim() ? parsed.body.trim() : fallback.body;
        return { subject, body };
    } catch {
        return { subject: fallback.subject, body: fallback.body };
    }
}
