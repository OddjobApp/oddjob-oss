import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import os from "os";
import crypto from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The dep optimizer commits a run by renaming deps_temp_<hash>/ over deps/.
// This checkout lives under OneDrive, whose sync engine keeps handles open on
// files the moment they are written, so that rename fails with EPERM; Vite
// retries for 5s (safeRename) and then gives up. The commit therefore NEVER
// lands: deps/ is never created, so every prebundled import 404s or 504s as
// "Outdated Optimize Dep" ("Failed to fetch dynamically imported module"),
// every server start re-optimizes from scratch, and the cache dir fills with
// orphaned deps_temp_* husks. OneDrive cannot be told to skip a subfolder of a
// synced library, so the cache has to live outside the synced tree entirely.
// Keyed by checkout path so multiple clones do not share one cache.
const checkoutCacheKey = crypto.createHash("sha1").update(__dirname).digest("hex").slice(0, 8);
const dependencyLockPath = path.resolve(__dirname, "package-lock.json");
const dependencyCacheKey = crypto
  .createHash("sha1")
  .update(fs.existsSync(dependencyLockPath) ? fs.readFileSync(dependencyLockPath) : "no-package-lock")
  // Optimizer aliases/dedupes are part of the generated module graph too. A
  // lock-only key reused the old React/Zustand chunks after this config changed,
  // allowing an open tab to combine two React dispatchers.
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex")
  .slice(0, 8);

export const cacheDir =
  process.platform === "win32"
    ? path.resolve(
        process.env.LOCALAPPDATA || os.tmpdir(),
        "oddjob-vite-cache",
        `${checkoutCacheKey}-${dependencyCacheKey}`,
      )
    : path.resolve(__dirname, "node_modules", ".vite");

// A dependency/configuration generation owns its prebundle. Reusing another
// generation through a junction mixes module hashes and lets re-optimization
// remove a cache still referenced by open tabs. Let Vite build this directory.

