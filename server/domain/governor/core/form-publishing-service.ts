import { db } from "@server/database_service.js";
import { hilForms } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("FormPublishingService");

/**
 * The identity of a form's questions: its field keys, in any order.
 *
 * publish() used to dedupe on the exact JSON of the schema, so any later edit to a
 * published template (a relabelled field, a Studio page) made the next identical
 * agent request publish a duplicate. Two forms asking for the same answers are the
 * same form for reuse, whatever their labels or layout.
 */
export function fieldKeySignature(fields: unknown): string {
    if (!Array.isArray(fields)) return "";
    return fields
        .map((field: any) => String(field?.key ?? field?.name ?? "").trim())
        .filter(Boolean)
        .sort()
        .join("|");
}

export class FormPublishingService {
    /**
     * Publish an ephemeral form schema to the global library.
     * Deduplicates on name, organization and field keys.
     */
    async publish(name: string, fields: any[], organizationId?: number, userId?: string) {
        try {
            // Defence in depth for the caller that got here with nothing: this threw
            // "Cannot read properties of undefined (reading 'map')" ~700 times because
            // request_human_input was executed despite failing parameter validation and
            // passed fields: undefined straight through. The adapter now refuses that
            // call, but a bare TypeError is a poor way to report a bad argument, so say
            // what is actually wrong.
            if (!name || typeof name !== "string") {
                throw new Error("Cannot publish a form without a name.");
            }
            if (!Array.isArray(fields) || fields.length === 0) {
                throw new Error(`Cannot publish form "${name}": it has no fields.`);
            }

            // 1. Existing templates with this name in this organization. A missing
            // organization means shared rows only (IS NULL): the old
            // `organizationId ? eq(...) : undefined` matched every tenant's forms.
            const existingForms = await db.select()
                .from(hilForms)
                .where(
                    and(
                        eq(hilForms.name, name),
                        organizationId ? eq(hilForms.organizationId, organizationId) : isNull(hilForms.organizationId),
                        eq(hilForms.kind, "template"),
                    )
                );

            // 2. Map fields to FormFieldDefinition format used by FormRenderer
            const normalizedFields = fields.map(f => ({
                key: f.name || f.key,
                label: f.label || f.name,
                type: this.mapType(f.type || 'text'),
                required: f.required !== undefined ? f.required : true,
                placeholder: f.placeholder,
                description: f.description,
                options: f.options,
                defaultValue: f.defaultValue,
                readOnly: f.readOnly
            }));

            const newSchema = { fields: normalizedFields };

            // 3. Reuse a template that asks for the same answers
            const signature = fieldKeySignature(normalizedFields);
            const duplicate = existingForms.find(f => fieldKeySignature((f.schema as any)?.fields) === signature);

            if (duplicate) {
                logger.info(`[FormPublishingService] Form "${name}" already exists in library (ID: ${duplicate.id}). Skipping publishing.`);
                return duplicate.id;
            }

            // 4. Insert new form into library
            const [newForm] = await db.insert(hilForms).values({
                name,
                description: `Agent-generated form for ${name}`,
                schema: newSchema,
                organizationId: organizationId || null,
                createdBy: userId || null,
                kind: "template",
                status: "active", // Global forms are active templates
                isArchived: false,
                isViewed: true,
                config: {},
                stepExecutionId: null,
            } as any).returning();

            // --- Pre-caching Logic ---
            try {
                const redis = getRedisClient();
                const cacheKey = `hil:form:${newForm.id}`;
                const nameCacheKey = `hil:form:name:${newForm.organizationId || 'global'}:${newForm.name}`;

                const cacheData = JSON.stringify(newForm);
                await redis.set(cacheKey, cacheData, 'EX', 3600 * 24); // Cache for 24h
                await redis.set(nameCacheKey, cacheData, 'EX', 3600 * 24);

                logger.info(`[FormPublishingService] Pre-cached form ${newForm.id} (${newForm.name}) in Redis`);
            } catch (cacheError) {
                logger.error(`[FormPublishingService] Failed to pre-cache form:`, cacheError);
            }

            logger.info(`[FormPublishingService] Successfully published form "${name}" (ID: ${newForm.id})`);
            return newForm.id;
        } catch (err: any) {
            logger.error(`[FormPublishingService] Failed to publish form "${name}":`, err);
            console.error("ERROR DETAIL:", err.message, err.stack);
            return null;
        }
    }

    private mapType(type: string): string {
        const typeMap: Record<string, string> = {
            'text': 'text',
            'number': 'number',
            'email': 'text',
            'select': 'select',
            'boolean': 'boolean',
            'date': 'text',
            'location': 'location',
            'geo': 'location',
            'rating': 'rating',
            'radio': 'radio',
            'computed': 'computed',
            'textarea': 'textarea',
            'markdown': 'markdown'
        };
        return typeMap[type] || 'text';
    }
}

export const formPublishingService = new FormPublishingService();
