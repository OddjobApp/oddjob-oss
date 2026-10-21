import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

/** Public connection metadata only. Secrets live in encrypted_credentials. */
export const agentmailConnections = pgTable("agentmail_connections", {
    organizationId: integer("organization_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
    inboxId: text("inbox_id").notNull().unique(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
