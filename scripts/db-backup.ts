
import { db } from "../server/db/index.js";
import * as schema from "@shared/schema/index.js";
import { getClient, QDRANT_COLLECTION } from "../server/integrations/qdrant-client";
import * as fs from 'fs';
import * as path from 'path';

async function backup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), `backups/backup-${timestamp}`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`🚀 Starting backup into: ${backupDir}`);

    try {
        // 1. PostgreSQL Backup
        console.log("🐘 Backing up PostgreSQL tables...");
        const tables = Object.keys(schema).filter(key => typeof (schema as any)[key] === 'object' && 'name' in (schema as any)[key]);

        const pgData: Record<string, any> = {};
        for (const tableName of tables) {
            const table = (schema as any)[tableName];
            try {
                const rows = await db.select().from(table);
                pgData[tableName] = rows;
                console.log(`   ✅ Backed up ${tableName}: ${rows.length} rows`);
            } catch (err: any) {
                console.warn(`   ⚠️ Failed to backup table ${tableName}: ${err.message}`);
            }
        }

        fs.writeFileSync(path.join(backupDir, 'postgres_data.json'), JSON.stringify(pgData, null, 2));
        console.log("✅ PostgreSQL backup complete.");

        // 2. Qdrant Backup
        console.log("🎯 Backing up Qdrant snapshots...");
        try {
            const qClient = getClient();
            const snapshot = await qClient.createSnapshot(QDRANT_COLLECTION);
            console.log(`   ✅ Snapshot created for ${QDRANT_COLLECTION}: ${JSON.stringify(snapshot, null, 2)}`);

            // Note: Snapshots are stored on the server side in Qdrant, but we've triggered it.
            fs.writeFileSync(path.join(backupDir, 'qdrant_snapshot_info.json'), JSON.stringify(snapshot, null, 2));
        } catch (err: any) {
            console.warn(`   ⚠️ Qdrant snapshot failed: ${err.message}`);
        }

        console.log(`\n🎉 Backup finished successfully! Location: ${backupDir}`);
    } catch (e) {
        console.error("❌ Backup process failed:", e);
    }
}

backup();
