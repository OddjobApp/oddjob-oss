/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

// The module pulls the whole agent stack in at import time; the two functions
// under test touch none of it.
vi.mock("@server/database_service.js", () => ({ db: {}, pool: {} }));

import { parseAppCatalog, selectAppForPresentation } from "./agent.service.js";

const apps = [
    { title: "QA Workbench (Org 291)", slug: "qa-workbench-standalone-1ii8a", description: "Test coverage, bug tracking, quality metrics", availability: "installed", href: "/app/qa-workbench-standalone-1ii8a" },
    { title: "SDLC Workbench Suite (Org 291)", slug: "sdlc-hybrid", description: "Shared Next.js server hosting all SDLC workbenches", availability: "installed", href: "/app/hybrid-sdlc-org291" },
];

describe("parseAppCatalog", () => {
    // The regression: list_installed_apps answers with {"items":[...]}, and the caller
    // accepted only a string starting with "[" - so the catalogue was always empty and
    // a hardcoded list of another organization's apps stood in for it.
    it("reads the object the tool actually returns", () => {
        expect(parseAppCatalog(JSON.stringify({ items: apps }))).toHaveLength(2);
    });

    it("still reads a bare array, and an object already parsed", () => {
        expect(parseAppCatalog(JSON.stringify(apps))).toHaveLength(2);
        expect(parseAppCatalog({ items: apps })).toHaveLength(2);
    });

    it("treats the tool's plain-sentence answer as no apps", () => {
        expect(parseAppCatalog("No installed apps, active agent deployments ... found for this organization.")).toEqual([]);
        expect(parseAppCatalog(undefined)).toEqual([]);
        expect(parseAppCatalog("{ not json")).toEqual([]);
    });
});

describe("selectAppForPresentation", () => {
    it("opens the app that was asked for", () => {
        expect(selectAppForPresentation("open the qa workbench app", apps)?.slug).toBe("qa-workbench-standalone-1ii8a");
    });

    // "it" is a substring of "suite", "quality" and "monitoring", so a two-letter
    // token used to score against every app and return an unrelated one.
    it("offers nothing when the organization has no such app", () => {
        expect(selectAppForPresentation("open the it ticketing app", apps)).toBeNull();
    });

    it("offers nothing when the organization has no apps at all", () => {
        expect(selectAppForPresentation("open the qa workbench app", [])).toBeNull();
    });
});
