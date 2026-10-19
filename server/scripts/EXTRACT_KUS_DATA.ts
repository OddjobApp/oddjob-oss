import fs from 'fs';

const backupFile = 'backups/postgres_backup.sql';
const outputFile = 'kus_restoration.sql';
const targetOrgId = '67';

async function extract() {
    console.log(`🚀 Starting KUS (Org ${targetOrgId}) Data Extraction (COPY mode)...`);
    const writeStream = fs.createWriteStream(outputFile);
    const readStream = fs.createReadStream(backupFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 });

    let leftover = '';
    let matchCount = 0;
    
    let currentTable: string | null = null;
    let targetColIndex: number = -1;
    let inCopyBlock = false;

    readStream.on('data', (chunk: any) => {
        const full = leftover + chunk;
        const lines = full.split('\n');
        leftover = lines.pop() || '';

        for (const line of lines) {
            // Check for COPY header
            // Format: COPY public.tablename (col1, col2, ...) FROM stdin;
            if (line.startsWith('COPY ')) {
                inCopyBlock = true;
                const match = line.match(/COPY (?:public\.)?(\w+) \((.+)\) FROM stdin;/i);
                if (match) {
                    currentTable = match[1];
                    const columns = match[2].split(',').map(c => c.trim());
                    targetColIndex = columns.findIndex(c => c === 'organization_id' || c === 'org_id' || (currentTable === 'orgs' && c === 'id'));
                    console.log(`🔍 Entering block for table "${currentTable}", org_id column at index ${targetColIndex}`);
                    writeStream.write(line + '\n');
                } else {
                    currentTable = null;
                    targetColIndex = -1;
                }
                continue;
            }

            // Check for COPY end
            if (line === '\\.') {
                if (inCopyBlock) writeStream.write(line + '\n');
                inCopyBlock = false;
                currentTable = null;
                targetColIndex = -1;
                continue;
            }

            if (inCopyBlock && targetColIndex !== -1) {
                // Tab separated data
                const cols = line.split('\t');
                if (cols[targetColIndex] === targetOrgId) {
                    writeStream.write(line + '\n');
                    matchCount++;
                }
            } else if (!inCopyBlock && line.includes('INSERT INTO')) {
                // Fallback to INSERT check (e.g. for small tables)
                if (line.includes(`(${targetOrgId},`) || line.includes(` ${targetOrgId},`) || line.includes(`, ${targetOrgId},`)) {
                    writeStream.write(line + '\n');
                    matchCount++;
                }
            }
        }
    });

    readStream.on('end', () => {
        if (leftover) writeStream.write(leftover + '\n');
        writeStream.end();
        console.log(`✅ Extraction complete. Found ${matchCount} relevant rows.`);
        console.log(`📂 Output saved to: ${outputFile}`);
    });
}

extract();

