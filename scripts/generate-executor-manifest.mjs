#!/usr/bin/env node
// Generates server/domain/jobs/core/executors/executor-manifest.ts — a static
// import list of every *-executor.ts file.
//
// Why this exists: AutoDiscoveryExecutorRegistry discovers executors with
// readdir() + dynamic import() of files on disk. That works under tsx in dev,
// but the production build bundles server code with esbuild — there is no
// executors directory inside dist, so the scan finds 0 files and every job
// executor silently fails to register. The manifest gives the bundle a static
// import graph the registry can fall back to.
//
// Run directly to regenerate; --check verifies freshness without writing
// (used by `npm run verify` so a new executor can't ship unregistered).

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const EXECUTOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'domain', 'jobs', 'core', 'executors');
const MANIFEST = join(EXECUTOR_DIR, 'executor-manifest.ts');

const files = readdirSync(EXECUTOR_DIR)
  .filter(f => f.endsWith('-executor.ts') && !f.includes('.test.') && !f.includes('.spec.'))
  .sort();

const body = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-executor-manifest.mjs (run via npm run build /
// npm run gen:executor-manifest; freshness enforced by check:executor-manifest).
// See that script for why the bundle needs a static import list.
import type { JobExecutor } from "./executor-types.js";

${files.map((f, i) => `import * as m${i} from "./${f.replace(/\.ts$/, '.js')}";`).join('\n')}

const modules = [${files.map((_, i) => `m${i}`).join(', ')}];

export function getBundledExecutors(): JobExecutor[] {
  const out: JobExecutor[] = [];
  for (const mod of modules) {
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && exported.prototype && 'canExecute' in exported.prototype) {
        out.push(new (exported as new () => JobExecutor)());
      }
    }
  }
  return out;
}
`;

const check = process.argv.includes('--check');
if (check) {
  let current = '';
  try {
    current = readFileSync(MANIFEST, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // A missing manifest is stale and must fail the freshness gate.
  }
  if (current !== body) {
    console.error(`executor-manifest.ts is stale — run: node scripts/generate-executor-manifest.mjs`);
    process.exit(1);
  }
  console.log(`executor-manifest.ts is current (${files.length} executors)`);
} else {
  writeFileSync(MANIFEST, body);
  console.log(`wrote executor-manifest.ts with ${files.length} executors`);
}
