import "dotenv/config";

const BASE = "http://localhost:5000";

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return cookie.split(";")[0];
}

async function run() {
  console.log("=".repeat(70));
  console.log("🔍 ODDJOB APP BUILDER (ARMORY) — FULL FEATURE VERIFICATION");
  console.log("=".repeat(70));

  const cookie = await login();
  console.log("✅ Authenticated\n");

  let pass = 0, fail = 0;

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

  // ═══════════════════════════════════════════════════════
  // 1. ARMORY UI PAGES
  // ═══════════════════════════════════════════════════════
  console.log("\n📄 ARMORY UI PAGES");
  console.log("-".repeat(50));

  for (const [label, url] of [
    ["Armory Main Hub", "/armory?orgId=473"],
    ["Armory Apps Fleet", "/armory/apps?orgId=473"],
    ["App 824 Builder Studio", "/armory/apps/824?orgId=473"],
    ["Component Gallery", "/armory/gallery?orgId=473"],
  ] as const) {
    await check(label, async () => {
      const r = await fetch(`${BASE}${url}`, { headers: { cookie } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (!html.includes('id="root"') && !html.includes('id="app"'))
        throw new Error("Missing React mount point");
    });
  }

  // ═══════════════════════════════════════════════════════
  // 2. APP 824 LIVE PREVIEW (PROXIED)
  // ═══════════════════════════════════════════════════════
  console.log("\n🖥️  APP 824 LIVE PREVIEW (PROXIED NEXT.JS)");
  console.log("-".repeat(50));

  const previewRes = await fetch(`${BASE}/forged/rescue-dispatch`, { headers: { cookie } });
  const previewHtml = await previewRes.text();

  await check("Preview loads (HTTP 200)", async () => {
    if (!previewRes.ok) throw new Error(`HTTP ${previewRes.status}`);
  });

  for (const [block, marker] of [
    ["IndustrialDashboardHero", "Rescue Dispatch Control"],
    ["MetricGrid", "Mean Response Time"],
    ["TacticalMapControl", "Sector 7"],
    ["TacticalSimulationControlBlock", "What-If Route"],
    ["TacticalDispatchQueueBlock", "Priority Rescues Triage"],
    ["TacticalSquadStatusBlock", "Squad Fleet Readiness"],
    ["TacticalServiceProviderBlock", "Service Provider Network"],
    ["TacticalCommsBroadcastBlock", "Emergency Ops Channel"],
    ["StatusTimeline", "Recent Tactical Activity Stream"],
  ] as const) {
    await check(`Block: ${block}`, async () => {
      if (!previewHtml.includes(marker))
        throw new Error(`Marker "${marker}" not found in rendered HTML`);
    });
  }

  // ═══════════════════════════════════════════════════════
  // 3. STYLESHEET DELIVERY
  // ═══════════════════════════════════════════════════════
  console.log("\n🎨 STYLESHEET DELIVERY");
  console.log("-".repeat(50));

  const cssHref = previewHtml.match(/href="([^"]*\.css[^"]*)"/)?.[1];
  if (cssHref) {
    const cssUrl = cssHref.startsWith("http") ? cssHref : `${BASE}${cssHref}`;
    await check(`CSS loads from ${cssHref}`, async () => {
      const r = await fetch(cssUrl, { headers: { cookie } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.text();
      if (body.length < 10000)
        throw new Error(`CSS too small: ${body.length} bytes`);
      console.log(`     → ${body.length.toLocaleString()} bytes, Content-Type: ${r.headers.get("content-type")}`);
    });
  } else {
    fail++;
    console.log("  ❌ No CSS <link> found in preview HTML");
  }

  // ═══════════════════════════════════════════════════════
  // 4. API ENDPOINTS
  // ═══════════════════════════════════════════════════════
  console.log("\n🔌 API ENDPOINTS");
  console.log("-".repeat(50));

  // Fleet
  await check("GET /api/apps/fleet", async () => {
    const r = await fetch(`${BASE}/api/apps/fleet?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json() as any;
    const apps = d.apps || d;
    const count = Array.isArray(apps) ? apps.length : 0;
    console.log(`     → ${count} apps in fleet`);
    const app824 = (Array.isArray(apps) ? apps : []).find((a: any) => a.id === 824);
    if (app824) {
      console.log(`     → App 824: status=${app824.status}, port=${app824.runtimeMetadata?.assignedPort}`);
    }
  });

  // Installed
  await check("GET /api/apps/installed", async () => {
    const r = await fetch(`${BASE}/api/apps/installed?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json() as any;
    console.log(`     → ${Array.isArray(d) ? d.length : "?"} installed apps`);
  });

  // Market
  await check("GET /api/apps/market", async () => {
    const r = await fetch(`${BASE}/api/apps/market?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // Lifecycle
  await check("GET /api/apps/lifecycle", async () => {
    const r = await fetch(`${BASE}/api/apps/lifecycle?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // App 824 Context
  await check("GET /api/apps/rescue-dispatch/context", async () => {
    const r = await fetch(`${BASE}/api/apps/rescue-dispatch/context?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // Start app
  await check("POST /api/apps/824/start", async () => {
    const r = await fetch(`${BASE}/api/apps/824/start`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json() as any;
    if (!d.success) throw new Error("start did not succeed");
    console.log(`     → Port: ${d.app?.runtimeMetadata?.assignedPort}, Status: ${d.app?.runtimeMetadata?.status}`);
  });

  // Releases
  await check("GET /api/apps/824/releases", async () => {
    const r = await fetch(`${BASE}/api/apps/824/releases?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // Analytics
  await check("GET /api/apps/824/analytics", async () => {
    const r = await fetch(`${BASE}/api/apps/824/analytics?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // Deploy info
  await check("GET /api/apps/824/deploy", async () => {
    const r = await fetch(`${BASE}/api/apps/824/deploy?orgId=473`, { headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });

  // ═══════════════════════════════════════════════════════
  // 5. BLOCK REGISTRY (file-based)
  // ═══════════════════════════════════════════════════════
  console.log("\n📦 BLOCK REGISTRY (block-registry.json)");
  console.log("-".repeat(50));

  await check("Block registry file is valid JSON", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("server/domain/apps/core/block-registry.json", "utf8");
    const data = JSON.parse(raw);
    const blocks = data.blocks || [];
    console.log(`     → ${blocks.length} blocks registered`);
    const tactical = blocks.filter((b: any) => b.id?.startsWith("Tactical"));
    console.log(`     → ${tactical.length} tactical blocks: ${tactical.map((b: any) => b.id).join(", ")}`);
    if (tactical.length < 5) throw new Error(`Expected >= 5 tactical blocks, got ${tactical.length}`);
  });

  // ═══════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log(`🏁 TOTAL: ${pass} PASS, ${fail} FAIL out of ${pass + fail} checks`);
  if (fail === 0) console.log("🎉 ALL CHECKS PASSED — App Builder is fully functional!");
  console.log("=".repeat(70));

  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
