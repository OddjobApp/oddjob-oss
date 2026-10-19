/**
 * The styling contract a forged app must satisfy for gallery components to
 * render as designed — and the deterministic repair of the parts that can be
 * repaired without guessing.
 *
 * Every gallery primitive is written against semantic tokens: `bg-background`
 * resolves to `hsl(var(--background))`. If the app never declares `--background`,
 * the class still applies and the colour resolves to nothing — so the component
 * mounts, the page renders, and it renders unstyled. Nothing throws, no test
 * fails, and the build reports success over an app that looks broken.
 *
 * That is the failure this module exists to catch: a preview that is blank or
 * unstyled must not be reported as a completed build.
 */

/**
 * Tokens the gallery's own primitives resolve against.
 *
 * Taken from the platform's index.css rather than invented here — a component
 * asking for a token the platform does not publish is a different bug, and one
 * this check would hide by inventing a default for it.
 */
export const REQUIRED_TOKENS = [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--destructive-foreground",
    "--border",
    "--input",
    "--ring",
    "--radius",
] as const;

/**
 * A light-mode default for each token, used only to repair a MISSING
 * declaration.
 *
 * Never used to replace one the app already has: an author who set their own
 * primary colour meant it, and "repair" that overwrites intent is vandalism.
 */
const TOKEN_DEFAULTS: Record<string, string> = {
    "--background": "0 0% 100%",
    "--foreground": "222 47% 11%",
    "--card": "0 0% 100%",
    "--card-foreground": "222 47% 11%",
    "--popover": "0 0% 100%",
    "--popover-foreground": "222 47% 11%",
    "--primary": "222 47% 11%",
    "--primary-foreground": "210 40% 98%",
    "--secondary": "210 40% 96%",
    "--secondary-foreground": "222 47% 11%",
    "--muted": "210 40% 96%",
    "--muted-foreground": "215 16% 47%",
    "--accent": "210 40% 96%",
    "--accent-foreground": "222 47% 11%",
    "--destructive": "0 84% 60%",
    "--destructive-foreground": "210 40% 98%",
    "--border": "214 32% 91%",
    "--input": "214 32% 91%",
    "--ring": "222 47% 11%",
    "--radius": "0.5rem",
};

export type ContractCheckId =
    | "stylesheet-present"
    | "token-contract"
    | "global-styles-loaded"
    | "tailwind-content"
    | "undefined-tokens";

export interface ContractCheck {
    id: ContractCheckId;
    ok: boolean;
    detail: string;
    /** Whether a deterministic repair exists for this failure. */
    repairable: boolean;
}

export interface ContractReport {
    slug: string;
    checks: ContractCheck[];
    ok: boolean;
    /** True when every failure has a deterministic repair. */
    fullyRepairable: boolean;
}

const STYLESHEET_CANDIDATES = ["app/globals.css", "src/app/globals.css", "styles/globals.css", "src/styles/globals.css", "src/index.css"];
const ENTRY_CANDIDATES = ["app/layout.tsx", "src/app/layout.tsx", "pages/_app.tsx", "src/pages/_app.tsx", "src/main.tsx"];
const TAILWIND_CANDIDATES = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"];

async function firstExisting(root: string, candidates: string[]): Promise<string | null> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const rel of candidates) {
        try {
            await fs.access(path.join(root, rel));
            return rel;
        } catch {
            /* keep looking */
        }
    }
    return null;
}

/** Token names a stylesheet declares, e.g. `--background: 0 0% 100%;`. */
function declaredTokens(css: string): Set<string> {
    return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
}

