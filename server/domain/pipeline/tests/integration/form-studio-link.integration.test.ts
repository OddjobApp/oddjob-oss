/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * A published form's public link against a real database: expiry, the emailed
 * code round trip, and replacing the link.
 */

configureTestEnvironment();
process.env.JWT_SECRET ??= "test-secret-for-form-links";

const sent: Array<{ email: string; code: string }> = [];
vi.mock("@domain/integrations/core/email.service.js", () => ({
    sendOtpEmail: async (email: string, code: string) => { sent.push({ email, code }); },
}));

const { db } = await import("@server/database_service.js");
const { hilForms, otpCodes } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { verifyFormSession } = await import("../../core/form-link-session.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[form-studio-link] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("Form Studio public links", () => {
    let orgId: number;
    let ctx: any;
    const tokens: string[] = [];

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Studio links ${stamp}`, slug: `studio-links-${stamp}` } as any).returning();
        orgId = org.id;
        ctx = { organizationId: orgId, userId: undefined, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
    });

    afterAll(async () => {
        for (const token of tokens) await db.delete(otpCodes).where(eq(otpCodes.executionId, `form_link:${token}`));
        if (!orgId) return;
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    async function publishForm(name: string) {
        const form = await studio.create(`${name} ${stamp}`, ctx);
        await studio.save(form.id, 0, {
            schema: { fields: [{ key: "mood", label: "Mood", type: "number", required: true, pageId: "p1" }], studio: { version: 2, pages: [{ id: "p1", title: "Mood" }] } },
        }, ctx);
        const published = await studio.publish(form.id, 1, ctx);
        const token = published.href.split("/").pop()!;
        tokens.push(token);
        return { form, token, revision: published.revision };
    }

    it("asks for a code only when the form says so, and a code opens it once", async () => {
        const { form, token, revision } = await publishForm("Coded link");
        expect((await studio.published(token)).security.requireOtp).toBe(false);
        await expect(studio.requestLinkCode(token, "sam@example.com")).rejects.toThrow("This form does not ask for a code.");

        await studio.setLinkSecurity(form.id, { requireOtp: true, tokenExpirationHours: null }, ctx);
        expect((await studio.published(token)).security).toEqual({ requireOtp: true, tokenExpirationHours: null });

        await studio.requestLinkCode(token, "sam@example.com");
        const { code } = sent.at(-1)!;
        await expect(studio.verifyLinkCode(token, "sam@example.com", code === "000000" ? "111111" : "000000")).rejects.toThrow(/not right/);
        const { session } = await studio.verifyLinkCode(token, "sam@example.com", code);
        expect(verifyFormSession(session, token)).toEqual({ email: "sam@example.com" });
        await expect(studio.verifyLinkCode(token, "sam@example.com", code)).rejects.toThrow(/not right/);

        const submitted = await studio.submit(token, revision, { mood: 3 }, { email: "sam@example.com" });
        const [row] = await db.select({ config: hilForms.config }).from(hilForms).where(and(eq(hilForms.id, submitted.id), eq(hilForms.organizationId, orgId)));
        expect((row.config as any).formStudioResponse.respondentEmail).toBe("sam@example.com");
    });

    it("answers an expired link with 410", async () => {
        const { form, token } = await publishForm("Expiring link");
        await studio.setLinkSecurity(form.id, { requireOtp: false, tokenExpirationHours: 1 }, ctx);
        expect((await studio.published(token)).release.releaseNumber).toBe(1);

        const [row] = await db.select().from(hilForms).where(eq(hilForms.id, form.id));
        const config = row.config as any;
        config.formStudio.published.at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        await db.update(hilForms).set({ config }).where(eq(hilForms.id, form.id));

        await expect(studio.published(token)).rejects.toMatchObject({ statusCode: 410, message: expect.stringContaining("expired") });
    });

    it("replaces a link so the old one, and sessions made for it, stop working", async () => {
        const { form, token } = await publishForm("Rotated link");
        const oldSession = (await import("../../core/form-link-session.js")).signFormSession({ token, email: "sam@example.com" });
        const rotated = await studio.rotateLink(form.id, ctx);
        const newToken = rotated.published!.href.split("/").pop()!;
        tokens.push(newToken);

        expect(newToken).not.toBe(token);
        await expect(studio.published(token)).rejects.toThrow("Published form not found.");
        expect((await studio.published(newToken)).release.releaseNumber).toBe(1);
        expect(verifyFormSession(oldSession, newToken)).toBeNull();
    });
});
