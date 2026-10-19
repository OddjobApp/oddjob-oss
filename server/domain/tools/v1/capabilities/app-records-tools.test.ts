import { describe, it, expect } from "vitest";
import { fitRecordPage, APP_RECORDS_OUTPUT_BUDGET } from "./app-records-tools.js";
import { MAX_TOOL_OUTPUT_CHARS, capToolOutput } from "@domain/crew/core/crew-tools.service.js";

const app = { id: 805, slug: "budgetmaster-workbench", name: "budgetmaster-workbench" };
const record = (i: number) => ({
    recordId: `qbo:1:9:payment:${i}`,
    updatedAt: "2026-10-09T00:00:00.000Z",
    data: { amount: i, currency: "USD", payee_raw: `Payee ${i}`, memo: "x".repeat(400), account_id: `acct-${i}` },
});
const page = (count: number, total = 51, offset = 0) =>
    ({ app, collection: "transactions", total, offset, records: Array.from({ length: count }, (_, i) => record(offset + i)) });

describe("fitRecordPage", () => {
    it("stays inside the CREW tool-output cap, so CREW never cuts it", () => {
        expect(APP_RECORDS_OUTPUT_BUDGET).toBeLessThan(MAX_TOOL_OUTPUT_CHARS);
        const out = fitRecordPage(page(25));
        expect(out.length).toBeLessThanOrEqual(APP_RECORDS_OUTPUT_BUDGET);
        expect(capToolOutput(out)).toBe(out);
    });

    it("says exactly how many records it returned and where the next page starts", () => {
        const out = JSON.parse(fitRecordPage(page(25)));
        expect(out.records.length).toBe(out.returned);
        expect(out.returned).toBeLessThan(25);
        expect(out.summary).toContain(`Returned ${out.returned} of 51`);
        expect(out.nextOffset).toBe(out.returned);
        expect(out.summary).toContain(`call again with offset ${out.returned}`);
        expect(out.summary).toMatch(/Only \d+ fitted/);
    });

    it("fits more records when asked for fewer fields", () => {
        const all = JSON.parse(fitRecordPage(page(25)));
        const narrow = JSON.parse(fitRecordPage(page(25), { fields: ["amount", "payee_raw"] }));
        expect(narrow.returned).toBeGreaterThan(all.returned);
        expect(Object.keys(narrow.records[0].data)).toEqual(["amount", "payee_raw"]);
    });

    it("trims a long value instead of letting it crowd out other records", () => {
        const out = JSON.parse(fitRecordPage(page(1, 1)));
        expect(out.records[0].data.memo).toMatch(/… \[100 more chars\]$/);
    });

    it("reports the last page as complete", () => {
        const out = JSON.parse(fitRecordPage(page(2, 2)));
        expect(out).toMatchObject({ returned: 2, nextOffset: null });
        expect(out.summary).toContain("That is all of them.");
    });

    it("reports an empty match plainly", () => {
        const out = JSON.parse(fitRecordPage(page(0, 0)));
        expect(out.summary).toBe("No records matched in 'transactions' of budgetmaster-workbench.");
    });
});

describe("propose_app_action", () => {
    it("is declared with idempotent annotation and valid parameters schema", async () => {
        const { APP_RECORDS_TOOLS } = await import("./app-records-tools.js");
        const tool = APP_RECORDS_TOOLS.propose_app_action;
        expect(tool).toBeDefined();
        expect(tool.idempotency).toBe("idempotent");

        // Valid create_record payload
        const validCreate = tool.parameters.parse({
            app: "budgetmaster-workbench",
            action: "create_record",
            collection: "transactions",
            data: { amount: 100, payee: "Acme" },
            reason: "Adding expense from verified receipt.",
        });
        expect(validCreate.action).toBe("create_record");
        expect(validCreate.collection).toBe("transactions");

        // Valid update_record payload with recordId
        const validUpdate = tool.parameters.parse({
            app: "budgetmaster-workbench",
            action: "update_record",
            collection: "transactions",
            recordId: "rec_123",
            data: { status: "cleared" },
            reason: "Updating transaction status.",
        });
        expect(validUpdate.recordId).toBe("rec_123");

        // Valid delete_record payload
        const validDelete = tool.parameters.parse({
            app: "rescue-dispatch",
            action: "delete_record",
            collection: "active_rescues",
            recordId: "rescue_999",
            reason: "Closing out duplicate dispatch ticket.",
        });
        expect(validDelete.action).toBe("delete_record");

        // Invalid action fails schema validation
        expect(() =>
            tool.parameters.parse({
                app: "app",
                action: "drop_table" as any,
                collection: "col",
                reason: "invalid",
            })
        ).toThrow();

        // Missing required reason fails validation
        expect(() =>
            tool.parameters.parse({
                app: "app",
                action: "create_record",
                collection: "col",
            })
        ).toThrow();
    });
});

