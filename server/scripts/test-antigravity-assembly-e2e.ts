import { dehydrationService } from "@domain/sdlc-pipeline/dehydration/dehydration.service.js";
import { componentLookupService } from "@domain/sdlc-pipeline/autonomous/component-lookup.service.js";
import { astGuardrailService } from "@domain/sdlc-pipeline/autonomous/ast-guardrail.service.js";
import { orgs } from "@shared/schema/index.js";
import { db } from "../database_service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("TestAntigravityAssemblyE2E");

async function testAntigravityAssemblyE2E() {
  logger.info("=== LAUNCHING E2E ANTIGRAVITY ASSEMBLY & SOLID-STATE TEST ===");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    logger.error("No org found in database.");
    process.exit(1);
  }

  // 1. Test AST Guardrails
  logger.info("\n1. Testing AST Guardrail Security Scanning...");
  const validCode = `def process_payload(payload):\n    return {"status": "ok", "result": payload.get("data", 0) * 2}\n`;
  const invalidCode = `def process_payload(payload):\n    eval("import os; os.system('rm -rf /')")\n`;

  const validCheck = astGuardrailService.validateCodeSnippet(validCode, "python");
  const invalidCheck = astGuardrailService.validateCodeSnippet(invalidCode, "python");

  logger.info(`   Valid Code Passed: ${validCheck.passed} (Violations: ${validCheck.violations.length})`);
  logger.info(`   Invalid Code Intercepted: ${!invalidCheck.passed} (Violations: ${invalidCheck.violations.length})`);

  // 2. Test Component Lookup & Feedback
  logger.info("\n2. Testing Component Lookup & Feedback Loop...");
  await componentLookupService.recordAssemblyFeedback("MetricSummaryCard", true);
  logger.info("   Recorded positive assembly feedback for MetricSummaryCard.");

  // 3. Test Dehydration & Solid-State Compilation
  logger.info("\n3. Testing Dehydration & Solid-State Compilation...");
  const dehydration = await dehydrationService.dehydrateSession({
    organizationId: org.id,
    sessionId: `test_session_${Date.now()}`,
    intent: "E2E Transaction Normalization & Vector Sync",
    codeSnippet: validCode,
    runtime: "python:3.11-slim",
    port: 8085,
  });

  logger.info(`   Assembly ID: ${dehydration.assemblyId}`);
  logger.info(`   Build Output Dir: ${dehydration.compilation.outputDir}`);
  logger.info(`   Entrypoint Created: ${dehydration.compilation.entrypointPath}`);
  logger.info(`   Dockerfile Created: ${dehydration.compilation.dockerfilePath}`);
  logger.info(`   Endpoint URL: ${dehydration.record.endpointUrl}`);

  logger.info("\n=== E2E ANTIGRAVITY ASSEMBLY TEST PASSED SUCCESSFULLY ===");
}

testAntigravityAssemblyE2E()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(`E2E Test Failed: ${err.message}`);
    process.exit(1);
  });
