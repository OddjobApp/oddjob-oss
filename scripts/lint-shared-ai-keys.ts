import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * Shared AI provider keys read outside the one place allowed to read them.
 *
 * Production is strict BYOK: every organization's AI work runs on that
 * organization's own key, and `server/config/env.ts` refuses to boot with a
 * shared provider key in the environment. A call site that reads
 * `process.env.GEMINI_API_KEY` therefore gets `undefined` in production — the
 * feature fails, or quietly degrades, for every customer — and in development
 * it silently bills the platform instead of the org.
 *
 * The one sanctioned reader is `resolveOrgGeminiKey`
 * (`server/domain/ai/core/org-gemini-key.ts`): the org's key, and the platform
 * key only outside production. Everything else should call it, or go through
 * the org-aware `aiClient`, which resolves the key itself.
 *
 * Reads the AST rather than grepping, so `process.env["GEMINI_API_KEY"]` and
 * `const { GEMINI_API_KEY } = process.env` are caught as well as the dotted form.
 */

export const SHARED_KEY_NAMES = new Set([
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_AI_API_KEY",
    "OPENAI_API_KEY",
    "OPEN_AI_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "DASHSCOPE_API_KEY",
    "QWEN_API_KEY",
    "META_API_KEY",
    "MODEL_API_KEY",
    "FAL_KEY",
]);

/**
 * Files allowed to read a shared key: boot validation, the sanctioned resolver,
 * and the worker's boot-time GEMINI -> GOOGLE alias (a no-op in production,
 * where env.ts refuses to boot with either set).
 */
const SANCTIONED = new Set([
    "server/config/env.ts",
    "server/domain/ai/core/org-gemini-key.ts",
    "server/worker-entrypoint.ts",
]);

interface Finding {
    filePath: string;
    line: number;
    key: string;
    snippet: string;
}

function isProcessEnv(node: ts.Node): boolean {
    return ts.isPropertyAccessExpression(node) &&
        node.name.text === "env" &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process";
}

export function auditSourceFile(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const rel = path.isAbsolute(filePath)
        ? path.relative(rootDir, filePath).split(path.sep).join("/")
        : filePath;

    const record = (node: ts.Node, key: string) => {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({ filePath: rel, line: line + 1, key, snippet: node.getText(sf).replace(/\s+/g, " ").slice(0, 160) });
    };

    const visit = (node: ts.Node): void => {
        // process.env.GEMINI_API_KEY
        if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression) && SHARED_KEY_NAMES.has(node.name.text)) {
            record(node, node.name.text);
        }
        // process.env["GEMINI_API_KEY"]
        if (
            ts.isElementAccessExpression(node) &&
            isProcessEnv(node.expression) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            SHARED_KEY_NAMES.has(node.argumentExpression.text)
        ) {
            record(node, node.argumentExpression.text);
        }
        // const { GEMINI_API_KEY } = process.env
        if (ts.isVariableDeclaration(node) && node.initializer && isProcessEnv(node.initializer) && ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
                const name = (element.propertyName ?? element.name).getText(sf);
                if (SHARED_KEY_NAMES.has(name)) record(element, name);
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sf);
    return findings;
}

// --- file selection ---------------------------------------------------------
//
// A denylist, like lint:org-scoping and for the same reason: every allowlist in
// this repo's history eventually missed a directory and reported green over it.

const SCAN_ROOTS = ["server", "shared"];
const DENY_SEGMENTS = ["node_modules", "dist", "build", `server${path.sep}blueprints`];

function isDenied(absPath: string): boolean {
    if (DENY_SEGMENTS.some((seg) => absPath.includes(seg))) return true;
    const norm = path.relative(rootDir, absPath).split(path.sep).join("/");
    if (/\.(test|spec)\.tsx?$/.test(norm)) return true;
    if (/\/(__tests__|tests)\//.test(norm)) return true;
    // One-shot operator scripts run against the operator's own key on purpose.
    if (/^server\/scripts\//.test(norm)) return true;
    return SANCTIONED.has(norm);
}

function collect(dir: string): string[] {
    let out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (isDenied(full)) continue;
        if (entry.isDirectory()) out = out.concat(collect(full));
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

// --- baseline ---------------------------------------------------------------

const BASELINE_PATH = path.join(__dirname, "lint-shared-ai-keys.baseline.json");

function readBaseline(): Record<string, number> | null {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"))?.files ?? null;
    } catch (err) {
        console.error(`[AI KEY LINT] Could not parse the baseline: ${(err as Error).message}`);
        process.exitCode = 2;
        return null;
    }
}

function writeBaseline(counts: Record<string, number>): void {
    const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    const total = Object.values(files).reduce((sum, n) => sum + n, 0);
    fs.writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ generatedBy: "npm run lint:shared-ai-keys -- --update-baseline", total, files }, null, 2)}\n`,
        "utf-8",
    );
}

export function auditTree(): Finding[] {
    const files = SCAN_ROOTS.flatMap((root) => collect(path.join(rootDir, root)));
    if (files.length < 500) {
        // A path change that quietly matched nothing would make this vacuous.
        console.error(`[AI KEY LINT] Only ${files.length} files matched; the selection is wrong.`);
        process.exitCode = 2;
    }
    return files.flatMap((file) => auditSourceFile(file, fs.readFileSync(file, "utf-8")));
}

function main(): void {
    console.log("🔍 [AI KEY LINT] Auditing shared AI provider key reads...");
    const findings = auditTree();

    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.filePath] = (counts[f.filePath] ?? 0) + 1;

    if (process.argv.includes("--update-baseline")) {
        writeBaseline(counts);
        console.log(`[AI KEY LINT] Baseline written: ${findings.length} read(s) across ${Object.keys(counts).length} file(s).`);
        return;
    }

    const baseline = readBaseline();
    if (!baseline) {
        for (const f of findings) console.log(`  ${f.filePath}:${f.line}  [${f.key}]  ${f.snippet}`);
        console.error(`[AI KEY LINT] ${findings.length} read(s) and no baseline to compare against.`);
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
    console.log(`[AI KEY LINT] ${findings.length} known read(s) against a baseline of ${baselineTotal}.`);

    if (improvements.length) {
        console.log(`\n[AI KEY LINT] Improved in ${improvements.length} file(s):`);
        for (const line of improvements) console.log(line);
        console.log("💡 Run `npm run lint:shared-ai-keys -- --update-baseline` to lock it in.");
    }

    if (regressions.length) {
        console.error(`\n❌ [AI KEY LINT] ${regressions.length} new shared AI key read(s):\n`);
        for (const f of regressions) {
            console.error(`  ${f.filePath}:${f.line}  [${f.key}]`);
            console.error(`     ${f.snippet}`);
        }
        console.error(
            "\n💡 Production is strict BYOK and has no shared provider key. Use resolveOrgGeminiKey\n" +
            "   (server/domain/ai/core/org-gemini-key.ts), or call the org-aware aiClient, which\n" +
            "   resolves the organization's key itself.\n",
        );
        process.exitCode = 1;
        return;
    }

    console.log("✅ [AI KEY LINT] No new shared AI key reads.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
    main();
}
