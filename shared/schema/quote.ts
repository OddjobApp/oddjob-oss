import { serial, text, jsonb, integer, pgTable } from "drizzle-orm/pg-core";

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull(),
  opportunityId: integer("opportunity_id"),
  lineItems: jsonb("line_items").notNull(),
});