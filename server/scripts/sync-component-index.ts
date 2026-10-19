import fs from "fs";
import path from "path";
import crypto from "crypto";
import ts from "typescript";
import { db } from "../database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("SyncComponentIndex");

/**
 * Component index synchronizer — Phase A (app-wide indexer scoping).
 *
 * Recursively scans configured "renderable block" roots and reconciles the
 * component_index against the files on disk:
 *   - existing rows are UPDATED in place (curated display name / category kept,
 *     propSchema + hash refreshed),
 *   - new block files are INSERTED (display name derived from the file name),
 *   - managed rows whose backing file no longer exists are PRUNED (self-cleaning,
 *     so phantom entries can't accumulate).
 *
 * Roots are limited to what the client renderers (gallery preview + instant apps)
 * can actually resolve — i.e. the packaged blocks — so nothing indexed is
 * un-renderable. Broadening the roots (widget/domain blocks) + a renderability
 * classifier is Phase B (see docs/design/app-wide-component-indexer.md).
 */

interface Root {
    dir: string;
    importPrefix: string;
    packageSource: string;
    /** design-system exports from the package root, not a per-file path. */
    flatImport?: boolean;
    /** Prune managed rows (same packageSource) whose file disappeared. */
    managed?: boolean;
}

const ROOTS: Root[] = [
    {
        dir: path.join(process.cwd(), "server", "domain", "core", "ui", "components", "packaged"),
        importPrefix: "@domain-ui/packaged",
        packageSource: "forge-ui",
        managed: true,
    },
    {
        dir: path.join(process.cwd(), "packages", "design-system", "src", "components"),
        importPrefix: "@oddjob/design-system",
        packageSource: "@oddjob/design-system",
        flatImport: true,
    },
];

/** Recursively collect component .tsx files (skip tests, barrels, non-PascalCase). */
function collectComponentFiles(dir: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (["__tests__", "node_modules"].includes(e.name)) continue;
            out.push(...collectComponentFiles(full));
        } else if (
            e.name.endsWith(".tsx") &&
            !/\.(test|spec)\.tsx$/.test(e.name) &&
            /^[A-Z]/.test(e.name) // PascalCase file → a component (skip index.tsx barrels)
        ) {
            out.push(full);
        }
    }
    return out;
}

/** Extract the Props interface members into a { propName: typeText } schema. */
function extractPropSchema(content: string, fileName: string, componentName: string): Record<string, string> {
    const propSchema: Record<string, string> = {};
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node)) {
            if (node.name.text.includes(componentName) || node.name.text.includes("Props")) {
                node.members.forEach((member) => {
                    if (ts.isPropertySignature(member) && member.name) {
                        const propName = member.name.getText(sourceFile) + (member.questionToken ? "?" : "");
                        propSchema[propName] = member.type ? member.type.getText(sourceFile) : "any";
                    }
                });
            }
        }
    });
    return propSchema;
}

