import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import { configureTestEnvironment } from "../../configure-test-environment.js";
import { hashPassword } from "../../../server/domain/auth/index.js";

/**
 * Ensures the spatial-signal suite has an organisation and an admin to act as,
 * before the server or any spec starts.
 *
 * `npm run test:db:setup` provisions the schema and org 1, but no user — and the
 * suite authenticates through `/api/login` like a real operator rather than
 * forging a session, so a real row has to exist. Doing it here rather than in a
 * spec means a failure reads as "the environment is wrong", not as a test
 * failure in whichever scenario happened to run first.
 *
 * Idempotent: re-running resets the password rather than colliding on the
 * unique email, so a developer who has poked at the test database still gets a
 * working login.
 */

loadEnv({ path: ".env.test", override: true });

export const SIGNAL_E2E_USER = {
  email: "admin@example.com",
  username: "signal-e2e-admin",
  password: "password123",
};

export default async function globalSetup(): Promise<void> {
  const { databaseUrl } = configureTestEnvironment();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    const org = await pool.query(
      `INSERT INTO orgs (org_id, name) VALUES (1, 'Test Organization')
       ON CONFLICT (org_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING org_id`,
    );
    const orgId: number = org.rows[0].org_id;

    const hashed = await hashPassword(SIGNAL_E2E_USER.password);

    // Matched on email because that is what /api/login resolves against, and it
    // is the column the dev-side ensure-admin script keys on too.
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
      SIGNAL_E2E_USER.email,
    ]);

    // users.id is text (uuid default), not serial.
    let userId: string;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      await pool.query(`UPDATE users SET password = $1, default_org_id = $2 WHERE id = $3`, [
        hashed,
        orgId,
        userId,
      ]);
    } else {
      const created = await pool.query(
        `INSERT INTO users (username, password, email, first_name, last_name, default_org_id, quiet_hours_enabled)
         VALUES ($1,$2,$3,'Signal','E2E',$4,false) RETURNING id`,
        [SIGNAL_E2E_USER.username, hashed, SIGNAL_E2E_USER.email, orgId],
      );
      userId = created.rows[0].id;
    }

    await pool.query(
      `INSERT INTO user_orgs (user_id, org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [userId, orgId],
    );

    // Cycle pause/resume/approve routes are gated behind requireOrgAdminOrSuper.
    // Scenarios 4, 6 and 7 drive those, so the fixture user needs the role or
    // half the suite fails on 403 rather than on anything meaningful.
    await pool.query(
      `INSERT INTO admin_roles (user_id, role, organization_id)
       VALUES ($1,'super_admin',NULL) ON CONFLICT DO NOTHING`,
      [userId],
    );

    console.log(
      `[signal-e2e] ready: org ${orgId}, user ${userId} (${SIGNAL_E2E_USER.email}) on ${
        new URL(databaseUrl).pathname
      }`,
    );
  } finally {
    await pool.end();
  }
}
