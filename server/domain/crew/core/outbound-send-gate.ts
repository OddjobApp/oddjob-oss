import type { CrewArtifact } from "./crew-tools.service.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("OutboundSendGate");

/**
 * Situational review gate for direct send tools in CREW rooms.
 *
 * `propose_outbound_message` lets an agent draft behind a confirmation card,
 * but the model chooses — it can still call send_email outright. This gate is
 * the enforcement layer: a send_* call whose situation warrants review is
 * converted into a pending `outbound_message` approval card instead of being
 * delivered, and the card is what a human sends.
 *
 * The rule is deliberately asymmetric — the cost of a wrong send is permanent
 * and external, the cost of a review is ten seconds:
 *
 *   - reply_agentmail               → always gated (customer-facing thread)
 *   - recipient outside the user's   → gated ("external_first_contact")
 *     own email domain (or unknown)
 *   - commitment / legal / money     → gated ("commitment_or_legal")
 *     language in subject or body
 *   - the user dictated the body     → direct send (verbatim instructions
 *     verbatim in the message             need no second review)
 *   - internal-domain recipients,    → direct send
 *     no commitment language
 *
 * Slack (`slack_post_message`) gets the same treatment, with workspace-shaped
 * rules instead of domain-shaped ones:
 *
 *   - @channel / @here / @everyone      → gated ("broad_audience")
 *   - commitment / legal language       → gated ("commitment_or_legal")
 *   - external/shared channel names     → gated ("customer_facing")
 *     (ext-, -external, shared, cust-…)
 *   - anything else                     → direct send
 */

export const GATED_SEND_TOOLS = new Set(["send_email", "send_agentmail", "gmail_send", "outlook_send_email", "reply_agentmail", "slack_post_message"]);

const SLACK_TOOLS = new Set(["slack_post_message"]);

const SLACK_BROADCAST = /<!?(channel|here|everyone)[>|]|@channel\b|@here\b|@everyone\b/i;

/** "Draft an email", "let me see it first" — the user asked to review the
 * message itself, so the destination rules don't apply: it holds either way. */
const DRAFT_INTENT = /\b(draft|let me (see|review|check|look)|show me|review (it|the|this|first)|before (you|it) (send|post|go)|confirm (it|first|before)|approve first)\b/i;

/** Channel names that read as leaving the org — shared/external/customer
 * workspaces don't carry a machine-readable flag on the send args, so the
 * name is the signal the gate has. */
