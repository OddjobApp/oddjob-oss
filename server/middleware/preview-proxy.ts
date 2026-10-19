
import { Request, Response, NextFunction } from "express";
import http from "node:http";
import { CREW_APP_ACTIVITY_BRIDGE } from './crew-app-activity-bridge.js';
import { appProxyAssetPath } from './app-proxy-asset-path.js';
import { appNavigationGuard } from './app-navigation-guard.js';
import zlib from "node:zlib";
import { appRegistryService } from "@domain/apps/app-registry.service.js";
import { db } from "@server/database_service.js";
import { apps, appDeployments, appInstances, type AppInstance } from "@shared/schema/index.js";
import { eq, and, or, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { getPlaintextToken } from "@domain/apps/infrastructure/app-token.service.js";
import { isRuntimeBackedApp } from "@domain/apps/core/app-runtime-profile.js";
import { renderAcmeOpsCommandDemoSite } from "./acme-demo-site.js";
import { verifiedRuntimeInstances } from '@domain/apps/infrastructure/runtime-instance-health.js';

const logger = createLogger("PreviewProxy");
const PREVIEW_LOOKUP_TTL_MS = 2500;

// Prevents concurrent auto-restart storms for the same app
const restartingApps = new Set<number>();

function triggerAutoStart(appId: number, orgId: number | null, slug: string, deploymentId: number) {
    if (restartingApps.has(appId)) return;
    restartingApps.add(appId);
    appRegistryService.startApp(appId, orgId ?? undefined)
        .then(async () => {
            logger.info(`[Mach 3] Auto-started ${slug} (appId=${appId})`);
            await db.update(appDeployments)
                .set({
                    status: "active",
                    config: {},
                    updatedAt: new Date(),
                })
                .where(eq(appDeployments.id, deploymentId))
                .catch(() => {});
            instanceCache.delete(`healthy:${slug}`);
            instanceCache.delete(`deployment:${deploymentId}`);
        })
        .catch(async err => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[Mach 3] Auto-start failed for ${slug}: ${message}`);
            await db.update(appDeployments)
                .set({
                    status: "failed",
                    config: { launchError: message, launchErrorAt: new Date().toISOString() },
                    updatedAt: new Date(),
                })
                .where(eq(appDeployments.id, deploymentId))
                .catch(updateErr => logger.warn(`[Mach 3] Failed to persist launch failure for ${slug}: ${updateErr.message}`));
            instanceCache.delete(`healthy:${slug}`);
            instanceCache.delete(`deployment:${deploymentId}`);
        })
        .finally(() => restartingApps.delete(appId));
}

/**
 * A missing app asset has to answer as a missing asset.
 *
 * When the referer names a forged app that has no healthy instance, this branch
 * used to fall through to the main server, whose SPA catch-all answers with
 * index.html. The browser then received text/html for a .js or .css request and
 * refused it on MIME grounds — one console error per asset, and a preview that
 * looked broken rather than simply not running. A plain 404 says the true thing
 * once, and lets the document request render the unavailable page instead.
 */
function sendAssetUnavailable(res: Response, slug: string, assetPath: string) {
    return res
        .status(404)
        .type("text/plain")
        .send(`Asset unavailable: "${slug}" is not running (${assetPath}).`);
}

function sendAppUnavailable(res: Response, slug: string, reason = "This app is not runnable yet.") {
    const safeSlug = String(slug).replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]!));
    const safeReason = String(reason).replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]!));
    return res.status(503).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>App Unavailable</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0F172A;color:#F8FAFC;margin:0;padding:24px}.panel{max-width:520px;border:1px solid #334155;background:#111827;border-radius:16px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 10px;font-size:24px;font-weight:650}p{color:#CBD5E1;line-height:1.5;margin:0 0 12px}.slug{font-family:ui-monospace,monospace;color:#93C5FD}</style>
</head><body><main class="panel"><h1>App unavailable</h1>
<p><span class="slug">${safeSlug}</span> could not be launched.</p>
<p>${safeReason}</p>
</main></body></html>`);
}

/**
 * Mach 3: The Deployment Bridge Proxy
 * Routes /forged/:slug/* -> localhost:ASSIGNED_PORT/*
 * Routes /app/:id/* -> localhost:ASSIGNED_PORT/* (ID-based lookup)
 * 
 * Shared Server Support:
 * For shared servers (e.g., sdlc-workbench), the proxy routes to the single container
 * and Next.js handles internal routing to specific workbenches.
 */
/**
 * Horizontal Scaling: Port Rotator for Round-Robin Load Balancing
 */
const portRotator = new Map<number, number>(); // deploymentId -> lastUsedIndex
const instanceCache = new Map<string, { expiresAt: number; instances: AppInstance[] }>();

function getCachedInstances(key: string): AppInstance[] | null {
    const cached = instanceCache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        instanceCache.delete(key);
        return null;
    }
    return cached.instances;
}

function setCachedInstances(key: string, instances: AppInstance[]) {
    instanceCache.set(key, { expiresAt: Date.now() + PREVIEW_LOOKUP_TTL_MS, instances });
}

