import { forgeValidatorService, isGalleryScannableFile } from "./forge-validator.service.js";
import { resolveForgeWorkspacePath } from "./forge-paths.js";

/**
 * What an existing app is actually made of, and what that means for changing it.
 *
 * An Instant App already on disk is the fastest path to a working application —
 * but only if the studio knows what it is looking at. Modifying a bespoke
 * hand-built UI the way you would modify a gallery scaffold is how someone's
 * deliberate design gets quietly replaced, which is the outcome the migration
 * rules exist to forbid.
 *
 * So this reads the workspace and reports facts, and `classifyScaffold` turns
 * those facts into one of five classes with the evidence attached. Every
 * signal here is measured from files on disk; nothing is inferred from the
 * app's name, its blueprint, or what a model believes about it.
 */

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache", "build", "coverage"]);
const MAX_FILES = 400;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_DEPTH = 12;

/** Raw controls the gallery has a direct equivalent for — mappable without redesign. */
const MAPPABLE_TAGS = ["button", "input", "select", "textarea", "table", "dialog", "form"];

export interface ScaffoldFile {
    path: string;
    usesGallery: boolean;
    /** Raw HTML control tags found in this file. */
    rawControls: string[];
    hardcodedColour: boolean;
    /** Local (non-gallery, non-library) component imports. */
    localComponentImports: number;
    bytes: number;
}

export interface ScaffoldInspection {
    slug: string;
    /** False when the workspace could not be read at all. */
    found: boolean;
    uiFiles: ScaffoldFile[];
    pages: string[];
    apiRoutes: string[];
    /** Dependency names from package.json, or empty when there is none. */
    dependencies: string[];
    hasPackageJson: boolean;
    hasGlobalStylesheet: boolean;
    /** globals.css (or equivalent) declares the semantic token contract. */
    hasSemanticTokens: boolean;
    truncated: boolean;
}

export type ScaffoldClass =
    | "gallery-native"
    | "gallery-compatible"
    | "legacy"
    | "custom"
    | "unhealthy";

export interface ScaffoldClassification {
    classification: ScaffoldClass;
    /** Why, in terms an author can check against their own app. */
    reasons: string[];
    /** Files a migration would touch. Empty for gallery-native. */
    migratableFiles: string[];
    /**
     * Files carrying bespoke UI that a migration must not rewrite.
     *
     * Named separately because "never silently replace unsupported custom
     * components" is only enforceable if the set is known before a patch runs.
     */
    preserveFiles: string[];
}

const EMPTY_INSPECTION = (slug: string): ScaffoldInspection => ({
    slug,
    found: false,
    uiFiles: [],
    pages: [],
    apiRoutes: [],
    dependencies: [],
    hasPackageJson: false,
    hasGlobalStylesheet: false,
    hasSemanticTokens: false,
    truncated: false,
});

/** Tokens a gallery-styled app must publish for its components to render correctly. */
const REQUIRED_TOKENS = ["--background", "--foreground", "--primary", "--border"];

const GALLERY_IMPORT = /from\s+['"](?:@domain-ui\/packaged(?:\/[^'"]*)?|@\/components\/ui\/[^'"]+|@domain-ui\/core\/ui\/components\/ui\/[^'"]+)['"]/;
const LOCAL_COMPONENT_IMPORT = /from\s+['"](?:\.{1,2}\/[^'"]*components?\/[^'"]+|@\/(?!components\/ui\/)[^'"]*components?\/[^'"]+)['"]/g;

/**
 * Read an app's workspace.
 *
 * Never throws: an unreadable workspace returns `found: false`, which
 * classifies as unhealthy rather than crashing the studio that asked.
 */
export async function inspectScaffold(slug: string): Promise<ScaffoldInspection> {
    let fs: typeof import("node:fs/promises");
    let path: typeof import("node:path");
    try {
        fs = await import("node:fs/promises");
        path = await import("node:path");
    } catch {
        return EMPTY_INSPECTION(slug);
    }

    let root: string;
    try {
        root = await resolveForgeWorkspacePath(slug);
        await fs.access(root);
    } catch {
        return EMPTY_INSPECTION(slug);
    }

    const result: ScaffoldInspection = { ...EMPTY_INSPECTION(slug), found: true };

    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH) return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (result.uiFiles.length >= MAX_FILES) {
                result.truncated = true;
                return;
            }
            if (SKIP_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith(".") && entry.name !== ".") continue;

            const full = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                await walk(full, relPath, depth + 1);
                continue;
            }

            const lower = relPath.toLowerCase();

            if (lower.endsWith("package.json") && !rel) {
                result.hasPackageJson = true;
                try {
                    const pkg = JSON.parse(await fs.readFile(full, "utf-8"));
                    result.dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
                } catch {
                    // A malformed package.json is itself a health signal; the
                    // dependency list simply stays empty.
                }
                continue;
            }

            if (/globals?\.css$|global\.css$/.test(lower)) {
                result.hasGlobalStylesheet = true;
                try {
                    const css = await fs.readFile(full, "utf-8");
                    result.hasSemanticTokens = REQUIRED_TOKENS.every((t) => css.includes(t));
                } catch {
                    /* unreadable stylesheet leaves hasSemanticTokens false */
                }
                continue;
            }

            if (/(^|\/)api\//.test(lower) && /\.(ts|js)$/.test(lower)) result.apiRoutes.push(relPath);
            if (!isGalleryScannableFile(relPath)) continue;

            let content: string;
            let bytes = 0;
            try {
                const stat = await fs.stat(full);
                bytes = stat.size;
                if (bytes > MAX_FILE_BYTES) continue;
                content = await fs.readFile(full, "utf-8");
            } catch {
                continue;
            }

            if (/(^|\/)(app|pages)\//.test(lower)) result.pages.push(relPath);

            const issues = forgeValidatorService.scanGalleryConformance(relPath, content);
            const rawControls = MAPPABLE_TAGS.filter((tag) =>
                issues.some((i) => i.message.includes(`Raw <${tag}>`)),
            );

            result.uiFiles.push({
                path: relPath,
                usesGallery: GALLERY_IMPORT.test(content),
                rawControls,
                hardcodedColour: issues.some((i) => i.message.includes("Hardcoded colour")),
                localComponentImports: (content.match(LOCAL_COMPONENT_IMPORT) ?? []).length,
                bytes,
            });
        }
    };

    await walk(root, "", 0);
    return result;
}

