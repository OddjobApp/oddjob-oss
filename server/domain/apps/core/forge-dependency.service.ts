import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import { getForgeWorkspacePath } from "./forge-paths.js";

const logger = createLogger("ForgeDependency");

/**
 * Known-safe versions for libraries commonly imported by AI-generated code.
 */
export const KNOWN_SAFE_VERSIONS: Record<string, string> = {
    "chart.js": "4.4.7",
    "react-chartjs-2": "5.3.0",
    "recharts": "2.15.0",
    "framer-motion": "11.11.17",
    "lucide-react": "0.453.0",
    "clsx": "2.1.1",
    "tailwind-merge": "2.6.0",
    "date-fns": "3.6.0",
    "lru-cache": "10.4.3",
    "class-variance-authority": "0.7.1",
    "tailwindcss": "3.4.17",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.49",
    // Drag & drop
    "react-beautiful-dnd": "13.1.1",
    "@hello-pangea/dnd": "4.0.0",
    "@dnd-kit/core": "6.3.1",
    "@dnd-kit/sortable": "8.0.0",
    "@dnd-kit/utilities": "3.2.2",
    // Data grid
    "react-table": "7.8.0",
    "@tanstack/react-table": "8.21.2",
    "ag-grid-react": "33.1.1",
    "ag-grid-community": "33.1.1",
    // Forms / validation
    "react-hook-form": "7.53.0",
    "zod": "3.23.8",
    "@hookform/resolvers": "3.9.0",
    // Date pickers
    "react-datepicker": "7.6.0",
    "@types/react-datepicker": "7.0.0",
    // Misc UI
    "react-select": "5.9.0",
    "react-dropzone": "14.3.5",
    "react-toastify": "10.0.6",
    "react-modal": "3.16.3",
    "react-tooltip": "5.28.0",
    "react-hot-toast": "2.5.2",
    "sonner": "1.7.2",
    "@radix-ui/react-accordion":       "1.2.2",
    "@radix-ui/react-alert-dialog":    "1.1.4",
    "@radix-ui/react-aspect-ratio":    "1.1.1",
    "@radix-ui/react-avatar":          "1.1.2",
    "@radix-ui/react-checkbox":        "1.1.3",
    "@radix-ui/react-collapsible":     "1.1.2",
    "@radix-ui/react-context-menu":    "2.2.4",
    "@radix-ui/react-dialog":          "1.1.4",
    "@radix-ui/react-dropdown-menu":   "2.1.4",
    "@radix-ui/react-hover-card":      "1.1.4",
    "@radix-ui/react-label":           "2.1.1",
    "@radix-ui/react-menubar":         "1.1.4",
    "@radix-ui/react-navigation-menu": "1.2.3",
    "@radix-ui/react-popover":         "1.1.4",
    "@radix-ui/react-progress":        "1.1.1",
    "@radix-ui/react-radio-group":     "1.2.2",
    "@radix-ui/react-scroll-area":     "1.2.2",
    "@radix-ui/react-select":          "2.1.4",
    "@radix-ui/react-separator":       "1.1.1",
    "@radix-ui/react-slider":          "1.2.2",
    "@radix-ui/react-slot":            "1.1.1",
    "@radix-ui/react-switch":          "1.1.2",
    "@radix-ui/react-tabs":            "1.1.2",
    "@radix-ui/react-toast":           "1.2.4",
    "@radix-ui/react-toggle":          "1.1.1",
    "@radix-ui/react-toggle-group":    "1.1.1",
    "@radix-ui/react-tooltip":         "1.1.6",
    "cmdk":      "1.0.4",
    "vaul":      "0.9.9",
    "input-otp": "1.4.1",
    "@tanstack/react-query": "5.59.0",
    "next-themes": "0.3.0",
    "tailwindcss-animate": "1.0.7",
    "wouter": "3.3.5",
    "@next/swc-linux-x64-gnu": "14.2.35",
};

// Exact-match builtins: these package names must never be treated as npm packages.
// Use exact matching so "react" is excluded but "react-beautiful-dnd" is NOT.
const BUILTIN_EXACT = new Set([
    "react", "react-dom", "react/jsx-runtime",
    "next",
    "path", "fs", "os", "http", "https", "crypto", "stream", "buffer",
    "events", "util", "url", "querystring", "assert", "child_process",
    "zlib", "net", "tls", "dns", "readline", "perf_hooks", "worker_threads",
    // Bare relative path segments returned by extractPackageName for './foo' → '.' and '../bar' → '..'
    ".", "..",
]);

