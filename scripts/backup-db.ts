import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findPgDump() {
    // 1. Check if in PATH
    try {
        await execAsync('pg_dump --version');
        return 'pg_dump';
    } catch (e) {
        // Not in PATH
    }

    // 2. Check common Windows locations
    const commonPaths = [
        'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe'
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            console.log(`[Backup] Found pg_dump at ${p}`);
            return `"${p}"`; // Quote for shell
        }
    }

    throw new Error('pg_dump not found in PATH or standard locations.');
}

async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), 'backups', timestamp);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`[Backup] Starting backup to ${backupDir}...`);

    // 1. Postgres Backup
    try {
        console.log('[Backup] Dumping PostgreSQL...');
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) throw new Error('DATABASE_URL not set');

        // Parse DB URL to get params if needed, or pass directly if pg_dump supports it.
        // pg_dump accepts connection string via -d
        // On Windows PowerShell string passing might be tricky, so we rely on env var if possible or just pass the url.
        // IMPORTANT: We need to handle password.

        // Simple parsing for password to set PGPASSWORD
        const urlObj = new URL(dbUrl);
        const password = (urlObj.password);

        const env = { ...process.env, PGPASSWORD: password };
        const pgDumpCmd = await findPgDump();

        // pg_dump -d <url> -f <file>
        // Use --no-password to prevent prompt, rely on PGPASSWORD
        await execAsync(`${pgDumpCmd} --no-password -d "${dbUrl}" -f "${path.join(backupDir, 'oddjob_pg.sql')}"`, { env });
        console.log('[Backup] PostgreSQL dump complete.');
    } catch (e: any) {
        console.error('[Backup] Failed to dump PostgreSQL:', e.message);
    }

    // 2. Qdrant Snapshot
    try {
        console.log('[Backup] Snapshotting Qdrant...');
        const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        const collection = process.env.QDRANT_COLLECTION || 'oddjob_rag_assets';

        const response = await fetch(`${qdrantUrl}/collections/${collection}/snapshots`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {})
            }
        });

        if (!response.ok) {
            // Check if collection exists first? 
            if (response.status === 404) {
                console.warn('[Backup] Qdrant collection not found, skipping snapshot.');
            } else {
                throw new Error(`Qdrant snapshot failed: ${response.statusText}`);
            }
        } else {
            const data = await response.json();
            const snapshotName = data.result.name;
            console.log(`[Backup] Qdrant snapshot created: ${snapshotName}`);

            // Download snapshot
            console.log('[Backup] Downloading Qdrant snapshot...');
            const downloadUrl = `${qdrantUrl}/collections/${collection}/snapshots/${snapshotName}`;
            const snapshotRes = await fetch(downloadUrl, {
                headers: {
                    ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {})
                }
            });

            if (!snapshotRes.ok) throw new Error("Failed to download snapshot");

            const buffer = await snapshotRes.arrayBuffer();
            fs.writeFileSync(path.join(backupDir, `qdrant_${snapshotName}`), Buffer.from(buffer));
            console.log('[Backup] Qdrant snapshot downloaded.');
        }

    } catch (e: any) {
        console.error('[Backup] Failed to snapshot Qdrant:', e.message);
        // Don't fail the whole process via throw, just log.
    }

    console.log(`[Backup] \u2705 Backup completed successfully in ${backupDir}`);
}

createBackup().catch(console.error);
