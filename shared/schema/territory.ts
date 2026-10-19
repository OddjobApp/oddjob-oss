import { serial, text, jsonb, pgTable } from "drizzle-orm/pg-core";

export const territories = pgTable("territories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rules: jsonb("rules").notNull(),
});