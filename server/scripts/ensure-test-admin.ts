/**
 * Ensure the integration-test admin account exists in the TEST database.
 *
 * HTTP integration suites (e.g. selenium-autopilot) authenticate through the
 * real `/api/login`, so they need a real account. `oddjob_test` is provisioned
 * by `npm run test:db:setup` with schema only, so that account does not exist
 * and every such suite fails at login.
 *
 * Why this rather than `npm run db:seed`: the seed TRUNCATEs 14 tables. The test
 * database is not empty scratch space — it accumulates fixtures that other
 * integration suites depend on (122 users / 39 orgs at time of writing), and
 * wiping it to add one row would be a destructive fix for an additive problem.
 * This script only inserts what is missing and is safe to re-run.
 *
 * Credentials match tests/e2e/auth.setup.ts so both paths share one account.
 *
 * Usage:
 *   npx tsx server/scripts/ensure-test-admin.ts
 */
import "dotenv/config";
import { Client } from "pg";
import { hashPassword } from "../domain/auth/index.js";

const USERNAME = process.env.TEST_USER_EMAIL || "admin@example.com";
const PASSWORD = process.env.TEST_USER_PASSWORD || "password123";

async function main() {
    const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    // Hard guard. This script creates a known-password admin account, so it must
    // never be able to run against a development or production database.
    if (!url) throw new Error("No TEST_DATABASE_URL/DATABASE_URL configured.");
    const dbName = new URL(url).pathname.slice(1);
    if (!/test/i.test(dbName)) {
        throw new Error(
            `Refusing to run against "${dbName}" — this script only targets a test database ` +
            `(name must contain "test"). It creates an account with a well-known password.`
        );
    }

    const client = new Client({ connectionString: url });
    await client.connect();

    try {
        const { rows: existing } = await client.query(
            "SELECT id, default_org_id FROM users WHERE username = $1 LIMIT 1",
            [USERNAME]
        );

        // Reuse any org so the session gets a usable organization context;
        // create one only if the database has none at all.
        // NB: the orgs primary key column is `org_id`, not `id` — the Drizzle
        // model aliases it (`id: serial("org_id")`), so raw SQL must use org_id.
        let orgId: number;
        const { rows: orgRows } = await client.query("SELECT org_id FROM orgs ORDER BY org_id LIMIT 1");
        if (orgRows.length > 0) {
            orgId = orgRows[0].org_id;
        } else {
            const { rows: created } = await client.query(
                "INSERT INTO orgs (name) VALUES ($1) RETURNING org_id",
                ["Integration Test Org"]
            );
            orgId = created[0].org_id;
            console.log(`  Created org ${orgId} (database had none)`);
        }

        // Hash via the app's own helper so the format always matches what
        // authEngine.login verifies against.
        const passwordHash = await hashPassword(PASSWORD);

        let userId: string;
        if (existing.length > 0) {
            userId = existing[0].id;
            await client.query(
                "UPDATE users SET password = $1, default_org_id = COALESCE(default_org_id, $2) WHERE id = $3",
                [passwordHash, orgId, userId]
            );
            console.log(`  Updated existing user "${USERNAME}" (${userId})`);
        } else {
            const { rows: created } = await client.query(
                `INSERT INTO users (username, password, email, first_name, last_name, default_org_id)
                 VALUES ($1, $2, $3, 'Integration', 'Test', $4) RETURNING id`,
                [USERNAME, passwordHash, USERNAME, orgId]
            );
            userId = created[0].id;
            console.log(`  Created user "${USERNAME}" (${userId})`);
        }

        const { rows: role } = await client.query(
            "SELECT id FROM admin_roles WHERE user_id = $1 LIMIT 1",
            [userId]
        );
        if (role.length === 0) {
            await client.query(
                "INSERT INTO admin_roles (user_id, role, organization_id) VALUES ($1, 'super_admin', NULL)",
                [userId]
            );
            console.log(`  Granted super_admin`);
        }

        console.log(`\n✅ Test admin ready in "${dbName}": ${USERNAME} / ${PASSWORD}\n`);
    } finally {
        await client.end();
    }
}

main()
    .then(() => {
        // Importing the app's password helper initialises the pod registry, the
        // Redis client and the DB pool as a side effect, and those open handles
        // keep the event loop alive indefinitely. Exit explicitly rather than
        // waiting for a natural drain that never comes.
        process.exit(0);
    })
    .catch((err) => {
        console.error(`\n❌ ${err.message}\n`);
        process.exit(1);
    });
