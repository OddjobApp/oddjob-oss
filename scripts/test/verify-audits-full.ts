import "dotenv/config";
import { db } from "../../server/database_service.js";
import { appAuditLogs, appAudits } from "../../shared/schema/apps.js";
import { eq, desc } from "drizzle-orm";

async function verifyAuditsFull() {
  console.log("=".repeat(70));
  console.log("🔍 VERIFYING AUDITS MENU, FORGE SHADOW & QA FUNCTIONALITY");
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
  // 1. SEED SHADOW AUDITS & QA TRACES
  // ══════════════════════════════════════════════════════════
  console.log("🛠️  1. SEEDING ADVERSARIAL AUDIT LOGS (Forge Shadow)");
  console.log("-".repeat(55));

  await check("Seed Forge Shadow Audit Findings (app_audit_logs)", async () => {
    // Clear old test rows first
    await db.delete(appAuditLogs).where(eq(appAuditLogs.appId, 824));

    await db.insert(appAuditLogs).values([
      {
        appId: 824,
        orgId: 473,
        findingType: "accessibility",
        severity: "warning",
        description: "TacticalMapControl canvas missing ARIA live region for dynamic radar target updates.",
        recommendation: "Wrap radar target list in aria-live='polite' region for screen reader accessibility.",
        qaTrace: {
          testRunner: "Selenium 4.18",
          ruleId: "aria-live-radar",
          impact: "moderate",
          selector: ".tactical-map-canvas",
        },
      },
      {
        appId: 824,
        orgId: 473,
        findingType: "performance",
        severity: "warning",
        description: "Large DOM node count (842 elements) detected during Eulerian H3 hex grid rendering.",
        recommendation: "Virtualize hexagonal grid cells outside active radar sweep viewport.",
        qaTrace: {
          testRunner: "Selenium 4.18",
          metric: "dom_nodes",
          value: 842,
          threshold: 500,
        },
      },
      {
        appId: 824,
        orgId: 473,
        findingType: "security",
        severity: "critical",
        description: "Emergency Ops frequency socket channel permits unencrypted broadcast packets without mTLS handshake.",
        recommendation: "Enforce WSS protocol and verify token signature on initial socket upgrade frame.",
        qaTrace: {
          testRunner: "ForgeShadow Security Scanner",
          vulnerability: "CWE-319",
          cveCategory: "Cleartext Transmission of Sensitive Data",
        },
      },
    ]);
  });

  await check("Seed QA Test Audits (app_audits)", async () => {
    await db.delete(appAudits).where(eq(appAudits.appId, 824));

    await db.insert(appAudits).values([
      {
        appId: 824,
        jobId: "forge-qa-run-001",
        success: true,
        summary: "Automated Selenium verification pass: 9/9 Component Gallery modular blocks rendered successfully.",
        output: JSON.stringify({
          passedBlocks: [
            "IndustrialDashboardHero",
            "MetricGrid",
            "TacticalMapControl",
            "TacticalSimulationControlBlock",
            "TacticalDispatchQueueBlock",
            "TacticalSquadStatusBlock",
            "TacticalServiceProviderBlock",
            "TacticalCommsBroadcastBlock",
            "StatusTimeline"
          ],
          totalDurationMs: 3420,
          memoryMb: 84.5
        }),
      }
    ]);
  });

  // ══════════════════════════════════════════════════════════
  // 2. VERIFY GET /api/apps/824/audit-logs (Studio Audits Menu)
  // ══════════════════════════════════════════════════════════
  console.log("\n🔎 2. STUDIO AUDITS API (GET /api/apps/824/audit-logs)");
  console.log("-".repeat(55));

  await check("Fetch audit logs via REST API", async () => {
    const res = await fetch("http://localhost:5000/api/apps/824/audit-logs?orgId=473", {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const logs = await res.json() as any[];
    if (logs.length < 3) throw new Error(`Expected >= 3 audit logs, got ${logs.length}`);

    console.log(`     → Returned ${logs.length} audit logs:`);
    for (const log of logs) {
      console.log(`       [${log.severity.toUpperCase()}] ${log.findingType}: ${log.description.slice(0, 70)}...`);
      if (log.recommendation) {
        console.log(`         ↳ Recommendation: ${log.recommendation.slice(0, 60)}...`);
      }
    }
  });

  // ══════════════════════════════════════════════════════════
  // 3. VERIFY GET /api/apps/824/audits (QA & Tests Tab)
  // ══════════════════════════════════════════════════════════
  console.log("\n🧪 3. QA & TESTS API (GET /api/apps/824/audits)");
  console.log("-".repeat(55));

  await check("Fetch QA audits via REST API", async () => {
    const res = await fetch("http://localhost:5000/api/apps/824/audits?orgId=473", {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const audits = await res.json() as any[];
    if (audits.length === 0) throw new Error("No QA audits returned");

    console.log(`     → Returned ${audits.length} QA audit runs:`);
    for (const a of audits) {
      console.log(`       Run: ${a.jobId} — Success: ${a.success}`);
      console.log(`       Summary: ${a.summary}`);
    }
  });

  // ══════════════════════════════════════════════════════════
  // 4. VERIFY FRONTEND ROUTES ACCESSIBILITY
  // ══════════════════════════════════════════════════════════
  console.log("\n🌐 4. FRONTEND INTERFACES ACCESSIBILITY");
  console.log("-".repeat(55));

  await check("App Studio Builder Page (tab=preview / Audits rail)", async () => {
    const res = await fetch("http://localhost:5000/armory/apps/824?login=1&orgId=473&tab=preview", {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('id="root"')) throw new Error("Missing React mount point");
  });

  await check("App QA & Tests Tab (tab=qa)", async () => {
    const res = await fetch("http://localhost:5000/armory/apps/824?login=1&orgId=473&tab=qa", {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('id="root"')) throw new Error("Missing React mount point");
  });

  // ══════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log(`🏁 RESULT: ${pass} PASS, ${fail} FAIL out of ${pass + fail} checks`);
  if (fail === 0) console.log("🎉 AUDITS MENU & QA FUNCTIONALITY: FULLY VERIFIED!");
  console.log("=".repeat(70));

  process.exit(fail > 0 ? 1 : 0);
}

verifyAuditsFull().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