// Prefix-match builtins: anything starting with these is always a builtin/alias.
const BUILTIN_PREFIXES = ["node:", "@/", "../", "./", "@domain-ui/", "@domain/", "@server/"];

function isBuiltin(pkg: string): boolean {
    return BUILTIN_EXACT.has(pkg) || BUILTIN_PREFIXES.some(p => pkg.startsWith(p));
}

/**
 * Extract the npm package name from an import specifier.
 * "@scope/pkg/sub" → "@scope/pkg"
 * "pkg/sub"        → "pkg"
 * "./foo"          → relative (caller must check isBuiltin first)
 */
function extractPackageName(specifier: string): string {
    // Relative imports: return the specifier as-is so isBuiltin can reject them
    if (specifier.startsWith(".")) return specifier;
    if (specifier.startsWith("@")) {
        const parts = specifier.split("/");
        return parts.slice(0, 2).join("/");
    }
    return specifier.split("/")[0];
}

/**
 * Scan source for all third-party import specifiers.
 */
function scanImports(source: string): Set<string> {
    const found = new Set<string>();
    // static: import ... from '...'  or  import '...'
    // dynamic: require('...')
    const re = /(?:from|import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        const specifier = m[1] || m[2];
        if (!specifier) continue;
        const pkg = extractPackageName(specifier);
        if (!isBuiltin(pkg)) found.add(pkg);
    }
    return found;
}

/**
 * Service responsible for scanning generated code for missing dependencies
 * and injecting them into the target workspace.
 */
export const forgeDependencyService = {
    /**
     * Scans ALL generated files for any third-party import and ensures every
     * detected package exists in the workspace package.json.
     *
     * Known packages → pinned to KNOWN_SAFE_VERSIONS.
     * Unknown packages → logged as a warning so the build surfaces the issue
     *   rather than silently producing broken output.
     */
    async detectAndInjectDependencies(
        slug: string,
        files: Record<string, string>,
        emitLog: (m: string, l?: any) => Promise<void>,
        workspacePath?: string
    ): Promise<void> {
        const wsPath = workspacePath ?? getForgeWorkspacePath(slug);
        const pkgPath = path.join(wsPath, "package.json");

        let pkgJson: any;
        try {
            pkgJson = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
        } catch {
            return;
        }

        const existingDeps = new Set([
            ...Object.keys(pkgJson.dependencies ?? {}),
            ...Object.keys(pkgJson.devDependencies ?? {}),
            ...Object.keys(pkgJson.peerDependencies ?? {}),
        ]);

        // Collect every third-party package referenced across all generated files
        const allImported = new Set<string>();
        for (const [filename, content] of Object.entries(files)) {
            if (typeof content !== "string") continue;
            if (!filename.match(/\.(ts|tsx|js|jsx|mjs)$/)) continue;
            for (const pkg of scanImports(content)) {
                allImported.add(pkg);
            }
        }

        const toInject: string[] = [];
        const unknown: string[] = [];

        for (const pkg of allImported) {
            if (existingDeps.has(pkg)) continue; // already in package.json

            if (KNOWN_SAFE_VERSIONS[pkg]) {
                pkgJson.dependencies ??= {};
                pkgJson.dependencies[pkg] = KNOWN_SAFE_VERSIONS[pkg];
                toInject.push(pkg);
            } else {
                unknown.push(pkg);
            }
        }

        if (toInject.length > 0) {
            await emitLog(`Dependency Guard: Injecting detected libraries (${toInject.join(", ")}) into workspace package.json...`, "info");
            await fs.writeFile(pkgPath, JSON.stringify(pkgJson, null, 2), "utf-8");
        } else {
            await emitLog("Dependencies verified — no missing packages found.", "info");
        }

        if (unknown.length > 0) {
            await emitLog(
                `⚠️ Dependency Guard: Unrecognized package(s) imported but not in KNOWN_SAFE_VERSIONS — build may fail: ${unknown.join(", ")}`,
                "warn"
            );
            logger.warn("Unrecognized packages in generated code", { slug, packages: unknown });
        }
    }
};
