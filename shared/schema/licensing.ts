
import { pgTable, text, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// LICENSING SCHEMA
// ============================================================================

export const systemLicenses = pgTable("system_licenses", {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(), // The raw JWT
    isActive: boolean("is_active").default(true).notNull(),
    planType: text("plan_type").notNull(), // 'enterprise', 'teams', 'starter'
    seats: text("seats").notNull(), // Stored as text to allow "unlimited" or number
    features: jsonb("features").default([]).notNull(), // Array of feature strings
    customerName: text("customer_name"),
    issuedAt: timestamp("issued_at").notNull(),
    expiresAt: timestamp("expires_at"), // Nullable for perpetual
    lastValidatedAt: timestamp("last_validated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSystemLicenseSchema = createInsertSchema(systemLicenses, {
    features: z.array(z.string()),
}).omit({
    id: true,
    lastValidatedAt: true,
    createdAt: true,
});

export type SystemLicense = typeof systemLicenses.$inferSelect;
export type InsertSystemLicense = z.infer<typeof insertSystemLicenseSchema>;

// License Payload (Proprietary format inside the JWT)
export const licensePayloadSchema = z.object({
    iss: z.literal("oddjob-licensing-authority"),
    sub: z.string(), // Customer Org ID or UUID
    aud: z.literal("oddjob-app"),
    exp: z.number().optional(), // Unix timestamp
    iat: z.number(),
    data: z.object({
        plan: z.string(),
        seats: z.union([z.number(), z.literal("unlimited")]),
        features: z.array(z.string()),
        customerName: z.string().optional(),
    }),
});

export type LicensePayload = z.infer<typeof licensePayloadSchema>;



