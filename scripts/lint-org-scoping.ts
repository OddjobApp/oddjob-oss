import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * Tenant scoping that silently stops scoping.
 *
 * `server/utils/org-conditions.ts` documents one spelling of this defect:
 * `orgId != null ? eq(col, orgId) : undefined`, where Drizzle reads
 * `.where(undefined)` as NO FILTER rather than an empty match. Grepping for
 * that phrasing has repeatedly certified the codebase clean while the same bug
 * sat in the tree under a different spelling. Seven have now been found:
 *
 *   1. `if (!isSuperAdmin && orgId) conditions.push(eq(col, orgId))` — no else,
 *      so a null org adds no predicate at all.      (6 cycle handlers, a write)
 *   2. `orgId != null ? eq(col, orgId) : undefined`             (org-conditions)
 *   3. `orgId || 1`   — retargets organization 1 rather than widening (5 sites)
 *   4. `orgId ?? 1`   — the same, and invisible to a grep for `|| 1`
 *   5. `cycle.organizationId!` — asserts away the null the compiler flagged
 *   6. `orgId ? eq(col, orgId) : sql`true`` — a literal true predicate, which
 *      reads as deliberate                                          (5 sites)
 *   7. `let conditions: any;` assigned in some branches but not all, so
 *      `.where(conditions)` receives undefined   (a cross-tenant DELETE)
 *
 * Plus the tenant being sourced from the request rather than the session, which
 * is not a scoping failure so much as scoping the attacker chose.
 *
 * A regex cannot see most of these; each needs to know what an expression is
 * rather than what it looks like. This reads the AST, syntactically — no
 * type-checker and no Program, so it stays fast enough to sit in `verify`.
 *
 * The cost of that choice: it cannot tell whether an arbitrary expression is
 * nullable, so it catches the seven shapes above rather than the whole class.
 * `scripts/lint-org-scoping.test.ts` pins every one of them against a fixture,
 * and pins the patterns that must NOT fire — an optional `userId` filter
 * falling through to `sql`true`` is correct, and a linter that cried wolf there
 * would be turned off within a week.
 */

interface Finding {
    filePath: string;
    line: number;
    rule: string;
    snippet: string;
}

/** Identifiers and properties that name a tenant. */
const ORG_NAME = /(^|[^a-z])(org|organisation|organization)(_?id|Id)?$/i;

/** Matches `orgId`, `organizationId`, `organization_id`, `x.organizationId`. */
function namesAnOrg(text: string): boolean {
    const tail = text.split(".").pop() ?? text;
    const cleaned = tail.replace(/[?!]/g, "");
    if (/^(org|orgid|organizationid|organization_id|organisationid|organisation_id)$/i.test(cleaned)) {
        return true;
    }
    return ORG_NAME.test(cleaned) && /org/i.test(cleaned);
}

/**
 * The expressions a value could actually come from, following only the
 * operators that pass a value through: `||`, `??`, parentheses, a non-null
 * assertion, and a single-argument numeric cast.
 *
 * Needed because the coercions in this tree chain:
 * `req.org?.id ?? Number(req.body?.orgId) ?? 1` has a whole binary expression
 * on the left of the final `??`, so checking the immediate operand misses it.
 * Following only the value path — rather than the whole subtree — keeps
 * `segments.reduce(...) || 1` from being read as an organization.
 */
function valueSources(node: ts.Node): ts.Node[] {
    if (ts.isParenthesizedExpression(node)) return valueSources(node.expression);
    if (ts.isNonNullExpression(node)) return valueSources(node.expression);
    if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
        return [...valueSources(node.left), ...valueSources(node.right)];
    }
    if (
        ts.isCallExpression(node) &&
        node.arguments.length === 1 &&
        /^(Number|parseInt|parseFloat|String)$/.test(node.expression.getText())
    ) {
        return valueSources(node.arguments[0]);
    }
    return [node];
}

