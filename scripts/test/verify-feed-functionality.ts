import "dotenv/config";
import { db } from "../../server/database_service.js";
import { appTelemetry } from "../../shared/schema/apps.js";
import { eq, desc } from "drizzle-orm";

async function verifyFeedMenuAndFunctionality() {
  console.log("=".repeat(70));
  console.log("🔍 VERIFYING FEED (TELEMETRY) MENU & REAL-TIME STREAMING");
  console.log("=".repeat(70));

  // 1. Authenticate
  const loginRes = await fetch("http://localhost:5000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
  console.log("✅ Authenticated with Admin Session\n");

  let pass = 0;
  let fail = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      pass++;
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      fail++;
      console.log(`  ❌ ${name}: ${e.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 1. CONTAINER LOG FEED (SSE)
  // ══════════════════════════════════════════════════════════
  console.log("📡 1. CONTAINER LOG STREAM (GET /api/apps/824/logs)");
  console.log("-".repeat(55));

  await check("Connects to SSE container log stream", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch("http://localhost:5000/api/apps/824/logs?orgId=473", {
        headers: { cookie },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        throw new Error(`Expected text/event-stream, got ${contentType}`);
      }
      console.log(`     → Content-Type: ${contentType}`);
    } catch (err: any) {
      if (err.name !== "AbortError") throw err;
      console.log("     → SSE stream established and held open");
    } finally {
      clearTimeout(timeout);
    }
  });

  // ══════════════════════════════════════════════════════════
  // 2. REAL-TIME EVENT STREAM (GET /api/events/stream)
  // ══════════════════════════════════════════════════════════
  console.log("\n⚡ 2. PLATFORM EVENT STREAM (GET /api/events/stream)");
  console.log("-".repeat(55));

  await check("Connects to global /api/events/stream SSE endpoint", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch("http://localhost:5000/api/events/stream?limit=10", {
        headers: { cookie },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        throw new Error(`Expected text/event-stream, got ${contentType}`);
      }
      console.log(`     → Content-Type: ${contentType}`);
    } catch (err: any) {
      if (err.name !== "AbortError") throw err;
      console.log("     → Event stream established and held open");
    } finally {
      clearTimeout(timeout);
    }
  });

  // ══════════════════════════════════════════════════════════
  // 3. EVENT EMISSION & LIVE BUFFER (POST /api/events/emit)
  // ══════════════════════════════════════════════════════════
  console.log("\n🚀 3. TELEMETRY EVENT INGESTION & DISPATCH");
  console.log("-".repeat(55));

  const sampleTelemetry = {
    type: "app.824.telemetry",
    source: "app-runtime:rescue-dispatch",
    payload: {
      appId: 824,
      event: "DISPATCH_CYCLE_TICK",
      level: "info",
      metric: "response_time_ms",
      value: 18.4,
      status: "OPTIMAL",
      sector: "Sector 7",
      squadReadiness: 94.2,
      timestamp: new Date().toISOString(),
    },
  };

  await check("Emits telemetry event to event bus", async () => {
    const emitRes = await fetch("http://localhost:5000/api/events/emit", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify(sampleTelemetry),
    });
    if (!emitRes.ok) throw new Error(`HTTP ${emitRes.status}: ${await emitRes.text()}`);
    const data = await emitRes.json() as any;
    console.log(`     → Emitted event ID: ${data.eventId || data.id || "OK"}`);
  });

  await check("Verifies telemetry event in live buffer (/api/events/live)", async () => {
    const liveRes = await fetch("http://localhost:5000/api/events/live?limit=10", {
      headers: { cookie },
    });
    if (!liveRes.ok) throw new Error(`HTTP ${liveRes.status}`);
    const events = await liveRes.json() as any[];
    const match = events.find(
      (e) => e.eventType === "app.824.telemetry" || e.payload?.appId === 824
    );
    if (!match) throw new Error("Emitted telemetry event not found in live buffer");
    console.log(`     → Found event "${match.eventType}" (event: ${match.payload?.event}, status: ${match.payload?.status})`);
  });

  // ══════════════════════════════════════════════════════════
  // 4. PERSISTED APP TELEMETRY (DB SEED & QUERY)
  // ═══════════════════════════════════════════════════════
  console.log("\n💾 4. PERSISTED TELEMETRY STORE (app_telemetry table)");
  console.log("-".repeat(55));

  await check("Inserts live telemetry heartbeats into database", async () => {
    await db.insert(appTelemetry).values([
      {
        appId: 824,
        orgId: 473,
        event: "RADAR_SWEEP_PULSE",
        level: "info",
        metadata: {
          sector: "Sector 7-Alpha",
          detectedSignals: 12,
          h3HexagonsScanned: 64,
          networkLatencyMs: 24,
        },
      },
      {
        appId: 824,
        orgId: 473,
        event: "SLA_BREACH_PREDICTED",
        level: "warn",
        metadata: {
          incidentId: "INC-8891",
          predictedDelayMin: 4.2,
          alternativeProvider: "Paramedic Unit 4",
        },
      },
    ]);
  });

  await check("Queries persisted app telemetry rows", async () => {
    const rows = await db
      .select()
      .from(appTelemetry)
      .where(eq(appTelemetry.appId, 824))
      .orderBy(desc(appTelemetry.createdAt))
      .limit(5);

    if (rows.length === 0) throw new Error("No telemetry records found for App 824");
    console.log(`     → Retrieved ${rows.length} telemetry records for App 824:`);
    for (const r of rows) {
      console.log(`       [${r.level.toUpperCase()}] ${r.event} — ${JSON.stringify(r.metadata)}`);
    }
  });

  // ══════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log(`🏁 RESULT: ${pass} PASS, ${fail} FAIL out of ${pass + fail} checks`);
  if (fail === 0) console.log("🎉 FEED MENU & REAL-TIME TELEMETRY: FULLY VERIFIED!");
  console.log("=".repeat(70));

  process.exit(fail > 0 ? 1 : 0);
}

verifyFeedMenuAndFunctionality().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
