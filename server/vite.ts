import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import fspath from "node:path";
import { fileURLToPath } from "node:url";
import { type Server } from "node:http";
import { resolveSpaTemplate } from "@shared/spa-routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const viteLogger = {
  hasWarned: false,
  warn: (msg: string) => {
    log(`[Vite:Warn] ${msg}`, "vite");
  },
  warnOnce: (msg: string) => {
    log(`[Vite:Warn] ${msg}`, "vite");
  },
  error: (msg: string) => {
    log(`[Vite:Error] ${msg}`, "vite");
  },
  info: (msg: string) => {
    log(`[Vite:Info] ${msg}`, "vite");
  },
  clearScreen: () => {},
  hasError: (err: any) => false,
  hasErrorLogged: (err: any) => false,
};

/**
 * Standard Vite Setup for Middleware Mode
 * Handles standalone login.html and main index.html breakout for performance.
 */
export async function setupVite(app: Express, server: Server) {
  log("Starting Vite middleware...", "vite");

  // Prevent infinite loop in vite.config.ts proxy
  process.env.VITE_AS_MIDDLEWARE = 'true';

  const projectRoot = process.cwd();
  const clientRoot = path.resolve(projectRoot, "client");

  // vite and vite.config.ts are dev-only dependencies — imported dynamically so
  // the production bundle (esbuild) neither bundles vite.config.ts nor emits a
  // top-level `import "vite"` that would crash dist/index.js at boot.
  const { createServer: createViteServer } = await import("vite");
  // Non-literal specifier prevents esbuild from inlining vite.config.ts into the
  // server bundle; resolved at runtime only when setupVite actually runs.
  // @ts-ignore - explicitly pointing to the ts file in the root
  const viteConfigModule = await import(new URL("../vite.config.ts", import.meta.url).href);
  const viteConfig = viteConfigModule.default;

  const vite = await createViteServer({
    ...viteConfig,
    // Use ONLY the root vite.config.ts (spread above). Without this, Vite
    // auto-discovers and merges client/vite.config.ts from `root`, which adds a
    // SECOND @vitejs/plugin-react instance — duplicating the React Refresh
    // preamble and breaking every .tsx transform ("symbol already declared").
    configFile: false,
    appType: "custom", // Important for manual control over HTML vs Assets
    root: clientRoot,
    // Explicit resolve block ensures aliases survive the spread + override chain
    // in Vite 6 middleware mode (the import-analysis plugin requires aliases to
    // be present during its initialization pass, not just at transform time).
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "zustand", "use-sync-external-store", "@tanstack/react-query"],
      alias: {
        "react": path.resolve(projectRoot, "node_modules/react"),
        "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(projectRoot, "node_modules/react/jsx-runtime"),
        "react/jsx-dev-runtime": path.resolve(projectRoot, "node_modules/react/jsx-dev-runtime"),
        "zustand": path.resolve(projectRoot, "node_modules/zustand"),
        "use-sync-external-store": path.resolve(projectRoot, "node_modules/use-sync-external-store"),
        "@tanstack/react-query": path.resolve(projectRoot, "node_modules/@tanstack/react-query"),
        "@domain-ui": path.resolve(projectRoot, "server", "domain"),
        "@domain": path.resolve(projectRoot, "server", "domain"),
        "@server": path.resolve(projectRoot, "server"),
        "@shared": path.resolve(projectRoot, "shared"),
        "@": path.resolve(projectRoot, "client", "src"),
        "@assets": path.resolve(projectRoot, "attached_assets"),
        "@oddjob/shared-utils": path.resolve(projectRoot, "packages", "shared-utils", "src"),
        ...(viteConfig.resolve?.alias || {}),
      },
    },
    // Reuse one optimizer generation across restarts. Forcing a rebuild here can
    // leave open browsers with React DOM and React Query URLs from different
    // generations, producing a null hooks dispatcher on the login page.
    optimizeDeps: {
      ...(viteConfig.optimizeDeps || {}),
      force: false,
    },
    server: {
      ...(viteConfig.server || {}),
      middlewareMode: true,
      hmr: { server, path: "/vite-hmr" },
      allowedHosts: true,
      fs: {
        ...(viteConfig.server?.fs || {}),
        strict: false,
        allow: [
          projectRoot,
          ...(viteConfig.server?.fs?.allow || []),
        ],
      },
    },
    // Must follow vite.config.ts, which moves the cache off the OneDrive-synced
    // tree so the optimizer's deps_temp_* -> deps/ rename can actually commit.
    // Hardcoding node_modules/.vite here silently reinstated the broken path.
    cacheDir: viteConfig.cacheDir ?? path.resolve(projectRoot, "node_modules", ".vite"),
    customLogger: {
      ...viteLogger,
      error: (msg: string) => viteLogger.error(msg),
      warn: (msg: string) => viteLogger.warn(msg),
      info: (msg: string) => viteLogger.info(msg),
    },
  });

  // 1. MULTI-SPA HTML ROUTER — runs BEFORE Vite's middleware to prevent
  // Vite 8's internal HTML fallback from serving index.html for all routes.
  // Only intercepts navigation requests (GET + accepts HTML + SPA path).
  // Asset requests (/@vite, /src/, /node_modules/, files with extensions) pass through.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl || "";
    const path = req.path || "";

    // Skip non-GET
    if (req.method !== "GET") return next();

    // Skip API routes
    if (path.startsWith("/api/")) return next();

    // Skip Vite internals and assets — let vite.middlewares handle these
    const isViteAsset = 
      path.startsWith("/@") || 
      path.startsWith("/src/") || 
      path.startsWith("/node_modules/") ||
      path === "/vite-hmr" ||
      (path.includes(".") && !path.endsWith(".html"));

    if (isViteAsset) return next();

    // SPA route matcher — shared with serveStatic, see shared/spa-routes.ts.
    const spaTemplate = path.includes("login.html") ? "login.html" : resolveSpaTemplate(path);

    // Only handle known SPA routes or requests that accept HTML
    const acceptsHtml = (req.headers.accept || "").includes("text/html");
    if (!spaTemplate) {
      if (!acceptsHtml) return next();
      // Unknown HTML routes render the public recovery page without requiring login.
      const clientTemplatePath = fspath.resolve(clientRoot, "login.html");
      if (!fs.existsSync(clientTemplatePath)) {
        log(`CRITICAL: Template login.html not found at ${clientTemplatePath}`, "vite");
        return next();
      }
      try {
        let template = await fs.promises.readFile(clientTemplatePath, "utf-8");
        let page = await vite.transformIndexHtml(url, template);
        page = page.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
        res.status(404).set({
          "Content-Type": "text/html",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        }).end(page);
        return;
      } catch (e) {
        log(`ERROR transforming fallback template for ${path}: ${(e as Error).message}`, "vite");
        vite.ssrFixStacktrace(e as Error);
        return next(e);
      }
    }

    const templateName = spaTemplate;

    try {
      const clientTemplatePath = fspath.resolve(clientRoot, templateName);
      
      if (!fs.existsSync(clientTemplatePath)) {
        log(`CRITICAL: Template ${templateName} not found at ${clientTemplatePath}`, "vite");
        return next();
      }

      let template = await fs.promises.readFile(clientTemplatePath, "utf-8");
      let page = await vite.transformIndexHtml(url, template);
      
      // Remove restrictive CSP meta tags to allow iframe embedding
      page = page.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
      
      res.status(200).set({
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }).end(page);
    } catch (e) {
      log(`ERROR transforming template for ${path}: ${(e as Error).message}`, "vite");
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });

  // 2. Vite Development Middlewares (HMR, virtual assets, /src, /node_modules)
  app.use(vite.middlewares);

  // 2.5 Strip Vite's restrictive CSP to allow iframe embedding
  app.use((req, res, next) => {
    const originalWriteHead = res.writeHead.bind(res);
    (res.writeHead as any) = (...args: any[]) => {
      // writeHead(statusCode, headers) or writeHead(statusCode, statusMessage, headers)
      const headersIdx = typeof args[1] === 'object' ? 1 : typeof args[2] === 'object' ? 2 : -1;
      if (headersIdx >= 0) {
        const headers = args[headersIdx] as Record<string, string | string[]>;
        const cspKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-security-policy');
        if (cspKey) {
          const csp = String(headers[cspKey]);
          if (csp.includes("frame-src 'none'")) {
            headers[cspKey] = csp.replace(/frame-src\s+'none'/, "frame-src 'self'");
          }
        }
      }
      return originalWriteHead(...(args as [number, ...(string | undefined)[]]));
    };
    next();
  });

  return vite;
}

/**
 * Standard Static Serving for Production
 */
export function serveStatic(app: Express, distPath = fspath.resolve(__dirname, "..", "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(`Could not find the build directory: ${distPath}`);
  }

  // 1. Static Assets first
  app.use(express.static(distPath, { index: false }));

  // 2. SPA navigations go to the bundle that owns the path — the same resolver
  // setupVite uses, so dev and prod cannot disagree (shared/spa-routes.ts).
  app.get("*", (req, res, next) => {
    const template = resolveSpaTemplate(req.path);
    if (!template) return next();
    res.sendFile(fspath.resolve(distPath, template));
  });

  // 3. Everything else gets the auth SPA's recovery page with a 404.
  app.use("*", (_req, res) => {
    res.status(404).sendFile(fspath.resolve(distPath, "login.html"));
  });
}
