
import crypto from "crypto";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import {
    omnichannelIdentities,
    type ChannelType,
    type OmnichannelIdentityRow,
} from "@shared/schema/index.js";
import { getTwilioConfig, twilioRequest } from "@domain/tools/v1/capabilities/twilio-helpers.js";

const logger = createLogger("Omnichannel");

// Pairing codes are short-lived by design: a leaked code must expire before an
// attacker can bind a victim's number to their own account.
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Wrong codes a challenge survives. A 6-digit code is a million guesses; without
 * a cap, 10 minutes is enough to try them all and bind someone else's number.
 * The count lives on the row (settings.verifyAttempts) and is claimed atomically,
 * so parallel guesses cannot slip past it.
 */
export const MAX_VERIFY_ATTEMPTS = 5;

// E.164-ish: optional leading '+', non-zero first digit, 7–15 digits total.
// Deliberately strict — the pairing code is the only proof-of-ownership for the
// number, so a malformed identifier failing loudly beats a near-miss normalize.
const E164_PATTERN = /^\+?[1-9]\d{6,14}$/;

export type ChannelTarget = {
    channelType: ChannelType;
    channelIdentifier: string;
    /** Org whose credentials should pay for delivery; undefined → env/global config. */
    organizationId?: number | null;
};

export type StartPairingResult =
    | { ok: true; id: number; delivered: boolean }
    | { ok: false; reason: "invalid_identifier" | "identifier_in_use" };

export type VerifyPairingResult =
    | { ok: true }
    | { ok: false; reason: "not_found" | "expired" | "wrong_code" | "too_many_attempts" | "identifier_in_use" };

/**
 * Normalize a user- or carrier-supplied channel identifier to the stored form.
 * Returns null for input that can never be a valid identifier for the channel.
 *
 * For sms/whatsapp the stored form is E.164 ('+' prefixed). WhatsApp carriers
 * prefix the number with 'whatsapp:' on inbound webhooks — stripped here so the
 * same lookup works for pairing (user input) and ingress (Twilio payloads).
 */
export function normalizeChannelIdentifier(channelType: ChannelType, raw: string): string | null {
    let trimmed = (raw ?? "").trim();
    if (channelType === "whatsapp" && trimmed.toLowerCase().startsWith("whatsapp:")) {
        trimmed = trimmed.slice("whatsapp:".length).trim();
    }
    if (!trimmed) return null;

    if (channelType === "sms" || channelType === "whatsapp") {
        if (!E164_PATTERN.test(trimmed)) return null;
        return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
    }

    // Telegram identifiers are platform chat ids (numeric; negative for groups).
    // There is no canonical format to enforce — store verbatim.
    return trimmed;
}

/**
 * 6-digit pairing code. crypto.randomInt, not Math.random — this code is the
 * only authentication factor standing between a phone number and an Oddjob
 * account, so it needs a CSPRNG.
 */
