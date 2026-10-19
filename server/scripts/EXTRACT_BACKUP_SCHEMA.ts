
import fs from 'fs';
import path from 'path';

const backupFile = 'backups/postgres_backup.sql';
const outputSchema = 'tmp_backup_schema.txt';

function extractSchema() {
    console.log("Analyzing Postgres Backup Schema...");
    const content = fs.readFileSync(backupFile, 'utf8');
    const tableMatches = content.match(/CREATE TABLE public\.[\w_]+ \([\s\S]+?\);/g) || [];
    
    let report = "Postgres Backup Table Definitions:\n\n";
    for (const table of tableMatches) {
        report += table + "\n\n";
    }
    
    fs.writeFileSync(outputSchema, report);
    console.log(`✅ Extracted ${tableMatches.length} table definitions to ${outputSchema}`);
}

extractSchema();

