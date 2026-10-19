/**
 * Backfills user_orgs from evidence, so membership can be enforced without locking
 * people out.
 *
 * getUserOrgContext accepts a caller-supplied organizationId with no membership check —
 * ?orgId=, x-organization-id, or organizationId in the body — and that value scopes
 * every tenant query in the codebase. Closing it means requiring a user_orgs row, and
 * user_orgs holds 5 rows across 26 users. Enforcing against that today would lock most
 * people out of orgs they demonstrably work in.
 *
 * So membership is derived from what users have actually DONE: rows they created in an
 * org, projects they own, and their own default org. That is evidence of legitimate
 * access rather than a guess, and it is deliberately conservative — it grants nothing
 * a user has not already used.
 *
 * It is NOT a substitute for the real membership list. Anyone who has an org but never
 * created anything in it will be missing, which is exactly what the
 * cross_org_access_would_be_denied log in auth-context.ts is there to reveal. Run this,
 * then watch that log before enforcing.
 *
 * Usage:
 *   npx tsx scripts/backfill-user-orgs.ts            # report only
 *   npx tsx scripts/backfill-user-orgs.ts --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/database_service.js";

const APPLY = process.argv.includes("--apply");

/**
 * Joined to users and orgs so a row whose creator or org has since been deleted cannot
 * produce a membership pointing at nothing — user_orgs has FKs to both.
 */
const EVIDENCE = sql`
    with evidence as (
        select created_by as user_id, organization_id as org_id from crew_sessions where created_by is not null and organization_id is not null
        union select created_by, organization_id from pipelines where created_by is not null and organization_id is not null
        union select created_by, organization_id from missions  where created_by is not null and organization_id is not null
        union select created_by, organization_id from apps      where created_by is not null and organization_id is not null
        union select owner_user_id, organization_id from projects where owner_user_id is not null and organization_id is not null
        union select id, default_org_id from users where default_org_id is not null
    )
    select e.user_id, e.org_id
    from evidence e
    join users u on u.id = e.user_id
    join orgs  o on o.org_id = e.org_id
    where not exists (
        select 1 from user_orgs uo where uo.user_id = e.user_id and uo.org_id = e.org_id
    )
    order by e.user_id, e.org_id
`;

async function main() {
    const rows = (await db.execute(EVIDENCE)).rows as Array<{ user_id: string; org_id: number }>;

    if (rows.length === 0) {
        console.log("Every evidenced membership is already present in user_orgs. Nothing to do.");
        process.exit(0);
    }

    const byUser = new Map<string, number[]>();
    for (const r of rows) {
        byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.org_id]);
    }

    console.log(`${rows.length} evidenced membership(s) missing, across ${byUser.size} user(s):`);
    for (const [userId, orgIds] of byUser) {
        console.log(`  ${userId} -> org ${orgIds.join(", ")}`);
    }

    if (!APPLY) {
        console.log("\nReport only. Re-run with --apply to insert these rows.");
        process.exit(0);
    }

    // ON CONFLICT DO NOTHING: the primary key is (user_id, org_id), and a concurrent
    // run or a partially-applied earlier run must not fail the whole backfill.
    await db.execute(sql`
        insert into user_orgs (user_id, org_id)
        select e.user_id, e.org_id from (${EVIDENCE}) e
        on conflict (user_id, org_id) do nothing
    `);

    const [{ total }] = (await db.execute(sql`select count(*)::int as total from user_orgs`)).rows as Array<{ total: number }>;
    console.log(`\nInserted. user_orgs now holds ${total} row(s).`);
    console.log("Do NOT enable enforcement yet — watch cross_org_access_would_be_denied first.");
    process.exit(0);
}

main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
