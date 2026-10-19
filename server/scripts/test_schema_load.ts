
import * as fs from 'fs';
import * as path from 'path';

async function testSchemas() {
  const schemaDir = path.join(process.cwd(), 'shared', 'schema');
  
  async function scanDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        await scanDir(fullPath);
      } else if (file.endsWith('.ts') && !file.endsWith('index.ts')) {
        console.log(`Testing ${fullPath}...`);
        try {
          await import(fullPath);
        } catch (e: any) {
          console.error(`FAILED to load ${fullPath}:`, e.message);
          console.error(e.stack);
        }
      }
    }
  }

  await scanDir(schemaDir);
}

testSchemas().catch(console.error);
