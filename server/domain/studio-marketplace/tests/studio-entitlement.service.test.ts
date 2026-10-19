/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls, row } = vi.hoisted(() => ({
    calls: { inserts: [] as any[], deletes: [] as any[], wheres: 0 },
    row: { current: {} as any },
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: (condition: any) => {
                    calls.wheres += 1;
                    const rows = row.current ? [row.current] : [];
                    const query = Object.assign(Promise.resolve(rows), {
                        limit: async () => rows,
                        orderBy: () => query,
                    });
                    // @ts-expect-error attaching condition for test inspection
                    query.condition = condition;
                    return query;
                },
            }),
        }),
        insert: () => ({
            values: (v: any) => {
                calls.inserts.push(v);
                return { onConflictDoNothing: () => ({ returning: async () => [row.current] }) };
            },
        }),
        delete: () => ({
            where: (condition: any) => {
                calls.deletes.push(condition);
                return { execute: async () => ({ rowCount: 1 }) };
            },
        }),
    },
}));

const { StudioEntitlementService, GATED_STUDIO_KINDS } = await import(
    "../core/studio-entitlement.service.js"
);

const service = new StudioEntitlementService();

beforeEach(() => {
    calls.inserts = [];
    calls.deletes = [];
    calls.wheres = 0;
    row.current = {
        id: 1,
        organizationId: 42,
        studioKind: "media",
        installedByUserId: "u1",
        installedAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: new Date("2026-10-01T00:00:00Z"),
    };
});

describe("StudioEntitlementService.list", () => {
    it("returns only the gated studios for the org, marking installed ones", async () => {
        const result = await service.list(42);

        expect(result).toHaveLength(GATED_STUDIO_KINDS.length);
        expect(result.map((s) => s.kind)).toEqual(GATED_STUDIO_KINDS);
        expect(result.find((s) => s.kind === "media")).toMatchObject({
            name: "Media Studio",
            installed: true,
        });
    });
});

describe("StudioEntitlementService.isEnabled", () => {
    it("returns true for non-gated studios without querying", async () => {
        expect(await service.isEnabled(42, "form")).toBe(true);
        expect(calls.wheres).toBe(0);
    });

    it("returns true when an entitlement row exists", async () => {
        expect(await service.isEnabled(42, "media")).toBe(true);
        expect(calls.wheres).toBe(1);
    });

    it("returns false when no entitlement row exists", async () => {
        row.current = undefined as any;
        expect(await service.isEnabled(42, "media")).toBe(false);
    });
});

describe("StudioEntitlementService.install", () => {
    it("inserts an entitlement for a gated studio", async () => {
        row.current = { id: 2, organizationId: 42, studioKind: "signal" };
        await service.install(42, "u2", "signal");

        expect(calls.inserts[0]).toMatchObject({
            organizationId: 42,
            studioKind: "signal",
            installedByUserId: "u2",
        });
    });

    it("rejects install for a non-gated studio", async () => {
        await expect(service.install(42, "u2", "form")).rejects.toThrow(/not available as an add-on/);
        expect(calls.inserts).toHaveLength(0);
    });

    it("rejects unknown studio kinds", async () => {
        await expect(service.install(42, "u2", "nope" as any)).rejects.toThrow(/not available as an add-on/);
    });
});

describe("StudioEntitlementService.uninstall", () => {
    it("deletes an entitlement for a gated studio", async () => {
        await service.uninstall(42, "media");
        expect(calls.deletes).toHaveLength(1);
    });

    it("rejects uninstall for a non-gated studio", async () => {
        await expect(service.uninstall(42, "form")).rejects.toThrow(/not available as an add-on/);
        expect(calls.deletes).toHaveLength(0);
    });
});
