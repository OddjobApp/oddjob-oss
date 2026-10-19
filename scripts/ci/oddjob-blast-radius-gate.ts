#!/usr/bin/env node
/**
 * Oddjob CI Blast Radius Gate CLI
 *
 * Standalone runner executed during CI pull request workflows.
 * Calculates blast radius for modified files against System Graph topology and exits with 0 (pass) or 1 (fail).
 *
 * Usage:
 *   npx tsx scripts/ci/oddjob-blast-radius-gate.ts [--files file1,file2] [--max-score 50]
 */

import { execSync } from "child_process";
import { ciImpactGateService } from "../../server/domain/xray/core/ci-impact-gate.service.js";

async function runCIGate() {
  console.log("🔍 Oddjob System Graph CI Blast Radius Gate");
  console.log("-------------------------------------------");

  const args = process.argv.slice(2);
  let files: string[] = [];
  let maxScore = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--files" && args[i + 1]) {
      files = args[i + 1].split(",").map((f) => f.trim());
      i++;
    } else if (args[i] === "--max-score" && args[i + 1]) {
      maxScore = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Fall back to git diff if no explicit files passed
  if (files.length === 0) {
    try {
      const gitOutput = execSync("git diff --name-only origin/main...HEAD", { encoding: "utf-8" });
      files = gitOutput.split("\n").map((f) => f.trim()).filter((f) => f.length > 0);
    } catch {
      try {
        const gitOutput = execSync("git diff --name-only HEAD~1", { encoding: "utf-8" });
        files = gitOutput.split("\n").map((f) => f.trim()).filter((f) => f.length > 0);
      } catch (err: any) {
        console.warn("⚠️ Could not detect modified files via git diff:", err.message);
      }
    }
  }

  if (files.length === 0) {
    console.log("✅ No modified files detected. Impact gate passed.");
    process.exit(0);
  }

  console.log(`📁 Evaluating ${files.length} changed files against System Graph topology...`);

  try {
    const result = await ciImpactGateService.evaluatePullRequestImpact({
      modifiedFiles: files,
      maxBlastRadiusScore: maxScore,
    });

    console.log(`\n📊 Impact Check Results:`);
    console.log(`   - Passed: ${result.passed ? "✅ YES" : "❌ NO"}`);
    console.log(`   - Blast Radius Score: ${result.totalImpactScore} / ${result.maxAllowedScore}`);
    console.log(`   - Severity Category: ${result.blastRadiusCategory.toUpperCase()}`);
    console.log(`   - Affected Entities: ${result.affectedEntitiesCount}`);

    if (!result.passed) {
      console.error(`\n🚨 PR BLOCKED: ${result.blockedReason}`);
      if (result.summary.recommendedActions.length > 0) {
        console.error("\n💡 Recommended Actions:");
        result.summary.recommendedActions.forEach((act) => console.error(`   - ${act}`));
      }
      process.exit(1);
    }

    console.log("\n✅ Blast radius check passed cleanly.");
    process.exit(0);
  } catch (err: any) {
    console.error("❌ Unexpected error during CI impact gate execution:", err.message);
    process.exit(1);
  }
}

runCIGate();
