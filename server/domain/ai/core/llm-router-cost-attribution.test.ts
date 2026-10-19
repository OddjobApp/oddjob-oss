/**
 * Every routed model call must carry its tenant to the client.
 *
 * CachedAIClient reads `config.organizationId` and calls
 * systemConfigService.trackSpend(). That single value does three things:
 *
 *   - the pre-call budget check (trackSpend(0, orgId, missionId)) — skipped
 *     entirely when orgId is null, so the call proceeds over budget
 *   - the mission and organization kill-switch alerts
 *   - the cost_ledger row (`if (amount > 0 && orgId)`)
 *
 * llmRouterService.complete() receives an organizationId and threads it through
 * selectModel, executeSelection and logFailure — then dropped it at the final
 * hop, because the per-provider methods take only `request` and `model`. Every
 * routed call was therefore unattributed AND unbudgeted, and crew — the busiest
 * surface — routes exclusively this way. cost_ledger recorded nothing from
 * 2026-08-27 onward while the platform kept running.
 *
 * A source assertion rather than an integration test: the failure mode is
 * silence, and the invariant is "no execute() call may omit the tenant", which
 * is a property of the file. This follows the existing precedent in
 * improvement.routes.mounted.test.ts, which asserts on routes.ts source for the
 * same reason — a router nobody mounts reads as finished.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTER = path.resolve(process.cwd(), "server", "domain", "ai", "core", "llm-router.service.ts");
const source = fs.readFileSync(ROUTER, "utf8");

describe("llm-router cost attribution", () => {
    it("passes organizationId at every client.execute call site", () => {
        const lines = source.split(/\r?\n/);
        const offenders: number[] = [];

        lines.forEach((line, i) => {
            if (!line.includes("client.execute(")) return;
            // The tenant must appear inside this call's config object. Ten lines
            // is well inside every config in this file and stops the search from
            // running into the next call.
            const window = lines.slice(i, i + 10).join("\n");
            if (!/organizationId:\s*request\.organizationId/.test(window)) {
                offenders.push(i + 1);
            }
        });

        expect(
            offenders,
            `client.execute() without organizationId at line(s) ${offenders.join(", ")}. ` +
                "Without it CachedAIClient calls trackSpend(cost, null, null): no ledger row, " +
                "and both budget kill-switches are skipped.",
        ).toEqual([]);
    });

    it("has execute call sites to check, so the assertion cannot pass vacuously", () => {
        const count = (source.match(/client\.execute\(/g) ?? []).length;
        expect(count).toBeGreaterThan(0);
    });

    it("carries the tenant on LLMRequest so it survives the per-provider hop", () => {
        // unifiedComplete/unifiedStream receive only (request, model),
        // so the request is the only vehicle that reaches them.
        expect(source).toMatch(/interface LLMRequest[\s\S]*?organizationId\?:\s*number/);
    });

    it("stamps the caller's organizationId onto the request in complete()", () => {
        // complete(request, organizationId) is where the id enters; if it is not
        // copied onto the request, the per-provider methods never see it.
        expect(source).toMatch(/request\s*=\s*\{\s*\.\.\.request,\s*organizationId\s*\}/);
    });
});
