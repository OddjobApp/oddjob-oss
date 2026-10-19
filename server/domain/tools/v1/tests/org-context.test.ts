/**
 * Guards the tool layer's organization resolution.
 *
 * `requireToolOrgId` replaced 23 hand-written `context.organizationId || 1`
 * fallbacks across the capability files. Each of those quietly redirected reads
 * AND writes to organization 1 whenever a tool ran without a resolved
 * organization — reachable in practice, since several invocation paths call a
 * capability's `execute` without populating (or even passing) a context.
 */

import { describe, it, expect } from "vitest";
import { requireToolOrgId } from "@domain/tools/v1/capabilities/org-context.js";

describe("requireToolOrgId", () => {
    it("returns the organization when one is present", () => {
        expect(requireToolOrgId({ organizationId: 42 } as any)).toBe(42);
    });

    it.each([
        ["a null organization", { organizationId: null }],
        ["an undefined organization", { organizationId: undefined }],
        ["an absent organization key", {}],
        ["organization 0", { organizationId: 0 }],
        ["a negative organization", { organizationId: -1 }],
        ["a non-numeric organization", { organizationId: "not-an-org" }],
        ["a missing context", undefined],
        ["a null context", null],
    ])("throws on %s instead of falling back to organization 1", (_label, ctx) => {
        expect(() => requireToolOrgId(ctx as any)).toThrow(/Organization context required/);
    });

    it("never resolves to organization 1 for an absent organization", () => {
        // The specific failure this replaced: `|| 1` made every one of these
        // return 1, which downstream code then treated as authentic tenancy.
        for (const ctx of [null, undefined, {}, { organizationId: null }, { organizationId: 0 }]) {
            let resolved: number | undefined;
            try {
                resolved = requireToolOrgId(ctx as any);
            } catch {
                resolved = undefined;
            }
            expect(resolved).toBeUndefined();
        }
    });
});
