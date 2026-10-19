/**
 * A user editing their OWN profile and notification preferences.
 *
 * WHY THIS EXISTS: the web Profile page (and the Android app's Settings) PATCH
 * `/api/users/:id`, a route that was never mounted, so saving a profile 404'd.
 * The only user-update path, `PUT /api/admin/users/:id`, writes the request
 * body straight into `users` — password, pin, username, defaultOrgId, the legal
 * acceptance flags — so it is not a safe thing to point a settings screen at.
 *
 * This takes an allow-list instead. Anything else in the body is rejected
 * rather than silently dropped, so a client that thinks it changed a field is
 * told it did not.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { users } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use 24-hour HH:MM");

function isIanaTimezone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

const nullableText = (max: number) =>
    z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

export const selfProfileUpdateSchema = z
    .object({
        firstName: nullableText(100),
        lastName: nullableText(100),
        slackHandle: nullableText(100),
        quietHoursEnabled: z.boolean().optional(),
        quietHoursStart: hhmm.nullable().optional(),
        quietHoursEnd: hhmm.nullable().optional(),
        quietHoursTimezone: z
            .string()
            .refine(isIanaTimezone, "Unknown timezone")
            .nullable()
            .optional(),
        // The web Profile form always sends the email it loaded. Accepted only
        // unchanged: login resolves by email, so a self-service change would
        // let two accounts answer to the same address.
        email: z.string().nullable().optional(),
    })
    .strict();

export type SelfProfileUpdate = Omit<z.infer<typeof selfProfileUpdateSchema>, "email">;

/**
 * Validates a self-service update against the user's current email. Pure, so
 * the rules are tested without a database.
 */
export function parseSelfProfileUpdate(body: unknown, currentEmail: string | null): SelfProfileUpdate {
    const parsed = selfProfileUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue.path.join(".") || undefined;
        const message = issue.code === "unrecognized_keys"
            ? `These fields cannot be changed here: ${(issue as any).keys.join(", ")}`
            : `${field ? field + ": " : ""}${issue.message}`;
        throw new BadRequestError(message);
    }
    const { email, ...rest } = parsed.data;
    if (email !== undefined && (email ?? null) !== (currentEmail ?? null)) {
        throw new BadRequestError("Email cannot be changed from your profile. Ask an administrator.");
    }
    if (rest.quietHoursEnabled === true && (rest.quietHoursStart === null || rest.quietHoursEnd === null)) {
        throw new BadRequestError("Quiet hours need a start and an end time.");
    }
    return rest;
}

/**
 * What an administrator may change on someone else's account through
 * PUT /api/admin/users/:id — exactly what the admin UserDetail page edits.
 * The route used to write the raw body, so an org admin (or a user editing
 * themselves) could set password, pin, username, defaultOrgId or the legal
 * acceptance flags. Credentials and identity go through their own flows.
 */
export const adminUserUpdateSchema = z
    .object({
        // The admin page sends "" for a user with no email; that means none, not
        // an invalid address, or no edit to such a user could ever be saved.
        email: z.preprocess(
            (v) => (typeof v === "string" && v.trim() === "" ? null : v),
            z.string().trim().email().nullable().optional(),
        ),
        firstName: nullableText(100),
        lastName: nullableText(100),
        slackHandle: nullableText(100),
        quietHoursEnabled: z.boolean().nullable().optional(),
        quietHoursStart: hhmm.nullable().optional(),
        quietHoursEnd: hhmm.nullable().optional(),
        quietHoursTimezone: z.string().refine(isIanaTimezone, "Unknown timezone").nullable().optional(),
        alertFilters: z.record(z.unknown()).nullable().optional(),
    })
    .strict();

export type AdminUserUpdate = z.infer<typeof adminUserUpdateSchema>;

export function parseAdminUserUpdate(body: unknown): AdminUserUpdate {
    const parsed = adminUserUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue.path.join(".") || undefined;
        throw new BadRequestError(
            issue.code === "unrecognized_keys"
                ? `These fields cannot be changed here: ${(issue as any).keys.join(", ")}`
                : `${field ? field + ": " : ""}${issue.message}`,
        );
    }
    return parsed.data;
}

export const selfProfileService = {
    async update(userId: string, body: unknown) {
        const [existing] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!existing) throw new NotFoundError("User not found");

        const updates = parseSelfProfileUpdate(body, existing.email);
        if (Object.keys(updates).length > 0) {
            await db.update(users).set(updates).where(eq(users.id, userId));
        }

        const [row] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                firstName: users.firstName,
                lastName: users.lastName,
                slackHandle: users.slackHandle,
                quietHoursEnabled: users.quietHoursEnabled,
                quietHoursStart: users.quietHoursStart,
                quietHoursEnd: users.quietHoursEnd,
                quietHoursTimezone: users.quietHoursTimezone,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row;
    },
};
