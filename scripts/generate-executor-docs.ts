import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExecutorDoc {
  name: string;
  version: string;
  description: string;
  jobTypes: string[];
  configSchema: any;
  examples: any[];
  capabilities: string[];
}

async function extractExecutorDocs(): Promise<ExecutorDoc[]> {
  const executorDir = join(__dirname, '../server/domain/jobs/core/executors');
  try {
    const files = await readdir(executorDir);
    const executorFiles = files.filter(f => f.endsWith('-executor.ts'));
    
    const docs: ExecutorDoc[] = [];
    
    for (const file of executorFiles) {
      // In a real implementation, this would parse the AST or reflect metadata
      // For now, we simulate extraction based on filename
      const baseName = file.replace('-executor.ts', '');
      
      docs.push({
        name: `${baseName} Executor`,
        version: '1.0.0',
        description: `Executes jobs of type ${baseName}`,
        jobTypes: [baseName],
        configSchema: {
          type: 'object',
          properties: {
            // generic schema placeholder
          }
        },
        examples: [],
        capabilities: ['execute']
      });
    }
    
    return docs;
  } catch (err) {
    console.error(`Error reading executor directory:`, err);
    return [];
  }
}

import fs from 'fs/promises';

async function generateMarkdown(docs: ExecutorDoc[]) {
  let md = '# Job Executors Documentation\n\n';
  
  for (const doc of docs) {
    md += `## ${doc.name}\n\n`;
    md += `${doc.description}\n\n`;
    
    md += `### Supported Types\n`;
    md += doc.jobTypes.map(t => `- \`${t}\``).join('\n') + '\n\n';
    
    md += `### Configuration Schema\n`;
    md += '```json\n';
    md += JSON.stringify(doc.configSchema, null, 2) + '\n';
    md += '```\n\n';
    
    if (doc.examples.length > 0) {
      md += `### Examples\n`;
      for (const ex of doc.examples) {
        md += `#### ${ex.name}\n`;
        md += '```json\n';
        md += JSON.stringify(ex.config, null, 2) + '\n';
        md += '```\n\n';
      }
    }
  }
  
  await fs.writeFile(join(__dirname, '../docs/executors.md'), md);
  console.log('Documentation generated at docs/executors.md');
}

async function run() {
  console.log("Extracting executor documentation...");
  const docs = await extractExecutorDocs();
  console.log(`Found ${docs.length} executors.`);
  await generateMarkdown(docs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(console.error);
}
