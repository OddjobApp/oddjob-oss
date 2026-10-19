import { readdir, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

const projectRoot = process.cwd();
const domainDir = join(projectRoot, 'server', 'domain');
const outputFile = join(domainDir, 'domain_files.json');

async function walk(dir, allFiles = []) {
    const files = await readdir(dir);
    for (const file of files) {
        const fullPath = join(dir, file);
        const s = await stat(fullPath);
        if (s.isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist' && file !== '.git' && file !== 'tests') {
                await walk(fullPath, allFiles);
            }
        } else if (file.endsWith('.ts') || file.endsWith('.js')) {
            allFiles.push({
                Name: file,
                FullName: fullPath
            });
        }
    }
    return allFiles;
}

async function run() {
    console.log(`Crawling domain directory: ${domainDir}...`);
    const files = await walk(domainDir);
    console.log(`Found ${files.length} domain files.`);
    
    // Format JSON to match the expected structure
    await writeFile(outputFile, JSON.stringify(files, null, 4), 'utf-8');
    console.log(`Updated ${outputFile}`);
}

run().catch(console.error);
