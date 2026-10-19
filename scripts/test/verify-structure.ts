/**
 * Structure Verification: Check all Phase 2 components are in place
 * 
 * Run with: npx tsx scripts/test/verify-structure.ts
 */
import fs from "node:fs/promises";
import path from "node:path";

const CHECKS = [
  // Documentation
  { path: "docs/FEATURES.md", type: "file", name: "Features Documentation" },
  
  // Blueprints
  { path: "server/blueprints/apps/crud-app/pages/index.tsx", type: "file", name: "CRUD App Blueprint v2" },
  { path: "server/blueprints/apps/analytics-dashboard/pages/index.tsx", type: "file", name: "Analytics Dashboard Blueprint v2" },
  { path: "server/blueprints/apps/chat-assistant/pages/index.tsx", type: "file", name: "Chat Assistant Blueprint v2" },
  { path: "server/blueprints/apps/mission-supervisor/pages/index.tsx", type: "file", name: "Mission Supervisor Blueprint v2" },
  
  // Platform Blocks
  { path: "server/domain/core/ui/components/packaged/PlatformDatasetChartBlock.tsx", type: "file", name: "Dataset Chart Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformFormBlock.tsx", type: "file", name: "Form Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformKnowledgeSearchBlock.tsx", type: "file", name: "Knowledge Search Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformJobRunnerBlock.tsx", type: "file", name: "Job Runner Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformHILApprovalBlock.tsx", type: "file", name: "HIL Approval Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformPipelineStatusBlock.tsx", type: "file", name: "Pipeline Status Block" },
  { path: "server/domain/core/ui/components/packaged/PlatformDeadLetterQueueBlock.tsx", type: "file", name: "Dead Letter Queue Block" },
  { path: "server/domain/core/ui/components/packaged/SeleniumRunnerBlock.tsx", type: "file", name: "Selenium Runner Block" },
  
  // Shared Components
  { path: "server/domain/core/ui/components/shared/ForgeProgressToast.tsx", type: "file", name: "Forge Progress Toast" },
  { path: "server/domain/core/ui/components/shared/ForgeStatusPanel.tsx", type: "file", name: "Forge Status Panel" },
  { path: "server/domain/core/ui/components/shared/LiveEventFeed.tsx", type: "file", name: "Live Event Feed" },
  
  // Hooks
  { path: "server/domain/core/ui/hooks/useEventStream.ts", type: "file", name: "useEventStream Hook" },
  
  // Server Services
  { path: "server/domain/core/events.route.ts", type: "file", name: "Events API Route" },
  { path: "server/domain/apps/core/selenium-runner.service.ts", type: "file", name: "Selenium Runner Service" },
  { path: "server/domain/apps/selenium.routes.ts", type: "file", name: "Selenium API Routes" },
  
  // Registry
  { path: "server/domain/apps/core/block-registry.json", type: "file", name: "Block Registry" },
  
  // Tests
  { path: "tests/unit/app-versioning.service.integration.test.ts", type: "file", name: "Versioning Service Tests" },
  { path: "tests/unit/agent-coordinator.service.test.ts", type: "file", name: "Agent Coordinator Tests" },
  { path: "tests/unit/blueprint-evolution.service.integration.test.ts", type: "file", name: "Blueprint Evolution Tests" },
  { path: "tests/unit/platform-blocks.test.tsx", type: "file", name: "Platform Blocks UI Tests" },
];

const CONTENT_CHECKS = [
  { 
    file: "server/domain/apps/app-forge.service.ts", 
    patterns: ["injectSlotTokens", "eventStreamService.publish", "forge.*.ignition_started"],
    name: "Forge Slot Token Injection"
  },
  { 
    file: "server/domain/apps/core/forge-shadow.service.ts", 
    patterns: ["seleniumRunnerService", "runAudit", "generateBlueprintFiles"],
    name: "Real Shadow Forge with Selenium"
  },
  { 
    file: "server/domain/core/infrastructure/event-stream.service.ts", 
    patterns: ["onEvent", "getRecent"],
    name: "Event Stream Service SSE API"
  },
  { 
    file: "server/domain/core/ui/components/packaged/PlatformKnowledgeSearchBlock.tsx", 
    patterns: ["cytoscape", "KnowledgeGraph", "cose"],
    name: "Knowledge Graph Visualization"
  },
];

async function verify() {
  console.log("\n🔍 Phase 2 Structure Verification\n");
  console.log("================================\n");
  
  let passed = 0;
  let failed = 0;
  
  // File existence checks
  console.log("File Structure:\n");
  for (const check of CHECKS) {
    const fullPath = path.resolve(check.path);
    try {
      await fs.access(fullPath);
      console.log(`  ✅ ${check.name}`);
      passed++;
    } catch {
      console.log(`  ❌ ${check.name} - ${check.path}`);
      failed++;
    }
  }
  
  console.log("\nContent Verification:\n");
  for (const check of CONTENT_CHECKS) {
    const fullPath = path.resolve(check.file);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const missing = check.patterns.filter(p => !content.includes(p));
      
      if (missing.length === 0) {
        console.log(`  ✅ ${check.name}`);
        passed++;
      } else {
        console.log(`  ⚠️  ${check.name} - missing: ${missing.join(", ")}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${check.name} - ${err}`);
      failed++;
    }
  }
  
  // Slot token check in blueprints
  console.log("\nSlot Token Check:\n");
  const blueprintChecks = [
    { path: "server/blueprints/apps/crud-app/pages/index.tsx", tokens: ["APP_TITLE", "COLLECTION_NAME", "COLUMNS"] },
    { path: "server/blueprints/apps/analytics-dashboard/pages/index.tsx", tokens: ["APP_TITLE", "CHART_CONFIG", "KPI_METRICS"] },
    { path: "server/blueprints/apps/chat-assistant/pages/index.tsx", tokens: ["AGENT_ID", "PERSONA_NAME"] },
    { path: "server/blueprints/apps/mission-supervisor/pages/index.tsx", tokens: ["MISSION_ID", "PlatformMissionsBlock"] },
  ];
  
  for (const check of blueprintChecks) {
    const fullPath = path.resolve(check.path);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const missing = check.tokens.filter(t => !content.includes(t));
      
      if (missing.length === 0) {
        console.log(`  ✅ ${path.basename(check.path)}`);
        passed++;
      } else {
        console.log(`  ⚠️  ${path.basename(check.path)} - missing tokens: ${missing.join(", ")}`);
        failed++;
      }
    } catch {
      console.log(`  ❌ ${path.basename(check.path)} - file not found`);
      failed++;
    }
  }
  
  console.log("\n================================\n");
  console.log(`Results: ${passed} passed, ${failed} failed\n`);
  
  if (failed === 0) {
    console.log("🎉 All structure checks passed!\n");
    process.exit(0);
  } else {
    console.log("⚠️  Some checks failed. Review above.\n");
    process.exit(1);
  }
}

verify();
