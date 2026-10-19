import { execSync } from "child_process";

/**
 * One-shot eval CI entrypoint: run the eval suite, then the regression gate.
 *
 *   npm run evals:ci
 *
 * The eval RUNNER exits non-zero when any subject is below its absolute pass
 * threshold — that's expected signal, NOT the CI verdict. The authoritative
 * pass/fail is the regression GATE (per-subject regression vs. the committed
 * baseline), so we always run the gate regardless of the runner's exit code and
 * propagate the gate's exit code as the job result.
 *
 * Cross-platform (uses execSync + npx, works on POSIX CI and Windows dev).
 */

function run(cmd: string): number {
    try {
        execSync(cmd, { stdio: "inherit" });
        return 0;
    } catch (err: any) {
        return typeof err?.status === "number" ? err.status : 1;
    }
}

console.log("\n[evals:ci] Step 1/2 — running eval suite (produces tests/evals/.last-results.json)...");
const runnerCode = run("npx tsx tests/evals/eval_runner.ts");
console.log(`[evals:ci] eval runner exited ${runnerCode} (informational — the gate decides).`);

console.log("\n[evals:ci] Step 2/2 — running regression gate against the committed baseline...");
const gateCode = run("npx tsx scripts/evals/gate.ts");

process.exit(gateCode);
