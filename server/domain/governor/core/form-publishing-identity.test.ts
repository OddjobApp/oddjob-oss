/**
 * FormPublishingService reuse: a template is identified by its field keys.
 *
 * publish() deduped on the exact JSON of the stored schema, so relabelling a field
 * of an agent-published template (or giving it Studio pages) made the next
 * identical request publish a duplicate.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ existing: [] as any[], insert: vi.fn() }));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => h.existing }) }),
        insert: (...args: any[]) => {
            h.insert(...args);
            return { values: () => ({ returning: () => [{ id: 99, name: "Budget cap", organizationId: 7 }] }) };
        },
    },
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    getRedisClient: () => ({ set: vi.fn().mockResolvedValue("OK") }),
}));

import { formPublishingService, fieldKeySignature } from "./form-publishing-service.js";

beforeEach(() => {
    h.existing = [];
    h.insert.mockClear();
});

describe("fieldKeySignature", () => {
    it("ignores field order, labels and types", () => {
        expect(fieldKeySignature([{ key: "b", label: "B" }, { key: "a", type: "number" }]))
            .toBe(fieldKeySignature([{ name: "a" }, { key: "b", label: "Renamed" }]));
    });

    it("tells different questions apart", () => {
        expect(fieldKeySignature([{ key: "a" }])).not.toBe(fieldKeySignature([{ key: "a" }, { key: "b" }]));
    });
});

describe("FormPublishingService.publish reuse", () => {
    it("reuses a template whose fields were relabelled after it was published", async () => {
        h.existing = [{
            id: 12,
            schema: { fields: [{ key: "cap", label: "Monthly cap (edited in Studio)", type: "number" }], studio: { version: 1 } },
        }];

        const id = await formPublishingService.publish("Budget cap", [{ name: "cap", label: "Cap", type: "number" }], 7);

        expect(id).toBe(12);
        expect(h.insert).not.toHaveBeenCalled();
    });

    it("publishes a new template when the questions differ", async () => {
        h.existing = [{ id: 12, schema: { fields: [{ key: "cap" }] } }];

        const id = await formPublishingService.publish("Budget cap", [{ name: "cap" }, { name: "currency" }], 7);

        expect(id).toBe(99);
        expect(h.insert).toHaveBeenCalledTimes(1);
    });
});
