/**
 * Login-protected live view of an org's computer-use desktop.
 *
 * The desktop image ships noVNC (a web VNC client) on port 6901 with no password, published
 * on loopback only. People reach it through this proxy:
 *
 *   GET  /api/integrations/trycua/desktop/viewer[?orgId=]   requireAuth + membership + trycua_enabled;
 *        starts the desktop if needed, issues a ticket, redirects to the noVNC page
 *   GET  …/desktop/viewer/o/<orgId>/<asset>                 requireAuth + membership; noVNC's files
 *   WS   …/desktop/viewer/o/<orgId>/websockify?ticket=…     the VNC stream (ticket must match org)
 *
 * The WebSocket upgrade runs outside Express (no session), so it is authorized by the ticket:
 * random, single-use, 60s to connect, bound to the org and user that asked for it and to that
 * org's desktop. The redirect issues it server-side, so page scripts never hold a reusable
 * credential, and the Origin header must match the Host (cross-site WebSocket hijacking).
 * Oddjob's cookies and auth headers are never forwarded into the container.
 */
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";
import { createLogger } from "../../../utils/logger.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { adminRoles, userOrgs, users } from "../../../../shared/schema/index.js";
import { BadRequestError, ConfigurationError, ForbiddenError } from "../../../utils/errors.js";
import { orgDesktopService } from "./org-desktop.service.js";
import { createTicketStore, isSameOriginUpgrade, rejectUpgrade } from "./ws-tickets.js";

const logger = createLogger("DesktopViewer");

export const VIEWER_PREFIX = "/api/integrations/trycua/desktop/viewer";
// The org rides in the path (…/viewer/o/<orgId>/vnc.html) so the page, its files and its
// socket all resolve to the org the viewer was opened for. Without it, asset requests fall
// back to the session's org, which is not necessarily the org the app has selected.
const WS_PATH = /^\/api\/integrations\/trycua\/desktop\/viewer\/o\/(\d+)\/websockify$/;
export const viewerOrgPath = (organizationId: number) => `${VIEWER_PREFIX}/o/${organizationId}`;
const TICKET_TTL_MS = 60_000;
const HOST_CACHE_MS = 60_000;

interface Ticket {
    organizationId: number;
    userId: string;
    viewerHost: string;
}

const tickets = createTicketStore<Ticket>(TICKET_TTL_MS);
const hostCache = new Map<number, { host: string; at: number }>();

/** host:port of the org's noVNC. For org_desktop this starts (or creates) the desktop. */
export async function resolveViewerHost(organizationId: number): Promise<string> {
    if ((process.env.TRYCUA_PROVIDER || "mock").toLowerCase() !== "cua") {
        throw new ConfigurationError("The desktop viewer needs TRYCUA_PROVIDER=cua");
    }
    const type = (process.env.TRYCUA_PROVIDER_TYPE || "cloud").toLowerCase();
    let host: string;
    if (type === "org_desktop") {
        host = (await orgDesktopService.ensureEndpoints(organizationId)).viewer;
    } else if (type === "local") {
        host = process.env.TRYCUA_LOCAL_VIEWER_HOST || "127.0.0.1:6901";
    } else {
        throw new ConfigurationError(`The desktop viewer is not available for TRYCUA_PROVIDER_TYPE=${type}`);
    }
    hostCache.set(organizationId, { host, at: Date.now() });
    return host;
}

async function cachedViewerHost(organizationId: number): Promise<string> {
    const cached = hostCache.get(organizationId);
    if (cached && Date.now() - cached.at < HOST_CACHE_MS) return cached.host;
    return resolveViewerHost(organizationId);
}

export function issueViewerTicket(input: Ticket, now = Date.now()): string {
    return tickets.issue(input, now);
}

export function consumeViewerTicket(ticket: string | null, now = Date.now()): Ticket | undefined {
    return tickets.consume(ticket, now);
}

/**
 * The noVNC page URL. noVNC resolves `path` relative to the page, so the WebSocket lands on
 * the org's websockify path. reconnect=false: a reconnect would reuse the spent ticket;
 * reopening the viewer fetches a fresh one.
 *
 * viewOnly shows the desktop without passing keyboard or mouse through, for watching an
 * agent work. It is a convenience, not a control: the same person may open it interactive.
 */
export function viewerPageUrl(organizationId: number, ticket: string, options: { viewOnly?: boolean } = {}): string {
    const params = new URLSearchParams({
        autoconnect: "true",
        resize: "scale",
        reconnect: "false",
        ...(options.viewOnly ? { view_only: "true" } : {}),
        path: `websockify?ticket=${ticket}`,
    });
    return `${viewerOrgPath(organizationId)}/vnc.html?${params.toString()}`;
}

const ACCESS_CACHE_MS = 60_000;
const accessCache = new Map<string, number>();

/**
 * Who may open an org's desktop. getUserOrgContext accepts a caller-supplied org
 * (?orgId=, x-organization-id) without checking membership (observe-only for now, see
 * auth-context.ts), which for this endpoint would hand any logged-in user interactive
 * control of any org's desktop and whatever accounts are logged in on it. So the viewer
 * checks for itself: super-admins, or users whose membership, default org or admin role
 * names this org.
 */
