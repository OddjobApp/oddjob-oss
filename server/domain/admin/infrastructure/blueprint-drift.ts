/**
 * Blueprint Capability Drift Detection
 * ====================================
 *
 * Turns the capability catalog's Evidence column from "what is declared" into
 * "declared AND implemented".
 *
 * A blueprint declares a hand-authored `capabilities: string[]` in
 * `blueprint-registry.service.ts` — e.g. Wayfare claims "GPX Export". Nothing
 * has ever checked that claim against the blueprint's actual source. This module
 * does, by walking the same `server/blueprints/apps` tree that X-Ray's
 * `codeGraphService.indexBlueprints()` indexes and asking, for each declared
 * capability, whether its distinctive terms appear anywhere in that blueprint's
 * code.
 *
 * Why source text rather than X-Ray's code graph: X-Ray's graph lives in
 * `knowledgeNodes`/`knowledgeEdges` and only reflects reality after an indexing
 * pass has run. Deriving a FINGERPRINTED document from it would make the hash
 * depend on whether a background job happened to have run — a spec that flips to
 * "outdated" for reasons unrelated to the platform's capabilities. Reading the
 * tree directly is deterministic, needs no index, and answers the same question.
 *
 * DELIBERATELY CONSERVATIVE. A term match is evidence, not proof: it says the
 * word appears in the blueprint's code, not that the feature works. Matches made
 * only of generic engineering words ("app", "ui", "data") are flagged
 * `weakMatch` so the UI never shows a green check earned by the word "app".
 *
 * Two drift directions are reported, and the second is usually the surprising
 * one:
 *   - a registry entry with no source directory  → `missing_implementation`
 *   - a source directory with no registry entry  → `undeclared` (invisible to
 *     the marketplace and to the Copilot, however good it is)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlueprintDrift");

// Mirrors codeGraphService's BLUEPRINT_ROOT so both read the same tree.
export const DEFAULT_BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");

/** Directories that are build output or dependencies, never authored source. */
const PRUNED_DIRS = new Set([
    "node_modules", ".next", ".turbo", ".git", "dist", "build", "out", "coverage", ".cache",
]);

/**
 * Not every blueprint is a TypeScript app. The Go, Java, and Python backend
 * starters have no `.ts` file at all — omitting their extensions gave them an
 * EMPTY corpus, so every capability they declared read as unevidenced. A drift
 * report that depends on the implementation language is worse than none.
 */
const SOURCE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".css", ".scss", ".html",
    ".go", ".java", ".py", ".kt", ".rb", ".rs", ".cs", ".php", ".swift", ".sql",
    ".yml", ".yaml", ".toml", ".gradle", ".mod",
]);

/** Shared blueprint scaffolding, not a blueprint in its own right. */
const NON_BLUEPRINT_DIRS = new Set(["shared"]);

// Bounds keep the scan predictable on large or pathological trees. Applied after
// sorting so truncation stays deterministic.
const MAX_FILES_PER_BLUEPRINT = 300;
const MAX_BYTES_PER_FILE = 96 * 1024;

/**
 * Words too common to constitute evidence on their own — generic nouns plus the
 * marketing qualifiers that trail a real feature name ("Webhook **Ready**",
 * "Mobile **First**", "Offline **Mode**").
 *
 * These are excluded from the SIGNIFICANT terms that decide verification. That
 * matters: requiring "ready" to appear in source made "Webhook Ready" read as
 * only partially implemented even when the code plainly handles webhooks —
 * a false drift signal driven entirely by a marketing adjective.
 */
const GENERIC_TERMS = new Set([
    "app", "api", "ui", "ux", "web", "data", "live", "real", "time", "ready", "platform",
    "support", "based", "full", "core", "main", "page", "view", "list", "item", "user",
    "code", "file", "type", "open", "new", "auto", "multi", "free", "fast", "high", "low",
    "custom", "dynamic", "simple", "smart", "modern", "premium", "native", "standard",
    "mode", "first", "enabled", "aware", "driven", "powered", "friendly", "level", "grade",
    // Presentational adjectives. These describe how something behaves rather
    // than naming a feature, and almost never appear as identifiers — requiring
    // them made "Interactive Map" read as unimplemented against a blueprint
    // with a working Mapbox map. Technical claims like "deterministic" are
    // deliberately NOT here: those should have to prove themselves.
    "interactive", "responsive", "seamless", "intuitive", "unified", "comprehensive",
]);

