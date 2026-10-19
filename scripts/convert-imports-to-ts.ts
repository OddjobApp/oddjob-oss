/**
 * Script to add .ts extensions to ALL relative imports that are missing extensions
 * for Node.js v24 ESM compatibility
 */
import * as fs from 'fs';
import * as path from 'path';

const serverDir = path.join(process.cwd(), 'server');
const sharedDir = path.join(process.cwd(), 'shared');

// Regex patterns
// 1. Convert .js extensions to .ts
const jsToTsRegex = /(from\s+['"])(\.{1,2}\/[^'"]+)(\.js)(['"])/g;
// 2. Add .ts to imports that have NO extension (but are relative paths)
const noExtensionImportRegex = /(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g;
// 3. Dynamic imports
const dynamicImportNoExtRegex = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+?)(['"]\s*\))/g;

function hasExtension(importPath: string): boolean {
    const ext = path.extname(importPath);
    return ext.length > 0;
}

function processFile(filePath: string): { modified: boolean; changes: number } {
    const content = fs.readFileSync(filePath, 'utf-8');
    let newContent = content;
    let changes = 0;

    // Step 1: Convert .js to .ts
    newContent = newContent.replace(jsToTsRegex, (match, prefix, importPath, ext, suffix) => {
        changes++;
        return `${prefix}${importPath}.ts${suffix}`;
    });

    // Step 2: Add .ts to missing-extension imports
    newContent = newContent.replace(noExtensionImportRegex, (match, prefix, importPath, suffix) => {
        // Check if already has extension
        if (hasExtension(importPath)) {
            return match;
        }
        changes++;
        return `${prefix}${importPath}.ts${suffix}`;
    });

    // Step 3: Dynamic imports
    newContent = newContent.replace(dynamicImportNoExtRegex, (match, prefix, importPath, suffix) => {
        if (hasExtension(importPath)) {
            return match;
        }
        changes++;
        return `${prefix}${importPath}.ts${suffix}`;
    });

    if (changes > 0) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(`✓ ${path.relative(process.cwd(), filePath)} (${changes} changes)`);
    }

    return { modified: changes > 0, changes };
}

function walkDir(dir: string, callback: (filePath: string) => void) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            walkDir(filePath, callback);
        } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            callback(filePath);
        }
    }
}

console.log('Adding .ts extensions to ALL relative imports in server/ and shared/...\n');

let totalFiles = 0;
let modifiedFiles = 0;
let totalChanges = 0;

for (const dir of [serverDir, sharedDir]) {
    if (fs.existsSync(dir)) {
        walkDir(dir, (filePath) => {
            totalFiles++;
            const result = processFile(filePath);
            if (result.modified) {
                modifiedFiles++;
                totalChanges += result.changes;
            }
        });
    }
}

console.log(`\n✅ Done! Modified ${modifiedFiles}/${totalFiles} files with ${totalChanges} total changes.`);
