import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A router nobody mounts is dark code that reviews as finished.
 *
 * This is not hypothetical here: `server/domain/capabilities/routes/capability-rfc.routes.ts`
 * defines two endpoints, is referenced by no file under `server/`, and has
 * therefore never been reachable. Its handlers were still worth fixing, and
 * they still serve no traffic.
 *
 * A static check rather than a live boot: `server/routes.ts` registers via
 * dynamic import inside an async function, so mounting is a fact about the
 * source, and asserting it here costs nothing at runtime.
 */

const ROUTES_TS = path.resolve(process.cwd(), "server", "routes.ts");

describe("improvement router registration", () => {
    const source = fs.readFileSync(ROUTES_TS, "utf8");

    it("is imported by server/routes.ts", () => {
        expect(
            source,
            "improvement.routes.js is not imported by server/routes.ts, so none of its endpoints are reachable.",
        ).toContain("domain/improvement/routes/improvement.routes.js");
    });

    it("is mounted under /api/improvement", () => {
        expect(
            source.replace(/\s+/g, " "),
            "The improvement router is imported but never passed to app.use, so its endpoints 404.",
        ).toMatch(/app\.use\(\s*["']\/api\/improvement["']\s*,\s*improvementRouter\s*\)/);
    });

    it("mounts the router it imports, under the path the spec names", () => {
        const importMatch = source.match(
            /const\s*\{\s*default:\s*(\w+)\s*\}\s*=\s*await import\(\s*["'][^"']*improvement\.routes\.js["']\s*\)/,
        );
        expect(importMatch, "Could not find the improvement router import binding.").toBeTruthy();
        const binding = importMatch![1];
        expect(source).toContain(`app.use("/api/improvement", ${binding})`);
    });
});
