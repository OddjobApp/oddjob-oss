/**
 * Every package the application imports must be declared in package.json.
 *
 * axios, zustand, react-router-dom and uuid were imported by client and server
 * code while declared nowhere; they resolved only because some other package
 * happened to depend on them. Any upgrade that dropped that other package
 * would have removed them, and the failure would have surfaced as a broken
 * page or a crashed worker rather than at install time.
 *
 * Scans every source file under the roots below — a denylist of what to skip,
 * not an allowlist of what to check — with the TypeScript import scanner, and
 * fails when a bare package is not a dependency, devDependency, optional or
 * peer dependency.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SCAN = ["client/src", "server", "shared", "packages"];
// server/blueprints holds templates for generated apps, which declare their own dependencies.
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", "__fixtures__", "fixtures", "blueprints"]);
const EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/**
 * Imported on purpose without being declared. Each is loaded with a dynamic
 * import only when used, behind a `declare module` stub, so a deployment that
 * never uses it never installs it.
 */
const OPTIONAL = new Map<string, string>([
    ["snowflake-sdk", "Snowflake driver, loaded on demand by the SQL executor and analytics-db tools"],
]);
/** Path aliases from tsconfig/vite, and virtual modules — not packages. */
const ALIASES = ["@/", "@shared", "@server", "@domain", "@domain-ui", "@assets", "@oddjob/", "virtual:", "~"];

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const declared = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
]);
const builtins = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]));

function* files(dir: string): Generator<string> {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
        const full = join(dir, name);
        if (SKIP_DIRS.has(name)) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) {
            // A nested package (server/mcp/linkedin-mcp, packages/*) declares its own dependencies.
            if (readdirSync(full).includes("package.json")) continue;
            yield* files(full);
        } else if (EXTENSIONS.test(name)) {
            yield full;
        }
    }
}

function packageOf(specifier: string): string | null {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
    if (ALIASES.some((a) => specifier === a.replace(/\/$/, "") || specifier.startsWith(a))) return null;
    if (/^[a-z]+:/.test(specifier)) return null; // data:, http:, etc.
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (builtins.has(name)) return null;
    return name;
}

const missing = new Map<string, string[]>();

for (const root of SCAN) {
    for (const file of files(join(ROOT, root))) {
        // The compiler's own scanner: real import, export-from, dynamic import and
        // require — never a "from '...'" inside a string or a comment.
        // require() is a module load only in JS; in TS a call named require is a local helper.
        const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, /\.(?:c|m)?jsx?$/.test(file));
        for (const { fileName } of importedFiles) {
            const name = packageOf(fileName);
            if (!name || declared.has(name) || OPTIONAL.has(name) || name.startsWith("@types/")) continue;
            // A type-only import is satisfied by its @types package.
            if (declared.has(`@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`)) continue;
            const where = missing.get(name) ?? [];
            if (where.length < 3) where.push(relative(ROOT, file).split("\\").join("/"));
            missing.set(name, where);
        }
    }
}

if (missing.size === 0) {
    console.log(`✅ [DEPS] Every imported package is declared in package.json.`);
    process.exit(0);
}
console.error(`❌ [DEPS] ${missing.size} imported package(s) are not declared in package.json:`);
for (const [name, where] of [...missing].sort()) console.error(`  ${name}  ←  ${where.join(", ")}`);
console.error(`Declare each one (npm install --save <pkg>), or remove the import.`);
process.exit(1);
