
import fs from 'fs';
import readline from 'readline';

const backupFile = 'backups/postgres_backup.sql';
const outputSchema = 'tmp_backup_schema.txt';

async function extractSchema() {
    console.log("🚀 Analyzing Postgres Backup Schema (Robust Streaming)...");
    const rl = readline.createInterface({
        input: fs.createReadStream(backupFile),
        crlfDelay: Infinity
    });

    let writing = false;
    let schemaCount = 0;
    const outputWriter = fs.createWriteStream(outputSchema);

    for await (const line of rl) {
        if (line.includes("CREATE TABLE public.")) {
            writing = true;
            schemaCount++;
        }

        if (writing) {
            outputWriter.write(line + "\n");
        }

        if (writing && line.trim().endsWith(");")) {
            writing = false;
            outputWriter.write("\n");
        }
    }

    outputWriter.end();
    console.log(`✅ Extracted ${schemaCount} table definitions to ${outputSchema}`);
}

extractSchema();

