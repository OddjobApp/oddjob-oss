/**
 * Script to convert @shared/* imports to relative paths
 * Handles both file and directory imports correctly
 */
import * as fs from 'fs';
import * as path from 'path';

const serverDir = path.join(process.cwd(), 'server');
const sharedDir = path.join(process.cwd(), 'shared');

// Calculate relative path from source file to shared directory
function getRelativePathToShared(sourceFile: string, sharedPath: string): string {
    const sourceDir = path.dirname(sourceFile);
    let targetBasePath = path.join(sharedDir, sharedPath);

    // Check if target is a directory (e.g., @shared/schema -> shared/schema/index.ts)
    let targetPath = targetBasePath;

    if (fs.existsSync(targetBasePath) && fs.statSync(targetBasePath).isDirectory()) {
        // It's a directory, look for index.ts
        targetPath = path.join(targetBasePath, 'index.ts');
    } else if (!targetBasePath.endsWith('.ts')) {
        // Try adding .ts extension
        if (fs.existsSync(targetBasePath + '.ts')) {
            targetPath = targetBasePath + '.ts';
        } else if (fs.existsSync(targetBasePath) && fs.statSync(targetBasePath).isDirectory()) {
            targetPath = path.join(targetBasePath, 'index.ts');
        } else {
            // Fallback: append .ts and hope it works (or will error clearly)
            targetPath = targetBasePath + '.ts';
        }
    }

    let relativePath = path.relative(sourceDir, targetPath);

    // Ensure it starts with ./ or ../
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }

    // Replace backslashes with forward slashes for cross-platform
    relativePath = relativePath.replace(/\\/g, '/');

    return relativePath;
}

function processFile(filePath: string): { modified: boolean; changes: number } {
    const content = fs.readFileSync(filePath, 'utf-8');
    let newContent = content;
    let changes = 0;

    // Match @shared/* imports (with or without .ts extension already)
    const sharedImportRegex = /(from\s+['"])@shared\/([^'"]+)(['"])/g;

    newContent = newContent.replace(sharedImportRegex, (match, prefix, sharedPath, suffix) => {
        // Remove any existing .ts extension for consistent processing
        const cleanPath = sharedPath.replace(/\.ts$/, '');
        const relativePath = getRelativePathToShared(filePath, cleanPath);
        changes++;
        return `${prefix}${relativePath}${suffix}`;
    });

    // Also match remaining @shared imports that somehow have .ts already
    const sharedImportWithTsRegex = /(from\s+['"])\.\.\/(?:\.\.\/)*shared\/([^'"]+)\.ts(['"])/g;

    // Fix any malformed double-extension paths like ../shared/schema.ts.ts
    newContent = newContent.replace(/\.ts\.ts/g, '.ts');

    if (changes > 0) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(`✓ ${path.relative(process.cwd(), filePath)} (${changes} imports converted)`);
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

console.log('Converting @shared/* imports to relative paths (with directory support)...\n');

let totalFiles = 0;
let modifiedFiles = 0;
let totalChanges = 0;

walkDir(serverDir, (filePath) => {
    totalFiles++;
    const result = processFile(filePath);
    if (result.modified) {
        modifiedFiles++;
        totalChanges += result.changes;
    }
});

console.log(`\n✅ Done! Modified ${modifiedFiles}/${totalFiles} files with ${totalChanges} total changes.`);
