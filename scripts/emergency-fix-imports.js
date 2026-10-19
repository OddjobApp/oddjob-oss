import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

async function processFile(filePath) {
    const content = await readFile(filePath, 'utf-8');
    let fixedContent = content;

    // 1. Fix the corruption I caused: "/../DIR../DIR/" -> "../../DIR/"
    fixedContent = fixedContent.replace(/\/(\.\.\/[^/]+)\.\.([^/]+)\//g, '../../$2/');
    // Specific fix for the weird patterns I saw: "/../middleware../middleware/"
    fixedContent = fixedContent.replace(/\/(\.\.\/middleware)\.\.(middleware)\//g, '../../middleware/');
    fixedContent = fixedContent.replace(/\/(\.\.\/utils)\.\.(utils)\//g, '../../utils/');
    fixedContent = fixedContent.replace(/\/(\.\.\/ai)\.\.(ai)\//g, '../../ai/');

    // 2. Fix the single ../ when it should be ../../ (if it's not already fixed or corrupted)
    // Only if it's "from '../DIR" and not "from '../../DIR"
    const dirs = ['middleware', 'utils', 'core', 'db', 'instrumentation', 'vite', 'integrations', 'workers', 'mcp', 'services', 'ai', 'config'];
    for (const dir of dirs) {
        // Correct starting ../ to ../../
        fixedContent = fixedContent.replace(new RegExp(`"\\.\\.\\/${dir}`, 'g'), `"../../${dir}`);
        fixedContent = fixedContent.replace(new RegExp(`'\\.\\.\\/${dir}`, 'g'), `'../../${dir}`);

        // Clean up any over-fixed ones (../../../ to ../../)
        fixedContent = fixedContent.replace(new RegExp(`"\\.\\.\\/\\.\\.\\/\\.\\.\\/${dir}`, 'g'), `"../../${dir}`);
        fixedContent = fixedContent.replace(new RegExp(`'\\.\\.\\/\\.\\.\\/\\.\\.\\/${dir}`, 'g'), `'../../${dir}`);

        // Clean up the weird /../ patterns
        fixedContent = fixedContent.replace(new RegExp(`"\\/\\.\\.\\/${dir}`, 'g'), `"../../${dir}`);
        fixedContent = fixedContent.replace(new RegExp(`'\\/\\.\\.\\/${dir}`, 'g'), `'../../${dir}`);
    }

    // 3. Ensure .js extension on relative imports
    // This is a bit risky but mostly safe for internal paths
    fixedContent = fixedContent.replace(/from "(\.\.?\/[^"]+)(?<!\.js)"/g, 'from "$1.js"');
    fixedContent = fixedContent.replace(/from '(\.\.?\/[^']+)(?<!\.js)'/g, "from '$1.js'");
    fixedContent = fixedContent.replace(/import\("(\.\.?\/[^"]+)(?<!\.js)"\)/g, 'import("$1.js")');
    fixedContent = fixedContent.replace(/import\('(\.\.?\/[^']+)(?<!\.js)'\)/g, "import('$1.js')");

    // Fix double .js
    fixedContent = fixedContent.replace(/\.js\.js/g, '.js');

    if (fixedContent !== content) {
        console.log(`Emergency fixing ${filePath}`);
        await writeFile(filePath, fixedContent, 'utf-8');
    }
}

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git') {
                await walk(fullPath);
            }
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
            await processFile(fullPath);
        }
    }
}

console.log('Starting Emergency Fix...');
walk(join(ROOT_DIR, 'server', 'domain')).then(() => {
    console.log('Emergency Fix completed.');
});
