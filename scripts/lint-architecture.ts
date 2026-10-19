import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

interface Violation {
  filePath: string;
  line: number;
  snippet: string;
  reason: string;
}

/**
 * How a file qualifies as "route layer" depends on where it lives.
 *
 * Under `server/domain/` the suffix is the only signal: those trees hold
 * services, executors and UI alongside routers, so `.route.ts`/`.routes.ts` is
 * what marks a router.
 *
 * Under `server/routes/` the directory itself is the signal. Almost nothing
 * there carries the suffix — `governor.ts`, `operational-cycles.ts`,
 * `research.ts` are all routers — so a suffix-only rule skipped that entire
 * tree and this linter reported "all routes follow the Deep Module pattern"
 * while 328 direct db calls sat in 44 unscanned files.
 */
type Mode = "suffix" | "all";

const NON_ROUTE_BASENAMES = new Set(["index.ts"]);

function isTestPath(p: string): boolean {
  // Normalise separators first: path.join yields backslashes on Windows, and a
  // regex written for POSIX slashes would silently stop excluding test files.
  const norm = p.split(path.sep).join("/");
  return /\.(test|spec)\.tsx?$/.test(norm) || /\/(__tests__|tests)\//.test(norm);
}

function findRouteFiles(dir: string, mode: Mode): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findRouteFiles(fullPath, mode));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (isTestPath(fullPath)) continue;

    const isSuffixed = entry.name.endsWith(".route.ts") || entry.name.endsWith(".routes.ts");
    if (mode === "suffix") {
      if (isSuffixed) results.push(fullPath);
    } else if (!NON_ROUTE_BASENAMES.has(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function auditRouteFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const forbiddenPatterns = [
    // `\s` spans newlines on purpose. Queries are routinely written as
    //     const rows = await db
    //       .select()
    // and a single-line pattern could not see them, so this rule reported "all
    // routes follow the Deep Module pattern" while 19 direct db calls sat across
    // 9 route files. Matching across the break is the whole point of the rule.
    { pattern: /\bdb\s*\.\s*(select|insert|update|delete|execute|transaction)\b/, reason: "Direct database execution inside route handler (must defer to Service layer)" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i];
    if (lineContent.trim().startsWith("//") || lineContent.trim().startsWith("*")) {
      continue;
    }

    // Test the line joined with the next two, so a query broken across lines —
    //     const rows = await db
    //       .select()
    // is still seen. Testing lineContent alone let 19 direct db calls across 9
    // route files pass while this rule reported a perfect score.
    const window = lines.slice(i, i + 3).join("\n");

    for (const rule of forbiddenPatterns) {
      // Anchor on the line that actually names `db`, so the reported line number
      // points at the start of the query rather than a continuation.
      if (!/\bdb\b/.test(lineContent)) continue;
      if (rule.pattern.test(window)) {
        violations.push({
          filePath: path.relative(rootDir, filePath),
          line: i + 1,
          snippet: lineContent.trim(),
          reason: rule.reason,
        });
      }
    }
  }

  return violations;
}

const BASELINE_PATH = path.join(__dirname, "lint-architecture.baseline.json");

/** Relative paths are compared and stored POSIX-style so the baseline is portable. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function countByFile(violations: Violation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    const key = toPosix(v.filePath);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function readBaseline(): Record<string, number> | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
    return parsed?.files ?? null;
  } catch (err) {
    console.error(`[ARCH LINT] Could not parse ${path.basename(BASELINE_PATH)}: ${(err as Error).message}`);
    process.exitCode = 2;
    return null;
  }
}

function writeBaseline(counts: Record<string, number>): void {
  const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const total = Object.values(files).reduce((sum, n) => sum + n, 0);
  const body = {
    // Known direct-db-in-route violations, held as a ratchet. New violations and
    // regressions in listed files fail the build; the counts here may only go
    // down. Burn a file down to zero and delete its entry.
    generatedBy: "npm run lint:arch -- --update-baseline",
    total,
    files,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
}

function main() {
  console.log("🔍 [ARCH LINT] Auditing API route handlers for Deep Module enforcement...");

  const routeDirs: Array<{ dir: string; mode: Mode }> = [
    { dir: path.join(rootDir, "server", "routes"), mode: "all" },
    { dir: path.join(rootDir, "server", "domain"), mode: "suffix" },
  ];

  let totalFiles = 0;
  const allViolations: Violation[] = [];

  for (const { dir, mode } of routeDirs) {
    const routeFiles = findRouteFiles(dir, mode);
    totalFiles += routeFiles.length;

    for (const file of routeFiles) {
      const violations = auditRouteFile(file);
      allViolations.push(...violations);
    }
  }

  console.log(`✅ [ARCH LINT] Scanned ${totalFiles} route files.`);

  const counts = countByFile(allViolations);

  if (process.argv.includes("--update-baseline")) {
    writeBaseline(counts);
    console.log(`[ARCH LINT] Baseline written: ${allViolations.length} violation(s) across ${Object.keys(counts).length} file(s).`);
    return;
  }

  const maxWarningsArg = process.argv.find((arg) => arg.startsWith("--max-warnings="));
  const baseline = maxWarningsArg ? null : readBaseline();

  if (baseline) {
    const regressions: string[] = [];
    const improvements: string[] = [];

    for (const [file, count] of Object.entries(counts)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        regressions.push(
          allowed === 0
            ? `  ✗ ${file}: ${count} direct db call(s) in a route file that had none`
            : `  ✗ ${file}: ${count} direct db call(s), baseline allows ${allowed}`,
        );
      } else if (count < allowed) {
        improvements.push(`  ↓ ${file}: ${count} (baseline ${allowed})`);
      }
    }
    for (const [file, allowed] of Object.entries(baseline)) {
      if (!(file in counts)) improvements.push(`  ✓ ${file}: 0 (baseline ${allowed}) — clear`);
    }

    const baselineTotal = Object.values(baseline).reduce((sum, n) => sum + n, 0);
    console.log(`[ARCH LINT] ${allViolations.length} known violation(s) against a baseline of ${baselineTotal}.`);

    if (improvements.length > 0) {
      console.log(`\n[ARCH LINT] Ratcheted down in ${improvements.length} file(s):`);
      for (const line of improvements) console.log(line);
      console.log("💡 Run `npm run lint:arch -- --update-baseline` to lock the improvement in.");
    }

    if (regressions.length > 0) {
      console.error(`\n❌ [ARCH LINT] ${regressions.length} file(s) regressed:`);
      for (const line of regressions) console.error(line);
      for (const v of allViolations) {
        const key = toPosix(v.filePath);
        if ((counts[key] ?? 0) > (baseline[key] ?? 0)) {
          console.error(`     ${key}:${v.line}  "${v.snippet}"`);
        }
      }
      console.error("\n💡 Move the query into a domain service and call that from the handler.");
      process.exitCode = 1;
    } else {
      console.log("✅ [ARCH LINT] No new direct-db-in-route violations.");
    }
    return;
  }

  if (allViolations.length > 0) {
    console.warn(`⚠️ [ARCH LINT] Found ${allViolations.length} Deep Module pattern warning(s):\n`);
    for (const v of allViolations) {
      console.warn(`  - ${v.filePath}:${v.line} -> ${v.reason}`);
      console.warn(`    Line ${v.line}: "${v.snippet}"\n`);
    }
    console.warn("💡 Hint: Move database queries into server/services or domain service files to maintain thin route controllers.");
  } else {
    console.log("🎉 [ARCH LINT] All routes follow the Deep Module pattern perfectly!");
  }

  if (maxWarningsArg) {
    const maxWarnings = Number(maxWarningsArg.split("=")[1]);
    if (!Number.isSafeInteger(maxWarnings) || maxWarnings < 0) {
      console.error("[ARCH LINT] --max-warnings must be a non-negative integer.");
      process.exitCode = 2;
    } else if (allViolations.length > maxWarnings) {
      console.error(`[ARCH LINT] Warning budget exceeded: ${allViolations.length} found, ${maxWarnings} allowed.`);
      process.exitCode = 1;
    } else {
      console.log(`[ARCH LINT] Warning budget satisfied: ${allViolations.length}/${maxWarnings}.`);
    }
  }
}

main();