const SLACK_EXTERNAL_CHANNEL = /(?:^|[\s#_-])(ext|external|shared|cust|customer|client|vendor|partner|public)[\s_-]/i;

const COMMITMENT_LANGUAGE =
    /\$\s?\d|\bUSD\b|\bEUR\b|\bpric(e|ing|ed)\b|\bquote[ds]?\b|\bcontract\b|\bagreement\b|\bNDA\b|\blegal\b|\binvoice[ds]?\b|\bpayments?\b|\bguarantee[ds]?\b|\bcommits?\b|\bcommitments?\b|\bdeadline\b|\bsign(ed|ing|ature)?\b/i;

function firstText(...vals: any[]): string {
    for (const v of vals) {
        if (typeof v === "string" && v.trim()) return v;
    }
    return "";
}

function collectEmails(args: Record<string, any>): string[] {
    const addrs = new Set<string>();
    for (const key of ["to", "cc", "bcc"] as const) {
        const v = args[key];
        for (const item of Array.isArray(v) ? v : [v]) {
            if (typeof item !== "string") continue;
            for (const m of item.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []) {
                addrs.add(m.toLowerCase());
            }
        }
    }
    return [...addrs];
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The requesting user's own email domain — the boundary between internal
 * mail and mail that leaves the org. Null when it cannot be established, in
 * which case every recipient counts as external (default-deny). */
async function senderDomain(context: any): Promise<string | null> {
    const explicit = String(context?.senderEmail ?? context?.userEmail ?? "");
    const m = explicit.match(/@([\w.-]+)$/);
    if (m) return m[1].toLowerCase();
    const userId = String(context?.userId ?? "");
    if (!USER_ID_PATTERN.test(userId)) return null;
    try {
        const { db } = await import("@server/database_service.js");
        const { users } = await import("@shared/schema/index.js");
        const { eq } = await import("drizzle-orm");
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        const dm = String(user?.email ?? "").match(/@([\w.-]+)$/);
        return dm ? dm[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

interface GateVerdict {
    sensitivity: string;
    why: string;
    /** The agent card's own boundary forbids this send outright — no card, no delivery. */
    block?: boolean;
}

/** The calling agent's durable approval boundary. Crew turns resolve via
 * agent_cards.approval_boundary (context.agentCardId); mission-executed
 * agents — standing agents, heartbeat work — resolve via the deployment of
 * the executing job (context.jobId → agent_deployments.approval_boundary).
 * Null when neither is attached — global rules then apply alone. */
async function agentBoundary(context: any): Promise<string | null> {
    const orgId = Number(context?.organizationId);
    if (!Number.isInteger(orgId) || orgId <= 0) return null;
    try {
        const { db } = await import("@server/database_service.js");
        const { and, eq } = await import("drizzle-orm");

        const cardId = Number(context?.agentCardId);
        if (Number.isInteger(cardId) && cardId > 0) {
            const { agentCards } = await import("@shared/schema/index.js");
            const [card] = await db
                .select({ approvalBoundary: agentCards.approvalBoundary })
                .from(agentCards)
                .where(and(eq(agentCards.id, cardId), eq(agentCards.organizationId, orgId)))
                .limit(1);
            const text = String(card?.approvalBoundary ?? "").trim();
            if (text) return text;
        }

        const jobId = Number(context?.jobId);
        if (Number.isInteger(jobId) && jobId > 0) {
            const { agentDeployments } = await import("@shared/schema/agent-deployments.js");
            const [deployment] = await db
                .select({ approvalBoundary: agentDeployments.approvalBoundary })
                .from(agentDeployments)
                .where(and(eq(agentDeployments.jobId, jobId), eq(agentDeployments.organizationId, orgId)))
                .limit(1);
            const text = String(deployment?.approvalBoundary ?? "").trim();
            if (text) return text;
        }

        return null;
    } catch (err: any) {
        // An unreadable boundary is not an absent one — returning null here
        // would let a "never contact customers" agent send freely while the
        // database is unhappy. Callers treat the throw as a held send.
        logger.warn(`Approval boundary lookup failed: ${err?.message}`);
        throw new Error(`approval boundary could not be read (${err?.message})`);
    }
}

async function reviewReason(
    toolName: string,
    args: Record<string, any>,
    context: any,
): Promise<GateVerdict | null> {
    const subject = firstText(args.subject);
    const body = firstText(args.html, args.body, args.text, args.message);
    const summary = `${subject} ${body}`;

    // The card's durable boundary outranks every turn-level rule, including
    // the verbatim and draft-intent checks below: "never contact customers" is
    // a hard stop that neither a dictated body nor a review card may bend, and
    // "review everything" turns every send into a card — both read from the
    // card/deployment boundary, not from this turn's instructions.
    const boundary = await agentBoundary(context);
    if (boundary) {
        const boundaryNote = `the card's approval boundary says "${boundary.slice(0, 120)}"`;
        const isExternalReach =
            SLACK_TOOLS.has(toolName)
                ? SLACK_EXTERNAL_CHANNEL.test(` ${firstText(args.channel, args.channelName, args.to)} `) || args.isExternal === true || args.shared === true
                : await (async () => {
                    const domain = await senderDomain(context);
                    const recipients = collectEmails(args);
                    return recipients.some((addr) => !domain || addr.split("@")[1] !== domain);
                  })();
        if (isExternalReach && /(never|do not|don't|prohibit|forbid|no)\b[^.]*\b(external|customer|client|outside|vendor|partner)/i.test(boundary)) {
            return { sensitivity: "boundary_violation", block: true, why: `${boundaryNote} — this send would reach outside` };
        }
        if (/(never|do not|don't|prohibit|forbid|no)\b[^.]*\b(send|email|message|post)/i.test(boundary)) {
            return { sensitivity: "boundary_violation", block: true, why: `${boundaryNote} — outbound sends are off the table for this agent` };
        }
        if (/(always|all|every|any)\b[^.]*\b(approv|review|confirm|sign[- ]?off)/i.test(boundary)) {
            return { sensitivity: "requested_review", why: `${boundaryNote}` };
        }
    }

    // Authoring mail always confirms the connected sender, even for verbatim text.
    if (["send_email", "gmail_send", "outlook_send_email"].includes(toolName)) {
        return COMMITMENT_LANGUAGE.test(summary)
            ? { sensitivity: "commitment_or_legal", why: "the draft contains commitment, pricing, or legal language" }
            : { sensitivity: "requested_review", why: "confirm the Google or Microsoft sender and optionally remember it" };
    }

    // The user dictated the content — re-reviewing their own words adds
    // friction without adding a check.
    const instruction = String(context?.named?.message ?? "");
    const verbatim = body.trim().length >= 40 && instruction.toLowerCase().includes(body.trim().toLowerCase());
    if (verbatim) return null;

    // "Draft an email and send it" — the user asked to see the draft, so even
    // a routine internal send must stop at the card.
    if (DRAFT_INTENT.test(instruction)) {
        return { sensitivity: "requested_review", why: "you asked to review the draft before it goes out" };
    }

    if (SLACK_TOOLS.has(toolName)) {
        const channel = firstText(args.channel, args.channelName, args.to);
        if (SLACK_BROADCAST.test(body)) {
            return { sensitivity: "broad_audience", why: "the post mentions @channel/@here/@everyone — it reaches the whole channel" };
        }
        if (COMMITMENT_LANGUAGE.test(summary)) {
            return { sensitivity: "commitment_or_legal", why: "the post contains commitment, pricing, or legal language" };
        }
        if (SLACK_EXTERNAL_CHANNEL.test(` ${channel} `) || args.isExternal === true || args.shared === true) {
            return { sensitivity: "customer_facing", why: `the post targets ${channel || "a channel that reads as external or shared"}` };
        }
        return null;
    }

    if (COMMITMENT_LANGUAGE.test(summary)) {
        return { sensitivity: "commitment_or_legal", why: "the draft contains commitment, pricing, or legal language" };
    }

    if (toolName === "reply_agentmail") {
        return { sensitivity: "customer_facing", why: "this replies into an existing external thread" };
    }

    const domain = await senderDomain(context);
    const recipients = collectEmails(args);
    const external = recipients.filter((addr) => !domain || addr.split("@")[1] !== domain);
    if (external.length > 0 || recipients.length === 0) {
        return {
            sensitivity: "external_first_contact",
            why: recipients.length
                ? `recipient ${external[0] ?? recipients[0]} is outside ${domain ?? "a resolvable internal domain"}`
                : "the send targets recipients the room cannot verify as internal",
        };
    }

    return null;
}

export interface GatedSendResult {
    record: { name: string; ok: boolean; ms: number; error?: string };
    output: string;
    artifact: CrewArtifact | null;
}

/**
 * Returns a synthesized approval-card result when the send should be reviewed,
 * or null when the call may execute normally. Runs after argument validation
 * so `args` is the tool's declared shape.
 */
export async function maybeGateOutboundSend(
    toolName: string,
    args: Record<string, any>,
    context: any,
    started: number,
): Promise<GatedSendResult | null> {
    if (!GATED_SEND_TOOLS.has(toolName)) return null;
    const ms = Date.now() - started;

    const verdict = await reviewReason(toolName, args, context);
    if (!verdict) return null;

    // "Never" boundaries don't get a card — a human approving a card is how a
    // "review" rule bends; a "never" rule must not bend.
    if (verdict.block) {
        logger.info(`Send '${toolName}' blocked by agent boundary — ${verdict.why}`);
        return {
            record: { name: toolName, ok: false, ms, error: `blocked by agent approval boundary` },
            output:
                `The message was not sent: ${verdict.why}. ` +
                `Do not retry this send; tell the user the agent's own rules forbid it, and ask whether they want to change the boundary on the agent card.`,
            artifact: null,
        };
    }

    const isSlack = SLACK_TOOLS.has(toolName);
    const toList = isSlack
        ? [firstText(args.channel, args.channelName, args.to) || "#channel"]
        : collectEmails(args);
    const subject = firstText(args.subject);
    const body = firstText(args.html, args.body, args.text, args.message);

    try {
        const { CREW_TASK_PROPOSAL_TOOLS } = await import("@domain/tools/v1/capabilities/crew-task-proposal-tools.js");
        const output = await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(
            {
                channel: isSlack ? "slack" : "email",
                to: toList.length ? toList : ["(existing thread)"],
                from: args.from,
                subject,
                body,
                cc: args.cc,
                bcc: args.bcc,
                bodyFormat: args.is_html || args.isHtml || args.html ? "html" : "plain",
                workspace: args.workspace ?? args.workspaceName,
                sendTool: isSlack || toolName === "send_email" ? null : toolName,
                trigger: context?.named?.message
                    ? `Drafted from the room's request: "${String(context.named.message).slice(0, 140)}"`
                    : undefined,
                sensitivity: verdict.sensitivity,
                reason: `Held for review — ${verdict.why}.`,
                // Thread replies keep their messageId so approval resumes the
                // same thread rather than starting a new email.
                ...(toolName === "reply_agentmail" ? { threadTs: args.threadId, messageId: args.messageId } : {}),
            } as any,
            context,
        );

        const json = extractJson(output);
        const artifact: CrewArtifact | null =
            json && json.type === "approval_request" ? { tool: "propose_outbound_message", payload: json } : null;

        logger.info(`Send '${toolName}' held for review — ${verdict.why}`);

        return {
            record: { name: toolName, ok: true, ms },
            output:
                `The message was not sent — ${verdict.why}, so it was placed on a review card instead. ` +
                `A human will send or discard it. Do not tell the user it was sent; say it is pending their confirmation.`,
            artifact,
        };
    } catch (err: any) {
        // If the review path itself fails, fail closed on external/commitment
        // sends — losing a draft beats an unreviewed send.
        logger.warn(`Send gate could not raise a review card: ${err?.message}`);
        return {
            record: { name: toolName, ok: false, ms, error: `review gate failed — ${err?.message}`.slice(0, 200) },
            output:
                `Error: the send was held for review but the review card could not be created (${err?.message}). ` +
                `The message was NOT sent. Ask the user whether to try again.`,
            artifact: null,
        };
    }
}

function extractJson(output: unknown): Record<string, any> | null {
    const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
    const start = text.indexOf("{");
    if (start === -1) return null;
    try {
        return JSON.parse(text.slice(start));
    } catch {
        return null;
    }
}
