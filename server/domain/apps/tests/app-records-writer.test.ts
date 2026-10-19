import { describe, it, expect, vi, beforeEach } from "vitest";

const selectAnswers: unknown[][] = [];
const insertedValues: unknown[] = [];
const updatedValues: unknown[] = [];
let deleteCalled = false;

vi.mock("@server/database_service.js", () => {
    const chain = (result: () => unknown) => {
        const self: any = {};
        for (const m of ["from", "where", "orderBy", "limit", "returning"]) self[m] = () => self;
        self.values = (v: unknown) => {
            insertedValues.push(v);
            return self;
        };
        self.set = (v: unknown) => {
            updatedValues.push(v);
            return self;
        };
        self.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
        return self;
    };
    return {
        db: {
            select: () => chain(() => selectAnswers.shift() ?? []),
            insert: () => chain(() => [{ id: 1 }]),
            update: () => chain(() => [{ id: 1 }]),
            delete: () => {
                deleteCalled = true;
                return chain(() => []);
            },
        },
    };
});

import { executeAppRecordAction } from "../core/app-records-writer.service.js";

describe("executeAppRecordAction", () => {
    beforeEach(() => {
        selectAnswers.length = 0;
        insertedValues.length = 0;
        updatedValues.length = 0;
        deleteCalled = false;
    });

    it("inserts a new record on create_record", async () => {
        selectAnswers.push([]); // Not existing
        const res = await executeAppRecordAction({
            organizationId: 42,
            appId: 10,
            collection: "tickets",
            action: "create_record",
            data: { title: "Fix login button", priority: "high" },
        });

        expect(res.success).toBe(true);
        expect(res.action).toBe("create_record");
        expect(res.collection).toBe("tickets");
        expect(res.recordId).toMatch(/^rec_/);
        expect(res.data).toEqual({ title: "Fix login button", priority: "high" });
        expect(insertedValues.length).toBe(1);
    });

    it("refuses to create over an existing record instead of replacing it", async () => {
        selectAnswers.push([{ id: 7 }]); // A record with this id exists
        await expect(executeAppRecordAction({
            organizationId: 42,
            appId: 10,
            collection: "tickets",
            action: "create_record",
            recordId: "ticket_123",
            data: { title: "Duplicate" },
        })).rejects.toThrow(/already exists.*update_record/);
        expect(insertedValues.length).toBe(0);
        expect(updatedValues.length).toBe(0);
    });

    it("updates existing record on update_record", async () => {
        selectAnswers.push([{ id: 1, data: { title: "Old title", status: "open" } }]); // Existing record
        const res = await executeAppRecordAction({
            organizationId: 42,
            appId: 10,
            collection: "tickets",
            action: "update_record",
            recordId: "ticket_123",
            data: { status: "resolved" },
        });

        expect(res.success).toBe(true);
        expect(res.action).toBe("update_record");
        expect(res.recordId).toBe("ticket_123");
        expect(res.data).toEqual({ title: "Old title", status: "resolved" });
        expect(updatedValues.length).toBe(1);
    });

    it("throws NotFoundError when updating non-existent record", async () => {
        selectAnswers.push([]); // Not existing
        await expect(
            executeAppRecordAction({
                organizationId: 42,
                appId: 10,
                collection: "tickets",
                action: "update_record",
                recordId: "missing_id",
                data: { status: "closed" },
            })
        ).rejects.toThrow(/not found/i);
    });

    it("deletes existing record on delete_record", async () => {
        selectAnswers.push([{ id: 1 }]); // Existing
        const res = await executeAppRecordAction({
            organizationId: 42,
            appId: 10,
            collection: "tickets",
            action: "delete_record",
            recordId: "ticket_123",
        });

        expect(res.success).toBe(true);
        expect(res.action).toBe("delete_record");
        expect(deleteCalled).toBe(true);
    });

    it("requires recordId for update_record and delete_record", async () => {
        await expect(
            executeAppRecordAction({
                organizationId: 42,
                appId: 10,
                collection: "tickets",
                action: "update_record",
            })
        ).rejects.toThrow(/recordId is required/i);

        await expect(
            executeAppRecordAction({
                organizationId: 42,
                appId: 10,
                collection: "tickets",
                action: "delete_record",
            })
        ).rejects.toThrow(/recordId is required/i);
    });
});
