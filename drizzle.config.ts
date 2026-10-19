import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // The legacy root journal references migration files intentionally removed
  // from the published repository. runtime/ is the self-contained maintained
  // chain: a full current-schema baseline followed by forward migrations.
  out: "./migrations/runtime",
  schema: "./shared/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
