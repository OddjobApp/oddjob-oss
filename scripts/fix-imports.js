import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fixImports(filePath, baseDir) {
  const content = await readFile(filePath, 'utf-8');
  const fileDir = dirname(filePath);

  // Fix relative imports: from "./module" -> from "./module.js" OR from "../module" -> from "../module.js"
  // Matches ./... and ../... but verifies it doesn't already end in .js
  let fixed = content.replace(/from\s+["'](\.{1,2}\/[^"']+)(?<!\.js)["']/g, (match, path) => {
    return match.replace(path, path + '.js');
  });

  // Fix @shared imports - calculate relative path from current file to dist/shared folder
  fixed = fixed.replace(/from\s+["']@shared\/([^"']+)["']/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'shared')).replace(/\\/g, '/');
    let filePath = path;
    if (path === 'schema' || path === 'schema.js') {
      filePath = 'schema/index.js';
    } else {
      filePath = path.endsWith('.js') ? path : path + '.js';
    }
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `from "${finalPath}"`;
  });

  // Fix @domain imports
  fixed = fixed.replace(/from\s+["']@domain\/([^"']+)["']/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'server', 'domain')).replace(/\\/g, '/');
    let filePath = path.endsWith('.js') ? path : path + '.js';
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `from "${finalPath}"`;
  });

  // Fix @server imports
  fixed = fixed.replace(/from\s+["']@server\/([^"']+)["']/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'server')).replace(/\\/g, '/');
    let filePath = path.endsWith('.js') ? path : path + '.js';
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `from "${finalPath}"`;
  });

  // Fix relative dynamic imports: import("./...") or import("../...")
  fixed = fixed.replace(/import\(["'](\.{1,2}\/[^"']+)(?<!\.js)["']\)/g, (match, path) => {
    return `import("${path}.js")`;
  });

  // Fix dynamic imports: import("@shared/...")
  fixed = fixed.replace(/import\(["']@shared\/([^"']+)["']\)/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'shared')).replace(/\\/g, '/');
    let filePath = path;
    if (path === 'schema' || path === 'schema.js') {
      filePath = 'schema/index.js';
    } else {
      filePath = path.endsWith('.js') ? path : path + '.js';
    }
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `import("${finalPath}")`;
  });

  // Fix dynamic imports: import("@domain/...")
  fixed = fixed.replace(/import\(["']@domain\/([^"']+)["']\)/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'server', 'domain')).replace(/\\/g, '/');
    let filePath = path.endsWith('.js') ? path : path + '.js';
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `import("${finalPath}")`;
  });

  // Fix dynamic imports: import("@server/...")
  fixed = fixed.replace(/import\(["']@server\/([^"']+)["']\)/g, (match, path) => {
    const relPath = relative(fileDir, join(baseDir, 'server')).replace(/\\/g, '/');
    let filePath = path.endsWith('.js') ? path : path + '.js';
    let finalPath = relPath === '' ? `./${filePath}` : `${relPath}/${filePath}`;
    if (!finalPath.startsWith('.')) finalPath = `./${finalPath}`;
    return `import("${finalPath}")`;
  });

  if (fixed !== content) {
    await writeFile(filePath, fixed, 'utf-8');
  }
}

async function processDirectory(dir, baseDir) {
  const files = await readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = join(dir, file.name);

    if (file.isDirectory()) {
      await processDirectory(fullPath, baseDir);
    } else if (file.name.endsWith('.js')) {
      await fixImports(fullPath, baseDir);
    }
  }
}

const distServerDir = join(__dirname, '..', 'dist', 'server');
const distSharedDir = join(__dirname, '..', 'dist', 'shared');
const baseDir = join(__dirname, '..', 'dist');
if (await exists(distServerDir)) {
  await processDirectory(distServerDir, baseDir);
}
if (await exists(distSharedDir)) {
  await processDirectory(distSharedDir, baseDir);
}
console.log('Fixed all imports in dist/server and dist/shared');