/** Token names the app's own code references through var(). */
function referencedTokens(source: string): Set<string> {
    return new Set([...source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
}

export async function validateGalleryContract(slug: string): Promise<ContractReport> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");
    const { isGalleryScannableFile } = await import("./forge-validator.service.js");

    const checks: ContractCheck[] = [];
    let root: string;
    try {
        root = await resolveForgeWorkspacePath(slug);
        await fs.access(root);
    } catch {
        return {
            slug,
            checks: [{ id: "stylesheet-present", ok: false, detail: "The workspace could not be read.", repairable: false }],
            ok: false,
            fullyRepairable: false,
        };
    }

    /* ── The global stylesheet ─────────────────────────────────────────── */
    const stylesheet = await firstExisting(root, STYLESHEET_CANDIDATES);
    checks.push({
        id: "stylesheet-present",
        ok: stylesheet !== null,
        detail: stylesheet ? `Global stylesheet at ${stylesheet}.` : "No global stylesheet found.",
        // Creating one from nothing needs to know where the framework expects
        // it, which depends on a router layout this cannot infer.
        repairable: false,
    });

    let css = "";
    if (stylesheet) {
        css = await fs.readFile(path.join(root, stylesheet), "utf-8").catch(() => "");
    }

    const declared = declaredTokens(css);
    const missing = REQUIRED_TOKENS.filter((t) => !declared.has(t));
    checks.push({
        id: "token-contract",
        ok: stylesheet !== null && missing.length === 0,
        detail: missing.length === 0
            ? "The semantic token contract is complete."
            : `Missing ${missing.length} token(s): ${missing.join(", ")}. Gallery components using them render unstyled.`,
        repairable: stylesheet !== null,
    });

    /* ── The entry point loads it ──────────────────────────────────────── */
    const entry = await firstExisting(root, ENTRY_CANDIDATES);
    let entrySource = "";
    if (entry) entrySource = await fs.readFile(path.join(root, entry), "utf-8").catch(() => "");
    const loadsStyles = /import\s+["'][^"']*globals?\.css["']|import\s+["'][^"']*index\.css["']/.test(entrySource);
    checks.push({
        id: "global-styles-loaded",
        ok: entry !== null && loadsStyles,
        detail: !entry
            ? "No entry point found to load the global stylesheet."
            : loadsStyles
              ? `${entry} loads the global stylesheet.`
              : `${entry} does not import the global stylesheet, so no token resolves at runtime.`,
        repairable: entry !== null && stylesheet !== null && !loadsStyles,
    });

    /* ── Tailwind sees the components ──────────────────────────────────── */
    const tailwind = await firstExisting(root, TAILWIND_CANDIDATES);
    let tailwindSource = "";
    if (tailwind) tailwindSource = await fs.readFile(path.join(root, tailwind), "utf-8").catch(() => "");
    // Components living outside the scanned globs have their classes stripped
    // by the JIT compiler — the component renders with class names that match
    // no generated CSS, which looks exactly like an unstyled page.
    const coversComponents = /components/.test(tailwindSource);
    checks.push({
        id: "tailwind-content",
        ok: tailwind !== null && coversComponents,
        detail: !tailwind
            ? "No Tailwind config found."
            : coversComponents
              ? "Tailwind scans the component directories."
              : "Tailwind's content globs do not cover the component directories; their classes will be stripped from the build.",
        repairable: tailwind !== null && !coversComponents,
    });

    /* ── Nothing references a token that does not exist ────────────────── */
    const referenced = new Set<string>();
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (depth > 8) return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (["node_modules", ".next", "dist", ".git", "build"].includes(e.name)) continue;
            if (e.name.startsWith(".")) continue;
            const full = path.join(dir, e.name);
            const relPath = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                await walk(full, relPath, depth + 1);
            } else if (isGalleryScannableFile(relPath) || relPath.endsWith(".css")) {
                const content = await fs.readFile(full, "utf-8").catch(() => "");
                for (const token of referencedTokens(content)) referenced.add(token);
            }
        }
    };
    await walk(root, "", 0);

    const undefinedTokens = [...referenced].filter((t) => !declared.has(t) && !REQUIRED_TOKENS.includes(t as any));
    checks.push({
        id: "undefined-tokens",
        ok: undefinedTokens.length === 0,
        detail: undefinedTokens.length === 0
            ? "Every referenced token is declared."
            : `References ${undefinedTokens.length} undeclared token(s): ${undefinedTokens.slice(0, 6).join(", ")}.`,
        // Inventing a value for a token the author made up is a guess about
        // what they meant it to look like.
        repairable: false,
    });

    const failed = checks.filter((c) => !c.ok);
    return {
        slug,
        checks,
        ok: failed.length === 0,
        fullyRepairable: failed.length > 0 && failed.every((c) => c.repairable),
    };
}

