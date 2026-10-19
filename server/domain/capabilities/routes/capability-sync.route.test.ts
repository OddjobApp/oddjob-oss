import { describe, it, expect } from "vitest";

import capabilitySyncRouter from "./capability-sync.route.js";

/**
 * Structural test: the handlers delegate to already-tested pipelines/queue, so
 * here we just assert the router declares the expected endpoints (methods +
 * paths) — cheap protection against a wiring regression without spinning up
 * express + auth.
 */
function declaredRoutes(router: any): Array<{ path: string; method: string }> {
    return (router.stack ?? [])
        .filter((layer: any) => layer.route)
        .flatMap((layer: any) =>
            Object.keys(layer.route.methods).map((method) => ({ path: layer.route.path, method })),
        );
}

describe("capability-sync.route", () => {
    it("declares the three sync endpoints", () => {
        const routes = declaredRoutes(capabilitySyncRouter);
        expect(routes).toContainEqual({ path: "/code-to-docs", method: "post" });
        expect(routes).toContainEqual({ path: "/docs-to-code", method: "post" });
        expect(routes).toContainEqual({ path: "/status", method: "get" });
    });
});
