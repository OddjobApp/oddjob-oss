import { serial, text, jsonb, pgTable } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  options: jsonb("options").notNull(),
});