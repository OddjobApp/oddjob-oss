import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');

const TARGET_DIRS = [
    path.join(ROOT, 'shared', 'schema'),
    path.join(ROOT, 'server')
];

const EXTENSIONS_TO_FIX = ['.ts', '.tsx', '.js', '.jsx'];

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // Regex to find relative imports/exports
    // Matches: import ... from './path' or export ... from './path'
    // Also matches: import './path'
    const regex = /(import|export)(\s+[\s\S]*?\s+from)?\s+['"](\.\.?\/[^'"]+)['"]/g;

    const newContent = content.replace(regex, (match, type, fromPart, importPath) => {
        // Skip if already has extension
        if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.cjs') || importPath.endsWith('.json') || importPath.endsWith('.css')) {
            return match;
        }

        const fullPath = path.resolve(path.dirname(filePath), importPath);
        
        // Try to find the actual file
        let resolvedPath = null;
        
        // 1. Check if it's a file
        for (const ext of EXTENSIONS_TO_FIX) {
            if (fs.existsSync(fullPath + ext)) {
                resolvedPath = importPath + '.js';
                break;
            }
        }

        // 2. Check if it's a directory with index
        if (!resolvedPath && fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
            for (const ext of EXTENSIONS_TO_FIX) {
                if (fs.existsSync(path.join(fullPath, 'index' + ext))) {
                    resolvedPath = (importPath.endsWith('/') ? importPath : importPath + '/') + 'index.js';
                    break;
                }
            }
        }

        if (resolvedPath) {
            changed = true;
            const result = `${type}${fromPart || ''} '${resolvedPath}'`;
            console.log(`  [FIX] ${filePath}: ${importPath} -> ${resolvedPath}`);
            return result;
        }

        return match;
    });

    if (changed) {
        fs.writeFileSync(filePath, newContent, 'utf8');
    }
}

function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist') {
                walk(fullPath);
            }
        } else if (EXTENSIONS_TO_FIX.includes(path.extname(fullPath))) {
            fixFile(fullPath);
        }
    }
}

console.log("Starting ESM extension fix...");
TARGET_DIRS.forEach(dir => {
    if (fs.existsSync(dir)) {
        console.log(`Processing directory: ${dir}`);
        walk(dir);
    }
});
console.log("Done.");
