/**
 * Encrypted Credentials Service
 * 
 * Provides encrypted storage for sensitive credentials (tokens, API keys, etc.)
 * Uses AES-256-GCM encryption via the encryption utility.
 * 
 * This service is used by Slack and other integrations to store tokens
 * encrypted at rest while still being able to retrieve them when needed.
 */

import { db } from "@server/database_service.js";
import { encryptedCredentials } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { encrypt, decrypt, isEncryptionAvailable } from "@server/utils/encryption.js";

const logger = createLogger("EncryptedCredentialsService");

export interface CredentialData {
    [key: string]: any;
}

export interface StoredCredential {
    id: number;
    organizationId: number;
    entityType: string;
    entityId: number;
    credentialType: string;
    encryptedData: string;
    createdAt: Date;
    updatedAt: Date;
}

export const encryptedCredentialsService = {
    /**
     * Store encrypted credentials for an entity
     */
    async store(
        organizationId: number,
        entityType: string,  // e.g., 'slack_workspace', 'saas_connector'
        entityId: number,
        credentialType: string,  // e.g., 'bot_token', 'user_token'
        data: CredentialData
    ): Promise<StoredCredential> {
        if (!isEncryptionAvailable()) {
            throw new Error("Encryption is not configured - cannot store credentials securely");
        }

        try {
            const encryptedData = encrypt(JSON.stringify(data));

            const [existing] = await db.select()
                .from(encryptedCredentials)
                .where(and(
                    eq(encryptedCredentials.organizationId, organizationId),
                    eq(encryptedCredentials.entityType, entityType),
                    eq(encryptedCredentials.entityId, entityId),
                    eq(encryptedCredentials.credentialType, credentialType)
                ))
                .limit(1);

            if (existing) {
                // Update existing
                const [updated] = await db.update(encryptedCredentials)
                    .set({
                        encryptedData,
                        updatedAt: new Date()
                    })
                    .where(eq(encryptedCredentials.id, existing.id))
                    .returning();
                
                logger.info(`Updated encrypted credentials for ${entityType}:${entityId} (${credentialType})`);
                return updated;
            } else {
                // Create new
                const [created] = await db.insert(encryptedCredentials)
                    .values({
                        organizationId,
                        entityType,
                        entityId,
                        credentialType,
                        encryptedData
                    })
                    .returning();
                
                logger.info(`Stored encrypted credentials for ${entityType}:${entityId} (${credentialType})`);
                return created;
            }
        } catch (err: any) {
            logger.error(`Failed to store encrypted credentials for ${entityType}:${entityId}:`, err.message);
            throw new Error(`Failed to store credentials: ${err.message}`);
        }
    },

    /**
     * Retrieve and decrypt credentials for an entity
     */
    async retrieve(
        organizationId: number,
        entityType: string,
        entityId: number,
        credentialType: string
    ): Promise<CredentialData | null> {
        if (!isEncryptionAvailable()) {
            logger.error("Encryption is not configured - cannot retrieve encrypted credentials");
            return null;
        }

        try {
            const [stored] = await db.select()
                .from(encryptedCredentials)
                .where(and(
                    eq(encryptedCredentials.organizationId, organizationId),
                    eq(encryptedCredentials.entityType, entityType),
                    eq(encryptedCredentials.entityId, entityId),
                    eq(encryptedCredentials.credentialType, credentialType)
                ))
                .limit(1);

            if (!stored) {
                return null;
            }

            const decrypted = decrypt(stored.encryptedData);
            return JSON.parse(decrypted);
        } catch (err: any) {
            logger.error(`Failed to retrieve encrypted credentials for ${entityType}:${entityId}:`, err.message);
            return null;
        }
    },

    /**
     * Delete encrypted credentials for an entity
     */
    async delete(
        organizationId: number,
        entityType: string,
        entityId: number,
        credentialType?: string
    ): Promise<boolean> {
        try {
            const conditions = [
                eq(encryptedCredentials.organizationId, organizationId),
                eq(encryptedCredentials.entityType, entityType),
                eq(encryptedCredentials.entityId, entityId)
            ];
            
            if (credentialType) {
                conditions.push(eq(encryptedCredentials.credentialType, credentialType));
            }

            await db.delete(encryptedCredentials)
                .where(and(...conditions));

            logger.info(`Deleted encrypted credentials for ${entityType}:${entityId}`);
            return true;
        } catch (err: any) {
            logger.error(`Failed to delete encrypted credentials for ${entityType}:${entityId}:`, err.message);
            return false;
        }
    },

    /**
     * Rotate encryption for all stored credentials
     * Use when changing encryption keys
     */
    async rotateAll(): Promise<{ success: number; failed: number }> {
        if (!isEncryptionAvailable()) {
            throw new Error("Encryption is not configured");
        }

        const allCredentials = await db.select().from(encryptedCredentials);
        let success = 0;
        let failed = 0;

        for (const cred of allCredentials) {
            try {
                // Decrypt with old key (already loaded)
                const decrypted = decrypt(cred.encryptedData);
                // Re-encrypt (will use current key)
                const reEncrypted = encrypt(decrypted);
                
                await db.update(encryptedCredentials)
                    .set({ encryptedData: reEncrypted, updatedAt: new Date() })
                    .where(eq(encryptedCredentials.id, cred.id));
                
                success++;
            } catch (err: any) {
                logger.error(`Failed to rotate credentials ${cred.id}:`, err.message);
                failed++;
            }
        }

        logger.info(`Credential rotation complete: ${success} succeeded, ${failed} failed`);
        return { success, failed };
    },

    /**
     * Check if credentials exist for an entity
     */
    async exists(
        organizationId: number,
        entityType: string,
        entityId: number,
        credentialType: string
    ): Promise<boolean> {
        const [stored] = await db.select({ id: encryptedCredentials.id })
            .from(encryptedCredentials)
            .where(and(
                eq(encryptedCredentials.organizationId, organizationId),
                eq(encryptedCredentials.entityType, entityType),
                eq(encryptedCredentials.entityId, entityId),
                eq(encryptedCredentials.credentialType, credentialType)
            ))
            .limit(1);

        return !!stored;
    }
};
