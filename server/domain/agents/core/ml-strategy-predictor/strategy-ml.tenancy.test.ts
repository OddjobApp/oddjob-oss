/**
 * Tenant isolation for the strategy predictor.
 *
 * Both halves of this service's learned state used to be shared across every
 * organization on the process:
 *
 *   1. retrainModel(orgId) assigned `this.featureWeights` on a singleton, so
 *      one tenant's retrain re-weighted every other tenant's predictions.
 *   2. loadHistoricalPerformance() selected from strategy_performance_logs with
 *      no WHERE clause at all, aggregating every tenant's outcomes into one map
 *      — and calculateConfidence() took an organizationId it never used, which
 *      is what kept the leak invisible at the call sites.
 *
 * Neither is visible in a single-tenant test, so these use two orgs with
 * deliberately different histories and assert one cannot be seen from the other.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG_A = 101;
const ORG_B = 202;

/** Performance rows per org. ORG_B deliberately has none. */
let logsByOrg: Record<number, any[]> = {};
/** Active registry row per org, if any. */
let activeVersionByOrg: Record<number, any | undefined> = {};

const inserted: Array<{ table: string; values: any }> = [];
const updated: Array<{ table: string; values: any }> = [];

const perfRow = (i: number, success: boolean) => ({
  id: i,
  strategy: "chain_of_thought",
  taskFeatures: { complexity: success ? 3 : 1, hasData: 1, riskLevel: 2 },
  success,
  qualityScore: success ? 0.9 : 0.2,
  executionTimeMs: 1000,
  tokenUsage: 100,
  correctionCount: 0,
  agentId: "agent-1",
  organizationId: 0,
  createdAt: new Date(),
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Markers rather than real SQL, so the fake db can see which org a query is
// scoped to. This is the whole point of the suite: an unfiltered query has no
// org marker, and is therefore detectable.
// Spread the real module and override only the comparators: the schema index
// needs relations(), pgTable() and friends to load at all.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  eq: (col: any, val: any) => ({ __eq: [col, val] }),
  and: (...conds: any[]) => ({ __and: conds }),
  desc: (c: any) => c,
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: { publish: vi.fn(async () => undefined) },
}));

const { strategyPerformanceLogs, strategyModelVersions } = await import("@shared/schema/index.js");

/** Pulls the organization id out of a captured where-clause tree, if present. */
function orgFrom(cond: any): number | null {
  if (!cond || typeof cond !== "object") return null;
  if (cond.__and) {
    for (const c of cond.__and) {
      const found = orgFrom(c);
      if (found !== null) return found;
    }
    return null;
  }
  if (cond.__eq) {
    const [col, val] = cond.__eq;
    if (col === strategyPerformanceLogs.organizationId || col === strategyModelVersions.organizationId) {
      return val as number;
    }
  }
  return null;
}

function makeSelectChain(projection: any) {
  let table: any = null;
  let org: number | null = null;
  let grouped = false;

  const chain: any = {
    from(t: any) { table = t; return chain; },
    where(c: any) { org = orgFrom(c); return chain; },
    groupBy() { grouped = true; return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    then(resolve: any, reject: any) {
      return Promise.resolve().then(() => {
        if (table === strategyModelVersions) {
          return org === null ? [] : [activeVersionByOrg[org]].filter(Boolean);
        }
        if (table === strategyPerformanceLogs) {
          // An unfiltered query sees every org — exactly the old bug. Modelled
          // faithfully so the test can catch it rather than assume it away.
          const rows = org === null
            ? Object.values(logsByOrg).flat()
            : (logsByOrg[org] ?? []);

          if (grouped) {
            const byStrategy = new Map<string, any[]>();
            for (const r of rows) {
              byStrategy.set(r.strategy, [...(byStrategy.get(r.strategy) ?? []), r]);
            }
            return [...byStrategy.entries()].map(([strategy, rs]) => ({
              strategy,
              totalUses: rs.length,
              successes: rs.filter(r => r.success).length,
              avgQuality: rs.reduce((s, r) => s + r.qualityScore, 0) / rs.length,
              avgTimeMs: rs.reduce((s, r) => s + r.executionTimeMs, 0) / rs.length,
            }));
          }

          // Aggregate projection (getHistoricalPerformance) vs raw row select.
          if (projection && "totalUses" in projection) {
            return [{
              totalUses: rows.length,
              successes: rows.filter(r => r.success).length,
              qualitySum: rows.reduce((s, r) => s + r.qualityScore, 0),
              avgTimeMs: 1000,
            }];
          }
          return rows;
        }
        return [];
      }).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@server/database_service.js", () => ({
  db: {
    select: (projection?: any) => makeSelectChain(projection),
    insert: (table: any) => ({
      values: async (values: any) => {
        inserted.push({ table: table === strategyModelVersions ? "versions" : "other", values });
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          updated.push({ table: table === strategyModelVersions ? "versions" : "other", values });
        },
      }),
    }),
  },
}));

