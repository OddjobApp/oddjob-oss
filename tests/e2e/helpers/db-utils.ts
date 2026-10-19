import dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../shared/schema/index.js';

dotenv.config();

/**
 * Direct database access for E2E specs.
 *
 * Some flows are asynchronous and have no UI or API surface that reports
 * completion — a background worker writes a row and nothing tells the browser.
 * `waitForDbState` polls the database for that row instead of sleeping and
 * hoping, which is both faster and far less flaky.
 *
 * The connection is separate from the application's pool and read-only by
 * convention: assert on state here, drive changes through the UI or API so the
 * test still exercises the real code path.
 *
 * IMPORTANT: DATABASE_URL must point at the same database the server under test
 * is using, or every predicate will poll an empty database until it times out.
 */

/** The drizzle client, with schema tables reachable directly (`db.evaluationResults`). */
export type TestDb = ReturnType<typeof drizzle<typeof schema>> & typeof schema;

let pool: Pool | null = null;
let cachedDb: TestDb | null = null;

/**
 * Lazily open the test database connection.
 *
 * Exposed for specs that want to query directly; most should prefer
 * `waitForDbState`, which handles polling and failure reporting.
 */
export function getTestDb(): TestDb {
  if (cachedDb) return cachedDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. E2E specs that assert on database state need it ' +
      'to point at the same database the server under test is using.',
    );
  }

  pool = new Pool({ connectionString, max: 2 });
  const base = drizzle(pool, { schema });

  // Fall through to the schema so both `db.query.evaluationResults.findFirst()`
  // and `db.evaluationResults` (the raw table, for db.select()) resolve.
  cachedDb = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in (target as object)) return Reflect.get(target as object, prop, receiver);
      return (schema as Record<string | symbol, unknown>)[prop as string];
    },
  }) as TestDb;

  return cachedDb;
}

/**
 * Close the connection. Call from `test.afterAll` in any spec that used this
 * helper — an open pool keeps the Playwright worker process alive after the
 * run finishes.
 */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    cachedDb = null;
  }
}

export interface WaitForDbStateOptions {
  /** Give up after this long, ms. Default 30000. */
  timeoutMs?: number;
  /** Delay between polls, ms. Default 1000. */
  intervalMs?: number;
}

/**
 * Poll `predicate` until it returns true, or fail with `description`.
 *
 * Errors thrown inside the predicate are treated as "not ready yet" and
 * retried — a table may not have rows, or a relation may not exist, early in a
 * run. The last such error is reported if the wait times out, so a genuinely
 * broken query still surfaces rather than looking like a timeout.
 *
 * @example
 * await waitForDbState(
 *   async (db) => {
 *     const row = await db.query.evaluationResults.findFirst({
 *       where: (f, { and, eq }) => and(eq(f.harnessId, 'incident-response'), eq(f.status, 'fail')),
 *     });
 *     return row !== undefined;
 *   },
 *   'a failed incident evaluation result',
 * );
 */
export async function waitForDbState(
  predicate: (db: TestDb) => Promise<boolean>,
  description: string,
  options: WaitForDbStateOptions = {},
): Promise<void> {
  const { timeoutMs = 30_000, intervalMs = 1_000 } = options;
  const db = getTestDb();
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      if (await predicate(db)) return;
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  const suffix = lastError
    ? ` Last error from the predicate: ${(lastError as Error)?.message ?? String(lastError)}`
    : '';
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.${suffix}`);
}
