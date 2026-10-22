/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { ensureFixtureOrgs } from "../../../../tests/helpers/fixture-orgs.js";
import { documentService } from "../core/extraction/document-service.js";

/**
 * Uploaded documents were stored as base64 and never turned into text, so they
 * were never indexed. Uploads are read when saved, and documents saved before
 * that are re-read on request — within the caller's organization only.
 */
const ORG = 9801;
const OTHER = 9802;
const CANARY = `canary-${randomUUID()}`;
const markdown = `# Agile business case\n\nThe ${CANARY} initiative cuts lead time by half.\n`;
const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");
const ctx = (organizationId: number) => ({ organizationId, userId: undefined as any, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false });
const ids: number[] = [];

describe("text of uploaded knowledge documents", () => {
    beforeAll(async () => {
        await ensureFixtureOrgs([[ORG, "Extraction"], [OTHER, "Extraction other"]]);
    });
    afterAll(async () => {
        if (ids.length) await db.delete(knowledgeDocuments).where(inArray(knowledgeDocuments.id, ids));
    });

    it("re-reads documents saved without text, and only the caller's organization's", async () => {
        const [mine] = await db.insert(knowledgeDocuments).values({
            title: `Old upload ${randomUUID()}`, sourceType: "upload", contentType: "text/markdown",
            fileData: b64(markdown), organizationId: ORG,
        }).returning();
        const [theirs] = await db.insert(knowledgeDocuments).values({
            title: `Other org upload ${randomUUID()}`, sourceType: "upload", contentType: "text/markdown",
            fileData: b64("other organization"), organizationId: OTHER,
        }).returning();
        ids.push(mine.id, theirs.id);

        const summary = await documentService.reextractDocuments(ctx(ORG) as any);
        expect(summary.documents.map((d) => d.id)).toEqual([mine.id]);
        expect(summary.extracted).toBe(1);

        const [after] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, mine.id));
        expect(after.textContent).toContain(CANARY);
        expect((after.metadata as any).extraction).toMatchObject({ status: "extracted" });
        const [untouched] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, theirs.id));
        expect(untouched.textContent ?? "").toBe("");
    });

    it("reads a new upload when it is saved, including a data: URL", async () => {
        const doc = await documentService.createDocument({
            title: `New upload ${randomUUID()}`, sourceType: "upload", contentType: "text/markdown",
            fileData: `data:text/markdown;base64,${b64(markdown)}`,
        }, ctx(ORG) as any);
        ids.push(doc.id);
        const [row] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id));
        expect(row.textContent).toContain(CANARY);
    });

    it("records an unreadable file as unsupported rather than as an empty document", async () => {
        const doc = await documentService.createDocument({
            title: `Binary ${randomUUID()}`, sourceType: "upload", contentType: "application/x-msdownload",
            fileData: b64("MZ\u0000\u0001binary"),
        }, ctx(ORG) as any);
        ids.push(doc.id);
        const [row] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id));
        expect(row.textContent ?? "").toBe("");
        expect((row.metadata as any).extraction.status).toBe("unsupported");
    });
});
