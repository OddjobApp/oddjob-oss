/**
 * Migrate signal feed credentials out of cleartext.
 *
 * `signal_feeds.auth_credentials` is plain jsonb and used to hold
 * `{ type, token }` directly. This moves any such row into the AES-256-GCM
 * `encrypted_credentials` store and replaces the column value with a
 * non-secret descriptor.
 *
 * This cannot be a SQL migration: encryption happens in the application, with a
 * key SQL has no access to.
 *
 * Usage:
 *   npx tsx server/scripts/migrate-feed-credentials.ts          # report only
 *   npx tsx server/scripts/migrate-feed-credentials.ts --apply  # migrate
 *
 * Safe to re-run: already-migrated rows are skipped.
 */

import "dotenv/config";
import { db } from "../database_service.js";
import { eq } from "drizzle-orm";
import { signalFeeds } from "@shared/schema/index.js";
import { isEncryptionAvailable } from "../utils/encryption.js";
import {
  isLegacyCleartext,
  storeFeedCredentials,
} from "../domain/signal-intelligence/core/feed-credentials.service.js";

async function main() {
  const apply = process.argv.includes("--apply");

  if (!isEncryptionAvailable()) {
    console.error(
      "✗ ENCRYPTION_KEY (or APP_TOKEN_ENCRYPTION_KEY) is not set. Cannot encrypt credentials."
    );
    process.exit(1);
  }

  const feeds = await db.select().from(signalFeeds);
  const legacy = feeds.filter((f) => isLegacyCleartext(f.authCredentials));

  console.log(`\nScanned ${feeds.length} signal feed(s).`);
  console.log(`${legacy.length} carry a cleartext token.\n`);

  if (legacy.length === 0) {
    console.log("Nothing to migrate.");
    process.exit(0);
  }

  // Identify rows without printing any token material.
  for (const feed of legacy) {
    console.log(
      `  id=${feed.id} org=${feed.organizationId} "${feed.name}" ` +
        `(type=${(feed.authCredentials as any).type ?? "unknown"})`
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to migrate these feeds.");
    process.exit(0);
  }

  let migrated = 0;
  let failed = 0;

  for (const feed of legacy) {
    const creds = feed.authCredentials as { type: string; token: string };
    try {
      const descriptor = await storeFeedCredentials(
        feed.organizationId,
        feed.id,
        { type: creds.type ?? "bearer", token: creds.token }
      );

      // Only clear the cleartext column once the encrypted copy is committed.
      await db
        .update(signalFeeds)
        .set({ authCredentials: descriptor, updatedAt: new Date() })
        .where(eq(signalFeeds.id, feed.id));

      console.log(`  ✅ Migrated feed ${feed.id}`);
      migrated++;
    } catch (err: any) {
      console.error(`  ✗ Feed ${feed.id} failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nMigrated ${migrated}, failed ${failed}.`);
  if (failed > 0) {
    console.log("Failed rows kept their cleartext credentials and still poll.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