/**
 * Decide what kind of scaffold this is.
 *
 * Order matters, and it is ordered by cost of being wrong:
 *
 *  1. Unhealthy first. Migrating something that does not run produces a broken
 *     app with different code in it, which is strictly worse than the broken
 *     app the author already had.
 *  2. Custom next. Bespoke UI must be recognised BEFORE it looks like legacy
 *     markup to be modernised, because the two are indistinguishable by raw-tag
 *     count alone and only one of them is safe to rewrite.
 *  3. Then the gallery classes, from cleanest to dirtiest.
 */
export function classifyScaffold(inspection: ScaffoldInspection): ScaffoldClassification {
    const reasons: string[] = [];

    if (!inspection.found) {
        return {
            classification: "unhealthy",
            reasons: ["The workspace could not be read."],
            migratableFiles: [],
            preserveFiles: [],
        };
    }

    if (inspection.uiFiles.length === 0) {
        return {
            classification: "unhealthy",
            reasons: [
                inspection.hasPackageJson
                    ? "The workspace has no UI files to render."
                    : "The workspace has no package.json and no UI files.",
            ],
            migratableFiles: [],
            preserveFiles: [],
        };
    }

    if (!inspection.hasPackageJson) {
        reasons.push("No package.json, so the app cannot install or start.");
        return { classification: "unhealthy", reasons, migratableFiles: [], preserveFiles: [] };
    }

    const withFindings = inspection.uiFiles.filter((f) => f.rawControls.length > 0 || f.hardcodedColour);
    const galleryFiles = inspection.uiFiles.filter((f) => f.usesGallery);

    /*
     * Bespoke UI: a file that builds its own components rather than reaching for
     * the gallery's. Several local component imports and no gallery import is
     * somebody's own design, not markup that was never modernised — and the two
     * cannot be told apart by counting raw tags.
     */
    const bespoke = inspection.uiFiles.filter((f) => !f.usesGallery && f.localComponentImports >= 2);
    const preserveFiles = bespoke.map((f) => f.path);

    if (bespoke.length > 0 && bespoke.length >= inspection.uiFiles.length / 2) {
        reasons.push(
            `${bespoke.length} of ${inspection.uiFiles.length} UI files compose their own components rather than the gallery's.`,
        );
        reasons.push("Bespoke UI is preserved rather than migrated.");
        return {
            classification: "custom",
            reasons,
            migratableFiles: inspection.uiFiles.filter((f) => !preserveFiles.includes(f.path) && (f.rawControls.length > 0 || f.hardcodedColour)).map((f) => f.path),
            preserveFiles,
        };
    }

    if (withFindings.length === 0 && galleryFiles.length > 0) {
        reasons.push(`All ${inspection.uiFiles.length} UI files draw from the gallery.`);
        if (!inspection.hasSemanticTokens && inspection.hasGlobalStylesheet) {
            reasons.push("The global stylesheet is missing part of the semantic token contract.");
        }
        return { classification: "gallery-native", reasons, migratableFiles: [], preserveFiles };
    }

    // Everything with a finding is a migration candidate, minus anything held
    // back as bespoke.
    const migratableFiles = withFindings.filter((f) => !preserveFiles.includes(f.path)).map((f) => f.path);

    /*
     * Compatible vs legacy turns on whether the raw controls have gallery
     * equivalents and whether the app draws from the gallery at all. An app
     * already importing gallery components that also uses a few raw controls
     * can be mapped in place; one that imports none needs its styling contract
     * established first, which is a different and larger job.
     */
    const allMappable = withFindings.every((f) => f.rawControls.every((t) => MAPPABLE_TAGS.includes(t)));

    if (galleryFiles.length > 0 && allMappable) {
        reasons.push(`${galleryFiles.length} of ${inspection.uiFiles.length} UI files already use the gallery.`);
        reasons.push(`${migratableFiles.length} file(s) use raw controls that map to gallery equivalents.`);
        return { classification: "gallery-compatible", reasons, migratableFiles, preserveFiles };
    }

    reasons.push(
        galleryFiles.length === 0
            ? "No UI file imports a gallery component."
            : `Only ${galleryFiles.length} of ${inspection.uiFiles.length} UI files use the gallery.`,
    );
    if (!inspection.hasSemanticTokens) reasons.push("The semantic token contract is not fully declared.");
    return { classification: "legacy", reasons, migratableFiles, preserveFiles };
}
