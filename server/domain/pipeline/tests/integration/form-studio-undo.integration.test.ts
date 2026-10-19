/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Form Studio undo/redo, against a real database.
 *
 * Undo used to restore the last snapshot through save(), which appended the
 * current state to history, so a second undo restored the state the first undo
 * had just left. These tests walk back two changes and forward again.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { hilForms } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService } = await import("../../core/form-studio.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-undo] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("Form Studio undo and redo", () => {
    let orgId: number;
    let ctx: any;
    let formId: number;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio undo ${stamp}`, slug: `studio-undo-${stamp}` } as any).returning();
        orgId = org.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        const form = await formStudioService.create("First", ctx);
        formId = form.id;
        await formStudioService.save(formId, 0, { name: "Second" }, ctx);
        await formStudioService.save(formId, 1, { name: "Third" }, ctx);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("walks back two changes instead of flipping between the last two", async () => {
        const once = await formStudioService.undo(formId, 2, ctx);
        expect(once.name).toBe("Second");
        const twice = await formStudioService.undo(formId, 3, ctx);
        expect(twice.name).toBe("First");
        await expect(formStudioService.undo(formId, 4, ctx)).rejects.toThrow(/No saved change to undo/);
    });

    it("redoes the undone changes in order", async () => {
        expect((await formStudioService.redo(formId, 4, ctx)).name).toBe("Second");
        expect((await formStudioService.redo(formId, 5, ctx)).name).toBe("Third");
        await expect(formStudioService.redo(formId, 6, ctx)).rejects.toThrow(/No undone change to redo/);
    });

    it("drops the redo stack when a new change is saved after an undo", async () => {
        await formStudioService.undo(formId, 6, ctx);
        await formStudioService.save(formId, 7, { name: "Branch" }, ctx);
        await expect(formStudioService.redo(formId, 8, ctx)).rejects.toThrow(/No undone change to redo/);
    });

    it("refuses an undo made against an old revision", async () => {
        await expect(formStudioService.undo(formId, 3, ctx)).rejects.toThrow(/changed/);
    });
});
