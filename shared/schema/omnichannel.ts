import { sql } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "./auth.js";
import { projects } from "./projects.js";

export const CHANNEL_TYPES = ["sms", "whatsapp", "telegram"] as const;
export type ChannelType = typeof CHANNEL_TYPES[number];

export const omnichannelIdentities = pgTable("omnichannel_identities", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    channelType: text("channel_type").$type<ChannelType>().notNull(),
    channelIdentifier: text("channel_identifier").notNull(), // E.164 phone or platform ID
    isVerified: boolean("is_verified").notNull().default(false),
    verificationCode: text("verification_code"),
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    defaultProjectId: integer("default_project_id").references(() => projects.id, { onDelete: "set null" }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    unqOrgChannelIdentifier: uniqueIndex("unq_org_channel_identifier").on(
        table.organizationId,
        table.channelType,
        table.channelIdentifier,
    ),
    // Inbound messages carry no org, so a verified identifier names one identity
    // platform-wide (migration 0136). Pending rows may repeat.
    unqVerifiedChannelIdentifier: uniqueIndex("unq_verified_channel_identifier")
        .on(table.channelType, table.channelIdentifier)
        .where(sql`${table.isVerified}`),
    idxOmnichannelLookup: index("idx_omnichannel_lookup").on(
        table.channelIdentifier,
        table.channelType,
    ),
    idxOmnichannelUser: index("idx_omnichannel_user").on(
        table.userId,
        table.organizationId,
    ),
}));

export const insertOmnichannelIdentitySchema = createInsertSchema(omnichannelIdentities);
export const selectOmnichannelIdentitySchema = createSelectSchema(omnichannelIdentities);
export type OmnichannelIdentityRow = typeof omnichannelIdentities.$inferSelect;
export type NewOmnichannelIdentity = typeof omnichannelIdentities.$inferInsert;
