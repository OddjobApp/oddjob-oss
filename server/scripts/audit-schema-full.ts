import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const schemaDir = path.resolve(__dirname, '../../shared/schema');
    const files = fs.readdirSync(schemaDir);

    for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
        if (file === 'index.ts' || file === 'index.js') continue;

        const filePath = path.join(schemaDir, file);
        try {
            // Use tsx or similar to import .ts files
            // For now, let's just use dynamic import
            // We need to use valid file URL for windows
            const fileUrl = 'file://' + filePath.replace(/\\/g, '/');
            const module = await import(fileUrl);
            
            for (const [key, value] of Object.entries(module)) {
                if (key === 'missionDeliverables' || (value as any)?.tableName === 'mission_deliverables') {
                    console.log(`FOUND IT!`);
                    console.log(`File: ${file}`);
                    console.log(`Key: ${key}`);
                    console.log(`Table Name: ${(value as any)?.tableName}`);
                    return;
                }
            }
        } catch (err) {
            // console.error(`Failed to import ${file}: ${err.message}`);
        }
    }
    
    // Also check subdirectories
    const subdirs = ['agent', 'jobs', 'knowledge', 'pipelines'];
    for (const subdir of subdirs) {
        const fullSubdir = path.join(schemaDir, subdir);
        if (!fs.existsSync(fullSubdir)) continue;
        const subFiles = fs.readdirSync(fullSubdir);
        for (const file of subFiles) {
            if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
             if (file === 'index.ts' || file === 'index.js') continue;
            const filePath = path.join(fullSubdir, file);
            try {
                const fileUrl = 'file://' + filePath.replace(/\\/g, '/');
                const module = await import(fileUrl);
                for (const [key, value] of Object.entries(module)) {
                    if (key === 'missionDeliverables' || (value as any)?.tableName === 'mission_deliverables') {
                        console.log(`FOUND IT!`);
                        console.log(`File: ${subdir}/${file}`);
                        console.log(`Key: ${key}`);
                        console.log(`Table Name: ${(value as any)?.tableName}`);
                        return;
                    }
                }
            } catch (err) {}
        }
    }

    console.log("Not found in any individual schema file.");
}

main();

