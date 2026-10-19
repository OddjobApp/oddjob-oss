// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { resolveSpaTemplate, SPA_ROUTES, type SpaTemplate } from "@shared/spa-routes";
import { serveStatic } from "./vite";

/**
 * Paths whose resolution has been wrong before. Prod used Express wildcards
 * (`/app*`) while dev matched whole segments, so `/apps` got the login bundle
 * in production, and the auth pages below were missing from prod entirely.
 */
const REGRESSIONS: Array<[string, SpaTemplate | null]> = [
  ["/", "login.html"],
  ["/login", "login.html"],
  ["/signup", "login.html"],
  ["/reset-password", "login.html"],
  ["/app/dispatcher", "login.html"],
  ["/o/7/app/dispatcher", "login.html"],
  ["/a/rescue-dispatcher", "login.html"],
  ["/apps", "armory.html"],
  ["/apps/42", "armory.html"],
  ["/app-forge", "armory.html"],
  ["/appforge", "armory.html"],
  ["/agents", "operations.html"],
  ["/agent/12", "intelligence.html"],
  ["/signal-intelligence", "operations.html"],
  ["/health/monitoring/1640", "intelligence.html"],
  ["/knowledge-store/x", "knowledge.html"],
  // Prefix-only lookalikes belong to nobody.
  ["/devices", null],
  ["/application", null],
  ["/dashboards", null],
];

describe("resolveSpaTemplate", () => {
  it.each(REGRESSIONS)("%s -> %s", (p, expected) => {
    expect(resolveSpaTemplate(p)).toBe(expected);
  });

  it("resolves every declared prefix, and its subpaths, to a template", () => {
    for (const { prefixes } of SPA_ROUTES) {
      for (const p of prefixes) {
        expect(resolveSpaTemplate(p), p).not.toBeNull();
        expect(resolveSpaTemplate(`${p}/x`), `${p}/x`).toBe(resolveSpaTemplate(p));
      }
    }
  });
});

describe("serveStatic serves what the resolver decides", () => {
  let server: Server;
  let base: string;
  let distPath: string;

  beforeAll(async () => {
    distPath = fs.mkdtempSync(path.join(os.tmpdir(), "spa-routes-"));
    for (const { template } of SPA_ROUTES) {
      fs.writeFileSync(path.join(distPath, template), template);
    }
    const app = express();
    serveStatic(app, distPath);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(distPath, { recursive: true, force: true });
  });

  it("serves the resolved bundle for every declared prefix and regression path", async () => {
    const paths = [
      ...REGRESSIONS.map(([p]) => p),
      ...SPA_ROUTES.flatMap(({ prefixes }) => prefixes.flatMap((p) => [p, `${p}/x`])),
    ];
    for (const p of paths) {
      const res = await fetch(base + p);
      const expected = resolveSpaTemplate(p);
      expect(await res.text(), p).toBe(expected ?? "login.html");
      expect(res.status, p).toBe(expected ? 200 : 404);
    }
  });
});
