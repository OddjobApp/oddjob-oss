
import fs from 'fs';

const backupFile = 'backups/postgres_backup.sql';

async function scan() {
    console.log("🚀 Scanning Postgres Backup for 'INSERT INTO orgs' or 'INSERT INTO public.orgs'...");
    
    // Read in chunks and handle both ASCII and UTF-16 if needed
    const buffer = fs.readFileSync(backupFile);
    const content = buffer.toString('utf8'); // Assuming UTF8 first
    
    // Look for any organization-like strings
    const orgMatches = content.match(/INSERT INTO (public\.)?orgs[\s\S]+?;/g) || [];
    console.log(`✅ Found ${orgMatches.length} org insert blocks.`);
    
    for (const block of orgMatches) {
        console.log(block);
    }
    
    const kusMatches = content.match(/[\s\S]{100}KUS[\s\S]{100}/g) || [];
    console.log(`✅ Found ${kusMatches.length} KUS context matches.`);
}

// Memory-aware version for 638MB
function scanStream() {
    const stream = fs.createReadStream(backupFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
    let leftover = '';
    
    stream.on('data', (chunk: any) => {
        const full = leftover + chunk;
        const lines = full.split('\n');
        leftover = lines.pop() || '';
        
        for (const line of lines) {
            if (line.includes('INSERT INTO public.orgs') || line.includes('INSERT INTO orgs')) {
                console.log("MATCH:", line);
            }
            if (line.includes('KUS')) {
                // console.log("KUS MATCH:", line.substring(0, 500));
            }
        }
    });

    stream.on('end', () => console.log("✅ Scan complete."));
}

scanStream();

