import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const execAsync = promisify(exec);

async function findPsql() {
    try {
        await execAsync('psql --version');
        return 'psql';
    } catch (e) {}

    const commonPaths = [
        'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe'
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) return `"${p}"`;
    }
    throw new Error('psql not found.');
}

async function restore() {
    const backupDir = path.join(process.cwd(), 'backups', '2026-03-24T14-46-05-634Z');
    const pgDumpFile = path.join(backupDir, 'oddjob_pg.sql');
    const qdrantSnapshotFile = path.join(backupDir, 'qdrant_oddjob_rag_assets-4625562830946146-2026-03-24-14-48-22.snapshot');

    if (!fs.existsSync(pgDumpFile)) throw new Error(`PostgreSQL dump not found at ${pgDumpFile}`);

    console.log(`[RobustRestore] Starting restoration from ${backupDir}...`);

    // 1. PostgreSQL Restore
    try {
        console.log('[RobustRestore] Restoring PostgreSQL (14GB)...');
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) throw new Error('DATABASE_URL not set');

        const urlObj = new URL(dbUrl);
        const env = { ...process.env, PGPASSWORD: urlObj.password };
        const psqlCmd = await findPsql();

        // Use spawn for better handling of large streams if possible, 
        // but since we are in a script, exec with a large buffer or just direct shell redirection is easier.
        // psql -d <url> -f <file> is usually very efficient as psql reads the file itself.
        console.log('[RobustRestore] Running psql command...');
        const { stdout, stderr } = await execAsync(`${psqlCmd} --no-password -d "${dbUrl}" -f "${pgDumpFile}"`, { 
            env,
            maxBuffer: 1024 * 1024 * 100 // 100MB buffer for logs if needed
        });
        
        if (stderr && !stderr.includes('already exists') && !stderr.includes('NOTICE')) {
            console.warn('[RobustRestore] psql stderr:', stderr);
        }
        console.log('[RobustRestore] PostgreSQL restoration complete.');
    } catch (e: any) {
        console.error('[RobustRestore] Failed to restore PostgreSQL:', e.message);
    }

    // 2. Qdrant Restore
    try {
        if (fs.existsSync(qdrantSnapshotFile)) {
            console.log('[RobustRestore] Qdrant restoration (manual step suggested for large snapshots)...');
            console.log(`[RobustRestore] To restore Qdrant, use: POST /collections/oddjob_rag_assets/snapshots/recover with file: ${path.basename(qdrantSnapshotFile)}`);
        }
    } catch (e: any) {
        console.error('[RobustRestore] Qdrant restore info failed:', e.message);
    }

    console.log(`[RobustRestore] ✅ Done.`);
}

restore().catch(console.error);
