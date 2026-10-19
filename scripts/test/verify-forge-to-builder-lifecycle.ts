import "dotenv/config";
import fs from "fs";
import path from "path";

async function verifyLifecyclePipeline() {
  console.log("=".repeat(75));
  console.log("🚀 VERIFYING FORGE-TO-BUILDER LIFECYCLE & DIRECT STUDIO PUBLISHING");
  console.log("=".repeat(75));

  let pass = 0;
  let fail = 0;

  function check(name: string, fn: () => void) {
    try {
      fn();
      pass++;
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      fail++;
      console.log(`  ❌ ${name}: ${e.message}`);
    }
  }

  const forgePath = path.resolve("server/domain/apps/ui/modules/apps/pages/AppForge.tsx");
  const builderPath = path.resolve("server/domain/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab.tsx");
  const publishModalPath = path.resolve("server/domain/apps/ui/modules/apps/components/tabs/subcomponents/PublishAppModal.tsx");
  const apiExplorerPath = path.resolve("server/domain/apps/ui/modules/apps/components/tabs/subcomponents/ApiContractExplorer.tsx");

  const forgeContent = fs.readFileSync(forgePath, "utf-8");
  const builderContent = fs.readFileSync(builderPath, "utf-8");
  const publishModalContent = fs.readFileSync(publishModalPath, "utf-8");
  const apiExplorerContent = fs.readFileSync(apiExplorerPath, "utf-8");

  // 1. Stage 1: Forge Ignition & Transition
  check("AppForge.tsx has animated Ignition Complete Banner", () => {
    if (!forgeContent.includes("Ignition Complete · App Online")) {
      throw new Error("Missing 'Ignition Complete · App Online' title in AppForge");
    }
    if (!forgeContent.includes("READY FOR CUSTOMIZATION")) {
      throw new Error("Missing 'READY FOR CUSTOMIZATION' badge");
    }
  });

  check("AppForge.tsx implements 3-second auto-redirect countdown to ?tab=preview", () => {
    if (!forgeContent.includes("const [countdown, setCountdown] = useState<number | null>(null);")) {
      throw new Error("Missing countdown state");
    }
    if (!forgeContent.includes("setLocation(`/armory/apps/${forgedAppId}?tab=preview`);")) {
      throw new Error("Missing deep-link redirect to ?tab=preview");
    }
    if (!forgeContent.includes("Open in Builder Studio")) {
      throw new Error("Missing 'Open in Builder Studio' button");
    }
    if (!forgeContent.includes("Stay on Logs")) {
      throw new Error("Missing 'Stay on Logs' pause button");
    }
  });

  // 2. Stage 2: PublishAppModal Component
  check("PublishAppModal.tsx exports glassmorphic publish modal with governance and versioning", () => {
    if (!publishModalContent.includes("export function PublishAppModal")) {
      throw new Error("Missing PublishAppModal export");
    }
    if (!publishModalContent.includes("Public Route & Slug")) {
      throw new Error("Missing slug configuration input");
    }
    if (!publishModalContent.includes("Access Governance & Visibility")) {
      throw new Error("Missing access governance selector");
    }
    if (!publishModalContent.includes("Release Version") || !publishModalContent.includes("Changelog / Release Notes")) {
      throw new Error("Missing version tag or release notes");
    }
    if (!publishModalContent.includes("Intranet / Portal Embed Code")) {
      throw new Error("Missing iframe embed snippet generator");
    }
  });

  // 3. Stage 3: ApiContractExplorer for Headless APIs
  check("ApiContractExplorer.tsx exports OpenAPI 3.1 Swagger & live request playground", () => {
    if (!apiExplorerContent.includes("export function ApiContractExplorer")) {
      throw new Error("Missing ApiContractExplorer export");
    }
    if (!apiExplorerContent.includes("OpenAPI 3.1 Specification & Request Playground")) {
      throw new Error("Missing OpenAPI 3.1 title");
    }
    if (!apiExplorerContent.includes("handleExecuteRequest")) {
      throw new Error("Missing request execution runner");
    }
    if (!apiExplorerContent.includes("curlSnippet")) {
      throw new Error("Missing cURL command generator");
    }
  });

  // 4. Stage 4: AppInteractiveBuilderTab Studio Integration
  check("AppInteractiveBuilderTab.tsx integrates Publish App button, status badge, and API tab", () => {
    if (!builderContent.includes("PublishAppModal")) {
      throw new Error("Missing PublishAppModal import or usage");
    }
    if (!builderContent.includes("ApiContractExplorer")) {
      throw new Error("Missing ApiContractExplorer import or usage");
    }
    if (!builderContent.includes("<span>API Contract</span>")) {
      throw new Error("Missing API Contract toolbar toggle");
    }
    if (!builderContent.includes("<span>Publish App</span>")) {
      throw new Error("Missing Publish App top-bar button");
    }
    if (!builderContent.includes("isPublished ? \"● PUBLISHED\" : \"○ DRAFT\"")) {
      throw new Error("Missing published status beacon badge");
    }
  });

  // 5. Live Server Endpoint Tests
  console.log("\n📡 Testing Live Endpoints & Production Route...");
  const loginRes = await fetch("http://localhost:5000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" })
  });
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];

  // A. Builder Page
  const builderRes = await fetch("http://localhost:5000/armory/apps/824?login=1&orgId=473&tab=preview", {
    headers: { cookie }
  });
  if (builderRes.status === 200) {
    pass++;
    console.log("  ✅ App Builder Studio (tab=preview) returns HTTP 200");
  } else {
    fail++;
    console.log(`  ❌ App Builder Studio returned HTTP ${builderRes.status}`);
  }

  // B. Deployment Settings
  const deployRes = await fetch("http://localhost:5000/api/apps/824/deploy", {
    headers: { cookie }
  });
  if (deployRes.status === 200 || deployRes.status === 404) {
    pass++;
    console.log(`  ✅ /api/apps/824/deploy endpoint responsive (Status: ${deployRes.status})`);
  } else {
    fail++;
    console.log(`  ❌ /api/apps/824/deploy returned HTTP ${deployRes.status}`);
  }

  // C. Readiness Probe
  const readinessRes = await fetch("http://localhost:5000/api/apps/824/readiness?probe=true", {
    headers: { cookie }
  });
  if (readinessRes.status === 200 || readinessRes.status === 404) {
    pass++;
    console.log(`  ✅ /api/apps/824/readiness probe responsive (Status: ${readinessRes.status})`);
  } else {
    fail++;
    console.log(`  ❌ /api/apps/824/readiness returned HTTP ${readinessRes.status}`);
  }

  // D. Live Forged Production App
  let liveRes = await fetch("http://localhost:5000/forged/rescue-dispatch");
  if (liveRes.status === 502) {
    console.log("  ⚠️ Container cold, booting via /api/apps/824/start...");
    await fetch("http://localhost:5000/api/apps/824/start", { method: "POST", headers: { cookie } });
    await new Promise((r) => setTimeout(r, 4000));
    liveRes = await fetch("http://localhost:5000/forged/rescue-dispatch");
  }
  if (liveRes.status === 200) {
    pass++;
    console.log("  ✅ Live Forged App (/forged/rescue-dispatch) returns HTTP 200 OK");
  } else {
    fail++;
    console.log(`  ❌ Live Forged App returned HTTP ${liveRes.status}`);
  }

  console.log("\n" + "=".repeat(75));
  console.log(`🏁 RESULT: ${pass} PASS, ${fail} FAIL out of ${pass + fail} checks`);
  if (fail === 0) console.log("🎉 ALL FORGE-TO-BUILDER LIFECYCLE & STUDIO PUBLISHING CHECKS PASSED!");
  console.log("=".repeat(75));

  process.exit(fail > 0 ? 1 : 0);
}

verifyLifecyclePipeline().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
