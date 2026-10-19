import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const connectors = pgTable("connectors", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // slack, jira, github, etc.
  status: text("status").notNull().default("active"), // active, inactive, error
  configSchema: jsonb("config_schema").$type<Record<string, any>>().default({}),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertConnectorSchema = createInsertSchema(connectors);
export const selectConnectorSchema = createSelectSchema(connectors);
export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;