/** An expression that filters nothing: undefined, true, or a true predicate. */
function isNonFilter(node: ts.Node): boolean {
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (ts.isIdentifier(node) && node.text === "undefined") return true;
    if (ts.isVoidExpression(node)) return true;
    // sql`true`, sql`1=1`, sql`TRUE`
    if (ts.isTaggedTemplateExpression(node)) {
        const tag = node.tag.getText();
        if (!/\bsql$/.test(tag)) return false;
        const body = node.template.getText().replace(/[`\s]/g, "").toLowerCase();
        return body === "true" || body === "1=1";
    }
    return false;
}

/** Does this subtree call `eq(...)` on something that names a tenant? */
function containsOrgEquality(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(n)) {
            const callee = n.expression.getText();
            if (/(^|\.)(eq|ne|inArray)$/.test(callee) && n.arguments.length > 0) {
                if (n.arguments.some((arg) => namesAnOrg(arg.getText()))) {
                    found = true;
                    return;
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

/**
 * Whether a conditionally-assigned variable has a path that leaves it unset.
 *
 * `let condition;` followed by if / else-if / **else** assigns on every path
 * and is fine — attachment-tools.ts does exactly that, correctly. The
 * diagnoses DELETE had if / else-if and no final else, so a third case fell
 * through to `.where(undefined)`. Only the missing `else` distinguishes them,
 * and flagging both would make this rule noise on correct code.
 */
function hasUnguardedFallThrough(sf: ts.SourceFile, name: string): boolean {
    let unguarded = false;

    const visit = (node: ts.Node): void => {
        if (unguarded) return;
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left) &&
            node.left.text === name
        ) {
            // Walk out to the outermost if of this chain and ask whether it
            // ends in an else.
            let outermost: ts.IfStatement | null = null;
            for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
                if (ts.isIfStatement(p)) outermost = p;
                if (ts.isFunctionLike(p)) break;
            }
            if (outermost) {
                let tail: ts.IfStatement = outermost;
                while (tail.elseStatement && ts.isIfStatement(tail.elseStatement)) {
                    tail = tail.elseStatement;
                }
                if (!tail.elseStatement) unguarded = true;
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sf);
    return unguarded;
}

function auditSourceFile(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const rel = path.relative(rootDir, filePath).split(path.sep).join("/");

    /** `let x;` / `let x: any;` with no initializer — may reach a query unset. */
    const unassignedLets = new Set<string>();
    const seenOnLine = new Set<string>();

    const record = (node: ts.Node, rule: string) => {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const text = node.getText(sf).replace(/\s+/g, " ").slice(0, 160);
        // A `??` chain naming three request properties is one mistake, not
        // three findings; dedupe per line and rule so a count means something.
        const key = `${line + 1}:${rule}`;
        if (seenOnLine.has(key)) return;
        seenOnLine.add(key);
        findings.push({ filePath: rel, line: line + 1, rule, snippet: text });
    };

    const visit = (node: ts.Node): void => {
        // --- 7. a conditionally-assigned predicate variable --------------------
        if (ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Let)) {
            for (const decl of node.declarationList.declarations) {
                if (decl.initializer) continue;
                if (!ts.isIdentifier(decl.name)) continue;
                const declaredAny = !decl.type || decl.type.kind === ts.SyntaxKind.AnyKeyword;
                const declaredOptional =
                    decl.type != null &&
                    ts.isUnionTypeNode(decl.type) &&
                    decl.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
                if (declaredAny || declaredOptional) unassignedLets.add(decl.name.text);
            }
        }

        // --- 2 / 6. an org filter whose other branch filters nothing -----------
        if (ts.isConditionalExpression(node)) {
            const trueIsOrg = containsOrgEquality(node.whenTrue);
            const falseIsOrg = containsOrgEquality(node.whenFalse);
            if (trueIsOrg && isNonFilter(node.whenFalse)) record(node, "org-filter-falls-through");
            else if (falseIsOrg && isNonFilter(node.whenTrue)) record(node, "org-filter-falls-through");
        }

        // --- 3 / 4. an org coerced to a literal id -----------------------------
        if (
            ts.isBinaryExpression(node) &&
            (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
                node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
            ts.isNumericLiteral(node.right) &&
            valueSources(node.left).some((src) => namesAnOrg(src.getText()))
        ) {
            record(node, "org-coerced-to-literal");
        }

        // --- 5. a non-null assertion on a tenant -------------------------------
        if (ts.isNonNullExpression(node) && namesAnOrg(node.expression.getText())) {
            record(node, "org-non-null-assertion");
        }

        if (ts.isCallExpression(node)) {
            const callee = ts.isPropertyAccessExpression(node.expression)
                ? node.expression.name.text
                : null;

            // --- `.where()` given something that may not filter ----------------
            if (callee === "where" && node.arguments.length === 1) {
                const arg = node.arguments[0];
                if (isNonFilter(arg)) record(node, "where-without-filter");
                else if (
                    ts.isIdentifier(arg) &&
                    unassignedLets.has(arg.text) &&
                    hasUnguardedFallThrough(sf, arg.text)
                ) {
                    record(node, "where-maybe-unassigned");
                }
            }

            // --- 1. `conditions.push(eq(org, ...))` under an if with no else ----
            if (callee === "push" && containsOrgEquality(node)) {
                for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
                    if (ts.isIfStatement(p)) {
                        const guardsOrg = namesAnOrg(p.expression.getText()) ||
                            /\borg(anization)?Id\b/i.test(p.expression.getText());
                        if (guardsOrg && !p.elseStatement) record(p, "org-predicate-conditionally-skipped");
                        break;
                    }
                    if (ts.isFunctionLike(p)) break;
                }
            }
        }

        // --- the tenant taken from the request ---------------------------------
        if (ts.isPropertyAccessExpression(node) && namesAnOrg(node.name.text)) {
            const chain = node.getText();
            if (/^req\.(body|query|params)\b/.test(chain) || /^req\.org\b/.test(chain)) {
                record(node, "org-sourced-from-request");
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sf);
    return findings;
}

// --- file selection ---------------------------------------------------------
//
// A denylist, deliberately. `lint:arch` matched route files by suffix and so
// exempted all 110 files in server/routes/ while reporting a perfect score;
// every allowlist in this repo's history has eventually missed a directory.

const SCAN_ROOTS = ["server", "shared"];

const DENY_SEGMENTS = [
    "node_modules",
    "dist",
    "build",
    // Scaffolded template apps carry their own dependency trees.
    `server${path.sep}blueprints`,
];

function isDenied(absPath: string): boolean {
    if (DENY_SEGMENTS.some((seg) => absPath.includes(seg))) return true;
    // Relative to the repo root, because the patterns below are anchored there.
    // Testing the absolute path meant `^server/scripts/` never matched and 400
    // findings came from one-shot operational scripts.
    const norm = path.relative(rootDir, absPath).split(path.sep).join("/");
    // Tests and one-shot operational scripts: a script that targets one
    // organization by id is doing so on purpose, with an operator present.
    if (/\.(test|spec)\.tsx?$/.test(norm)) return true;
    if (/\/(__tests__|tests)\//.test(norm)) return true;
    if (/^server\/scripts\//.test(norm)) return true;
    // The canonical context resolvers read `?orgId=` and the body on purpose,
    // and verify membership before returning it. They are the fix for
    // `org-sourced-from-request`, not an instance of it.
    if (/^server\/utils\/auth-context\.ts$/.test(norm)) return true;
    return false;
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

const BASELINE_PATH = path.join(__dirname, "lint-org-scoping.baseline.json");

function readBaseline(): Record<string, number> | null {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"))?.files ?? null;
    } catch (err) {
        console.error(`[ORG LINT] Could not parse the baseline: ${(err as Error).message}`);
        process.exitCode = 2;
        return null;
    }
}

function writeBaseline(counts: Record<string, number>): void {
    const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify(
            {
                generatedBy: "npm run lint:org-scoping -- --update-baseline",
                total: Object.values(files).reduce((sum, n) => sum + n, 0),
                files,
            },
            null,
            2,
        )}\n`,
        "utf-8",
    );
}

export function auditTree(): Finding[] {
    const files = SCAN_ROOTS.flatMap((root) => collect(path.join(rootDir, root)));
    if (files.length < 500) {
        // The guard lint:arch did not have. A path or extension change that
        // quietly matched nothing would make every assertion below vacuous.
        console.error(`[ORG LINT] Only ${files.length} files matched; the selection is wrong.`);
        process.exitCode = 2;
    }
    return files.flatMap((file) => auditSourceFile(file, fs.readFileSync(file, "utf-8")));
}

export { auditSourceFile };

function main(): void {
    console.log("🔍 [ORG LINT] Auditing tenant scoping...");
    const findings = auditTree();

    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.filePath] = (counts[f.filePath] ?? 0) + 1;

    if (process.argv.includes("--update-baseline")) {
        writeBaseline(counts);
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        console.log(`[ORG LINT] Baseline written: ${total} finding(s) across ${Object.keys(counts).length} file(s).`);
        return;
    }

    const baseline = readBaseline();
    if (!baseline) {
        for (const f of findings) console.log(`  ${f.filePath}:${f.line}  [${f.rule}]  ${f.snippet}`);
        console.log(`[ORG LINT] ${findings.length} finding(s); no baseline to compare against.`);
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
    console.log(`[ORG LINT] ${findings.length} known finding(s) against a baseline of ${baselineTotal}.`);

    if (improvements.length) {
        console.log(`\n[ORG LINT] Improved in ${improvements.length} file(s):`);
        for (const line of improvements) console.log(line);
        console.log("💡 Run `npm run lint:org-scoping -- --update-baseline` to lock it in.");
    }

    if (regressions.length) {
        console.error(`\n❌ [ORG LINT] ${regressions.length} new tenant-scoping finding(s):\n`);
        for (const f of regressions) {
            console.error(`  ${f.filePath}:${f.line}  [${f.rule}]`);
            console.error(`     ${f.snippet}`);
        }
        console.error(
            "\n💡 A tenant filter must not have a branch that filters nothing. Use getOrgConditions\n" +
            "   from server/utils/org-conditions.ts, or refuse: a null organization means `IS NULL`,\n" +
            "   never `no predicate` and never a default organization id.\n",
        );
        process.exitCode = 1;
        return;
    }

    console.log("✅ [ORG LINT] No new tenant-scoping findings.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
    main();
}