// A blueprint may compose shared platform components instead of implementing a
// feature inline. Following one hop of relative imports that leave the blueprint
// directory keeps those blueprints honest — see EXTERNAL_IMPORT_RE below.
const MAX_EXTERNAL_FILES = 80;
const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Workspace path aliases, mirroring tsconfig `compilerOptions.paths`.
 *
 * Following only RELATIVE imports missed the most important case: a blueprint
 * whose entire page is `import { TacticalDispatchDashboard } from
 * "@domain-ui/rescue/..."`. Its features were fully implemented in the platform,
 * and the drift report called every one of them missing — the worst kind of
 * wrong, because it accuses working code.
 */
const PATH_ALIASES: Array<[string, string]> = [
    ["@domain-ui/", "server/domain/"],
    ["@domain/", "server/domain/"],
    ["@server/", "server/"],
    ["@shared/", "shared/"],
    ["@/", "client/src/"],
];

/** Resolve an alias specifier to a repo-absolute path, or null if not aliased. */
function resolveAlias(specifier: string, repoRoot: string): string | null {
    for (const [prefix, target] of PATH_ALIASES) {
        if (specifier.startsWith(prefix)) {
            return path.resolve(repoRoot, target + specifier.slice(prefix.length));
        }
    }
    return null;
}

export type CapabilityEvidenceStatus = "verified" | "partial" | "unverified";

export interface DeclaredCapabilityDrift {
    capability: string;
    status: CapabilityEvidenceStatus;
    matchedTerms: string[];
    missingTerms: string[];
    /**
     * The capability has no distinctive terms at all (e.g. "Platform API"), so
     * even a full match proves nothing specific. Never counts as verified.
     */
    weakMatch: boolean;
    /** Up to three relative paths where a distinctive term was found. */
    evidence: string[];
}

export type BlueprintDriftStatus =
    | "aligned"
    | "partially_evidenced"
    | "unevidenced"
    | "missing_implementation"
    | "undeclared";

export interface BlueprintDriftFact {
    slug: string;
    status: BlueprintDriftStatus;
    declaredInRegistry: boolean;
    hasImplementation: boolean;
    sourceFileCount: number;
    capabilities: DeclaredCapabilityDrift[];
}

export interface BlueprintDriftSummary {
    root: string;
    blueprints: BlueprintDriftFact[];
    counts: {
        aligned: number;
        partiallyEvidenced: number;
        unevidenced: number;
        missingImplementation: number;
        undeclared: number;
        declaredCapabilities: number;
        verifiedCapabilities: number;
    };
}

export interface BlueprintDriftInput {
    /** Registry entries: what each blueprint CLAIMS it can do. */
    declared: Array<{ slug: string; capabilities: string[] }>;
    blueprintRoot?: string;
    /** Repo root that workspace path aliases resolve against. Defaults to cwd. */
    repoRoot?: string;
}

// --- Corpus -----------------------------------------------------------------

interface BlueprintCorpus {
    fileCount: number;
    /** Lowercased `relative/path\ncontents` per file, for term lookup. */
    documents: Array<{ relativePath: string; haystack: string }>;
}

async function collectSourceFiles(dir: string, root: string, acc: string[]): Promise<void> {
    if (acc.length >= MAX_FILES_PER_BLUEPRINT) return;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    // Sort so truncation at MAX_FILES_PER_BLUEPRINT is stable across runs.
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (acc.length >= MAX_FILES_PER_BLUEPRINT) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (PRUNED_DIRS.has(entry.name)) continue;
            await collectSourceFiles(full, root, acc);
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            acc.push(path.relative(root, full).split(path.sep).join("/"));
        }
    }
}

async function readIfSmall(full: string): Promise<string> {
    try {
        const info = await stat(full);
        if (info.size <= MAX_BYTES_PER_FILE) return await readFile(full, "utf8");
    } catch {
        // Unreadable file contributes its path only — still real evidence.
    }
    return "";
}

/**
 * Resolve a relative import specifier to concrete file paths, following a
 * directory or bare specifier to its index and, for a barrel, the modules
 * beside it. Returns [] for anything that does not resolve to real source.
 */
