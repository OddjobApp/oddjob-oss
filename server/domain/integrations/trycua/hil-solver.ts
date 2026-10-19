import crypto from "node:crypto";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("HilSolver");

/**
 * Mobile HIL solver link (Autonomous Operator proposal, Pillar 4).
 *
 * When a computer-use task pauses for a person, the task owner gets a push —
 * and, if they paired a phone number, a text message with a link that opens a
 * minimal solver page on whatever device received it. The page asks for the
 * one thing the agent needs (an OTP, a yes/no) and confirms the task.
 *
 * The link carries a signed, single-purpose grant rather than a session: the
 * person is on their phone, probably without a browser login. Single-use is
 * enforced downstream — confirmTask rejects anything not `needs_confirmation`.
 */
export const SOLVER_LINK_TTL_MS = 90_000;

export interface SolverGrant {
    taskId: string;
    userId: string;
    organizationId: number;
    expiresAt: number;
}

function solverSecret(): string | undefined {
    return process.env.INTERNAL_API_SECRET || process.env.SESSION_SECRET;
}

function base64url(input: string | Buffer): string {
    return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintSolverToken(
    grant: { taskId: string; userId: string; organizationId: number },
    now: number = Date.now(),
): string | null {
    const secret = solverSecret();
    if (!secret) return null;
    const payload = base64url(JSON.stringify({ ...grant, expiresAt: now + SOLVER_LINK_TTL_MS }));
    return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySolverToken(token: string, now: number = Date.now()): SolverGrant | null {
    const secret = solverSecret();
    if (!secret) return null;

    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!signature) return null;

    const expected = Buffer.from(signPayload(payload, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
    }

    try {
        const grant = JSON.parse(Buffer.from(payload, "base64url").toString()) as SolverGrant;
        if (typeof grant.taskId !== "string" || typeof grant.userId !== "string"
            || typeof grant.organizationId !== "number" || typeof grant.expiresAt !== "number") {
            return null;
        }
        if (grant.expiresAt <= now) return null;
        return grant;
    } catch {
        return null;
    }
}

/**
 * Text the task owner's verified phone numbers a solver link. Never throws:
 * a push that already failed shouldn't also break the pause path.
 */
export async function sendSolverLink(task: {
    id: string;
    userId: string;
    organizationId: number;
    task: string;
}): Promise<void> {
    try {
        const baseUrl = (process.env.APP_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, "");
        if (!baseUrl) {
            logger.warn("No APP_URL/PUBLIC_URL — solver link SMS skipped", { taskId: task.id });
            return;
        }

        const { omnichannelService } = await import("../core/omnichannel.service.js");
        const identities = await omnichannelService.listIdentities(task.organizationId, task.userId);
        const phones = identities.filter((i) => i.channelType === "sms" && i.isVerified);
        if (phones.length === 0) return;

        const token = mintSolverToken({ taskId: task.id, userId: task.userId, organizationId: task.organizationId });
        if (!token) {
            logger.warn("No signing secret — solver link SMS skipped", { taskId: task.id });
            return;
        }

        const url = `${baseUrl}/hil/solve/${token}`;
        const text = `Oddjob: your task "${task.task.slice(0, 80)}" needs you. Solve it here (link expires in 90s): ${url}`;
        for (const phone of phones) {
            await omnichannelService.sendChannelMessage(
                { channelType: "sms", channelIdentifier: phone.channelIdentifier, organizationId: task.organizationId },
                text,
            );
        }
    } catch (error: any) {
        logger.warn("Solver link SMS failed", { taskId: task.id, error: error?.message });
    }
}
