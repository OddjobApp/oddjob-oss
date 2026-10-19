/**
 * fix-barrel-imports.mjs
 *
 * Converts `@shared/schema` barrel imports to canonical per-file imports.
 *
 * Usage: node scripts/fix-barrel-imports.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHARED_SCHEMA = path.resolve(ROOT, 'shared', 'schema');
const CLIENT_SRC = path.resolve(ROOT, 'client', 'src');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Step 1: Build symbol → canonical import path map ───────────────────────

/**
 * Given a canonical file path (relative to schema root), derive the @shared import path.
 * e.g. "auth.ts" → "@shared/schema/auth"
 *      "pipelines/index.ts" → "@shared/schema/pipelines"
 *      "pipelines/pipeline-core.ts" → "@shared/schema/pipelines/pipeline-core"
 */
function toImportPath(relativeFilePath) {
  // Remove .ts extension
  let p = relativeFilePath.replace(/\.ts$/, '');
  // If it ends with /index, strip that (e.g. pipelines/index → pipelines)
  p = p.replace(/\/index$/, '');
  return `@shared/schema/${p}`;
}

/**
 * Extract all exported names from a TypeScript file (names only, not the file structure).
 * Handles:
 *   export type Foo = ...
 *   export const Foo = ...
 *   export function Foo ...
 *   export { Foo, Bar }
 *   export { Foo as Bar }  → captures Bar (the alias)
 *   export * from "..." (ignored — we don't follow re-exports within canonical files)
 */
function extractExports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const names = new Set();

  // Named exports: export type Foo, export const Foo, export function Foo, export class Foo, export enum Foo
  const namedPattern = /^export\s+(?:type\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = namedPattern.exec(content)) !== null) {
    names.add(m[1]);
  }

  // Re-export with braces: export { Foo, Bar as Baz }
  const bracePattern = /^export\s+(?:type\s+)?\{([^}]+)\}/gm;
  while ((m = bracePattern.exec(content)) !== null) {
    const inner = m[1];
    // Each item: "Foo" or "Foo as Bar" → capture last name (the exported alias)
    for (const item of inner.split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const exported = parts[parts.length - 1].trim();
      if (exported && /^[A-Za-z_$]/.test(exported)) {
        names.add(exported);
      }
    }
  }

  return names;
}

/**
 * Walk a directory recursively, returning all .ts files (not .d.ts).
 */
function walkTs(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full, base));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

console.log('Building symbol → canonical file map...');

// Collect all canonical files (skip index.ts at root since it's the barrel)
const allSchemaFiles = walkTs(SHARED_SCHEMA).filter(f => f !== 'index.ts');

// symbol → importPath (first occurrence wins if duplicated)
const symbolMap = new Map();
// Also track: importPath → Set of symbols (for diagnostics)
const fileSymbols = new Map();

for (const relFile of allSchemaFiles) {
  const absPath = path.join(SHARED_SCHEMA, relFile);
  const importPath = toImportPath(relFile);

  // Skip sub-index files that just re-export (e.g. pipelines/index.ts)
  // We still want to include them if they define their own exports
  let symbols;
  try {
    symbols = extractExports(absPath);
  } catch (e) {
    console.warn(`  WARN: Could not parse ${relFile}: ${e.message}`);
    continue;
  }

  if (symbols.size === 0) continue;

  fileSymbols.set(importPath, symbols);
  for (const sym of symbols) {
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, importPath);
    } else {
      // Duplicate — note it but keep first
      // console.warn(`  DUP: ${sym} in ${importPath} (already in ${symbolMap.get(sym)})`);
    }
  }
}

console.log(`  Mapped ${symbolMap.size} symbols across ${fileSymbols.size} canonical files.\n`);

// ─── Step 2: Find and rewrite client files ───────────────────────────────────

/**
 * Parse an import statement of the form:
 *   import { Foo, Bar, type Baz } from "@shared/schema";
 *   import type { Foo } from "@shared/schema";
 * Returns { importedNames: string[], isTypeOnly: boolean, fullMatch: string }
 */
