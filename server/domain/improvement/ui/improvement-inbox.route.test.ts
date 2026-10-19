import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveSpaTemplate } from "@shared/spa-routes";

/**
 * A page that is imported but never routed — or routed in the SPA that does not
 * serve its URL — renders nowhere while every sidebar link still updates.
 *
 * Three things have to agree for /control/improvement to work, and each has
 * gone wrong in this repo before:
 *
 *  1. the page file exists where the lazy import names it (a `lazy(() =>
 *     import(...))` is invisible to a plain grep, so a stale path fails only at
 *     runtime, inside a Suspense boundary);
 *  2. a Route in IntelligenceRouting points at it;
 *  3. the URL prefix is served by the SPA that router belongs to, which
 *     shared/spa-routes.ts decides for dev and production alike.
 */

const ROOT = process.cwd();
const ROUTING = path.resolve(
    ROOT, "server", "domain", "core", "ui", "components", "routing", "IntelligenceRouting.tsx",
);
const PAGE = path.resolve(
    ROOT, "server", "domain", "improvement", "ui", "modules", "improvement", "pages", "ImprovementInbox.tsx",
);
describe("Improvement Inbox routing", () => {
    const routing = fs.readFileSync(ROUTING, "utf8");

    it("has a page file at the path the lazy import names", () => {
        expect(routing).toContain(
            "@domain-ui/improvement/ui/modules/improvement/pages/ImprovementInbox",
        );
        expect(
            fs.existsSync(PAGE),
            "IntelligenceRouting lazily imports ImprovementInbox, but no file exists at that path.",
        ).toBe(true);
    });

    it("routes /control/improvement to the page", () => {
        expect(routing.replace(/\s+/g, " ")).toMatch(
            /<Route path="\/control\/improvement" component=\{ImprovementInbox\} \/>/,
        );
    });

    // wouter matches in order; a bare /control declared first would shadow it.
    it("declares the route before the bare /control route", () => {
        const specific = routing.indexOf('path="/control/improvement"');
        const bare = routing.indexOf('path="/control" component={ControlOverview}');
        expect(specific).toBeGreaterThan(-1);
        expect(bare).toBeGreaterThan(-1);
        expect(
            specific < bare,
            "/control is declared before /control/improvement and will shadow it.",
        ).toBe(true);
    });

    // Dev and prod both resolve through shared/spa-routes.ts, so one assertion
    // covers both; spa-routes.test.ts proves serveStatic follows the resolver.
    it("is served by the intelligence SPA", () => {
        expect(resolveSpaTemplate("/control/improvement")).toBe("intelligence.html");
    });
});
