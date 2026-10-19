import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * vi.mock() calls whose target resolves to no file.
 *
 * A mock of a path that does not exist mocks nothing, and vitest says nothing
 * about it: the module under test imports the real dependency, and the test
 * quietly runs against whatever Redis, Postgres or API happens to be reachable.
 * It passes on the machine that has those running and fails everywhere else —
 * which is how a clean Linux clone found tests that had only ever passed beside
 * a developer's Redis. Modules move; relative mock paths in moved tests and
 * mocks of renamed services do not follow.
 *
 * Resolves each target the way vitest does — relative to the test file, or
 * through the same aliases as vitest.config.ts — and reports the ones that
 * match no file. Package names (no leading `.` and no alias) are left alone.
 */

const ALIASES: Array<[prefix: string, target: string]> = [
    // Longest prefix first: "@domain-ui/" must win over "@domain/" and "@/".
    ["@oddjob/shared-utils/", "packages/shared-utils/src/"],
    ["@domain-ui/", "server/domain/"],
    ["@domain/", "server/domain/"],
    ["@server/", "server/"],
    ["@shared/", "shared/"],
    ["@/", "client/src/"],
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

interface Finding {
    filePath: string;
    line: number;
    specifier: string;
}

/** The repository-relative base path a specifier points at, or null for a package. */
export function targetBase(testFile: string, specifier: string): string | null {
    if (specifier.startsWith(".")) {
        return path.posix.normalize(path.posix.join(path.posix.dirname(testFile), specifier));
    }
    const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
    return alias ? alias[1] + specifier.slice(alias[0].length) : null;
}

/** Whether a repository-relative base resolves to a file, as an ESM/TS import would. */
export function resolves(base: string, exists: (rel: string) => boolean): boolean {
    const stem = base.replace(/\.(m|c)?(j|t)sx?$/, "");
    const candidates = [
        base,
        ...EXTENSIONS.map((ext) => stem + ext),
        ...EXTENSIONS.map((ext) => `${stem}/index${ext}`),
    ];
    return candidates.some(exists);
}

export function auditSourceFile(
    filePath: string,
    source: string,
    exists: (rel: string) => boolean,
): Finding[] {
    const findings: Finding[] = [];
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
        // vi.mock("x", ...) and vi.doMock("x", ...)
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "vi" &&
            (node.expression.name.text === "mock" || node.expression.name.text === "doMock") &&
            node.arguments.length > 0 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            const specifier = node.arguments[0].text;
            const base = targetBase(filePath, specifier);
            if (base !== null && !resolves(base, exists)) {
                const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                findings.push({ filePath, line: line + 1, specifier });
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sf);
    return findings;
}

// --- file selection ---------------------------------------------------------
//
// A denylist, like the other lint gates: every allowlist in this repo's history
// eventually missed a directory and reported green over it.

const DENY_SEGMENTS = new Set(["node_modules", "dist", "build", ".git", "coverage", "external", "workspace"]);

function collect(dir: string): string[] {
    let out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (DENY_SEGMENTS.has(entry.name) || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(collect(full));
        else if (entry.isFile() && /\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const toRel = (abs: string) => path.relative(rootDir, abs).split(path.sep).join("/");
const existsInRepo = (rel: string) => fs.existsSync(path.join(rootDir, rel));

// --- baseline ---------------------------------------------------------------

const BASELINE_PATH = path.join(__dirname, "lint-dead-mocks.baseline.json");

function readBaseline(): Record<string, number> | null {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"))?.files ?? null;
    } catch (err) {
        console.error(`[DEAD MOCK LINT] Could not parse the baseline: ${(err as Error).message}`);
        process.exitCode = 2;
        return null;
    }
}

function writeBaseline(counts: Record<string, number>): void {
    const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    const total = Object.values(files).reduce((sum, n) => sum + n, 0);
    fs.writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ generatedBy: "npm run lint:dead-mocks -- --update-baseline", total, files }, null, 2)}\n`,
        "utf-8",
    );
}

export function auditTree(): Finding[] {
    const files = collect(rootDir);
    if (files.length < 1000) {
        // A path change that quietly matched nothing would make this vacuous.
        console.error(`[DEAD MOCK LINT] Only ${files.length} test files matched; the selection is wrong.`);
        process.exitCode = 2;
    }
    return files.flatMap((file) => auditSourceFile(toRel(file), fs.readFileSync(file, "utf-8"), existsInRepo));
}

function main(): void {
    console.log("🔍 [DEAD MOCK LINT] Auditing vi.mock targets...");
    const findings = auditTree();

    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.filePath] = (counts[f.filePath] ?? 0) + 1;

    if (process.argv.includes("--update-baseline")) {
        writeBaseline(counts);
        console.log(`[DEAD MOCK LINT] Baseline written: ${findings.length} dead mock(s) across ${Object.keys(counts).length} file(s).`);
        return;
    }

    const baseline = readBaseline();
    if (!baseline) {
        for (const f of findings) console.log(`  ${f.filePath}:${f.line}  vi.mock("${f.specifier}")`);
        console.error(`[DEAD MOCK LINT] ${findings.length} dead mock(s) and no baseline to compare against.`);
        process.exitCode = 1;
        return;
    }

    const regressions: Finding[] = [];
    const improvements: string[] = [];
    for (const [file, count] of Object.entries(counts)) {
        const allowed = baseline[file] ?? 0;
        if (count > allowed) regressions.push(...findings.filter((f) => f.filePath === file));
        else if (count < allowed) improvements.push(`  ↓ ${file}: ${count} (baseline ${allowed})`);
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        if (!(file in counts)) improvements.push(`  ✓ ${file}: 0 (baseline ${allowed}) — clear`);
    }

    const baselineTotal = Object.values(baseline).reduce((s, n) => s + n, 0);
    console.log(`[DEAD MOCK LINT] ${findings.length} known dead mock(s) against a baseline of ${baselineTotal}.`);

    if (improvements.length) {
        console.log(`\n[DEAD MOCK LINT] Improved in ${improvements.length} file(s):`);
        for (const line of improvements) console.log(line);
        console.log("💡 Run `npm run lint:dead-mocks -- --update-baseline` to lock it in.");
    }

    if (regressions.length) {
        console.error(`\n❌ [DEAD MOCK LINT] ${regressions.length} new vi.mock target(s) that resolve to no file:\n`);
        for (const f of regressions) console.error(`  ${f.filePath}:${f.line}  vi.mock("${f.specifier}")`);
        console.error(
            "\n💡 A mock of a missing path mocks nothing, so the test runs the real module.\n" +
            "   Point it at the path the code under test actually imports.\n",
        );
        process.exitCode = 1;
        return;
    }

    console.log("✅ [DEAD MOCK LINT] No new dead mocks.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
    main();
}