export default defineConfig({
  cacheDir,
  plugins: [
    react(),
    {
      name: "browser-external-boundary",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const dependency of [...output.imports, ...output.dynamicImports]) {
            if (bundle[dependency] || dependency.startsWith(".") || dependency.startsWith("/") || /^(https?|data|blob):/.test(dependency)) continue;
            this.error(`Browser chunk ${output.fileName} contains unresolved server dependency: ${dependency}`);
          }
        }
      },
    },
    ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
      ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer(),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner(),
        ),
      ]
      : []),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "zustand", "use-sync-external-store", "@tanstack/react-query"],
    alias: {
      "react": path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "node_modules/react/jsx-dev-runtime"),
      "zustand": path.resolve(__dirname, "node_modules/zustand"),
      "use-sync-external-store": path.resolve(__dirname, "node_modules/use-sync-external-store"),
      "@tanstack/react-query": path.resolve(__dirname, "node_modules/@tanstack/react-query"),
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@server": path.resolve(__dirname, "server"),
      "@domain": path.resolve(__dirname, "server", "domain"),
      "@domain-ui": path.resolve(__dirname, "server", "domain"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      "@oddjob/shared-utils": path.resolve(__dirname, "packages", "shared-utils", "src"),
      // The CommonJS package root eagerly imports CronFileParser and fs/promises.
      // Shared calendar logic needs only expression parsing in browser builds.
      "cron-parser": path.resolve(__dirname, "node_modules", "cron-parser", "dist", "CronExpressionParser.js"),
    },
  },
  optimizeDeps: {
    entries: [
      "index.html",
      "login.html",
      "operations.html",
      "intelligence.html",
      "knowledge.html",
      "armory.html",
      "admin.html",
      "dashboard.html",
      "observability.html",
      "pipelines.html",
      "*.html",
      "client/*.html",
    ],
    include: [
      "react",
      "react-dom",
      "zustand",
      "use-sync-external-store",
      "wouter",
      "@tanstack/react-query",
      "framer-motion",
      "clsx",
      "tailwind-merge",
      "date-fns",
      // Only imported by lazily-loaded routes (ProjectSpacePage, StageCycle), so
      // Vite discovers it mid-session and triggers a re-optimize. On this
      // Windows/OneDrive checkout the optimizer cannot rename deps_temp_* into
      // deps/, so that re-optimize never completes and the dep 504s for the rest
      // of the server's life â€” surfacing as "Failed to fetch dynamically
      // imported module". Listing it here pre-bundles it during the startup
      // optimize, which does succeed.
      "cronstrue",
      "cron-parser",
      "react-hook-form",
      "@hookform/resolvers/zod",
      "zod",
      "h3-js",
      "d3",
      "embla-carousel-react",
      "input-otp",
      "react-day-picker",
      "next-themes",
      "react-map-gl",
      "mapbox-gl",
      "lucide-react",
      "dagre",
      "react-force-graph-2d",
      "react-force-graph-3d",
      "3d-force-graph",
      "force-graph",
      "three-forcegraph",
      "three-render-objects",
      "react-kapsule",
      "kapsule",
      "accessor-fn",
      "three",
      "three-spritetext",
      "react-resize-detector",
      "react-syntax-highlighter",
      // Deep subpaths are separate optimize entries: covering the package root
      // does not cover them, and a lazy route that first imports one triggers
      // the mid-session re-optimize that wedges `deps/` on this machine.
      "react-syntax-highlighter/dist/esm/prism",
      "react-syntax-highlighter/dist/esm/styles/prism",
      "zustand/middleware",
      "js-yaml",
      "uuid",
      "axios",
      "react-router-dom",
      "reactflow",
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-aspect-ratio",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-label",
      "@radix-ui/react-menubar",
      "@radix-ui/react-navigation-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-progress",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-slot",
      "class-variance-authority",
      "cmdk",
      "react-markdown",
      "remark-gfm",
      "mermaid",
      "@monaco-editor/react",
      "recharts",
      // Same failure mode as cronstrue above: each of these is imported only
      // from lazily-loaded routes, so without an entry here the first visit
      // re-optimizes mid-session and the dep 504s (react-resizable-panels broke
      // FormsBuilder this way).
      "react-resizable-panels",
      // Same failure mode again: imported only by lazily-mounted surfaces
      // (AgentChatPanel's virtualized transcript, the mission dashboards), so
      // the first visit re-optimizes mid-session, the browserHash flips, and
      // already-loaded modules keep the old ?v= react while new deps get the
      // new one â€” two React instances, and the first useState in the lazy
      // component reads a null dispatcher.
      "react-virtuoso",
      // Discovered mid-session by the browser crawl (admin credentials uses
      // react-icons/si, pipelines uses @hello-pangea/dnd, useMonacoEditor imports
      // monaco-editor directly, packaged blocks use embla autoplay and
      // cytoscape). Each discovery re-optimizes and 504s every ?v= dep URL the
      // page already holds â€” "Failed to fetch dynamically imported module".
      "react-icons/si",
      "@hello-pangea/dnd",
      "monaco-editor",
      "embla-carousel-autoplay",
      "cytoscape",
      "vaul",
      "fuzzysort",
      "rehype-raw",
      "rehype-sanitize",
      "turndown",
      "dompurify",
      "marked",
      "@mui/material",
      "@mui/icons-material",
      // Reached only through lazily-loaded pages that import a value (not just
      // a type) from shared/schema: Scribe's ScribeLensType pulls in scribe.ts,
      // which imports crew.ts and agent-cards.ts and with them drizzle. The
      // mid-session re-optimize this triggered wedged deps/ on 2026-10-18.
      "drizzle-orm",
      "drizzle-orm/pg-core",
      "drizzle-zod",
    ],
  },
  server: {
    fs: {
      allow: [
        path.resolve(__dirname, "client"),
        path.resolve(__dirname, "server/domain"),
        path.resolve(__dirname, "shared"),
        path.resolve(__dirname, "packages"),
        path.resolve(__dirname, "attached_assets"),
        path.resolve(__dirname, "node_modules"),
        // Vite does NOT add cacheDir to fs.allow automatically, and ours now
        // lives outside the project root â€” without this the browser cannot
        // load a single prebundled dep.
        cacheDir,
      ],
    },
    hmr: {
      overlay: false,
      path: "/vite-hmr",
    },
    headers: {
      'Content-Security-Policy': "frame-src 'self' http://localhost:5000;",
    },
    proxy: process.env.VITE_AS_MIDDLEWARE === 'true' ? undefined : {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        timeout: 300000,
        proxyTimeout: 300000
      },
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: process.env.VITE_SOURCEMAP === "true",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: process.env.NODE_ENV === "production",
        drop_debugger: true,
        pure_funcs: ["console.log", "console.debug"],
      },
    },
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      external: [
        "snowflake-sdk",
        /^@google-cloud\/.*/,
        /^google-auth-library.*/,
        /^googleapis.*/,
        /^pg.*/,
        /^express.*/,
        /^ioredis.*/,
        /^bull.*/,
        /^selenium-webdriver.*/,
        /^puppeteer.*/,
        /^playwright.*/,
        /^ws.*/,
        /^connect-pg-simple.*/,
        /^passport.*/,
        /^node:.*/,
        "https",
        "http",
        "fs",
        "fs/promises",
        "path",
        "crypto",
        "stream",
        "zlib",
        "net",
        "tls",
        "child_process",
        "os",
        "url",
        "util",
        "events",
        "buffer",
        "querystring",
        "dns",
        "v8",
        "async_hooks",
        /^@ast-grep\/.*/,
        /^ts-morph.*/,
        /\.node$/,
      ],
      input: {
        login: path.resolve(__dirname, "client", "login.html"),
        operations: path.resolve(__dirname, "client", "operations.html"),
        intelligence: path.resolve(__dirname, "client", "intelligence.html"),
        knowledge: path.resolve(__dirname, "client", "knowledge.html"),
        armory: path.resolve(__dirname, "client", "armory.html"),
      },
      output: {
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name?.split(".").pop() || "";
          if (/png|jpe?g|svg|gif|webp|ico/.test(ext)) {
            return "assets/images/[name]-[hash][extname]";
          }
          if (/woff2?|eot|ttf|otf/.test(ext)) {
            return "assets/fonts/[name]-[hash][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        // Let Rollup group dependency graphs. Hand-splitting interdependent
        // vendor packages creates circular chunks and browser TDZ failures.

      },
    },
  },
});