export async function assertViewerAccess(ctx: { userId: string; isSuperAdmin: boolean }, organizationId: number): Promise<void> {
    if (ctx.isSuperAdmin) return;
    const key = `${ctx.userId}:${organizationId}`;
    const grantedAt = accessCache.get(key);
    if (grantedAt && Date.now() - grantedAt < ACCESS_CACHE_MS) return;

    const [membership] = await db
        .select({ orgId: userOrgs.orgId })
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, ctx.userId), eq(userOrgs.orgId, organizationId)))
        .limit(1);
    if (!membership) {
        const [user] = await db.select({ defaultOrgId: users.defaultOrgId }).from(users).where(eq(users.id, ctx.userId)).limit(1);
        const [role] = await db.select({ organizationId: adminRoles.organizationId }).from(adminRoles).where(eq(adminRoles.userId, ctx.userId)).limit(1);
        if (user?.defaultOrgId !== organizationId && role?.organizationId !== organizationId) {
            logger.warn("Desktop viewer refused: not a member of the organization", { userId: ctx.userId, organizationId });
            throw new ForbiddenError("You are not a member of this organization");
        }
    }
    accessCache.set(key, Date.now());
}

// noVNC reads settings from the page's query string. This build also honours record_url,
// which streams a recording of the session to any address, so a crafted link to the viewer
// page could exfiltrate the desktop. Only the parameters viewerPageUrl sets are accepted.
const ALLOWED_PAGE_PARAMS = new Set(["autoconnect", "resize", "reconnect", "path", "view_only"]);
const ASSET_PATH = /^(vnc\.html|defaults\.json|mandatory\.json|package\.json|(app|core|vendor)\/[A-Za-z0-9_.\/-]+)$/;
const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "if-none-match", "if-modified-since", "range"];

/** Proxies one noVNC static file. Caller has already checked login and org. */
export async function proxyViewerAsset(req: Request, res: Response, organizationId: number, assetPath: string): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(405).end();
        return;
    }
    if (!ASSET_PATH.test(assetPath) || assetPath.split("/").includes("..")) {
        res.status(404).end();
        return;
    }
    const query = new URL(req.originalUrl, "http://x").searchParams;
    if (assetPath === "vnc.html") {
        for (const key of query.keys()) {
            if (!ALLOWED_PAGE_PARAMS.has(key)) throw new BadRequestError(`Viewer parameter ${key} is not allowed`);
        }
    }

    const host = await cachedViewerHost(organizationId);
    const [hostname, port] = splitHost(host);
    const headers: Record<string, string> = { host };
    for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
    }

    await new Promise<void>((resolve) => {
        const upstream = http.request(
            // The page's query string stays in the browser; noVNC reads it client-side.
            { hostname, port, method: req.method, path: `/${assetPath}`, headers, timeout: 15_000 },
            (upstreamRes) => {
                const out: Record<string, string | string[]> = {};
                for (const [name, value] of Object.entries(upstreamRes.headers)) {
                    if (value === undefined || name === "set-cookie" || name === "connection") continue;
                    out[name] = value;
                }
                if (assetPath === "vnc.html") {
                    out["cache-control"] = "no-store";
                    out["referrer-policy"] = "no-referrer"; // the page URL holds the (spent) ticket
                }
                res.writeHead(upstreamRes.statusCode ?? 502, out);
                upstreamRes.pipe(res);
                upstreamRes.on("end", resolve);
            },
        );
        upstream.on("timeout", () => upstream.destroy(new Error("viewer upstream timed out")));
        upstream.on("error", (error) => {
            logger.warn("Desktop viewer asset proxy failed", { organizationId, assetPath, error: error.message });
            if (!res.headersSent) res.status(502).end();
            else res.destroy();
            resolve();
        });
        upstream.end();
    });
}

/**
 * Bridges the VNC WebSocket to the desktop. Returns false if the path is not the viewer's,
 * so the caller can try other gateways.
 */
export function handleViewerUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url || "/", "http://x");
    const pathMatch = WS_PATH.exec(url.pathname);
    if (!pathMatch) return false;

    if (!isSameOriginUpgrade(request)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return true;
    }
    const ticket = consumeViewerTicket(url.searchParams.get("ticket"));
    if (!ticket) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return true;
    }
    if (Number(pathMatch[1]) !== ticket.organizationId) {
        rejectUpgrade(socket, 403, "Forbidden");
        return true;
    }

    const [hostname, port] = splitHost(ticket.viewerHost);
    const upstream = net.connect({ host: hostname, port });
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        orgDesktopService.viewerClosed(ticket.organizationId);
        logger.info("Desktop viewer disconnected", { organizationId: ticket.organizationId, userId: ticket.userId });
        socket.destroy();
        upstream.destroy();
    };

    orgDesktopService.viewerOpened(ticket.organizationId);
    upstream.on("connect", () => {
        logger.info("Desktop viewer connected", { organizationId: ticket.organizationId, userId: ticket.userId });
        const lines = [`GET /websockify HTTP/1.1`, `Host: ${ticket.viewerHost}`];
        // Only what the WebSocket handshake needs; never Oddjob's cookies or auth headers.
        for (const name of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
            const value = request.headers[name];
            if (typeof value === "string") lines.push(`${name}: ${value}`);
        }
        upstream.write(lines.join("\r\n") + "\r\n\r\n");
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on("error", (error) => {
        logger.warn("Desktop viewer upstream failed", { organizationId: ticket.organizationId, error: error.message });
        close();
    });
    // Upgraded HTTP sockets are half-open (allowHalfOpen), so a browser closing the tab only
    // ends our read side and "close" never comes. A WebSocket bridge has no use for half-open:
    // either side ending tears it down, which is also what lets the desktop go idle.
    upstream.on("end", close);
    upstream.on("close", close);
    socket.on("end", close);
    socket.on("error", close);
    socket.on("close", close);
    return true;
}

function splitHost(host: string): [string, number] {
    const i = host.lastIndexOf(":");
    return [host.slice(0, i), Number(host.slice(i + 1))];
}

/** Tests only. */
export function resetViewerStateForTests() {
    tickets.clear();
    hostCache.clear();
    accessCache.clear();
}
