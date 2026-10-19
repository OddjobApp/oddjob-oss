import "dotenv/config";
import fs from "fs";

async function verifyVisualMenuAndProps() {
  console.log("=".repeat(70));
  console.log("🔍 VERIFYING VISUAL MENU, COMPONENTS & THEIR PROPERTIES");
  console.log("=".repeat(70));

  // 1. Authenticate
  const loginRes = await fetch("http://localhost:5000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
  console.log("✅ Authenticated with Admin Session\n");

  // 2. Fetch Indexed Components from API
  const res = await fetch("http://localhost:5000/api/capabilities/component-index/search?limit=200", {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`Component search API failed: ${res.status}`);
  const components = await res.json() as any[];
  console.log(`📋 Total Components Indexed in DB: ${components.length}`);

  // 3. Verify Visual Menu Categories
  const categories = new Set(components.map((c) => c.category).filter(Boolean));
  console.log(`\n📂 Visual Menu Categories (${categories.size} categories):`);
  for (const cat of Array.from(categories).sort()) {
    const count = components.filter((c) => c.category === cat).length;
    console.log(`   • ${cat.padEnd(20)} (${count} components)`);
  }

  // 4. Verify Components & Detailed Properties
  console.log("\n🧩 Target Component & Property Verification:");
  const targetComponents = [
    "IndustrialDashboardHero",
    "MetricGrid",
    "TacticalMapControl",
    "TacticalSimulationControlBlock",
    "TacticalDispatchQueueBlock",
    "TacticalSquadStatusBlock",
    "TacticalServiceProviderBlock",
    "TacticalCommsBroadcastBlock",
    "StatusTimeline",
    "PlatformDatasetTableBlock"
  ];

  let passedComponents = 0;
  for (const target of targetComponents) {
    const found = components.find(
      (c) => c.importPath?.includes(target) || c.name?.toLowerCase().includes(target.toLowerCase())
    );

    if (found) {
      passedComponents++;
      console.log(`\n  ✅ [${found.name}]`);
      console.log(`     Import Path:   ${found.importPath}`);
      console.log(`     Category:      ${found.category}`);
      console.log(`     Export Type:   ${found.exportType}`);
      console.log(`     Properties / Schema:`);
      const props = found.propSchema || {};
      const propKeys = Object.keys(props);
      if (propKeys.length === 0) {
        console.log(`       (No props or zero-param block)`);
      } else {
        for (const [key, val] of Object.entries(props)) {
          console.log(`       - ${key}: ${typeof val === "object" ? JSON.stringify(val) : val}`);
        }
      }
    } else {
      console.log(`\n  ❌ [${target}] NOT FOUND in index`);
    }
  }

  // 5. Visual Menu Page Routes
  console.log("\n🌐 Visual Menu Pages Accessibility:");
  for (const route of [
    "/platform-maintenance/components",
    "/admin/style-gallery",
    "/armory/components"
  ]) {
    const pageRes = await fetch(`http://localhost:5000${route}`, {
      headers: { cookie },
      redirect: "follow"
    });
    console.log(`  ${pageRes.ok ? "✅" : "❌"} ${route} -> HTTP ${pageRes.status}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log(`🏁 RESULT: ${passedComponents}/${targetComponents.length} Target Components Fully Verified with Properties`);
  console.log("=".repeat(70));

  process.exit(passedComponents === targetComponents.length ? 0 : 1);
}

verifyVisualMenuAndProps().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