function parseBarrelImport(line) {
  // Full type import: import type { ... } from "@shared/schema"
  const typeImportMatch = line.match(/^import\s+type\s+\{([^}]+)\}\s+from\s+["']@shared\/schema["']/);
  if (typeImportMatch) {
    const names = typeImportMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    return { names, isTypeOnly: true, fullMatch: line };
  }

  // Mixed import: import { Foo, type Bar } from "@shared/schema"
  const mixedImportMatch = line.match(/^import\s+\{([^}]+)\}\s+from\s+["']@shared\/schema["']/);
  if (mixedImportMatch) {
    const rawNames = mixedImportMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    const names = rawNames.map(n => n.replace(/^type\s+/, '')); // strip inline "type" modifiers
    return { names, isTypeOnly: false, rawNames, fullMatch: line };
  }

  return null;
}

/**
 * Given an array of imported names and the raw import string,
 * produce replacement import lines grouped by canonical file.
 */
function buildReplacementImports(rawNames, symbolMap, isTypeOnly) {
  // Group by canonical file
  const byFile = new Map();
  const unresolved = [];

  for (const raw of rawNames) {
    const isInlineType = raw.startsWith('type ');
    const name = raw.replace(/^type\s+/, '');

    const canonicalFile = symbolMap.get(name);
    if (!canonicalFile) {
      unresolved.push(raw);
      continue;
    }

    if (!byFile.has(canonicalFile)) byFile.set(canonicalFile, []);
    byFile.get(canonicalFile).push(isInlineType ? `type ${name}` : name);
  }

  const lines = [];
  for (const [file, names] of byFile) {
    const sortedNames = names.sort();
    const prefix = isTypeOnly ? 'import type' : 'import';
    lines.push(`${prefix} { ${sortedNames.join(', ')} } from "${file}";`);
  }

  return { lines, unresolved };
}

// Find all client TypeScript/TSX files
function walkClientFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkClientFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const clientFiles = walkClientFiles(CLIENT_SRC);
let totalFixed = 0;
let totalUnresolved = 0;
const unresolvedReport = [];

for (const filePath of clientFiles) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Quick check: does this file import from the barrel?
  if (!content.includes('@shared/schema"') && !content.includes("@shared/schema'")) continue;

  const lines = content.split('\n');
  const newLines = [];
  let fileChanged = false;
  let fileUnresolved = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle multi-line imports (lines ending without closing brace)
    let fullLine = line;
    let j = i;
    if ((line.includes('import') || line.includes('{')) &&
        line.includes('@shared/schema') === false &&
        !line.trim().startsWith('//')) {
      // Not the line we care about — just pass through
    }

    // Collect potentially multi-line imports
    if (line.match(/^import\s+(type\s+)?\{/) && !line.includes('}')) {
      // Multi-line import — collect until closing }
      let collected = line;
      while (j + 1 < lines.length && !lines[j].includes('}')) {
        j++;
        collected += ' ' + lines[j].trim();
      }
      // Check if this collected import is from @shared/schema
      if (!collected.includes('@shared/schema')) {
        newLines.push(line);
        continue;
      }
      fullLine = collected;
      // We'll skip j lines
    } else if (!line.includes('@shared/schema')) {
      newLines.push(line);
      continue;
    }

    // Try to parse as a barrel import
    const parsed = parseBarrelImport(fullLine.trim());
    if (!parsed) {
      newLines.push(line);
      continue;
    }

    const rawNames = parsed.rawNames || parsed.names.map(n => n);
    const { lines: replacements, unresolved } = buildReplacementImports(
      parsed.rawNames || parsed.names,
      symbolMap,
      parsed.isTypeOnly
    );

    if (unresolved.length > 0) {
      fileUnresolved.push({ file: filePath, unresolved });
      totalUnresolved += unresolved.length;
    }

    if (replacements.length > 0) {
      newLines.push(...replacements);
      fileChanged = true;
      // Skip extra lines if we consumed a multi-line import
      if (j > i) i = j;
    } else {
      // Nothing resolved — keep original
      newLines.push(line);
    }
  }

  if (fileUnresolved.length > 0) {
    unresolvedReport.push(...fileUnresolved);
  }

  if (fileChanged) {
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    console.log(`  ${DRY_RUN ? '[DRY-RUN] ' : ''}Fixed: ${relPath}`);
    totalFixed++;
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    }
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Files updated: ${totalFixed}`);
console.log(`Unresolved symbols: ${totalUnresolved}`);

if (unresolvedReport.length > 0) {
  console.log(`\nUnresolved imports (need manual fix):`);
  for (const { file, unresolved } of unresolvedReport) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    console.log(`  ${rel}: ${unresolved.join(', ')}`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY-RUN] No files were modified. Remove --dry-run to apply changes.');
}
