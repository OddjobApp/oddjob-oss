/**
 * Internal Event Sources API & Status Aggregation Integration Tests
 * Validates internal event feed configuration, catalog status formatting,
 * and tenant isolation.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";
import { INTERNAL_EVENT_CATEGORIES } from "../../api/internal-event-sources.routes.js";

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl });

const orgs = {
  orgA: 0,
  orgB: 0,
};

const suffix = Date.now();

beforeAll(async () => {
  const a = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `internal-events-a-${suffix}`,
  ]);
  orgs.orgA = a.rows[0].org_id;

  const b = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `internal-events-b-${suffix}`,
  ]);
  orgs.orgB = b.rows[0].org_id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM orgs WHERE org_id = ANY($1::int[])`, [[orgs.orgA, orgs.orgB]]);
  await pool.end();
});

describe("Internal Event Sources & Catalog Status", () => {
  it("defines standard event triggers across all four core categories", () => {
    expect(INTERNAL_EVENT_CATEGORIES.cycle_events).toContain("cycle_phase_changed");
    expect(INTERNAL_EVENT_CATEGORIES.cycle_events).toContain("cycle_failed");
    expect(INTERNAL_EVENT_CATEGORIES.mission_events).toContain("mission_started");
    expect(INTERNAL_EVENT_CATEGORIES.deliverable_events).toContain("deliverable_created");
    expect(INTERNAL_EVENT_CATEGORIES.agent_events).toContain("task_completed");
  });

  it("persists internal event source feed and tracks category triggers", async () => {
    const insertRes = await pool.query(
      `INSERT INTO signal_feeds (organization_id, name, source_type, url, polling_interval_seconds, enabled, auth_credentials)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, source_type, auth_credentials`,
      [
        orgs.orgA,
        "Cycle Monitor Feed",
        "internal_event",
        "internal://cycle_events",
        60,
        true,
        JSON.stringify({
          internalSourceType: "cycle_events",
          eventTriggers: ["cycle_phase_changed", "cycle_failed"],
          filters: { minimumSeverity: "High" },
        }),
      ],
    );

    expect(insertRes.rows.length).toBe(1);
    const feed = insertRes.rows[0];
    expect(feed.source_type).toBe("internal_event");
    expect(feed.auth_credentials.internalSourceType).toBe("cycle_events");
    expect(feed.auth_credentials.eventTriggers).toEqual(["cycle_phase_changed", "cycle_failed"]);
  });

  it("enforces tenant isolation between distinct organizations", async () => {
    // Org A feed created in previous test
    const orgAFeeds = await pool.query(
      `SELECT * FROM signal_feeds WHERE organization_id = $1 AND source_type = 'internal_event'`,
      [orgs.orgA],
    );
    expect(orgAFeeds.rows.length).toBe(1);

    // Org B should have zero feeds
    const orgBFeeds = await pool.query(
      `SELECT * FROM signal_feeds WHERE organization_id = $1 AND source_type = 'internal_event'`,
      [orgs.orgB],
    );
    expect(orgBFeeds.rows.length).toBe(0);
  });
});