export interface ContractRepair {
    repaired: string[];
    remaining: ContractCheck[];
    ok: boolean;
}

/**
 * Repair what can be repaired deterministically, then re-validate.
 *
 * Only ever ADDS what is missing. A token the app already declares is left
 * alone, because an author who set their own primary colour meant it.
 */
export async function repairGalleryContract(slug: string): Promise<ContractRepair> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");

    const root = await resolveForgeWorkspacePath(slug);
    const before = await validateGalleryContract(slug);
    const repaired: string[] = [];

    const failing = (id: ContractCheckId) => before.checks.find((c) => c.id === id && !c.ok && c.repairable);

    if (failing("token-contract")) {
        const stylesheet = await firstExisting(root, STYLESHEET_CANDIDATES);
        if (stylesheet) {
            const full = path.join(root, stylesheet);
            const css = await fs.readFile(full, "utf-8").catch(() => "");
            const declared = declaredTokens(css);
            const missing = REQUIRED_TOKENS.filter((t) => !declared.has(t));
            if (missing.length > 0) {
                const block = [
                    "",
                    "/* Oddjob semantic token contract — added by Forge repair.",
                    "   Gallery components resolve their colours through these; without them",
                    "   the classes still apply and the colours resolve to nothing. */",
                    ":root {",
                    ...missing.map((t) => `  ${t}: ${TOKEN_DEFAULTS[t]};`),
                    "}",
                    "",
                ].join("\n");
                await fs.writeFile(full, css + block, "utf-8");
                repaired.push(`Declared ${missing.length} missing token(s) in ${stylesheet}.`);
            }
        }
    }

    if (failing("global-styles-loaded")) {
        const entry = await firstExisting(root, ENTRY_CANDIDATES);
        const stylesheet = await firstExisting(root, STYLESHEET_CANDIDATES);
        if (entry && stylesheet) {
            const full = path.join(root, entry);
            const source = await fs.readFile(full, "utf-8").catch(() => "");
            // Relative to the entry, so the import resolves whichever layout the
            // scaffold used.
            const rel = path
                .relative(path.dirname(path.join(root, entry)), path.join(root, stylesheet))
                .split(path.sep)
                .join("/");
            const specifier = rel.startsWith(".") ? rel : `./${rel}`;
            // Below any "use client" directive, which has to stay first.
            const directive = source.match(/^\s*["']use [a-z]+["'];?\s*\n/);
            const at = directive ? directive[0].length : 0;
            await fs.writeFile(full, `${source.slice(0, at)}import "${specifier}";\n${source.slice(at)}`, "utf-8");
            repaired.push(`Imported ${stylesheet} from ${entry}.`);
        }
    }

    if (failing("tailwind-content")) {
        const tailwind = await firstExisting(root, TAILWIND_CANDIDATES);
        if (tailwind) {
            const full = path.join(root, tailwind);
            const source = await fs.readFile(full, "utf-8").catch(() => "");
            const globs = `"./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./pages/**/*.{ts,tsx}"`;
            const patched = source.replace(/content\s*:\s*\[([\s\S]*?)\]/, (whole, inner) =>
                inner.trim().length === 0 ? `content: [${globs}]` : `content: [${inner.trim().replace(/,$/, "")}, ${globs}]`,
            );
            if (patched !== source) {
                await fs.writeFile(full, patched, "utf-8");
                repaired.push(`Extended Tailwind content globs in ${tailwind}.`);
            }
        }
    }

    const after = await validateGalleryContract(slug);
    return { repaired, remaining: after.checks.filter((c) => !c.ok), ok: after.ok };
}
