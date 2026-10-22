import dotenv from "dotenv";
dotenv.config();
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema/index.js";
import { createLogger } from "./utils/logger.js";
import { registerSealedJsonCodec } from "@shared/schema/sealed-json.js";
import { encrypt, decrypt } from "./utils/encryption.js";

// Sealed columns (SaaS connector credentials) encrypt with the platform key ring.
registerSealedJsonCodec({ seal: (plaintext) => encrypt(plaintext), open: (ciphertext) => decrypt(ciphertext) });

const logger = createLogger("Database");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Configurable pool settings via environment variables
const POOL_CONFIG = {
  max: parseInt(process.env.DB_POOL_MAX || '30', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
  allowExitOnIdle: process.env.DB_ALLOW_EXIT_ON_IDLE === 'true',
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10), // Query timeout
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '35000', 10), // Client query timeout
  /*
    TCP keepalive on every pooled socket.

    Without it a pooled connection can be silently dead long before anyone
    notices: Postgres logs nothing (it never closed anything), the socket just
    stops existing at the network layer — Docker Desktop's port forward drops
    idle forwarded connections, and a host sleep/resume kills all of them. The
    pool does not validate a client on checkout, so the next query goes out on a
    dead socket and fails with `read ECONNRESET`.

    That surfaced as the whole site 500ing: the session store shares this pool,
    so the failure landed in express-session, before any route, and every page
    load returned a JSON error instead of HTML.

    Keepalive probes keep the forward from treating the connection as idle, and
    make a genuinely dead peer fail fast enough for the pool to evict the client
    rather than hand it to a request.
  */
  keepAlive: process.env.DB_KEEPALIVE !== 'false',
  keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY_MS || '10000', 10),
};

// Slow query threshold for logging (default: 1000ms)
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.DB_SLOW_QUERY_THRESHOLD_MS || '1000', 10);

const DB_URL = (process.env.DATABASE_URL || '').trim();

// Create connection pool with proper configuration
export let pool = new Pool({
  connectionString: DB_URL,
  ...POOL_CONFIG,
});

// Set up error handling for the pool
pool.on('error', (err) => {
  logger.error('[Database] Unexpected error on idle client', err);
});

export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    activeCount: pool.totalCount - pool.idleCount,
  };
}

const METRICS_INTERVAL_MS = parseInt(process.env.DB_METRICS_INTERVAL_MS || '60000', 10);
let metricsInterval: NodeJS.Timeout | null = null;

export function startPoolMetricsLogging() {
  if (metricsInterval) return;
  if (process.env.DB_METRICS_ENABLED === 'true') {
    metricsInterval = setInterval(() => {
      const metrics = getPoolMetrics();
      logger.info(`[Database] Pool metrics: total=${metrics.totalCount}, active=${metrics.activeCount}, idle=${metrics.idleCount}, waiting=${metrics.waitingCount}`);
    }, METRICS_INTERVAL_MS);
  }
}

export function stopPoolMetricsLogging() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}

export async function checkDatabaseConnection(): Promise<{ connected: boolean; error?: string; metrics?: ReturnType<typeof getPoolMetrics> }> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { connected: true, metrics: getPoolMetrics() };
    } finally {
      client.release();
    }
  } catch (error: any) {
    return { connected: false, error: error.message || 'Unknown database connection error' };
  }
}

// Re-initialize for tests
export function reinitializeDatabase() {
  const newUrl = (process.env.DATABASE_URL || '').trim();
  pool.end().catch(() => {});
  pool = new Pool({
    connectionString: newUrl,
    ...POOL_CONFIG,
  });
  (db as any) = drizzle(pool, { schema });
}

// Test connection on module load (non-blocking)
if (process.env.NODE_ENV !== 'test') {
  checkDatabaseConnection().then(result => {
    if (result.connected) {
      logger.info('[Database] ✅ Connection pool initialized');
      startPoolMetricsLogging();
    }
  }).catch(() => {});
}

export let db = drizzle(pool, { schema });

// Query performance monitoring
interface QueryMetrics {
  sql: string;
  duration: number;
  slow: boolean;
}

const queryMetrics: QueryMetrics[] = [];
const MAX_QUERY_METRICS = 100;

/**
 * Execute a query with performance monitoring
 * Logs slow queries exceeding SLOW_QUERY_THRESHOLD_MS
 */
export async function monitoredQuery<T>(
  sql: string,
  params?: unknown[],
  operationName?: string
): Promise<T> {
  const start = performance.now();
  const client = await pool.connect();

  try {
    const result = await client.query(sql, params);
    const duration = performance.now() - start;

    const metric: QueryMetrics = {
      sql: operationName || sql.substring(0, 100),
      duration,
      slow: duration > SLOW_QUERY_THRESHOLD_MS,
    };

    // Keep only last N metrics
    queryMetrics.push(metric);
    if (queryMetrics.length > MAX_QUERY_METRICS) {
      queryMetrics.shift();
    }

    if (metric.slow) {
      logger.warn(`[Database] Slow query detected (${duration.toFixed(2)}ms): ${operationName || sql.substring(0, 100)}`);
    }

    return result.rows as T;
  } finally {
    client.release();
  }
}

/**
 * Get query performance statistics
 */
export function getQueryMetrics() {
  const slowQueries = queryMetrics.filter(q => q.slow);
  const avgDuration = queryMetrics.length > 0
    ? queryMetrics.reduce((sum, q) => sum + q.duration, 0) / queryMetrics.length
    : 0;

  return {
    totalQueries: queryMetrics.length,
    slowQueryCount: slowQueries.length,
    slowQueryRate: queryMetrics.length > 0 ? (slowQueries.length / queryMetrics.length) * 100 : 0,
    averageDuration: avgDuration,
    maxDuration: queryMetrics.length > 0 ? Math.max(...queryMetrics.map(q => q.duration)) : 0,
    recentSlowQueries: slowQueries.slice(-10),
  };
}

/**
 * Reset query metrics (useful for testing)
 */
export function resetQueryMetrics() {
  queryMetrics.length = 0;
}
