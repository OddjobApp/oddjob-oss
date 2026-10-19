/**
 * Turning an `assistant_app` payload into a URL that actually opens.
 *
 * Extracted from AgentChatSheet so the Crew Room and the copilot sheet share one
 * implementation. That is the whole point of the module: this logic has broken
 * app launches before by mangling routes it did not recognise into dead
 * `/app/<segment>/...` paths, and a second copy in the crew panel would be a
 * second chance to reintroduce exactly that.
 *
 * The rule the allowlist encodes: an href that already names a real top-level
 * route is passed through untouched. Only a bare, unrecognised path is treated
 * as a slug and given an `/app/` or `/a/` prefix.
 */

import { resolveSpaTemplate } from "@shared/spa-routes";

export interface AssistantAppPayload {
    title: string;
    description?: string;
    slug?: string;
    href?: string;
    /** 'agent_ai' → /a/:slug, 'app' → /app/:slug, 'blueprint' → an /armory href. */
    source?: "app" | "agent_ai" | "blueprint";
    mode?: "link" | "embed";
    /**
     * 'cycle_canvas' marks an installed org app deployment: the room mounts it in
     * the App Studio canvas (CrewCycleAppCanvas) instead of embedding a bare
     * transcript iframe, because the canvas carries the crewRoom binding,
     * surface-request host and mounted-app grounding.
     */
    studioSurface?: string;
    publicSlug?: string;
    publicPath?: string;
    appId?: number;
    deploymentId?: number;
    actionLabel?: string;
    blueprint?: string;
    cycleSlug?: string;
    cycleName?: string;
    /** Sub-route within a cycle app, appended to the base href. */
    routePath?: string;
    sourceAppId?: string;
    sourceAppName?: string;
}

/** Routes an agent may link to directly, beyond the SPA-owned top-level routes. */
const PASSTHROUGH_ROUTE_PREFIXES = ["/app/", "/a/", "/projects/", "/p/", "/pipeline/", "/workspace"];

/**
 * True when the href already names a real route. SPA routes are matched by whole
 * segment through the shared manifest: a raw `startsWith("/a")` passed every
 * slug beginning with "a" through untouched, as a dead link.
 */
function isPassthroughHref(href: string): boolean {
    if (PASSTHROUGH_ROUTE_PREFIXES.some((prefix) => href.startsWith(prefix))) return true;
    return resolveSpaTemplate(href.split(/[?#]/)[0]) !== null;
}

export function normalizeAssistantAppSlug(slug: string): string {
    const cleaned = slug.trim().replace(/^\/+/, "").replace(/^app\//, "").replace(/^a\//, "");
    return cleaned.replace(/_/g, "-");
}

export function normalizeAssistantRoutePath(routePath?: string): string {
    if (!routePath) return "";
    const cleaned = routePath.trim().replace(/^\/+/, "");
    if (!cleaned || cleaned.includes("://") || cleaned.startsWith("..")) return "";
    return cleaned
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..")
        .map((segment) => {
            try {
                return encodeURIComponent(decodeURIComponent(segment));
            } catch {
                return encodeURIComponent(segment);
            }
        })
        .join("/");
}

export function withAssistantAppRoute(baseHref: string, routePath?: string): string {
    const cleanedRoute = normalizeAssistantRoutePath(routePath);
    if (!cleanedRoute) return baseHref;

    const [pathAndQuery, hash = ""] = baseHref.split("#", 2);
    const [path, query = ""] = pathAndQuery.split("?", 2);
    if (path.replace(/\/+$/, "").endsWith(`/${cleanedRoute}`)) {
        return baseHref;
    }
    const nextPath = `${path.replace(/\/+$/, "")}/${cleanedRoute}`;
    return `${nextPath}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The URL to open for an app payload, or null if it names nothing openable. */
export function normalizeAssistantAppHref(app: AssistantAppPayload): string | null {
    const sourcePrefix = app.source === "agent_ai" ? "/a/" : "/app/";

    if (app.href) {
        if (/^https?:\/\//i.test(app.href)) return app.href;

        if (
            app.href === '/signal-intelligence' ||
            app.href.startsWith('/signal-intelligence/') ||
            app.href === '/signals' ||
            app.href.startsWith('/signals/') ||
            app.href === '/spatial' ||
            app.href.startsWith('/spatial/')
        ) {
            return withAssistantAppRoute('/workspace/signals', app.routePath);
        }

        if (isPassthroughHref(app.href)) {
            return withAssistantAppRoute(
                app.href.replace(/\/sdlc_workbench($|[/?#])/, "/sdlc-workbench$1"),
                app.routePath,
            );
        }

        const hrefWithoutSlash = app.href.replace(/^\/+/, "");
        const hashIndex = hrefWithoutSlash.indexOf("#");
        const queryIndex = hrefWithoutSlash.indexOf("?");
        const suffixIndex =
            [hashIndex, queryIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0] ??
            hrefWithoutSlash.length;
        const pathPart = hrefWithoutSlash.slice(0, suffixIndex);
        const suffix = hrefWithoutSlash.slice(suffixIndex);
        const safePath = normalizeAssistantRoutePath(pathPart);
        if (!safePath) return null;

        const [firstSegment, ...routeSegments] = safePath.split("/");
        const baseHref = `${sourcePrefix}${normalizeAssistantAppSlug(firstSegment)}${
            routeSegments.length ? `/${routeSegments.join("/")}` : ""
        }${suffix}`;
        return withAssistantAppRoute(baseHref, app.routePath);
    }

    if (app.slug) {
        // A blueprint is a template, not a deployed app: it opens the scaffolding
        // page, which is what render_app_surface's own description promises
        // ('blueprint' → /armory/new?blueprint=:slug). Without this branch a
        // blueprint carrying only a slug fell through to the /app/ prefix and
        // produced a URL that resolves to nothing.
        if (app.source === "blueprint") {
            return `/armory/new?blueprint=${encodeURIComponent(app.slug)}`;
        }

        return withAssistantAppRoute(
            `${sourcePrefix}${normalizeAssistantAppSlug(app.slug)}`,
            app.routePath,
        );
    }

    if (app.blueprint) {
        return `/armory/new?blueprint=${encodeURIComponent(app.blueprint)}`;
    }

    return null;
}