function injectAppNavigationGuard(html: string, slug: string): string {
    const script = appNavigationGuard(slug);
    if (html.includes("data-oddjob-app-nav-guard")) return html;
    if (html.includes("</body>")) return html.replace("</body>", `${script}${CREW_APP_ACTIVITY_BRIDGE}</body>`);
    return `${html}${script}${CREW_APP_ACTIVITY_BRIDGE}`;
}

function fetchUpstreamStylesheet(port: number, assetPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        const request = http.get({
            host: "127.0.0.1",
            port,
            path: assetPath,
            headers: { "accept-encoding": "identity" },
        }, (assetRes) => {
            if (assetRes.statusCode !== 200 || !String(assetRes.headers["content-type"] ?? "").includes("text/css")) {
                assetRes.resume();
                resolve(null);
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            assetRes.on("data", (chunk) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += buffer.length;
                if (size <= 2_000_000) chunks.push(buffer);
            });
            assetRes.on("end", () => resolve(size <= 2_000_000 ? Buffer.concat(chunks).toString("utf-8") : null));
        });
        request.setTimeout(5_000, () => request.destroy());
        request.on("error", () => resolve(null));
    });
}

function pipeProxyResponse(proxyRes: http.IncomingMessage, res: Response, headers: Record<string, any>, slug: string, targetPort: number) {
    const contentType = String(proxyRes.headers["content-type"] ?? "");
    if (!contentType.includes("text/html")) {
        res.writeHead(proxyRes.statusCode || 500, headers);
        proxyRes.pipe(res);
        return;
    }

    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    proxyRes.on("end", async () => {
        // The upstream container (Next.js) compresses HTML by default. We rewrite the
        // decoded HTML to inject the nav guard, so we must decompress first and then
        // strip the Content-Encoding header — otherwise the browser tries to gunzip
        // our plain-text body and fails with ERR_CONTENT_DECODING_FAILED (blank page).
        let raw = Buffer.concat(chunks);
        const encoding = String(proxyRes.headers["content-encoding"] ?? "").toLowerCase();
        try {
            if (encoding === "gzip") raw = zlib.gunzipSync(raw);
            else if (encoding === "br") raw = zlib.brotliDecompressSync(raw);
            else if (encoding === "deflate") raw = zlib.inflateSync(raw);
        } catch (err: any) {
            logger.warn(`[Mach 3] Failed to decompress ${encoding} HTML for ${slug}: ${err.message}`);
        }
        let html = raw.toString("utf-8");
        // Edge can leave nested iframe stylesheets unapplied when the Next asset URL
        // is rewritten after the HTML response. Inline the same compiled stylesheet
        // as a deterministic fallback while retaining the external link for caching.
        const cssPaths = Array.from(html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/_next\/[^"?]+\.css(?:\?[^\"]*)?)"[^>]*>/g), match => match[1]);
        if (cssPaths.length > 0) {
            const styles = await Promise.all(cssPaths.map(assetPath => fetchUpstreamStylesheet(targetPort, assetPath)));
            const inlineCss = styles
                .filter((css): css is string => Boolean(css))
                .map(css => css.replace(/<\/style/gi, "<\\/style"))
                .join("\n");
            if (inlineCss) {
                html = html.replace("</head>", `<style data-oddjob-gallery-styles>${inlineCss}</style></head>`);
            }
        }
        // Prefix root-relative /_next/ assets with /forged/${slug}/_next/ so they resolve
        // reliably even if the browser strips the Referer path in iframes.
        html = html.replace(/(href|src)="(\/_next\/[^"]+)"/g, `$1="/forged/${slug}$2"`);
        const body = Buffer.from(injectAppNavigationGuard(html, slug), "utf-8");
        // We send the rewritten body uncompressed (identity), so drop the length and
        // encoding headers that described the original compressed payload.
        delete headers["content-length"];
        delete headers["Content-Length"];
        delete headers["content-encoding"];
        delete headers["Content-Encoding"];
        res.writeHead(proxyRes.statusCode || 500, headers);
        res.end(body);
    });
}

async function getHealthyInstances(slug: string) {
    const cacheKey = `healthy:${slug}`;
    const cached = getCachedInstances(cacheKey);
    if (cached && cached.length > 0) return verifiedRuntimeInstances(cached);

    let deployment;
    
    // Handle app-ID format
    if (slug.startsWith("app-")) {
        const appId = parseInt(slug.replace("app-", ""));
        [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.appId, appId)).limit(1);
    } else {
        [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.publicSlug, slug)).limit(1);
    }

    if (!deployment) {
        // Fallback: search by primary app slug
        const [app] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
        if (app) {
            const [dep] = await db.select().from(appDeployments).where(eq(appDeployments.appId, app.id)).limit(1);
            deployment = dep;
        }
    }

    let instances: AppInstance[] = [];
    if (deployment) {
        instances = await db.select().from(appInstances).where(and(eq(appInstances.deploymentId, deployment.id), eq(appInstances.status, "running")));
    }



    instances = await verifiedRuntimeInstances(instances);
    if (instances.length > 0) {
        setCachedInstances(cacheKey, instances);
    }
    return instances;
}

