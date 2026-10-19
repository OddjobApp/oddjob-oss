import { inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { users } from "@shared/schema/auth.js";

/**
 * Names people recognise, for user ids. The Forms library and a form's history
 * showed raw ids ("by 6dd9d48b-0ac8-…").
 */
export async function userDisplayNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!wanted.length) return new Map();
    const rows = await db
        .select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, wanted));
    return new Map(rows.map((row) => [row.id, [row.firstName, row.lastName].filter(Boolean).join(" ") || row.username]));
}
