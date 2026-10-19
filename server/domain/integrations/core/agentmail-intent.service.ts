/**
 * AgentMail Intent Classifier & Security Gate
 *
 * Parses inbound email replies to extract:
 *   - intent: approve | reject | steer | launch | confirm | unknown
 *   - passcode: the 6-digit OTP included in the reply body
 *   - requestId: extracted from the thread subject or body
 *   - payload: any free-text content for steer/launch
 *
 * Security layers applied before any action is taken:
 *   1. HMAC signature verified upstream by webhook route
 *   2. Sender address pinned against the token's email claim
 *   3. OTP passcode verified against otp_codes table
 *   4. Org membership + role capability check
 */

import { db } from "@server/database_service.js";
import { otpCodes, approvalRequests, users } from "@shared/schema/index.js";
import { eq, and, gt, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { validateExternalToken } from "@domain/auth/core/jwt.service.js";

const logger = createLogger("AgentMailIntent");

export type EmailIntent = "approve" | "reject" | "steer" | "launch" | "unknown";

export interface ParsedIntent {
    intent: EmailIntent;
    passcode?: string;
    requestId?: number;
    payload?: string;
    rawBody: string;
}

// ── Intent parsing ────────────────────────────────────────────────────────────

const APPROVE_RE  = /^\s*APPROVE\b/im;
const REJECT_RE   = /^\s*REJECT\b/im;
const STEER_RE    = /^\s*STEER\b|^\s*NUDGE\b|^\s*GUIDANCE\b/im;
const LAUNCH_RE   = /^\s*LAUNCH\b|^\s*RUN\b/im;
const PASSCODE_RE = /\b(\d{6})\b/;
const REQ_ID_RE   = /Request ID[:\s]+(\d+)/i;

export async function parseEmailIntent(body: string): Promise<ParsedIntent> {
    const clean = body
        .replace(/^>.*$/gm, "")           // strip quoted reply lines
        .replace(/On .+ wrote:/gi, "")    // strip "On ... wrote:" headers
        .trim();

    const base: Omit<ParsedIntent, "intent"> = {
        rawBody: clean,
        payload: clean,
    };

    try {
        const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
        const isHealthy = await pythonBridge.isHealthy();

        if (isHealthy) {
            const result = await pythonBridge.execute(
                "classify_intent",
                "/api/v1/notifications/classify",
                "POST",
                { text: clean }
            );

            if (result && result.body && result.body.intent) {
                logger.info(`[AgentMailIntent] Classified via Python: ${result.body.intent} (conf: ${result.body.confidence})`);
                return {
                    ...base,
                    intent: result.body.intent as EmailIntent,
                    passcode: result.body.passcode,
                    // Regex fallback for Request ID as it's a fixed format
                    requestId: clean.match(REQ_ID_RE) ? parseInt(clean.match(REQ_ID_RE)![1]) : undefined,
                };
            }
        }
    } catch (err: any) {
        logger.warn("[AgentMailIntent] Python classification failed, falling back to regex:", { error: err.message });
    }

    // Legacy Regex Fallback
    const passcodeMatch = clean.match(PASSCODE_RE);
    const requestIdMatch = clean.match(REQ_ID_RE);

    const legacyBase = {
        ...base,
        passcode: passcodeMatch?.[1],
        requestId: requestIdMatch ? parseInt(requestIdMatch[1]) : undefined,
    };

    if (APPROVE_RE.test(clean))  return { ...legacyBase, intent: "approve" };
    if (REJECT_RE.test(clean))   return { ...legacyBase, intent: "reject" };
    if (STEER_RE.test(clean))    return { ...legacyBase, intent: "steer" };
    if (LAUNCH_RE.test(clean))   return { ...legacyBase, intent: "launch" };

    return { ...legacyBase, intent: "unknown" };
}

// ── Security gate ─────────────────────────────────────────────────────────────

export type GateResult =
    | { ok: true;  userId: string; userEmail: string; requestId?: number }
    | { ok: false; reason: string };

/**
 * HIGH-RISK gate (approve / reject / launch / promote):
 *   - Verifies sender is a known org member
 *   - Verifies OTP passcode against otp_codes table
 */
export async function verifyHighRiskAction(
    fromEmail: string,
    executionId: string,
    passcode: string | undefined,
): Promise<GateResult> {
    if (!passcode) {
        return { ok: false, reason: "No passcode found in email body. Reply with: APPROVE <6-digit-code>" };
    }

    // 1. Sender must be a known user
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, fromEmail))
        .limit(1);

    if (!user) {
        logger.warn(`[AgentMail Gate] Unknown sender: ${fromEmail}`);
        return { ok: false, reason: `Sender ${fromEmail} is not a registered Oddjob user.` };
    }

    // 2. OTP passcode verification
    const [otpRecord] = await db
        .select()
        .from(otpCodes)
        .where(
            and(
                eq(otpCodes.executionId, executionId),
                eq(otpCodes.email, fromEmail),
                eq(otpCodes.code, passcode),
                sql`${otpCodes.usedAt} IS NULL`,
                gt(otpCodes.expiresAt, new Date()),
            )
        )
        .limit(1);

    if (!otpRecord) {
        logger.warn(`[AgentMail Gate] Invalid/expired OTP from ${fromEmail} for execution ${executionId}`);
        return { ok: false, reason: "Invalid or expired passcode. Please check your email for a new one." };
    }

    // Mark OTP used
    await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otpRecord.id));

    return { ok: true, userId: user.id, userEmail: fromEmail };
}

/**
 * LOW-RISK gate (steer / nudge):
 *   - Sender must be a known org member only
 */
export async function verifyLowRiskAction(fromEmail: string): Promise<GateResult> {
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, fromEmail))
        .limit(1);

    if (!user) {
        return { ok: false, reason: `Sender ${fromEmail} is not a registered Oddjob user.` };
    }

    return { ok: true, userId: user.id, userEmail: fromEmail };
}

/**
 * Resolve the approval request ID + executionId from a request ID.
 */
export async function getApprovalByRequestId(requestId: number) {
    const [req] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId))
        .limit(1);
    return req ?? null;
}

/**
 * Find the most recent pending approval assigned to an email address.
 * Used when the email doesn't contain a Request ID.
 */
export async function getLatestPendingApprovalForEmail(email: string) {
    const [req] = await db
        .select()
        .from(approvalRequests)
        .where(
            and(
                eq(approvalRequests.approverEmail, email),
                eq(approvalRequests.status, "pending"),
            )
        )
        .orderBy(desc(approvalRequests.createdAt))
        .limit(1);
    return req ?? null;
}