async function getDeploymentIdForSlug(slug: string): Promise<number | null> {
    if (slug.startsWith("app-")) {
        const appId = parseInt(slug.replace("app-", ""));
        if (Number.isNaN(appId)) return null;
        const [deployment] = await db
            .select({ id: appDeployments.id })
            .from(appDeployments)
            .where(eq(appDeployments.appId, appId))
            .limit(1);
        return deployment?.id ?? null;
    }

    const [deployment] = await db
        .select({ id: appDeployments.id })
        .from(appDeployments)
        .where(eq(appDeployments.publicSlug, slug))
        .limit(1);
    if (deployment) return deployment.id;

    const [app] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(eq(apps.slug, slug))
        .limit(1);
    if (!app) return null;

    const [appDeployment] = await db
        .select({ id: appDeployments.id })
        .from(appDeployments)
        .where(eq(appDeployments.appId, app.id))
        .limit(1);
    return appDeployment?.id ?? null;
}

async function selectNextPort(deploymentId: number, instances: AppInstance[]): Promise<number | null> {
    if (instances.length === 0) return null;
    
    let currentIndex = portRotator.get(deploymentId) || 0;
    const nextIndex = (currentIndex + 1) % instances.length;
    portRotator.set(deploymentId, nextIndex);
    
    return instances[nextIndex].port;
}

