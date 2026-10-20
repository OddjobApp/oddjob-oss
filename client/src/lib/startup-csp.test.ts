import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const client = path.resolve(process.cwd(), "client");
const pages = readdirSync(client).filter(name => name.endsWith(".html"));

describe("production SPA startup under script-src self", () => {
    it("selects the actual HTML entry files", () => {
        expect(pages).toContain("login.html");
        expect(pages).toContain("operations.html");
    });

    it.each(pages)("%s does not require unsafe inline JavaScript", name => {
        const html = readFileSync(path.join(client, name), "utf8");
        for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            const [, attributes, body] = script;
            if (/type=["']application\/(?:ld\+)?json["']/i.test(attributes)) continue;
            expect(body.trim(), `${name} contains executable inline JavaScript blocked by production CSP`).toBe("");
            const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
            if (source?.startsWith("/bootstrap/")) {
                expect(existsSync(path.join(client, "public", source)), `${name}: missing ${source}`).toBe(true);
            }
        }
    });
});
