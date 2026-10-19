
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { ForgeOptions } from "./forge-types.js";
import { getForgeWorkspacePath, isWithinDirectory } from "./forge-paths.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const exec = promisify(execCallback);
const logger = createLogger("ForgeWorkspaceService");

/** Workspace paths `injectBuildConfig` fills with platform UI source. */
export const INJECTED_UI_LIBRARY_PATHS = ["src/components/ui", "src/domain", "src/lib/utils.ts"] as const;

export class ForgeWorkspaceService {
    /**
     * Skill: Sanitize Imports
     * 
     * Scans all .ts/.tsx files in the workspace and fixes common path resolution errors.
     */
    async sanitizeImports(slug: string, explicitBuildPath?: string): Promise<{ fixed: number }> {
        const buildPath = explicitBuildPath ?? getForgeWorkspacePath(slug);
        let fixedCount = 0;

        const scanDir = async (dir: string) => {
            const files = await fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
                const res = path.resolve(dir, file.name);
                if (file.isDirectory()) {
                    if (file.name === 'node_modules' || file.name === '.next') continue;
                    await scanDir(res);
                } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
                    let content = await fs.readFile(res, 'utf-8');

                    if (file.name === 'LocationPicker.tsx') {
                        let hasMapDeps = false;
                        try {
                            const pkgJson = JSON.parse(await fs.readFile(path.join(buildPath, 'package.json'), 'utf-8'));
                            hasMapDeps = !!(pkgJson.dependencies?.['react-map-gl'] || pkgJson.devDependencies?.['react-map-gl']);
                        } catch {}

                        if (!hasMapDeps) {
                            content = content
                                .replace(/import\s+Map,\s*\{[^}]*\}\s*from\s+['"]react-map-gl['"];?/g,
                                    'const Map: any = ({ children, style, className }: any) => <div style={style} className={className}>{children}</div>;\nconst Marker: any = () => null;\nconst NavigationControl: any = () => null;\ntype ViewStateChangeEvent = any;')
                                .replace(/import\s+mapboxgl\s+from\s+['"]mapbox-gl['"];?/g, "const mapboxgl: any = { supported: () => false };")
                                .replace(/import\s+['"]mapbox-gl\/dist\/mapbox-gl\.css['"];?/g, "");
                        }
                    }

                    const newContent = content
                        .replace(/from\s+['"]@\/src\/(.*?)['"]/g, "from '@/$1'")
                        .replace(/from\s+['"]@\/pages\/(.*?)['"]/g, "from '@/$1'")
                        .replace(/from\s+['"]\.\/(alert|spinner|button|label)['"]/g, "from '@/components/ui/$1'")
                        .replace(/from\s+['"]\.\.\/components\/ui\/(.*?)['"]/g, "from '@/components/ui/$1'")
                        .replace(/from\s+['"]@\/components\/ui\/(.*?)['"]/g, "from '@domain-ui/core/ui/components/ui/$1'")
                        .replace(/from\s+['"]@\/hooks\/(.*?)['"]/g, "from '@domain-ui/core/ui/hooks/$1'")
                        .replace(/from\s+['"]@\/lib\/utils['"]/g, "from '@/src/lib/utils'")
                        .replace(/from\s+['"]@\/components\/(.*?)['"]/g, "from '@domain-ui/core/ui/components/$1'")
                        .replace(/^\s*import\s+['"]\.\/FormRenderer\.css['"];\s*$/gm, "");

                    if (newContent !== content) {
                        await fs.writeFile(res, newContent, 'utf-8');
                        fixedCount++;
                    }
                }
            }
        };

        try {
            await scanDir(buildPath);
            logger.info(`[SanitizeImports] ${slug}: Fixed imports in ${fixedCount} files.`);
        } catch (err: any) {
            logger.error(`[SanitizeImports] Failed to scan workspace: ${err.message}`);
        }

        return { fixed: fixedCount };
    }

    /**
     * Skill: Inject Slot Tokens
     */
    async injectSlotTokens(
        slug: string, 
        options: ForgeOptions, 
        blueprintSlug: string,
        explicitBuildPath?: string
    ): Promise<{ injected: number }> {
        const buildPath = explicitBuildPath ?? getForgeWorkspacePath(slug);
        let injectedCount = 0;

        const blackboard = options.blackboard || {};
        const tokenMap: Record<string, string> = {
            APP_TITLE: options.name || slug,
            COLLECTION_NAME: blackboard.target_collection || blackboard.collection_name || `${slug}_data`,
            ENTITY_SINGULAR: blackboard.entity_singular || blackboard.entity_name || 'Item',
            ENTITY_PLURAL: blackboard.entity_plural || `${blackboard.entity_singular || 'Item'}s`,
            AGENT_ID: String(blackboard.agent_id || options.oddjobMissionId || 1),
            PERSONA_NAME: blackboard.persona_name || blackboard.agent_name || 'AI Assistant',
            MISSION_ID: String(blackboard.mission_id || options.oddjobMissionId || ''),
            COLUMNS: JSON.stringify(blackboard.columns || blackboard.table_columns || []),
            METRICS: JSON.stringify(blackboard.metrics || blackboard.kpi_metrics || []),
            KPI_METRICS: JSON.stringify(blackboard.kpi_metrics || blackboard.metrics || []),
            STAT_CARDS: JSON.stringify(blackboard.stat_cards || blackboard.metrics || []),
            FORM_FIELDS: JSON.stringify(blackboard.form_fields || blackboard.fields || []),
            SUGGESTED_PROMPTS: JSON.stringify(blackboard.suggested_prompts || blackboard.starter_prompts || [
                "What can you help me with?",
                "How do I get started?",
                "Show me an example"
            ]),
            CHART_CONFIG: JSON.stringify(blackboard.chart_config || {
                xField: 'createdAt',
                yField: 'value',
                chartType: 'area'
            }),
            TABLE_COLUMNS: JSON.stringify(blackboard.table_columns || blackboard.columns || []),
        };

        const scanAndInject = async (dir: string) => {
            const files = await fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
                const res = path.resolve(dir, file.name);
                if (file.isDirectory()) {
                    if (file.name === 'node_modules' || file.name === '.next') continue;
                    await scanAndInject(res);
                } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx') || file.name.endsWith('.json')) {
                    let content = await fs.readFile(res, 'utf-8');
                    let modified = false;



                    for (const [token, value] of Object.entries(tokenMap)) {
                        const placeholder = `{{${token}}}`;
                        if (content.includes(placeholder)) {
                            content = content.split(placeholder).join(value);
                            modified = true;
                        }
                    }

                    if (modified) {
                        content = content.replace(
                            /\/\/ @ts-ignore - Injected by forge during assembly\n/g,
                            '// Injected by forge during assembly\n'
                        );
                        await fs.writeFile(res, content, 'utf-8');
                        injectedCount++;
                    }
                }
            }
        };

        try {
            await scanAndInject(buildPath);
            logger.info(`[InjectSlotTokens] ${slug}: Injected ${injectedCount} files with slot tokens.`);
        } catch (err: any) {
            logger.error(`[InjectSlotTokens] Failed: ${err.message}`);
        }

        return { injected: injectedCount };
    }

    async checkCompilation(slug: string, blueprintSlug: string, explicitWorkspacePath?: string): Promise<{ success: boolean; errors: string[] }> {
        const cwd = explicitWorkspacePath ?? getForgeWorkspacePath(slug);
        const errors: string[] = [];

        const isCommandMissing = (err: any): boolean => {
            const msg = (err.message || "").toLowerCase();
            return msg.includes("not recognized") || 
                   msg.includes("not found") || 
                   msg.includes("enoent") || 
                   msg.includes("cannot find the path");
        };

        try {
            if (blueprintSlug === "go-backend") {
                logger.info(`[checkCompilation] Running Go build check in ${cwd}`);
                try {
                    // Running go vet is fast and safe across platforms
                    const { stdout, stderr } = await exec("go vet ./...", { cwd, env: tenantProcessEnv() });
                    logger.info(`[checkCompilation] Go vet stdout: ${stdout}, stderr: ${stderr}`);
                } catch (err: any) {
                    if (isCommandMissing(err)) {
                        logger.warn(`[checkCompilation] Go is not installed on this system. Skipping compiler check.`);
                    } else {
                        errors.push(`Go compilation/vet error: ${err.stderr || err.message}`);
                    }
                }
            } else if (blueprintSlug === "java-backend") {
                logger.info(`[checkCompilation] Running Java build check in ${cwd}`);
                try {
                    const { stdout, stderr } = await exec("mvn compile", { cwd, env: tenantProcessEnv() });
                    logger.info(`[checkCompilation] Maven compile stdout: ${stdout}, stderr: ${stderr}`);
                } catch (err: any) {
                    if (isCommandMissing(err)) {
                        logger.warn(`[checkCompilation] Maven (mvn) is not installed on this system. Skipping compiler check.`);
                    } else {
                        errors.push(`Java compile error: ${err.stderr || err.message}`);
                    }
                }
            } else if (blueprintSlug === "python-backend") {
                logger.info(`[checkCompilation] Running Python syntax check in ${cwd}`);
                try {
                    const { stdout, stderr } = await exec("python -m compileall -q .", { cwd, env: tenantProcessEnv() });
                    logger.info(`[checkCompilation] Python compileall stdout: ${stdout}, stderr: ${stderr}`);
                } catch (err: any) {
                    if (isCommandMissing(err)) {
                        logger.warn(`[checkCompilation] Python is not installed on this system. Skipping compiler check.`);
                    } else {
                        errors.push(`Python syntax error: ${err.stderr || err.message}`);
                    }
                }
            } else {
                // Default TypeScript/NextJS/React stack
                let hasTsConfig = false;
                try {
                    await fs.access(path.join(cwd, "tsconfig.json"));
                    hasTsConfig = true;
                } catch {}

                if (hasTsConfig) {
                    logger.info(`[checkCompilation] Running TypeScript type check in ${cwd}`);
                    try {
                        const { stdout, stderr } = await exec("npx tsc --noEmit", { cwd, env: tenantProcessEnv() });
                        logger.info(`[checkCompilation] TypeScript type check stdout: ${stdout}, stderr: ${stderr}`);
                    } catch (err: any) {
                        if (isCommandMissing(err)) {
                            logger.warn(`[checkCompilation] TypeScript compiler (tsc) is not installed on this system. Skipping type check.`);
                        } else {
                            errors.push(`TypeScript type check error: ${err.stdout || err.stderr || err.message}`);
                        }
                    }
                }
            }
        } catch (err: any) {
            errors.push(`General compilation check failure: ${err.message}`);
        }

        return {
            success: errors.length === 0,
            errors
        };
    }

    async validateWorkspace(slug: string, explicitBuildPath?: string): Promise<{ valid: boolean; issues: string[] }> {
        const buildPath = explicitBuildPath ?? getForgeWorkspacePath(slug);
        const issues: string[] = [];

        // Detect stack blueprint
        let blueprint = "";
        try {
            const manifestRaw = await fs.readFile(path.join(buildPath, "oddjob.manifest.json"), "utf-8");
            const manifest = JSON.parse(manifestRaw);
            blueprint = manifest.blueprint || "";
        } catch {
            // Fallback file-based detection
            try {
                await fs.access(path.join(buildPath, "pom.xml"));
                blueprint = "java-backend";
            } catch {
                try {
                    await fs.access(path.join(buildPath, "go.mod"));
                    blueprint = "go-backend";
                } catch {
                    try {
                        await fs.access(path.join(buildPath, "requirements.txt"));
                        blueprint = "python-backend";
                    } catch {}
                }
            }
        }

        let required: string[] = [];
        if (blueprint === "go-backend") {
            required = ["go.mod", "main.go", "Dockerfile"];
        } else if (blueprint === "java-backend") {
            required = ["pom.xml", "Dockerfile"];
        } else if (blueprint === "python-backend") {
            required = ["requirements.txt", "main.py", "Dockerfile"];
        } else {
            // TypeScript web/React app
            required = [
                "package.json",
                "Dockerfile",
                "next.config.js",
                "tsconfig.json",
                "src/lib/utils.ts",
                "pages/index.tsx",
                "pages/_app.tsx",
                "styles/globals.css",
            ];
        }

        for (const file of required) {
            try {
                await fs.access(path.join(buildPath, file));
            } catch {
                issues.push(`Missing required file: ${file}`);
            }
        }

        if (blueprint !== "go-backend" && blueprint !== "java-backend" && blueprint !== "python-backend") {
            try {
                const pkg = JSON.parse(await fs.readFile(path.join(buildPath, "package.json"), "utf-8"));
                if (!pkg.scripts?.build) issues.push("package.json missing scripts.build");
                if (!pkg.scripts?.start) issues.push("package.json missing scripts.start");
                if (!pkg.dependencies?.next) issues.push("package.json missing 'next' dependency");
                if (!pkg.dependencies?.react) issues.push("package.json missing 'react' dependency");
            } catch (err: any) {
                issues.push(`Cannot read package.json: ${err.message}`);
            }
        }

        // Compilation Check Gating
        const compCheck = await this.checkCompilation(slug, blueprint, buildPath);
        if (!compCheck.success) {
            issues.push(...compCheck.errors);
        }

        return { valid: issues.length === 0, issues };
    }

    async injectBuildConfig(slug: string, blueprintSlug: string, explicitBuildPath?: string): Promise<{ success: boolean; injected: string[] }> {
        const buildPath = explicitBuildPath ?? getForgeWorkspacePath(slug);
        const injected: string[] = [];

        // next.config.js
        if (blueprintSlug !== 'react-native') {
            const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.tsx', '.ts', '.js'],
    };
    return config;
  },
};
module.exports = nextConfig;
`;
            await fs.writeFile(path.join(buildPath, "next.config.js"), nextConfig);
            injected.push("next.config.js");

            if (process.platform === "win32") {
                const babelRcPath = path.join(buildPath, ".babelrc");
                await fs.writeFile(babelRcPath, JSON.stringify({ presets: ["next/babel"] }, null, 2));
                injected.push(".babelrc");

                const swcWinPkg = path.join(buildPath, "node_modules", "@next", "swc-win32-x64-msvc");
                await fs.rm(swcWinPkg, { recursive: true, force: true }).catch(() => {});
            }
        }

        // tsconfig.json
        const tsconfig = {
            compilerOptions: {
                target: "es2017",
                lib: ["dom", "dom.iterable", "esnext"],
                allowJs: true,
                skipLibCheck: true,
                strict: true,
                noEmit: true,
                esModuleInterop: true,
                module: "esnext",
                moduleResolution: "bundler",
                resolveJsonModule: true,
                isolatedModules: true,
                jsx: "preserve",
                incremental: true,
                tsBuildInfoFile: "node_modules/.cache/tsconfig.tsbuildinfo",
                plugins: [{ name: "next" }],
                baseUrl: ".",
                paths: {
                    "@/*": ["./src/*", "./*"],
                    "@domain-ui/core/ui/components/*": ["./src/domain/core/ui/components/*"],
                    "@domain-ui/core/*": ["./src/domain/core/*"],
                    "@domain-ui/packaged/*": ["./src/domain/core/ui/components/packaged/*"],
                    "@/components/ui/*": ["./src/domain/core/ui/components/ui/*"],
                    "@/components/packaged/*": ["./src/domain/core/ui/components/packaged/*"],
                    // Try the domain tree first (`@domain-ui/rescue/ui/...` ->
                    // `src/domain/rescue/ui/...`), then fall back to the legacy
                    // components-only meaning so existing blueprints still resolve.
                    "@domain-ui/*": ["./src/domain/*", "./src/domain/core/ui/components/*"]
                },
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
            // The platform UI copied in below is a library, not app code: as a
            // root it is type-checked whole, and its Radix imports fail every
            // app that does not depend on Radix. Excluded, a file the app does
            // import is still followed and checked.
            exclude: ["node_modules", ...INJECTED_UI_LIBRARY_PATHS]
        };
        await fs.writeFile(path.join(buildPath, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
        injected.push("tsconfig.json");

        if (blueprintSlug !== 'react-native') {
            let manifestName = slug;
            let manifestDescription = `${slug} — built with Oddjob App Forge`;
            try {
                const manifestRaw = await fs.readFile(path.join(buildPath, "oddjob.manifest.json"), "utf-8");
                const manifest = JSON.parse(manifestRaw);
                manifestName = manifest.name || manifestName;
                manifestDescription = manifest.description || manifestDescription;
            } catch { /* manifest not yet written — use slug fallback */ }

            const pagesDir = path.join(buildPath, "pages");
            await fs.mkdir(pagesDir, { recursive: true });
            const safeDesc = manifestDescription.replace(/"/g, '\\"').slice(0, 160);
            const safeName = manifestName.replace(/"/g, '\\"');
            await fs.writeFile(path.join(pagesDir, "_document.tsx"),
                [
                    'import { Html, Head, Main, NextScript } from "next/document";',
                    '',
                    'export default function Document() {',
                    '  return (',
                    '    <Html lang="en">',
                    '      <Head>',
                    `        <meta name="description" content="${safeDesc}" />`,
                    `        <meta property="og:title" content="${safeName}" />`,
                    `        <meta property="og:description" content="${safeDesc}" />`,
                    '        <meta property="og:type" content="website" />',
                    '        <link rel="preconnect" href="https://fonts.googleapis.com" />',
                    '        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />',
                    '      </Head>',
                    '      <body>',
                    '        <Main />',
                    '        <NextScript />',
                    '      </body>',
                    '    </Html>',
                    '  );',
                    '}',
                    '',
                ].join('\n')
            );
            injected.push("pages/_document.tsx");
        }

        // postcss.config.js
        const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
        await fs.writeFile(path.join(buildPath, "postcss.config.js"), postcssConfig);
        injected.push("postcss.config.js");

        // tailwind.config.js
        const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      }
    }
  },
  plugins: [],
};
`;
        await fs.writeFile(path.join(buildPath, "tailwind.config.js"), tailwindConfig);
        injected.push("tailwind.config.js");

        // src/lib/utils.ts
        const libDir = path.join(buildPath, "src", "lib");
        await fs.mkdir(libDir, { recursive: true });
        await fs.writeFile(
            path.join(libDir, "utils.ts"),
            [
                'import { clsx, type ClassValue } from "clsx";',
                'import { twMerge } from "tailwind-merge";',
                '',
                'export function cn(...inputs: ClassValue[]) {',
                '  return twMerge(clsx(inputs));',
                '}',
                ''
            ].join("\n")
        );
        injected.push("src/lib/utils.ts");

        // Copy domain UI
        const componentDest = path.join(buildPath, "src/domain/core/ui/components");
        const hooksDest = path.join(buildPath, "src/domain/core/ui/hooks");
        await fs.mkdir(componentDest, { recursive: true });
        await fs.mkdir(hooksDest, { recursive: true });

        const componentSrc = path.resolve("server/domain/core/ui/components");
        const hooksSrc = path.resolve("server/domain/core/ui/hooks");
        try {
            await fs.cp(componentSrc, componentDest, { recursive: true });
            await fs.cp(hooksSrc, hooksDest, { recursive: true });
            injected.push("src/domain/core/ui/components/**", "src/domain/core/ui/hooks/**");
        } catch (err: any) {
            logger.warn(`[InjectBuildConfig] UI copy failed: ${err.message}`);
        }

        // Copy canonical client UI primitives (Button, Input, Tabs, Dialog, etc.)
        // into both src/components/ui and src/domain/core/ui/components/ui
        // so that re-export stubs in server/domain/core/ui/components/ui are replaced
        // with the real Radix UI implementations, resolving circular re-export build failures.
        const canonicalUiSrc = path.resolve("client/src/components/ui");
        const canonicalUiDest = path.join(buildPath, "src/components/ui");
        const domainUiPrimsDest = path.join(buildPath, "src/domain/core/ui/components/ui");
        try {
            await fs.mkdir(canonicalUiDest, { recursive: true });
            await fs.cp(canonicalUiSrc, canonicalUiDest, { recursive: true });
            await fs.cp(canonicalUiSrc, domainUiPrimsDest, { recursive: true });
            injected.push("src/components/ui/**", "src/domain/core/ui/components/ui/**");
        } catch (err: any) {
            logger.warn(`[InjectBuildConfig] Canonical UI copy failed: ${err.message}`);
        }

        // Copy any NON-core domain UI the blueprint imports.
        //
        // Only core/ui was ever shipped, so a blueprint importing e.g.
        // `@domain-ui/rescue/ui/modules/rescue/components/TacticalDispatchDashboard`
        // referenced a directory that did not exist in the workspace and could not
        // compile. `next start` kept serving whatever bundle was built before the
        // import was introduced, so the app looked healthy while silently running
        // months-old code — the rescue dispatch queue was serving a build that
        // predated its own test hooks.
        //
        // Discover the domains actually referenced rather than hardcoding a list,
        // so this keeps working as blueprints change.
        try {
            const referenced = new Set<string>();
            const scanRoots = ["pages", "components", "app"];
            const scanFile = async (file: string) => {
                const text = await fs.readFile(file, "utf8");
                for (const m of text.matchAll(/@domain-ui\/([a-z0-9-]+)\//gi)) {
                    const domain = m[1].toLowerCase();
                    if (domain !== "core" && domain !== "packaged") referenced.add(domain);
                }
            };
            const walk = async (dir: string) => {
                let entries: any[] = [];
                try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
                for (const entry of entries) {
                    if (entry.name === "node_modules" || entry.name === ".next") continue;
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) await walk(full);
                    else if (/\.(tsx?|jsx?)$/.test(entry.name)) await scanFile(full);
                }
            };
            for (const root of scanRoots) await walk(path.join(buildPath, root));

            for (const domain of referenced) {
                const domainSrc = path.resolve(`server/domain/${domain}/ui`);
                try {
                    await fs.access(domainSrc);
                } catch {
                    logger.warn(`[InjectBuildConfig] Blueprint imports @domain-ui/${domain}/ but server/domain/${domain}/ui does not exist`);
                    continue;
                }
                const domainDest = path.join(buildPath, `src/domain/${domain}/ui`);
                await fs.mkdir(path.dirname(domainDest), { recursive: true });
                await fs.cp(domainSrc, domainDest, { recursive: true });
                injected.push(`src/domain/${domain}/ui/**`);
                logger.info(`[InjectBuildConfig] Copied @domain-ui/${domain} UI into workspace`);
            }
        } catch (err: any) {
            logger.warn(`[InjectBuildConfig] Domain UI discovery failed: ${err.message}`);
        }

        return { success: true, injected };
    }

    async editFile(slug: string, filePath: string, content: string, explicitWorkspacePath?: string) {
        const workspacePath = explicitWorkspacePath ?? getForgeWorkspacePath(slug);
        const fullPath = path.resolve(workspacePath, filePath);
        if (!isWithinDirectory(workspacePath, fullPath)) {
            throw new Error("Invalid file path");
        }
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        return { success: true, path: filePath };
    }

    async runCommand(slug: string, command: string, args: string[], explicitWorkspacePath?: string) {
        const cwd = explicitWorkspacePath ?? getForgeWorkspacePath(slug);
        const env = tenantProcessEnv({
            NODE_ENV: command === "npm" && args[0] === "run" && args[1] === "build"
                ? "production"
                : process.env.NODE_ENV,
        });
        try {
            const { stdout, stderr } = await exec(`${command} ${args.join(' ')}`, { cwd, env });
            return { success: true, stdout, stderr };
        } catch (err: any) {
            return { success: false, error: err.message, stderr: err.stderr };
        }
    }

    async cleanupWorkspace(slug: string) {
        const buildPath = getForgeWorkspacePath(slug);
        try {
            await fs.rm(buildPath, { recursive: true, force: true });
            return { success: true, message: `Workspace ${slug} cleaned up.` };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }
}

export const forgeWorkspaceService = new ForgeWorkspaceService();