function detectExportType(content: string, componentName: string): "default" | "named" {
    if (new RegExp(`export\\s+default\\s+(function\\s+)?${componentName}\\b`).test(content)) return "default";
    if (/export\s+default\s+(function|class|\()/.test(content)) return "default";
    return "named";
}

/** Heuristic: does the block fetch/mutate its own data (vs static/demo)? */
function fetchesOwnData(content: string): boolean {
    return /\buseQuery\b|\buseMutation\b|apiRequest\(|fetch\(/.test(content);
}

/** Props given a destructuring default in the component's first parameter
 *  (`{ columns = [] }`) — these are safe prop-free even if the interface marks
 *  them required. */
function findDefaultedProps(content: string, fileName: string): Set<string> {
    const defaulted = new Set<string>();
    const sf = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
        if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters.length) {
            const p = node.parameters[0];
            if (p.name && ts.isObjectBindingPattern(p.name)) {
                for (const el of p.name.elements) {
                    if (el.initializer) {
                        const nm = (el.propertyName ?? el.name).getText(sf);
                        defaulted.add(nm);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return defaulted;
}

/** Props that MUST be supplied for the block to render: declared required in the
 *  interface (no trailing `?`) and not given a destructuring default. */
function findRequiredProps(propSchema: Record<string, string>, defaulted: Set<string>): string[] {
    return Object.keys(propSchema)
        .filter((k) => !k.endsWith("?"))
        .map((k) => k.replace(/\?$/, ""))
        .filter((k) => !defaulted.has(k));
}

/** A block is "self-wiring" only if it fetches its own data AND renders with no
 *  required props — i.e. it is safe to drop onto a no-context surface (dashboard,
 *  instant-app). A block that fetches but still requires config props (e.g. a
 *  dataset table needing `columns`) is NOT self-wiring. */
function computeSelfWiring(content: string, fileName: string, propSchema: Record<string, string>): boolean {
    const defaulted = findDefaultedProps(content, fileName);
    return fetchesOwnData(content) && findRequiredProps(propSchema, defaulted).length === 0;
}

/** Append the "(Self-Wiring)" marker to a clean display name when appropriate. */
function labeledDisplayName(base: string, selfWiring: boolean): string {
    return deriveDisplayName(base) + (selfWiring ? " (Self-Wiring)" : "");
}

/** "MissionControlTable" -> "Mission Control Table"; strips a trailing "Block". */
function deriveDisplayName(base: string): string {
    return base
        .replace(/Block$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .trim();
}

export async function syncComponentIndexWithDisk(): Promise<void> {
    const existing = await db.select().from(componentIndex);
    const byModule = new Map<string, typeof existing[number]>();
    for (const row of existing) {
        const base = String(row.importPath || "").split("/").pop() || "";
        if (base) byModule.set(base, row);
        byModule.set(row.componentName, row); // also key by display name (flat-import roots)
    }

    let inserted = 0, updated = 0;
    const scannedManaged: Record<string, Set<string>> = {}; // packageSource -> set of basenames

    for (const root of ROOTS) {
        if (!fs.existsSync(root.dir)) {
            logger.warn(`[SyncComponentIndex] Root not found: ${root.dir}`);
            continue;
        }
        const files = collectComponentFiles(root.dir);
        logger.info(`[SyncComponentIndex] ${root.packageSource}: ${files.length} component files under ${path.relative(process.cwd(), root.dir)}`);
        if (root.managed) scannedManaged[root.packageSource] = new Set();

        for (const filePath of files) {
            const base = path.basename(filePath, ".tsx");
            const content = fs.readFileSync(filePath, "utf-8");
            const hash = crypto.createHash("sha256").update(content).digest("hex");
            const propSchema = extractPropSchema(content, path.basename(filePath), base);
            const exportType = detectExportType(content, base);
            const importPath = root.flatImport ? root.importPrefix : `${root.importPrefix}/${base}`;
            const snippet = `<${base} />`;
            const selfWiring = computeSelfWiring(content, path.basename(filePath), propSchema);
            const displayName = labeledDisplayName(base, selfWiring);
            if (root.managed) scannedManaged[root.packageSource].add(base);

            const found = byModule.get(base) || byModule.get(deriveDisplayName(base));
            if (found) {
                // Preserve the existing (possibly hand-curated) display name — only
                // correct the "(Self-Wiring)" marker so it accurately reflects whether
                // the block renders prop-free. Never regenerate the base name on update.
                const preservedBase = String(found.componentName).replace(/\s*\(Self-Wiring\)\s*$/i, "").trim();
                const correctedName = preservedBase + (selfWiring ? " (Self-Wiring)" : "");
                await db.update(componentIndex)
                    .set({ componentName: correctedName, propSchema, exportType, importPath, updatedAt: new Date() })
                    .where(eq(componentIndex.id, found.id));
                updated++;
            } else {
                await db.insert(componentIndex).values({
                    componentName: displayName,
                    componentCategory: "ui-block",
                    exportType,
                    packageSource: root.packageSource,
                    importPath,
                    propSchema,
                    dependencies: ["lucide-react"],
                    codeSnippet: snippet,
                    blueprintTemplate: snippet,
                    effectivenessScore: "5.00",
                    verificationSuccessRate: "100.00",
                    isApprovedForAssembly: true,
                }).onConflictDoNothing();
                inserted++;
                logger.info(`  [+] Indexed new block: ${displayName} (${base}, self-wiring=${selfWiring}, hash=${hash.slice(0, 8)})`);
            }
        }
    }

    // Reconcile managed rows against disk: remove phantoms (no backing file) and
    // de-duplicate (multiple rows for one module), keeping the most-recently-synced.
    let pruned = 0;
    for (const [packageSource, scanned] of Object.entries(scannedManaged)) {
        const managedRows = await db.select().from(componentIndex).where(eq(componentIndex.packageSource, packageSource));
        const staleIds: number[] = [];
        const keepByBase = new Map<string, { id: number; time: number }>();
        for (const r of managedRows) {
            const base = String(r.importPath || "").split("/").pop() || "";
            if (!scanned.has(base)) { staleIds.push(r.id); continue; } // no backing file
            const time = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
            const kept = keepByBase.get(base);
            if (!kept) { keepByBase.set(base, { id: r.id, time }); continue; }
            // Duplicate module → drop the older of the two.
            if (time >= kept.time) { staleIds.push(kept.id); keepByBase.set(base, { id: r.id, time }); }
            else { staleIds.push(r.id); }
        }
        if (staleIds.length) {
            await db.delete(componentIndex).where(inArray(componentIndex.id, staleIds));
            pruned += staleIds.length;
            logger.info(`  [-] Reconciled ${packageSource}: removed ${staleIds.length} phantom/duplicate row(s).`);
        }
    }

    logger.info(`[SyncComponentIndex] Done. inserted=${inserted} updated=${updated} pruned=${pruned}.`);
}

if (process.argv[1] && process.argv[1].endsWith("sync-component-index.ts")) {
    syncComponentIndexWithDisk().then(() => process.exit(0)).catch((err) => {
        logger.error(`[SyncComponentIndex] Failed: ${err.message}`);
        process.exit(1);
    });
}
