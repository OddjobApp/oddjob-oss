import { sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/index.js";

/**
 * Provision organizations at fixed ids for a suite, and keep the orgs sequence
 * ahead of them.
 *
 * An explicit id does not advance the serial sequence. Suites that inserted fixed
 * ids left it behind, so the next suite to create an org the normal way was handed
 * an id that already existed and failed on orgs_pkey — or not, depending on which
 * suites ran first. scripts/setup-test-db.ts already advances the sequence after
 * seeding org 1; this does the same for every suite that pins its own orgs.
 */
export async function ensureFixtureOrgs(fixtures: ReadonlyArray<readonly [id: number, name: string]>): Promise<void> {
    for (const [id, name] of fixtures) {
        await db.insert(orgs).values({ id, name }).onConflictDoNothing();
    }
    await db.execute(sql`
        SELECT setval(
            pg_get_serial_sequence('orgs', 'org_id'),
            GREATEST((SELECT COALESCE(MAX(org_id), 1) FROM orgs), 1)
        )
    `);
}
