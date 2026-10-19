/**
 * Scribe Vault Service
 *
 * Manages persistent, encrypted storage of masked and sandboxed content
 * in `scribe_vault_records`. Enforces strict organization-level multi-tenancy
 * and synchronizes with the in-flight ephemeral cache.
 */

import { db } from "@server/database_service.js";
import { scribeVaultRecords, type ScribeVaultRecord, type ScribeVaultClassification, type ScribeVaultMode } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@server/utils/encryption.js";
import { ephemeralVaultCache, type EphemeralVaultPayload } from "./ephemeral-vault-cache.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScribeVaultService");

export interface CreateVaultRecordInput {
    organizationId: number;
    documentId: number;
    nodeId?: number | null;
    tokenId: string;
    slug?: string | null;
    classification: ScribeVaultClassification;
    mode?: ScribeVaultMode;
    summary: string;
    rawPayload: string;
    localModelHint?: string | null;
}

export class ScribeVaultService {
    /**
     * Persist and encrypt a vault record into scribe_vault_records,
     * simultaneously warming the ephemeral in-flight cache.
     */
    async saveVaultRecord(input: CreateVaultRecordInput): Promise<ScribeVaultRecord> {
        const mode = input.mode ?? "static_reinsert";
        const encryptedPayload = encrypt(input.rawPayload);

        // 1. Check for existing record for this document + tokenId
        const existing = await db
            .select()
            .from(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.organizationId, input.organizationId),
                    eq(scribeVaultRecords.documentId, input.documentId),
                    eq(scribeVaultRecords.tokenId, input.tokenId)
                )
            )
            .limit(1);

        let record: ScribeVaultRecord;

        if (existing.length > 0) {
            const [updated] = await db
                .update(scribeVaultRecords)
                .set({
                    nodeId: input.nodeId ?? existing[0].nodeId,
                    slug: input.slug ?? existing[0].slug,
                    classification: input.classification,
                    mode,
                    summary: input.summary,
                    encryptedPayload,
                    localModelHint: input.localModelHint ?? existing[0].localModelHint,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(scribeVaultRecords.id, existing[0].id),
                        eq(scribeVaultRecords.organizationId, input.organizationId)
                    )
                )
                .returning();
            record = updated;
        } else {
            const [inserted] = await db
                .insert(scribeVaultRecords)
                .values({
                    organizationId: input.organizationId,
                    documentId: input.documentId,
                    nodeId: input.nodeId ?? null,
                    tokenId: input.tokenId,
                    slug: input.slug ?? null,
                    classification: input.classification,
                    mode,
                    summary: input.summary,
                    encryptedPayload,
                    localModelHint: input.localModelHint ?? null,
                })
                .returning();
            record = inserted;
        }

        // 2. Warm ephemeral cache
        await ephemeralVaultCache.set({
            tokenId: record.tokenId,
            organizationId: record.organizationId,
            documentId: record.documentId,
            nodeId: record.nodeId,
            classification: record.classification,
            mode: record.mode,
            summary: record.summary,
            rawPayload: input.rawPayload,
            localModelHint: record.localModelHint,
            createdAt: record.createdAt.getTime(),
        });

        logger.info(`Vault record saved: token=${record.tokenId} doc=#${record.documentId} org=#${record.organizationId}`);
        return record;
    }

    /**
     * Retrieve a decrypted vault record by organization, document, and tokenId.
     * Checks ephemeral cache first; falls back to database decryption if missing.
     */
    async getVaultRecord(
        organizationId: number,
        documentId: number,
        tokenId: string
    ): Promise<{ record: ScribeVaultRecord | null; rawPayload: string } | null> {
        // Fast path: Ephemeral in-flight cache
        const cached = await ephemeralVaultCache.get(organizationId, documentId, tokenId);
        if (cached) {
            return {
                record: {
                    id: 0,
                    organizationId: cached.organizationId,
                    documentId: cached.documentId,
                    nodeId: cached.nodeId ?? null,
                    tokenId: cached.tokenId,
                    slug: null,
                    classification: cached.classification,
                    mode: cached.mode,
                    summary: cached.summary,
                    encryptedPayload: "",
                    localModelHint: cached.localModelHint ?? null,
                    createdAt: new Date(cached.createdAt),
                    updatedAt: new Date(cached.createdAt),
                },
                rawPayload: cached.rawPayload,
            };
        }

        // Persistent database lookup
        const [record] = await db
            .select()
            .from(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.organizationId, organizationId),
                    eq(scribeVaultRecords.documentId, documentId),
                    eq(scribeVaultRecords.tokenId, tokenId)
                )
            )
            .limit(1);

        if (!record) return null;

        const rawPayload = decrypt(record.encryptedPayload);

        // Repopulate ephemeral cache
        await ephemeralVaultCache.set({
            tokenId: record.tokenId,
            organizationId: record.organizationId,
            documentId: record.documentId,
            nodeId: record.nodeId,
            classification: record.classification,
            mode: record.mode,
            summary: record.summary,
            rawPayload,
            localModelHint: record.localModelHint,
            createdAt: record.createdAt.getTime(),
        });

        return { record, rawPayload };
    }

    /**
     * List all vault records for a document without decrypting raw payloads.
     */
    async listVaultRecords(
        organizationId: number,
        documentId: number,
        nodeId?: number
    ): Promise<ScribeVaultRecord[]> {
        const conditions = [
            eq(scribeVaultRecords.organizationId, organizationId),
            eq(scribeVaultRecords.documentId, documentId),
        ];

        if (nodeId !== undefined) {
            conditions.push(eq(scribeVaultRecords.nodeId, nodeId));
        }

        return db
            .select()
            .from(scribeVaultRecords)
            .where(and(...conditions));
    }

    /**
     * Delete an individual vault record by tokenId and purge it from cache.
     */
    async deleteVaultRecord(
        organizationId: number,
        documentId: number,
        tokenId: string
    ): Promise<boolean> {
        await ephemeralVaultCache.delete(organizationId, documentId, tokenId);

        const deleted = await db
            .delete(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.organizationId, organizationId),
                    eq(scribeVaultRecords.documentId, documentId),
                    eq(scribeVaultRecords.tokenId, tokenId)
                )
            )
            .returning();

        return deleted.length > 0;
    }

    /**
     * Delete a vault record by primary key ID (verifying organizationId).
     */
    async deleteVaultRecordById(organizationId: number, recordId: number): Promise<boolean> {
        const [found] = await db
            .select()
            .from(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.id, recordId),
                    eq(scribeVaultRecords.organizationId, organizationId)
                )
            )
            .limit(1);

        if (!found) return false;

        await ephemeralVaultCache.delete(organizationId, found.documentId, found.tokenId);

        const deleted = await db
            .delete(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.id, recordId),
                    eq(scribeVaultRecords.organizationId, organizationId)
                )
            )
            .returning();

        return deleted.length > 0;
    }

    /**
     * Flush all vault records for a document (e.g. on complete document reset).
     */
    async flushDocumentVault(organizationId: number, documentId: number): Promise<number> {
        await ephemeralVaultCache.flushForDocument(organizationId, documentId);

        const deleted = await db
            .delete(scribeVaultRecords)
            .where(
                and(
                    eq(scribeVaultRecords.organizationId, organizationId),
                    eq(scribeVaultRecords.documentId, documentId)
                )
            )
            .returning();

        return deleted.length;
    }
}

export const scribeVaultService = new ScribeVaultService();