async function resolveImport(fromFile: string, specifier: string, repoRoot: string): Promise<string[]> {
    const aliased = resolveAlias(specifier, repoRoot);
    if (!aliased && !specifier.startsWith(".")) return []; // bare package import
    const base = (aliased ?? path.resolve(path.dirname(fromFile), specifier)).replace(/\.js$/, "");
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`];

    for (const candidate of candidates) {
        try {
            const info = await stat(candidate);
            if (info.isFile()) {
                // A barrel's own text is just re-exports — the implementation is
                // in its siblings. Resolving to `index.ts` alone would match only
                // exported NAMES, so a component's internals stay invisible.
                if (/^index\.(ts|tsx|js|jsx)$/.test(path.basename(candidate))) {
                    const dir = path.dirname(candidate);
                    const entries = await readdir(dir, { withFileTypes: true });
                    return entries
                        .filter((e) => e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
                        .map((e) => path.join(dir, e.name))
                        .sort();
                }
                return [candidate];
            }
            if (info.isDirectory()) {
                // A barrel re-exports its siblings, so the directory IS the unit
                // of implementation the blueprint is composing.
                const entries = await readdir(candidate, { withFileTypes: true });
                return entries
                    .filter((e) => e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
                    .map((e) => path.join(candidate, e.name))
                    .sort();
            }
        } catch {
            // Try the next candidate extension.
        }
    }
    return [];
}

async function buildCorpus(blueprintDir: string, repoRoot: string): Promise<BlueprintCorpus> {
    const files: string[] = [];
    await collectSourceFiles(blueprintDir, blueprintDir, files);
    files.sort();

    const documents: BlueprintCorpus["documents"] = [];
    const localContents: Array<{ full: string; contents: string }> = [];

    for (const relativePath of files) {
        const full = path.join(blueprintDir, relativePath);
        const contents = await readIfSmall(full);
        localContents.push({ full, contents });
        documents.push({ relativePath, haystack: `${relativePath}\n${contents}`.toLowerCase() });
    }

    // One hop out. A thin blueprint (chat-assistant-v2 is 25 lines) can delegate
    // its entire implementation to a shared packaged component; scanning only
    // its own directory would report every capability it declares as missing.
    // Two hops. A blueprint imports a dashboard; the dashboard composes the
    // panel that actually does the work (rescue-dispatch → TacticalDispatchDashboard
    // → LocationResolution). One hop credited the dashboard but still missed the
    // implementation. Bounded by MAX_EXTERNAL_FILES so a barrel cannot pull the
    // world in.
    const external = new Set<string>();
    let frontier = localContents.map(({ full, contents }) => ({ full, contents }));

    for (let hop = 0; hop < 2 && external.size < MAX_EXTERNAL_FILES; hop++) {
        const next: Array<{ full: string; contents: string }> = [];
        for (const { full, contents } of frontier) {
            for (const match of contents.matchAll(IMPORT_RE)) {
                for (const resolved of await resolveImport(full, match[1], repoRoot)) {
                    // Only paths that ESCAPE the blueprint — local files are already in.
                    if (!path.relative(blueprintDir, resolved).startsWith("..")) continue;
                    if (external.has(resolved) || external.size >= MAX_EXTERNAL_FILES) continue;
                    external.add(resolved);
                    next.push({ full: resolved, contents: await readIfSmall(resolved) });
                }
            }
        }
        frontier = next;
    }

    for (const full of Array.from(external).sort().slice(0, MAX_EXTERNAL_FILES)) {
        const contents = await readIfSmall(full);
        // Marked with an arrow so evidence makes the delegation visible rather
        // than implying the code lives in the blueprint.
        const label = `→ ${path.basename(path.dirname(full))}/${path.basename(full)}`;
        documents.push({ relativePath: label, haystack: `${label}\n${contents}`.toLowerCase() });
    }

    return { fileCount: files.length, documents };
}

// --- Matching ---------------------------------------------------------------

/** Distinctive terms of a capability phrase, lowercased and de-duplicated. */
export function capabilityTerms(capability: string): string[] {
    const terms = capability
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3);
    return Array.from(new Set(terms)).sort();
}

/**
 * Term lookup that tolerates the singular/plural difference.
 *
 * "Live Logs" was reported as unimplemented against a blueprint whose source
 * defines a `LogBlock` rendering a live console — the literal string "logs"
 * simply never appears. Plurality is not a semantic difference, and a checker
 * that treats it as one produces drift reports engineers learn to ignore.
 *
 * Deliberately limited to a trailing "s" on terms long enough for it to be a
 * plural marker: real stemming would start matching unrelated words, which is a
 * worse failure than missing a match.
 */
function matchesTerm(haystack: string, term: string): boolean {
    if (haystack.includes(term)) return true;
    // "discoveries" -> "discovery"
    if (term.length > 4 && term.endsWith("ies") && haystack.includes(`${term.slice(0, -3)}y`)) return true;
    // "logs" -> "log"
    if (term.length > 3 && term.endsWith("s") && haystack.includes(term.slice(0, -1))) return true;
    // "log" -> "logs"
    if (term.length >= 3 && haystack.includes(`${term}s`)) return true;
    return false;
}

function evaluateCapability(capability: string, corpus: BlueprintCorpus): DeclaredCapabilityDrift {
    const terms = capabilityTerms(capability);
    const significant = terms.filter((term) => !GENERIC_TERMS.has(term));
    const matched: string[] = [];
    const missing: string[] = [];
    const evidence = new Set<string>();

    for (const term of terms) {
        const hits = corpus.documents.filter((doc) => matchesTerm(doc.haystack, term));
        if (hits.length === 0) {
            missing.push(term);
            continue;
        }
        matched.push(term);
        // Only distinctive terms justify citing a file — otherwise every
        // blueprint would "evidence" everything via the word "app".
        if (!GENERIC_TERMS.has(term)) {
            for (const hit of hits.slice(0, 3)) evidence.add(hit.relativePath);
        }
    }

    // Verification rides on the DISTINCTIVE terms only. A capability made
    // entirely of generic words can never be verified, however well it matches.
    const matchedSignificant = significant.filter((term) => matched.includes(term));
    const weakMatch = significant.length === 0;
    const status: CapabilityEvidenceStatus = weakMatch
        ? (matched.length > 0 ? "partial" : "unverified")
        : matchedSignificant.length === significant.length
            ? "verified"
            : matchedSignificant.length > 0
                ? "partial"
                : "unverified";

    return {
        capability,
        status,
        matchedTerms: matched,
        // Report only the distinctive gaps — a missing "ready" is noise.
        missingTerms: missing.filter((term) => !GENERIC_TERMS.has(term)),
        weakMatch,
        evidence: Array.from(evidence).sort().slice(0, 3),
    };
}

function statusFor(
    declaredInRegistry: boolean,
    hasImplementation: boolean,
    capabilities: DeclaredCapabilityDrift[],
): BlueprintDriftStatus {
    if (!declaredInRegistry) return "undeclared";
    if (!hasImplementation) return "missing_implementation";
    if (capabilities.length === 0) return "unevidenced";

    // A weak match is not a confirmation — it must not earn "aligned".
    const solid = capabilities.filter((c) => c.status === "verified" && !c.weakMatch).length;
    if (solid === capabilities.length) return "aligned";
    return solid > 0 || capabilities.some((c) => c.status === "partial") ? "partially_evidenced" : "unevidenced";
}

// --- Entry point ------------------------------------------------------------

export async function scanBlueprintDrift(input: BlueprintDriftInput): Promise<BlueprintDriftSummary> {
    const root = input.blueprintRoot ?? DEFAULT_BLUEPRINT_ROOT;
    const repoRoot = input.repoRoot ?? process.cwd();

    let directories: string[] = [];
    try {
        const entries = await readdir(root, { withFileTypes: true });
        directories = entries
            .filter((entry) => entry.isDirectory() && !NON_BLUEPRINT_DIRS.has(entry.name) && !PRUNED_DIRS.has(entry.name))
            .map((entry) => entry.name)
            .sort();
    } catch {
        // No blueprint tree in this checkout. Every registry entry is then
        // genuinely unimplemented here, which is what gets reported.
        logger.warn(`Blueprint root not found at ${root}; reporting registry entries as unimplemented`);
    }

    const implemented = new Set(directories);
    const declaredBySlug = new Map(input.declared.map((entry) => [entry.slug, entry.capabilities]));
    const slugs = Array.from(new Set([...declaredBySlug.keys(), ...directories])).sort();

    const blueprints: BlueprintDriftFact[] = [];
    for (const slug of slugs) {
        const declaredInRegistry = declaredBySlug.has(slug);
        const hasImplementation = implemented.has(slug);

        // Only build a corpus when there is something to check it against.
        const needsCorpus = hasImplementation && declaredInRegistry;
        const corpus = needsCorpus
            ? await buildCorpus(path.join(root, slug), repoRoot)
            : { fileCount: 0, documents: [] };

        const capabilities = needsCorpus
            ? (declaredBySlug.get(slug) ?? [])
                .map((capability) => evaluateCapability(capability, corpus))
                .sort((a, b) => a.capability.localeCompare(b.capability))
            : [];

        blueprints.push({
            slug,
            status: statusFor(declaredInRegistry, hasImplementation, capabilities),
            declaredInRegistry,
            hasImplementation,
            sourceFileCount: corpus.fileCount,
            capabilities,
        });
    }

    const allCapabilities = blueprints.flatMap((b) => b.capabilities);
    return {
        root,
        blueprints,
        counts: {
            aligned: blueprints.filter((b) => b.status === "aligned").length,
            partiallyEvidenced: blueprints.filter((b) => b.status === "partially_evidenced").length,
            unevidenced: blueprints.filter((b) => b.status === "unevidenced").length,
            missingImplementation: blueprints.filter((b) => b.status === "missing_implementation").length,
            undeclared: blueprints.filter((b) => b.status === "undeclared").length,
            declaredCapabilities: allCapabilities.length,
            verifiedCapabilities: allCapabilities.filter((c) => c.status === "verified" && !c.weakMatch).length,
        },
    };
}
