// @vitest-environment node
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public trust page publishes only what the evidence supports. An idle
 * component is "unverified", not an outage; two jobs are not "100% uptime"; and a
 * healthy, busy hour is "operational" (it never could be before).
 */
const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>> }));
vi.mock("@server/database_service.js", () => {
    const dialect = new PgDialect();
    // Answer each query by what it reads, as Postgres would for that data.
    const answer = (query: any) => {
        const text = dialect.sqlToQuery(query).sql;
        const pick = (key: string) => ({ rows: [state.rows[key] ?? {}] });
        if (text.includes("INTERVAL '90 days'")) return pick("uptime");
        if (text.includes("python_sidecar")) return pick("kg");
        if (text.includes("FROM integration_logs") && text.includes("INTERVAL '1 hour'")) return pick("gateway");
        if (text.includes("FROM integration_logs")) return pick("integration24h");
        if (text.includes("'ai_api_call'")) return pick("ai");
        if (text.includes("FROM forensic_event_log") && text.includes("failures")) return pick("hour");
        if (text.includes("FROM forensic_event_log") && text.includes("job_type IN")) return { rows: [] };
        if (text.includes("FROM forensic_event_log") && text.includes("INTERVAL '24 hours'")) return pick("day");
        if (text.includes("FROM mission_runs")) return pick("missions");
        return { rows: [] };
    };
    return { db: { execute: vi.fn(async (q: unknown) => answer(q)) } };
});
vi.mock("@domain/sdlc-pipeline/autonomous/e2e-test-indexer.service.js", () => ({
    e2eTestIndexerService: { loadManifestV2: async () => ({ schemaVersion: 2, tests: [], suites: [] }) },
}));
import router from "./public.js";

function app() {
    const server = express();
    server.use("/api/public", router);
    return server;
}
const trust = async () => (await request(app()).get("/api/public/trust")).body.data;

describe("GET /api/public/trust", () => {
    beforeEach(() => { state.rows = {}; });

    it("calls idle components unverified instead of detecting issues", async () => {
        state.rows = {
            hour: { total: 0, failures: 0 },
            ai: { total: 0, success_rate: null }, kg: { total: 0, success_rate: null }, gateway: { total: 0, success_rate: null },
        };
        const data = await trust();
        expect(data.status).toBe("unverified");
        expect(new Set(data.components.map((c: any) => c.status))).toEqual(new Set(["unverified"]));
    });

    it("does not turn a handful of events into a percentage, and says how many it has", async () => {
        state.rows = {
            uptime: { total: 2, uptime_90d: "100.00" },
            day: { total_jobs: 2, success_rate: "100.00" },
            integration24h: { total_calls: 3, success_rate: "100.00" },
        };
        const data = await trust();
        expect(data.uptime_90d).toBeNull();
        expect(data.metrics.success_rate_24h).toBeNull();
        expect(data.metrics.integration_success_rate_24h).toBeNull();
        expect(data.metrics.jobs_processed_24h).toBe(2);
        expect(data.samples).toMatchObject({ events_90d: 2, jobs_24h: 2, integration_calls_24h: 3 });
    });

    it("reports a healthy, busy hour as operational, with measured rates", async () => {
        state.rows = {
            hour: { total: 40, failures: 1 },
            uptime: { total: 900, uptime_90d: "99.40" },
            day: { total_jobs: 120, success_rate: "98.50" },
            ai: { total: 12, success_rate: "100.00" }, gateway: { total: 30, success_rate: "96.70" },
        };
        const data = await trust();
        expect(data.status).toBe("operational");
        expect(data.uptime_90d).toBe(99.4);
        expect(data.metrics.success_rate_24h).toBe(98.5);
        expect(data.components.find((c: any) => c.name === "AI Inference Engine").status).toBe("operational");
        expect(data.components.find((c: any) => c.name === "Knowledge Graph").status).toBe("unverified");
    });

    it("still reports a real outage when there is enough evidence for one", async () => {
        state.rows = { hour: { total: 20, failures: 10 }, gateway: { total: 20, success_rate: "50.00" } };
        const data = await trust();
        expect(data.status).toBe("outage");
        expect(data.components.find((c: any) => c.name === "API Gateway").status).toBe("outage");
    });
});