function getSlugFromReferer(req: Request): string | null {
    const referer = req.headers.referer || '';

    // /app/{numeric-id} or /app/app-{numeric}  → e.g. /app/58, /app/app-58
    const numericMatch = referer.match(/\/app\/(?:app-)?(\d+)(?:[\/?#]|$)/);
    if (numericMatch) return `app-${numericMatch[1]}`;

    // /app/{slug-string} — slug-based URL (e.g. /app/pm-workbench-org291)
    // Critical: without this, static-asset requests like /_next/static/css/...
    // sent by the browser with Referer=/app/{slug} fail to resolve to the
    // right app and return 404, leaving the page unstyled / non-functional.
    const slugMatch = referer.match(/\/app\/([a-z0-9][a-z0-9-]*[a-z0-9])(?:[\/?#]|$)/i);
    if (slugMatch) return slugMatch[1];

    // /forged/:slug
    const forgedMatch = referer.match(/\/forged\/([^\/?#]+)/);
    if (forgedMatch) return forgedMatch[1];

    // /armory/apps/:id
    const armoryMatch = referer.match(/\/armory\/apps\/(\d+)(?:[\/?#]|$)/);
    if (armoryMatch) return `app-${armoryMatch[1]}`;

    return null;
}

export const previewProxy = async (req: Request, res: Response, next: NextFunction) => {

    const path = req.path;

    let slug: string;
    let remainingPath: string;
    let resolvedByPublicSlug = false;

    // ─── Referer-based API proxy for embedded app fetches ──────────────────────
    // When a forged app runs inside an iframe at /app/{slug}, any relative
    // fetch('/api/...') from client-side React is resolved against the
    // *parent* origin (localhost:5000), NOT the Next.js container port.
    //
    // We proxy two categories:
    //   1. /api/oddjob/* — Pages Router API handler in workbench blueprints
    //   2. /api/agent/*  — App Router API handlers (e.g. /api/agent/chat)
    //
    // Oddjob's own API namespaces (/api/auth, /api/users, /api/missions, etc.)
    // are excluded so they are handled by the main server's route handlers.
    const WORKBENCH_API_PREFIXES = ["/api/oddjob/", "/api/agent/"];
    const isWorkbenchApiPath = WORKBENCH_API_PREFIXES.some(p => path.startsWith(p));
    if (isWorkbenchApiPath) {
        const refererSlug = getSlugFromReferer(req);
        if (refererSlug) {
            if (path.startsWith("/api/oddjob/")) {
                const deploymentId = await getDeploymentIdForSlug(refererSlug);
                const appToken = deploymentId
                    ? await getPlaintextToken(deploymentId).catch(err => {
                        logger.warn(`[Mach 3] Could not decrypt app token for ${refererSlug}: ${err.message}`);
                        return null;
                    })
                    : null;

                if (appToken) {
                    const platformPath = path.replace(/^\/api\/oddjob/, "/api/platform/app");
                    logger.debug(`[Mach 3] Platform API bridge: ${path} -> ${platformPath} (Ref: ${refererSlug})`);

                    const proxyReq = http.request({
                        host: "127.0.0.1",
                        port: Number(process.env.PORT || 5000),
                        path: platformPath + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
                        method: req.method,
                        headers: {
                            ...req.headers,
                            host: `localhost:${process.env.PORT || 5000}`,
                            authorization: `Bearer ${appToken}`,
                        },
                    }, (proxyRes) => {
                        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
                        proxyRes.pipe(res);
                    });

                    proxyReq.on("error", (err) => {
                        logger.error(`[Mach 3] Platform API bridge error: ${err.message}`);
                        next();
                    });

                    req.pipe(proxyReq);
                    return;
                }
            }

            const instances = await getHealthyInstances(refererSlug);
            if (instances.length > 0) {
                const deploymentId = instances[0].deploymentId;
                const targetPort = await selectNextPort(deploymentId, instances) || instances[0].port;
                logger.debug(`[Mach 3] Iframe API proxy: ${path} -> localhost:${targetPort} (Ref: ${refererSlug})`);

                const proxyReq = http.request({
                    host: "127.0.0.1",
                    port: targetPort,
                    path: req.url,
                    method: req.method,
                    headers: { ...req.headers, host: `localhost:${targetPort}` },
                }, (proxyRes) => {
                    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
                    proxyRes.pipe(res);
                });

                proxyReq.on("error", (err) => {
                    logger.error(`[Mach 3] Iframe API proxy error: ${err.message}`);
                    next(); // Fall through to main server handlers on error
                });

                req.pipe(proxyReq);
                return;
            }
        }
        // No matching app in Referer — fall through to main Oddjob server handlers
        return next();
    }


    // Handle asset requests (/_next/static, etc.) from proxied apps
    const isAssetRequest = path.startsWith("/_next/") || path.startsWith("/__next") || !!path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/);

    if (isAssetRequest) {
        const refererSlug = getSlugFromReferer(req);
        if (refererSlug) {
            const instances = await getHealthyInstances(refererSlug);
            if (instances.length > 0) {
                // Determine deploymentId from instances
                const deploymentId = instances[0].deploymentId;
                const targetPort = await selectNextPort(deploymentId, instances) || instances[0].port;

                try {
                    logger.debug(`[Mach 3] Asset LB: ${path} -> localhost:${targetPort} (Ref: ${refererSlug})`);


                    const proxyReq = http.request({
                        host: "127.0.0.1",
                        port: targetPort,
                        path: appProxyAssetPath(path) + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
                        method: req.method,
                        headers: { ...req.headers, host: `localhost:${targetPort}` }
                    }, (proxyRes) => {
                        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
                        proxyRes.pipe(res);
                    });

                    proxyReq.on("error", (err) => {
                        logger.error(`[Mach 3] Asset proxy error: ${err.message}`);
                        if (res.headersSent) return res.end();
                        sendAssetUnavailable(res, refererSlug, path);
                    });

                    req.pipe(proxyReq);
                    return;
                } catch (err: any) {
                    logger.error(`[Mach 3] Asset proxy failed: ${err.message}`);
                    return sendAssetUnavailable(res, refererSlug, path);
                }
            }

            // Known app, no healthy instance: do not fall through to the SPA.
            logger.debug(`[Mach 3] Asset for stopped app ${refererSlug}: ${path}`);
            return sendAssetUnavailable(res, refererSlug, path);
        }
    }

    // ─── Referer-based page navigation proxy for embedded apps ─────────────────
    // When a Next.js app is embedded in an iframe at /app/{slug}/, clicking an
    // internal <Link href="/pm-workbench"> navigates the iframe to
    // http://localhost:5000/pm-workbench — which doesn't match /app/ or /forged/.
    // We detect this via the Referer header and proxy the page request to the container.
    const KNOWN_WORKBENCH_PAGES = ["/pm-workbench", "/scrum-master-workbench", "/qa-workbench", "/stakeholder-workbench", "/ai-workforce-dashboard", "/sprint-zero", "/vsm-dashboard", "/launch-command-center", "/market-research", "/content-studio", "/sales-enablement", "/feedback-insights",
        // research-workbench (Technical Research & RFC Synthesis) module routes
        "/ingestion-hub", "/decision-panel", "/draft-sandbox", "/memory-library", "/backlog-provisioner",
        // sales-opportunity-workbench module routes
        "/pipeline", "/opportunities", "/advisor",
        // budgetmaster-workbench module routes
        "/dashboard", "/ledger", "/accounts", "/forecast", "/alerts", "/sandboxes"];
    const isWorkbenchPage = KNOWN_WORKBENCH_PAGES.some(p => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
    if (isWorkbenchPage && !isAssetRequest) {
        const refererSlug = getSlugFromReferer(req);
        if (refererSlug) {
            const instances = await getHealthyInstances(refererSlug);
            if (instances.length > 0) {
                const deploymentId = instances[0].deploymentId;
                const targetPort = await selectNextPort(deploymentId, instances) || instances[0].port;
                logger.debug(`[Mach 3] Iframe page nav: ${path} -> localhost:${targetPort} (Ref: ${refererSlug})`);

                const proxyReq = http.request({
                    host: "127.0.0.1",
                    port: targetPort,
                    path: path + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
                    method: req.method,
                    headers: { ...req.headers, host: `localhost:${targetPort}` }
                }, (proxyRes) => {
                    const headers = { ...proxyRes.headers };
                    delete headers['x-frame-options'];
                    delete headers['content-security-policy'];
                    headers['X-Frame-Options'] = 'SAMEORIGIN';
                    headers['Content-Security-Policy'] = "frame-ancestors 'self';";
                    pipeProxyResponse(proxyRes, res, headers, refererSlug, Number(targetPort));
                });

                proxyReq.on("error", (err) => {
                    logger.error(`[Mach 3] Iframe page nav error: ${err.message}`);
                    next();
                });

                req.pipe(proxyReq);
                return;
            } else {
                // No running instance — trigger auto-start and show loading state
                // Resolve the app to trigger auto-start (Req 10.5)
                const deploymentId = await getDeploymentIdForSlug(refererSlug);
                if (deploymentId) {
                    const [appDeployment] = await db.select({
                        deployment: appDeployments,
                        app: apps,
                    })
                    .from(appDeployments)
                    .innerJoin(apps, eq(appDeployments.appId, apps.id))
                    .where(eq(appDeployments.id, deploymentId))
                    .limit(1);

                    if (appDeployment) {
                        if (appDeployment.deployment.status === "failed") {
                            const config = appDeployment.deployment.config as { launchError?: string } | null;
                            return sendAppUnavailable(res, refererSlug, config?.launchError || "This app failed to start.");
                        }
                        triggerAutoStart(appDeployment.app.id, appDeployment.deployment.organizationId, refererSlug, deploymentId);

                        if (req.accepts('html')) {
                            const safeSlug = String(refererSlug).replace(/[&<>"']/g, ch => ({
                                "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
                            }[ch]!));
                            return res.status(503).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3">
<title>Starting App…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0F172A;color:#F8FAFC;margin:0}.loader{border:4px solid #1E293B;border-top:4px solid #3B82F6;border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin-bottom:24px}@keyframes spin{to{transform:rotate(360deg)}}h1{margin:0;font-size:24px;font-weight:500}p{color:#94A3B8;margin-top:12px;font-size:15px}</style>
</head><body><div class="loader"></div><h1>Starting App</h1>
<p>Launching <strong>${safeSlug}</strong> — this page will reload automatically.</p>
</body></html>`);
                        }
                        return res.status(503).json({ error: "App is starting.", slug: refererSlug });
                    }
                }
            }
        }
    }

    // ─── Auth gate for /app/{slug} and /forged/{slug} entry points ──────────
    // Asset requests (handled above) authenticate via the Referer-derived slug
    // and don't go through this gate. Top-level page loads require either:
    //   1. an authenticated Oddjob session whose user belongs to the app's org
    //   2. accessPolicy='public' on the deployment (legacy / explicit opt-in)
    //   3. a valid ?share={token} (Phase 7 — external collaborator preview)
    // Failures: 401 for unauthenticated (browser), 403 for wrong-org.
    const needsPageAuth = (path.startsWith("/app/") || path.startsWith("/forged/")) && !isAssetRequest;
    if (needsPageAuth) {
        // Read userId from session first, then fall back to req.user (set by populateUserContext)
        const sessionUserId = (req as any).session?.userId as string | undefined
            || (req as any).user?.id as string | undefined;
        // Detect embed mode — embedded iframes should never redirect to /login
        const embedMode = req.query.embed as string | undefined;
        const isEmbed = embedMode === 'cycle' || embedMode === 'true' || embedMode === 'modal';
        // Resolve which app/org this URL points at so we can scope the check.
        const pathParts = path.split("/");
        const idPart = pathParts[2];
        let resolvedAppRow: { id: number; organizationId: number | null } | null = null;
        const numericId = parseInt(idPart?.replace(/^app-/, "") ?? "");
        if (!isNaN(numericId)) {
            const [row] = await db.select({ id: apps.id, organizationId: apps.organizationId })
                .from(apps).where(eq(apps.id, numericId)).limit(1);
            resolvedAppRow = row ?? null;
        } else if (idPart) {
            // Try publicSlug first, then app slug fallback.
            const [byPublic] = await db.select({ id: apps.id, organizationId: apps.organizationId })
                .from(apps)
                .innerJoin(appDeployments, eq(appDeployments.appId, apps.id))
                .where(eq(appDeployments.publicSlug, idPart)).limit(1);
            if (byPublic) {
                resolvedAppRow = byPublic;
            } else {
                const [byAppSlug] = await db.select({ id: apps.id, organizationId: apps.organizationId })
                    .from(apps).where(eq(apps.slug, idPart)).limit(1);
                resolvedAppRow = byAppSlug ?? null;
            }
        }
        if (resolvedAppRow) {
            // Check deployment for public-access bypass
            const [dep] = await db.select({ accessPolicy: appDeployments.accessPolicy })
                .from(appDeployments).where(eq(appDeployments.appId, resolvedAppRow.id)).limit(1);
            const isPublic = (dep?.accessPolicy as any)?.public === true || (dep?.accessPolicy as any) === "public";

            // Phase 7: Check valid ?share={token} bypass
            let isShareAuthorized = false;
            const shareToken = req.query.share as string | undefined;
            if (shareToken) {
                const { verifyPreviewShareToken } = await import("@domain/apps/preview-share-token.js");
                const verification = verifyPreviewShareToken(shareToken, resolvedAppRow.id);
                if (verification.valid) {
                    isShareAuthorized = true;
                    logger.debug(`[PreviewProxy] Share token authorized access to app ${resolvedAppRow.id}`);
                } else {
                    logger.warn(`[PreviewProxy] Invalid share token for app ${resolvedAppRow.id}: ${verification.reason}`);
                }
            }

            if (!isPublic && !isShareAuthorized) {
                if (!sessionUserId) {
                    // Embedded iframes must never redirect to /login (it renders inside the iframe).
                    // Instead, return an inline error page that the parent can detect.
                    if (isEmbed) {
                        logger.debug(`[Mach 3] Embed auth fail for ${idPart} — session expired`);
                        return res.status(401).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Session Expired</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0F172A;color:#F8FAFC;margin:0}h1{margin:0 0 8px;font-size:20px;font-weight:500}p{color:#94A3B8;font-size:14px;margin:0}</style>
</head><body><h1>Session Expired</h1>
<p>Please refresh the parent page to re-authenticate.</p>
</body></html>`);
                    }
                    if (req.accepts("html")) {
                        return res.redirect(`/login?return=${encodeURIComponent(req.originalUrl)}`);
                    }
                    return res.status(401).json({ error: "Authentication required" });
                }
                // Org-membership check (skip for super-admins).
                // Fast path: isSuperAdmin is cached in the session at login time (auth.ts).
                // Slow path: getUserOrgContext queries adminRoles if the session flag is absent
                // (e.g. sessions created before this fix, or during the same server restart).
                const sessionSuper = (req as any).session?.isSuperAdmin === true;
                const orgCtx = sessionSuper ? null : await getUserOrgContext(req);
                const isSuper = sessionSuper || orgCtx?.isSuperAdmin === true;
                if (!isSuper && resolvedAppRow.organizationId != null) {
                    const { userOrgs } = await import("@shared/schema/index.js");
                    const [membership] = await db.select().from(userOrgs).where(and(
                        eq(userOrgs.userId, sessionUserId),
                        eq(userOrgs.orgId, resolvedAppRow.organizationId),
                    )).limit(1);
                    if (!membership) {
                        return res.status(403).json({ error: "You don't have access to this app" });
                    }
                }

            }
        }
        // Fall through to the existing routing below.
    }

    // Handle /app/:slug pattern — slug may be numeric (app-58, 58) or a custom public slug
    if (path.startsWith("/app/")) {
        const pathParts = path.split("/");
        const idPart = pathParts[2]; // /app/:slug/rest...
        remainingPath = "/" + pathParts.slice(3).join("/");

        const numericId = parseInt(idPart.replace(/^app-/, ""));

        if (!isNaN(numericId)) {
            // Numeric ID or app-{number}: resolve to canonical app slug
            try {
                const [app] = await db.select().from(apps).where(eq(apps.id, numericId)).limit(1);
                if (!app) {
                    return res.status(404).json({ error: `App ${numericId} not found` });
                }
                slug = app.slug;
                logger.debug(`[Mach 3] Resolved /app/${numericId} to slug: ${slug}`);
            } catch (err: any) {
                logger.error(`[Mach 3] Failed to resolve app ID ${numericId}: ${err.message}`);
                return res.status(500).json({ error: "Failed to resolve app" });
            }
        } else {
            // Custom public slug (e.g. /app/my-sales-app): look up by publicSlug
            slug = idPart;
            resolvedByPublicSlug = true;
            logger.debug(`[Mach 3] Treating /app/${idPart} as publicSlug lookup`);
        }
    }
    // Handle /forged/:slug pattern
    else if (path.startsWith("/forged/")) {
        const pathParts = path.split("/");
        slug = pathParts[2]; // /forged/:slug/rest...
        const rest = pathParts.slice(3).join("/");
        remainingPath = rest ? "/" + rest : "/";
    }
    // Handle /projects/:projectKey/apps/:slug pattern
    else if (path.startsWith("/projects/") && path.includes("/apps/")) {
        const pathParts = path.split("/");
        // pathParts: ["", "projects", projectKey, "apps", slug, ...]
        const projectKey = pathParts[2];
        const appsIndex = pathParts.indexOf("apps");
        const appSlugPart = pathParts[appsIndex + 1];

        if (!appSlugPart) return next();

        slug = appSlugPart;
        resolvedByPublicSlug = true;
        const rest = pathParts.slice(appsIndex + 2).join("/");
        remainingPath = rest ? "/" + rest : "/";
        logger.debug(`[Mach 3] Resolved /projects/${projectKey}/apps/${slug} app entry point`);
    }
    else {
        return next();
    }


    try {
        const queryOrgId = req.query.orgId ? Number(req.query.orgId) : null;
        const sessionOrgId = (req as any).session?.organizationId || (req as any).user?.organizationId || null;
        const targetOrgId = queryOrgId || sessionOrgId;

        // Try to match deployment for caller's organization first, then fallback to any matching deployment
        const orgConditions = [
            or(
                eq(apps.slug, slug),
                eq(appDeployments.publicSlug, slug)
            )
        ];
        if (targetOrgId) {
            orgConditions.push(eq(appDeployments.organizationId, targetOrgId));
        }

        let [appDeployment] = await db.select({
            deployment: appDeployments,
            app: apps
        })
        .from(appDeployments)
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(and(...orgConditions))
        .orderBy(desc(appDeployments.id))
        .limit(1);

        if (!appDeployment) {
            const fallback = await db.select({
                deployment: appDeployments,
                app: apps
            })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(
                or(
                    eq(apps.slug, slug),
                    eq(appDeployments.publicSlug, slug)
                )
            )
            .orderBy(desc(appDeployments.id))
            .limit(1);
            appDeployment = fallback[0];
        }

        // Plain Node/Express assemblies own a real HTTP surface too. Requiring a
        // Docker image made those apps fall through to GenericAppShell even
        // after publication, which is how TiCal became a chat box instead of a
        // tip calculator. Tokenized UI still falls through by design.
        if (!appDeployment || !isRuntimeBackedApp(appDeployment.app)) {
            // For embed requests, NEVER fall through to the SPA — it renders
            // the full Oddjob login page inside the iframe, which is confusing.
            const embedParam = req.query.embed as string | undefined;
            if (embedParam === 'cycle' || embedParam === 'true' || embedParam === 'modal') {
                logger.debug(`[Mach 3] Embed request for ${slug} — no deployment found, returning inline error`);
                return res.status(503).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="5">
<title>Workbench Loading…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0F172A;color:#F8FAFC;margin:0}.loader{border:4px solid #1E293B;border-top:4px solid #3B82F6;border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin-bottom:24px}@keyframes spin{to{transform:rotate(360deg)}}h1{margin:0 0 8px;font-size:20px;font-weight:500}p{color:#94A3B8;font-size:14px;margin:0}</style>
</head><body><div class="loader"></div><h1>Workbench Starting</h1>
<p>Waiting for <strong>${String(slug).replace(/[&<>"']/g, '')}</strong> to become available…</p>
</body></html>`);
            }
            return next();
        }

        const { deployment } = appDeployment;

        // 2. Discover Healthy Instance Pool (Horizontal Scaling)
        const deploymentCacheKey = `deployment:${deployment.id}`;
        const instances = await verifiedRuntimeInstances(getCachedInstances(deploymentCacheKey) || await db.select().from(appInstances).where(and(
            eq(appInstances.deploymentId, deployment.id),
            eq(appInstances.status, "running")
        )));
        setCachedInstances(deploymentCacheKey, instances);

        if (instances.length === 0) {
            // Live Demo Site with Deployed Form Builder & Identity Bridge Harness
            if (slug === "acme-ops-command-00y63" || appDeployment.app.slug === "acme-ops-command-00y63") {
                return res.status(200).send(renderAcmeOpsCommandDemoSite(slug));
            }

            // Auto-start the app so the next refresh hits a live container
            triggerAutoStart(appDeployment.app.id, deployment.organizationId, slug, deployment.id);

            if (deployment.status === "failed") {
                const config = deployment.config as { launchError?: string } | null;
                return sendAppUnavailable(res, slug, config?.launchError || "This app failed to start.");
            }

            if (req.accepts('html')) {
                const safeSlug = String(slug).replace(/[&<>"']/g, ch => ({
                    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
                }[ch]!));
                return res.status(503).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3">
<title>Starting App…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0F172A;color:#F8FAFC;margin:0}.loader{border:4px solid #1E293B;border-top:4px solid #3B82F6;border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin-bottom:24px}@keyframes spin{to{transform:rotate(360deg)}}h1{margin:0;font-size:24px;font-weight:500}p{color:#94A3B8;margin-top:12px;font-size:15px}</style>
</head><body><div class="loader"></div><h1>Starting App</h1>
<p>Launching <strong>${safeSlug}</strong> — this page will reload automatically.</p>
</body></html>`);
            } else {
                return res.status(503).json({ error: "App is starting.", appId: slug });
            }
        }

        // 3. Round-Robin Load Balancing across healthy running instances
        const targetPort = (await selectNextPort(deployment.id, instances)) || instances[0].port;

        logger.debug(`[Mach 3] LB Selection: ${slug} -> localhost:${targetPort} (Pool size: ${instances.length})`);

        // 2. Forward Request
        // Forward session context headers so the workbench app inherits the user session
        const sessionHeaders: Record<string, string> = {};
        const proxyUserId = (req as any).session?.userId || (req as any).user?.id;
        if (proxyUserId) {
            sessionHeaders["x-oddjob-user-id"] = String(proxyUserId);
            sessionHeaders["x-oddjob-username"] = String((req as any).session?.username || (req as any).user?.username || "");
            sessionHeaders["x-oddjob-org-id"] = String((req as any).session?.organizationId || (req as any).user?.organizationId || "");
            sessionHeaders["x-oddjob-is-super-admin"] = String((req as any).session?.isSuperAdmin ?? (req as any).user?.isSuperAdmin ?? false);
        }

        const proxyReq = http.request({
            host: "127.0.0.1",
            port: targetPort,
            path: remainingPath + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
            method: req.method,
            headers: {
                ...req.headers,
                ...sessionHeaders,
                host: `localhost:${targetPort}`
            }
        }, (proxyRes) => {
            // Strip headers that block iframe embedding
            const headers = { ...proxyRes.headers };
            delete headers['x-frame-options'];
            delete headers['content-security-policy'];
            delete headers['content-security-policy-report-only'];

            // Allow embedding in iframes from same origin
            headers['X-Frame-Options'] = 'SAMEORIGIN';
            // frame-ancestors controls who can embed the forged app (not what it can embed)
            headers['Content-Security-Policy'] = "frame-ancestors 'self';";
            headers['Referrer-Policy'] = 'no-referrer-when-downgrade';

            // Rewrite redirect Location headers so the browser stays inside the proxy.
            // Without this, Next.js trailing-slash / normalisation redirects emit an
            // absolute `Location: http://localhost:<containerPort>/path` header that the
            // browser follows directly — resulting in ERR_CONNECTION_REFUSED because the
            // container port is not reachable from the host browser.
            const statusCode = proxyRes.statusCode || 500;
            if (statusCode >= 300 && statusCode < 400 && headers['location']) {
                const location = headers['location'] as string;
                let rewritten = location;
                try {
                    const locUrl = new URL(location);
                    if (locUrl.hostname === 'localhost') {
                        // Absolute localhost URL — rewrite to go back through the proxy
                        rewritten = `/forged/${slug}${locUrl.pathname}${locUrl.search}${locUrl.hash}`;
                    }
                } catch {
                    // Relative path (e.g. "/some-page") — prefix with proxy base
                    if (location.startsWith('/') && !location.startsWith('/forged/') && !location.startsWith('/app/')) {
                        rewritten = `/forged/${slug}${location}`;
                    }
                }
                if (rewritten !== location) {
                    logger.debug(`[Mach 3] Rewrote redirect: ${location} → ${rewritten}`);
                    headers['location'] = rewritten;
                }
            }

            pipeProxyResponse(proxyRes, res, headers, slug, Number(targetPort));
        });

        proxyReq.on("error", async (err: NodeJS.ErrnoException) => {
            logger.error(`[Mach 3] Proxy error for ${slug}: ${err.message}`);

            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
                try {
                    const [current] = await db.select({ meta: apps.runtimeMetadata })
                        .from(apps).where(eq(apps.slug, slug)).limit(1);

                    const meta = (current?.meta as any) || {};
                    const launchedAt = meta.launchedAt ? new Date(meta.launchedAt) : new Date(0);
                    const gracePeriodMs = 45000;
                    const pastGrace = Date.now() - launchedAt.getTime() > gracePeriodMs;

                    if (pastGrace) {
                        // Auto-restart the app so the next retry hits a live container
                        triggerAutoStart(appDeployment.app.id, deployment.organizationId, slug, deployment.id);
                    } else {
                        logger.debug(`[Mach 3] ECONNREFUSED for ${slug} during boot grace — retrying`);
                    }
                } catch (dbErr: any) {
                    logger.warn(`[Mach 3] Could not check status for ${slug}: ${dbErr.message}`);
                }
            }

            if (!res.headersSent) {
                const isApiRoute = req.path.startsWith('/api/') || req.path === '/api';
                if (req.accepts('html') || !isApiRoute) {
                    const safeSlug = String(slug).replace(/[&<>"']/g, ch => ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                        "'": "&#39;",
                    }[ch]!));
                    
                    res.status(502).send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta http-equiv="refresh" content="5">
                            <title>App Waking Up...</title>
                            <style>
                                body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0F172A; color: #F8FAFC; margin: 0; }
                                .loader { border: 4px solid #1E293B; border-top: 4px solid #3B82F6; border-radius: 50%; width: 48px; height: 48px; animation: spin 1s linear infinite; margin-bottom: 24px; }
                                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                                h1 { margin: 0; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; }
                                p { color: #94A3B8; margin-top: 12px; font-size: 15px; }
                                .hidden-data { display: none; }
                            </style>
                        </head>
                        <body>
                            <div class="loader"></div>
                            <h1>App Waking Up</h1>
                            <p>The container for "${safeSlug}" is not yet responding. Automatically retrying...</p>
                        </body>
                        </html>
                    `);
                } else {
                    res.status(502).json({ error: "App container is not responding. Use the Builder to restart it." });
                }
            }
        });

        req.pipe(proxyReq);

    } catch (err: any) {
        logger.error(`[Mach 3] Deployment lookup failed for ${slug}: ${err.message}`);
        const embedParam = req.query.embed as string | undefined;
        if (embedParam === 'cycle' || embedParam === 'true' || embedParam === 'modal') {
            return res.status(503).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="5">
<title>Error</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0F172A;color:#F8FAFC;margin:0}h1{margin:0 0 8px;font-size:20px;font-weight:500}p{color:#94A3B8;font-size:14px;margin:0}</style>
</head><body><h1>Workbench Error</h1>
<p>Failed to load workbench. Retrying…</p>
</body></html>`);
        }
        next();
    }
};
