import * as fs from "fs";
import * as path from "path";
import { evalBaselineSchema, type SubjectPassRate } from "@shared/contracts/index.js";
import { evaluateGate } from "../../tests/evals/scoring.js";

/**
 * Regression gate for the eval measurement spine.
 *
 * Reads a results file (per-subject pass-rates, produced by the eval runner via
 * `--out`) and the committed baseline, then fails (exit 1) when any subject
 * regresses beyond delta or falls below threshold.
 *
 *   npx tsx scripts/evals/gate.ts [resultsPath] [baselinePath]
 *
 * Defaults: results = tests/evals/.last-results.json,
 *           baseline = tests/evals/eval-baseline.json
 */

const root = process.cwd();
const resultsPath = process.argv[2] || path.join(root, "tests/evals/.last-results.json");
const baselinePath = process.argv[3] || path.join(root, "tests/evals/eval-baseline.json");

function loadJson(p: string): unknown {
    if (!fs.existsSync(p)) {
        console.error(`[eval-gate] file not found: ${p}`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function main() {
    const current = loadJson(resultsPath) as SubjectPassRate[];
    const baseline = evalBaselineSchema.parse(loadJson(baselinePath));

    const report = evaluateGate(current, baseline);

    console.log(`\n=== Eval Regression Gate ===`);
    console.log(`Subjects checked: ${report.checked}  ·  delta: ${baseline.regressionDelta}  ·  default threshold: ${baseline.defaultThreshold}\n`);

    if (report.ok) {
        console.log("✅ PASS — no regressions or threshold breaches.");
        process.exit(0);
    }

    for (const f of report.findings) {
        if (f.kind === "not_measured") {
            console.log(`❌ NOT MEASURED  ${f.subjectKey}: the run produced no result for this subject (baseline ${f.baseline?.toFixed(3)})`);
        } else if (f.kind === "regression") {
            console.log(`❌ REGRESSION  ${f.subjectKey}: ${f.current.toFixed(3)} (baseline ${f.baseline?.toFixed(3)}, down ${f.delta?.toFixed(3)})`);
        } else {
            console.log(`❌ BELOW THRESHOLD  ${f.subjectKey}: ${f.current.toFixed(3)} < ${f.threshold?.toFixed(3)}`);
        }
    }
    console.log(`\n⚠️  ${report.findings.length} finding(s). Gate failed.`);
    process.exit(1);
}

main();
