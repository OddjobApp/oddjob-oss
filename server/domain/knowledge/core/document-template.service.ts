import { db } from "@server/database_service.js";
import { documentTemplates, type DocumentTemplate, type InsertDocumentTemplate } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

export class DocumentTemplateService {
    async list(orgId: number): Promise<DocumentTemplate[]> {
        return db
            .select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, orgId))
            .orderBy(documentTemplates.name);
    }

    async getById(id: number, orgId: number): Promise<DocumentTemplate | undefined> {
        const [template] = await db
            .select()
            .from(documentTemplates)
            .where(
                and(
                    eq(documentTemplates.id, id),
                    eq(documentTemplates.organizationId, orgId)
                )
            )
            .limit(1);
        return template;
    }

    async getResolvedContent(template: DocumentTemplate): Promise<string> {
        if (template.source === 'direct' || !template.knowledgeDocumentId) {
            return template.content || "";
        }

        const { knowledgeDocuments } = await import("@shared/schema/index.js");
        const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, template.knowledgeDocumentId)).limit(1);

        if (!doc) return "Reference document not found.";

        const { mapKnowledgeDocumentToRagSource } = await import("./knowledge-store.js");
        const { getAssetPlainText } = await import("@domain/knowledge/core/rag-utils.service.js");

        try {
            const ragSource = mapKnowledgeDocumentToRagSource(doc);
            const text = await getAssetPlainText(ragSource);
            return text;
        } catch (e: any) {
            console.error(`Error resolving template content: ${e.message}`);
            return `Error resolving template: ${e.message}`;
        }
    }

    async create(data: InsertDocumentTemplate, orgId: number): Promise<DocumentTemplate> {
        const [template] = await db
            .insert(documentTemplates)
            .values({
                ...data,
                organizationId: orgId,
            })
            .returning();
        return template;
    }

    async update(id: number, data: Partial<InsertDocumentTemplate>, orgId: number): Promise<DocumentTemplate> {
        const [template] = await db
            .update(documentTemplates)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(documentTemplates.id, id),
                    eq(documentTemplates.organizationId, orgId)
                )
            )
            .returning();

        if (!template) {
            throw new Error(`Document template ${id} not found or access denied`);
        }
        return template;
    }

    async delete(id: number, orgId: number): Promise<void> {
        await db
            .delete(documentTemplates)
            .where(
                and(
                    eq(documentTemplates.id, id),
                    eq(documentTemplates.organizationId, orgId)
                )
            );
    }
}

export const documentTemplateService = new DocumentTemplateService();


