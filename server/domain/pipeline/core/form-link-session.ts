import jwt from "jsonwebtoken";
import { AppError } from "@server/utils/errors.js";

/**
 * A short-lived proof that a respondent entered the code sent to an email address,
 * for one form link.
 *
 * Bound to the link's token as well as the email, so a session earned on one form
 * cannot open another, and a rotated link invalidates every session made for the
 * old one.
 */

const SESSION_KIND = "form_link";
const SESSION_TTL = "2h";

function secret(): string {
    const value = process.env.JWT_SECRET;
    if (!value) throw new AppError("Email codes for forms need JWT_SECRET to be set on the server.", 500, "CONFIG_MISSING");
    return value;
}

export function signFormSession(input: { token: string; email: string }): string {
    return jwt.sign({ kind: SESSION_KIND, token: input.token, email: input.email }, secret(), { expiresIn: SESSION_TTL });
}

/** The verified email, or null for a missing, expired, tampered or other link's session. */
export function verifyFormSession(session: string | null | undefined, token: string): { email: string } | null {
    if (!session) return null;
    try {
        const payload = jwt.verify(session, secret()) as { kind?: string; token?: string; email?: string };
        if (payload.kind !== SESSION_KIND || payload.token !== token || !payload.email) return null;
        return { email: payload.email };
    } catch {
        return null;
    }
}
