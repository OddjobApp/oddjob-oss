/**
 * Encrypted Credentials Schema
 * 
 * Stores sensitive credentials (tokens, API keys) encrypted at rest.
 * Uses AES-256-GCM encryption via the encryption utility.
 */

import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

export const encryptedCredentials = pgTable("encrypted_credentials", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    
    // Entity reference (what these credentials belong to)
    entityType: text("entity_type").notNull(),  // e.g., 'slack_workspace', 'saas_connector'
    entityId: integer("entity_id").notNull(),     // ID of the entity in its table
    
    // Credential classification
    credentialType: text("credential_type").notNull(),  // e.g., 'bot_token', 'user_token'
    
    // Encrypted data (format: iv.tag.ciphertext in hex)
    encryptedData: text("encrypted_data").notNull(),
    
    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    // For quick lookups by entity
    entityIdx: index("encrypted_creds_entity_idx").on(t.entityType, t.entityId),
    // For lookups by credential type
    typeIdx: index("encrypted_creds_type_idx").on(t.credentialType),
    // For organization-scoped queries
    orgIdx: index("encrypted_creds_org_idx").on(t.organizationId),
    // Unique constraint: one credential type per entity
    uniqueCreds: index("encrypted_creds_unique_idx").on(t.entityType, t.entityId, t.credentialType),
}));

// Schema for inserting new encrypted credentials
export const insertEncryptedCredentialsSchema = createInsertSchema(encryptedCredentials).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

// Types
export type EncryptedCredentials = typeof encryptedCredentials.$inferSelect;
export type InsertEncryptedCredentials = z.infer<typeof insertEncryptedCredentialsSchema>;


