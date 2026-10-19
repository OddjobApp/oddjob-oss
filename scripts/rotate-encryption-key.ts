/**
 * Re-encrypt every stored secret under the current ENCRYPTION_KEY.
 *
 * Rotation:
 *   1. Set ENCRYPTION_KEY to the new key and ENCRYPTION_KEYS_PREVIOUS to the
 *      old one(s), comma-separated; deploy. Reads keep working on either key.
 *   2. npm run encryption:rotate              # dry run: what would change
 *      npm run encryption:rotate -- --apply   # re-encrypt
 *   3. When a run reports 0 to rotate and 0 failed, remove ENCRYPTION_KEYS_PREVIOUS.
 *
 * Covers every column written with server/utils/encryption.ts:
 * encrypted_credentials.encrypted_data (org AI keys, credential secrets, other
 * integration tokens) and scribe_vault_records.encrypted_payload. Each update
 * is a compare-and-set on the old ciphertext, so a row saved concurrently
 * (a key replaced mid-run) is left alone rather than overwritten.
 *
 * App deployment tokens use APP_TOKEN_ENCRYPTION_KEY and are re-minted when
 * they cannot be decrypted; they need no rotation.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { encryptedCredentials, scribeVaultRecords } from "@shared/schema/index.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";
import { emptyReport, rotateCiphertext, type RotationReport } from "@server/utils/encryption-rotation.js";

const apply = process.argv.includes("--apply");

async function rotateEncryptedCredentials(): Promise<RotationReport> {
    const report = emptyReport("encrypted_credentials");
    const rows = await db.select().from(encryptedCredentials);
    for (const row of rows) {
        report.scanned++;
        try {
            const next = rotateCiphertext(row.encryptedData, encryptedCredentialOwner(row));
            if (next === null) { report.current++; continue; }
            if (apply) {
                await db.update(encryptedCredentials)
                    .set({ encryptedData: next, updatedAt: new Date() })
                    .where(and(eq(encryptedCredentials.id, row.id), eq(encryptedCredentials.encryptedData, row.encryptedData)));
            }
            report.rotated++;
        } catch (err) {
            report.failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return report;
}

async function rotateScribeVault(): Promise<RotationReport> {
    const report = emptyReport("scribe_vault_records");
    const rows = await db.select({ id: scribeVaultRecords.id, encryptedPayload: scribeVaultRecords.encryptedPayload })
        .from(scribeVaultRecords);
    for (const row of rows) {
        report.scanned++;
        try {
            const next = rotateCiphertext(row.encryptedPayload, null);
            if (next === null) { report.current++; continue; }
            if (apply) {
                await db.update(scribeVaultRecords)
                    .set({ encryptedPayload: next })
                    .where(and(eq(scribeVaultRecords.id, row.id), eq(scribeVaultRecords.encryptedPayload, row.encryptedPayload)));
            }
            report.rotated++;
        } catch (err) {
            report.failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return report;
}

async function main() {
    console.log(apply ? "Rotating stored secrets onto the current ENCRYPTION_KEY…" : "Dry run (pass --apply to re-encrypt):");
    const reports = [await rotateEncryptedCredentials(), await rotateScribeVault()];
    let failed = 0;
    for (const r of reports) {
        console.log(`  ${r.table}: ${r.scanned} scanned, ${r.current} already current, ${r.rotated} ${apply ? "rotated" : "to rotate"}, ${r.failed.length} failed`);
        for (const f of r.failed.slice(0, 20)) console.log(`    id ${f.id}: ${f.error}`);
        failed += r.failed.length;
    }
    if (failed > 0) {
        console.log("\nRows that failed cannot be read with any configured key. Keep ENCRYPTION_KEYS_PREVIOUS until they are resolved.");
        process.exitCode = 1;
    }
    process.exit();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
