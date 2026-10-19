import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

async function processFile(filePath) {
    const content = await readFile(filePath, 'utf-8');
    let fixedContent = content;

    // 1. Fix .ts.js -> .js
    fixedContent = fixedContent.replace(/\.ts\.js/g, '.js');

    // 2. Fix junk before ../
    // Matches any word sequence followed by ../ that isn't already ../
    // We use a negative lookbehind or just match only alphanumeric + underscore
    fixedContent = fixedContent.replace(/([a-zA-Z0-9_]{2,})\.\.\//g, '../');

    // Fix specific corrupted ones I saw in logs
    fixedContent = fixedContent.replace(/Dols\.\.\//g, '../');
    fixedContent = fixedContent.replace(/Dodleware\.\.\//g, '../');

    // 3. Fix shared/schema directory
    fixedContent = fixedContent.replace(/shared\/schema(?!\/index\.js)(?:\.js|['"])/g, (match) => {
        if (match.endsWith('.js')) return 'shared/schema/index.js';
        if (match.endsWith('"')) return 'shared/schema/index.js"';
        if (match.endsWith("'")) return "shared/schema/index.js'";
        return 'shared/schema/index.js';
    });

    // 4. Fix doubled .js.js
    fixedContent = fixedContent.replace(/\.js\.js/g, '.js');

    // 5. Final check for doubled directories (like core../core)
    fixedContent = fixedContent.replace(/([^/]+)\.\.\/\1\//g, '$1/');

    if (fixedContent !== content) {
        console.log(`Cleaned up: ${filePath}`);
        await writeFile(filePath, fixedContent, 'utf-8');
    }
}

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
                await walk(fullPath);
            }
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
            await processFile(fullPath);
        }
    }
}

console.log('Running final cleanup...');
walk(join(ROOT_DIR, 'server')).then(() => {
    console.log('Final cleanup completed.');
});