export function generateVerificationCode(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export const omnichannelService = {
    /**
     * Begin (or restart) pairing a channel identifier to an Oddjob user.
     *
     * The (org, channelType, channelIdentifier) tuple is unique, so an existing
     * row is updated rather than duplicated — but only when it already belongs
     * to the requesting user. A number claimed by a DIFFERENT user in the same
     * org is rejected outright: re-pairing must never hijack a colleague's
     * verified (or pending) channel.
     */
    async startPairing(params: {
        organizationId: number;
        userId: string;
        channelType: ChannelType;
        channelIdentifier: string;
    }): Promise<StartPairingResult> {
        const identifier = normalizeChannelIdentifier(params.channelType, params.channelIdentifier);
        if (!identifier) {
            return { ok: false, reason: "invalid_identifier" };
        }

        const [existing] = await db
            .select()
            .from(omnichannelIdentities)
            .where(and(
                eq(omnichannelIdentities.organizationId, params.organizationId),
                eq(omnichannelIdentities.channelType, params.channelType),
                eq(omnichannelIdentities.channelIdentifier, identifier),
            ))
            .limit(1);

        if (existing && existing.userId !== params.userId) {
            logger.warn(
                `Pairing rejected: ${params.channelType} identifier is already bound to a different user in org ${params.organizationId}`,
            );
            return { ok: false, reason: "identifier_in_use" };
        }

        // Inbound messages carry no org: a sender's number has to name exactly one
        // identity, so a number verified anywhere else is not pairable here.
        if (await this.verifiedElsewhere(params.channelType, identifier, params.organizationId, params.userId)) {
            logger.warn(`Pairing rejected: ${params.channelType} identifier is already verified for another identity`);
            return { ok: false, reason: "identifier_in_use" };
        }

        const code = generateVerificationCode();
        const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MS);
        const now = new Date();

        let id: number;
        if (existing) {
            const [updated] = await db
                .update(omnichannelIdentities)
                .set({
                    verificationCode: code,
                    verificationExpiresAt: expiresAt,
                    isVerified: false,
                    // A new code gets a fresh allowance of guesses.
                    settings: { ...(existing.settings ?? {}), verifyAttempts: 0 },
                    updatedAt: now,
                })
                .where(eq(omnichannelIdentities.id, existing.id))
                .returning({ id: omnichannelIdentities.id });
            id = updated.id;
        } else {
            try {
                const [inserted] = await db
                    .insert(omnichannelIdentities)
                    .values({
                        organizationId: params.organizationId,
                        userId: params.userId,
                        channelType: params.channelType,
                        channelIdentifier: identifier,
                        isVerified: false,
                        verificationCode: code,
                        verificationExpiresAt: expiresAt,
                    })
                    .returning({ id: omnichannelIdentities.id });
                id = inserted.id;
            } catch (err: any) {
                // Concurrent pairings of the same number race on the unique
                // index; translate the constraint violation into the same
                // domain rejection rather than surfacing a raw 500.
                if (err?.code === "23505") {
                    return { ok: false, reason: "identifier_in_use" };
                }
                throw err;
            }
        }

        const delivered = await this.sendChannelMessage(
            {
                channelType: params.channelType,
                channelIdentifier: identifier,
                organizationId: params.organizationId,
            },
            `Your Oddjob verification code is ${code}. It expires in 10 minutes.`,
        );

        // The row id is safe to return; the code itself is never exposed via the
        // API — the channel message is its only delivery path.
        return { ok: true, id, delivered };
    },

    /**
     * Confirm a pairing with the code delivered to the channel.
     *
     * Already-verified rows return success without re-checking the code, so a
     * client retrying after a network failure stays idempotent.
     */
    async verifyPairing(params: {
        organizationId: number;
        userId: string;
        identityId: number;
        code: string;
    }): Promise<VerifyPairingResult> {
        const [row] = await db
            .select()
            .from(omnichannelIdentities)
            .where(eq(omnichannelIdentities.id, params.identityId))
            .limit(1);

        // Existence is answered as 'not_found' for other users' rows too —
        // confirming the id exists would leak pairing state across the org.
        if (!row || row.organizationId !== params.organizationId || row.userId !== params.userId) {
            return { ok: false, reason: "not_found" };
        }

        if (row.isVerified) {
            return { ok: true };
        }

        if (!row.verificationCode || !row.verificationExpiresAt) {
            // No pending challenge (e.g. code was cleared) — nothing to match.
            return { ok: false, reason: "wrong_code" };
        }

        if (row.verificationExpiresAt.getTime() < Date.now()) {
            return { ok: false, reason: "expired" };
        }

        // Claim one attempt before comparing. The increment and the cap are one
        // statement, so N parallel guesses get at most MAX_VERIFY_ATTEMPTS claims.
        const attempts = sql`coalesce((${omnichannelIdentities.settings}->>'verifyAttempts')::int, 0)`;
        const claimed = await db
            .update(omnichannelIdentities)
            .set({
                settings: sql`jsonb_set(${omnichannelIdentities.settings}, '{verifyAttempts}', to_jsonb(${attempts} + 1))`,
            })
            .where(and(eq(omnichannelIdentities.id, row.id), sql`${attempts} < ${MAX_VERIFY_ATTEMPTS}`))
            .returning({ id: omnichannelIdentities.id });
        if (claimed.length === 0) {
            return { ok: false, reason: "too_many_attempts" };
        }

        // timingSafeEqual throws on length mismatch — gate on length first.
        const expected = Buffer.from(row.verificationCode, "utf8");
        const provided = Buffer.from(String(params.code ?? ""), "utf8");
        const match = expected.length === provided.length
            && crypto.timingSafeEqual(expected, provided);
        if (!match) {
            return { ok: false, reason: "wrong_code" };
        }

        // Re-checked here, not only at start: another identity may have verified
        // the same number while this code was outstanding. The partial unique
        // index (0136) is the backstop for two verifications racing.
        if (await this.verifiedElsewhere(row.channelType, row.channelIdentifier, row.organizationId, row.userId)) {
            return { ok: false, reason: "identifier_in_use" };
        }

        try {
            await db
                .update(omnichannelIdentities)
                .set({
                    isVerified: true,
                    // Clear the challenge once consumed — a spent code is a liability.
                    verificationCode: null,
                    verificationExpiresAt: null,
                    settings: { ...(row.settings ?? {}), verifyAttempts: 0 },
                    updatedAt: new Date(),
                })
                .where(eq(omnichannelIdentities.id, row.id));
        } catch (err: any) {
            if (err?.code === "23505") return { ok: false, reason: "identifier_in_use" };
            throw err;
        }

        return { ok: true };
    },

    /** Whether this identifier is verified for any identity other than (org, user). */
    async verifiedElsewhere(channelType: ChannelType, identifier: string, organizationId: number, userId: string): Promise<boolean> {
        const [other] = await db
            .select({ id: omnichannelIdentities.id })
            .from(omnichannelIdentities)
            .where(and(
                eq(omnichannelIdentities.channelType, channelType),
                eq(omnichannelIdentities.channelIdentifier, identifier),
                eq(omnichannelIdentities.isVerified, true),
                or(ne(omnichannelIdentities.organizationId, organizationId), ne(omnichannelIdentities.userId, userId)),
            ))
            .limit(1);
        return Boolean(other);
    },

    /**
     * The inbound-webhook lookup: which verified identity owns this sender?
     * Returns null for unverified or unknown identifiers, and for an identifier
     * verified more than once (rows from before the one-owner rule): an inbound
     * message must never go to whichever tenant the database happens to list first.
     */
    async resolveVerifiedIdentity(
        channelType: ChannelType,
        channelIdentifier: string,
    ): Promise<OmnichannelIdentityRow | null> {
        const identifier = normalizeChannelIdentifier(channelType, channelIdentifier);
        if (!identifier) return null;

        const rows = await db
            .select()
            .from(omnichannelIdentities)
            .where(and(
                eq(omnichannelIdentities.channelType, channelType),
                eq(omnichannelIdentities.channelIdentifier, identifier),
                eq(omnichannelIdentities.isVerified, true),
            ))
            .limit(2);
        if (rows.length > 1) {
            logger.error(`${channelType} identifier is verified for more than one identity; refusing to route it`);
            return null;
        }

        return rows[0] ?? null;
    },

    /**
     * Send a text message over the identity's channel. Never throws — delivery
     * failure is reported as `false` so callers can degrade (e.g. fall back to
     * the web UI) rather than lose the request.
     *
     * `text` is never logged: it routinely carries secrets (pairing codes,
     * approvals) that must not land in log aggregators.
     */
    async sendChannelMessage(target: ChannelTarget, text: string): Promise<boolean> {
        try {
            if (target.channelType === "sms" || target.channelType === "whatsapp") {
                const config = await getTwilioConfig(target.organizationId ?? undefined);
                if (!config?.accountSid || !config.authToken || !config.fromNumber) {
                    logger.warn(
                        `Twilio is not configured — cannot deliver ${target.channelType} message to ${target.channelIdentifier}`,
                    );
                    return false;
                }
                const isWhatsApp = target.channelType === "whatsapp";
                const from = isWhatsApp
                    ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || config.fromNumber}`
                    : config.fromNumber;
                const to = isWhatsApp
                    ? `whatsapp:${target.channelIdentifier}`
                    : target.channelIdentifier;
                await twilioRequest(config, "/Messages.json", { To: to, From: from, Body: text });
                return true;
            }

            if (target.channelType === "telegram") {
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                if (!botToken) {
                    logger.warn("TELEGRAM_BOT_TOKEN not set — cannot deliver telegram message");
                    return false;
                }
                const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: target.channelIdentifier, text }),
                });
                if (!res.ok) {
                    logger.warn(`Telegram sendMessage rejected with HTTP ${res.status} for ${target.channelIdentifier}`);
                    return false;
                }
                return true;
            }

            logger.warn(`Unknown channel type '${target.channelType}' — message not delivered`);
            return false;
        } catch (err: any) {
            logger.error(
                `Channel delivery failed (${target.channelType} → ${target.channelIdentifier}): ${err.message}`,
            );
            return false;
        }
    },

    /**
     * The current user's channel identities in the org, minus the live
     * verification code (a pending code is a secret; it never leaves the DB).
     */
    async listIdentities(organizationId: number, userId: string) {
        const rows = await db
            .select()
            .from(omnichannelIdentities)
            .where(and(
                eq(omnichannelIdentities.organizationId, organizationId),
                eq(omnichannelIdentities.userId, userId),
            ));

        return rows.map(({ verificationCode: _verificationCode, ...safe }) => safe);
    },

    /**
     * Remove an identity the caller owns. Returns false when nothing matched —
     * either a bad id or an attempt to unlink someone else's channel.
     */
    async removeIdentity(organizationId: number, userId: string, identityId: number): Promise<boolean> {
        const deleted = await db
            .delete(omnichannelIdentities)
            .where(and(
                eq(omnichannelIdentities.id, identityId),
                eq(omnichannelIdentities.organizationId, organizationId),
                eq(omnichannelIdentities.userId, userId),
            ))
            .returning({ id: omnichannelIdentities.id });

        return deleted.length > 0;
    },
};