const { StrategyMLService } = await import("./strategy-ml.service.js");

beforeEach(() => {
  logsByOrg = {};
  activeVersionByOrg = {};
  inserted.length = 0;
  updated.length = 0;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("learned weights do not cross tenants", () => {
  it("leaves another org on the defaults after a retrain", async () => {
    // ORG_A has plenty of history; ORG_B has none and has never been trained.
    logsByOrg[ORG_A] = Array.from({ length: 120 }, (_, i) => ({
      ...perfRow(i, i % 3 !== 0),
      organizationId: ORG_A,
    }));

    const service = new StrategyMLService();
    await service.retrainModel(ORG_A);

    const b = await service.exportModel(ORG_B);

    // The old singleton assigned this.featureWeights unconditionally, so ORG_B
    // would have been served ORG_A's trained weights here.
    expect(b.featureWeights.complexity).toBe(0.25);
    expect(b.featureWeights.hasData).toBe(0.15);
    expect(b.version).toBe("default");
  });

  it("does not let one org's outcomes appear in another's performance stats", async () => {
    logsByOrg[ORG_A] = Array.from({ length: 40 }, (_, i) => ({
      ...perfRow(i, true),
      organizationId: ORG_A,
    }));

    const service = new StrategyMLService();

    const a = await service.exportModel(ORG_A);
    const b = await service.exportModel(ORG_B);

    // Unfiltered, the aggregate query returned ORG_A's 40 rows to ORG_B too.
    expect(a.strategyPerformance.chain_of_thought?.totalUses).toBe(40);
    expect(b.strategyPerformance.chain_of_thought).toBeUndefined();
    expect(Object.keys(b.strategyPerformance)).toHaveLength(0);
  });
});

describe("trained weights survive a restart", () => {
  it("loads the active registry version rather than the defaults", async () => {
    activeVersionByOrg[ORG_A] = {
      version: "v101-trained",
      featureWeights: { complexity: 0.42, hasData: 0.05 },
      organizationId: ORG_A,
      isActive: true,
      createdAt: new Date(),
    };

    // A brand-new instance is exactly what a process restart produces.
    const service = new StrategyMLService();
    const a = await service.exportModel(ORG_A);

    expect(a.version).toBe("v101-trained");
    expect(a.featureWeights.complexity).toBe(0.42);
    expect(a.featureWeights.hasData).toBe(0.05);
    // Untouched features keep their default, rather than vanishing.
    expect(a.featureWeights.riskLevel).toBe(0.10);
  });

  it("keeps orgs on their own active version", async () => {
    activeVersionByOrg[ORG_A] = {
      version: "v101-trained",
      featureWeights: { complexity: 0.42 },
      organizationId: ORG_A,
      isActive: true,
      createdAt: new Date(),
    };

    const service = new StrategyMLService();
    const a = await service.exportModel(ORG_A);
    const b = await service.exportModel(ORG_B);

    expect(a.featureWeights.complexity).toBe(0.42);
    expect(b.featureWeights.complexity).toBe(0.25);
  });
});

describe("activation is earned, not assumed", () => {
  it("refuses to activate on too little validation data", async () => {
    // 12 records => 3 held out, below MIN_VALIDATION_RECORDS.
    logsByOrg[ORG_A] = Array.from({ length: 12 }, (_, i) => ({
      ...perfRow(i, i % 2 === 0),
      organizationId: ORG_A,
    }));

    const service = new StrategyMLService();
    const result = await service.retrainModel(ORG_A);

    expect(result.success).toBe(true);
    expect(result.activated).toBe(false);
    expect(result.version).toBe("default");
    // Nothing may be written to the registry when nothing was activated.
    expect(inserted.filter(i => i.table === "versions")).toHaveLength(0);
  });

  it("reports a real number rather than a fixed 0.05", async () => {
    // Success is uncorrelated with every feature, so there is no genuine
    // improvement to be had and the delta must not be a positive constant.
    logsByOrg[ORG_A] = Array.from({ length: 120 }, (_, i) => ({
      ...perfRow(i, i % 2 === 0),
      taskFeatures: { complexity: 2, hasData: 1, riskLevel: 2 },
      organizationId: ORG_A,
    }));

    const service = new StrategyMLService();
    const result = await service.retrainModel(ORG_A);

    expect(result.accuracyImprovement).not.toBe(0.05);
    expect(Number.isFinite(result.accuracyImprovement)).toBe(true);
  });
});
