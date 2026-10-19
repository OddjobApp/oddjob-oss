
import { exec } from 'child_process';
import * as fs from 'fs';
import * as util from 'util';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EvalResult {
    name: string;
    command: string;
    passed: boolean;
    output: string;
    duration: number;
}

const EVAL_SCRIPTS = [
    { name: "Alert Configuration", command: "npx tsx eval_alerts.ts" },
    { name: "Autoresearch (Autonomous Evolution)", command: "npx tsx eval_autoresearch.ts" },
    { name: "Audit Logging", command: "npx tsx eval_audit.ts" },
    { name: "Authentication System", command: "npx tsx eval_authentication.ts" },
    { name: "Credentials System", command: "npx tsx eval_credentials.ts" },
    { name: "CURL / API Jobs", command: "npx tsx eval_curl.ts" },
    { name: "Datasets", command: "npx tsx eval_datasets.ts" },
    { name: "Enterprise Features", command: "npx tsx eval_enterprise_features.ts" },
    { name: "Ephemeral Concierge", command: "npx tsx eval_ephemeral_concierge.ts" },
    { name: "Error Diagnosis System", command: "npx tsx eval_error_diagnosis.ts" },
    { name: "Forensic Logging", command: "npx tsx eval_forensic.ts" },
    { name: "HIL (Human in the Loop) Forms", command: "npx tsx eval_hil_forms.ts" },
    { name: "Job Type Execution", command: "npx tsx eval_job_types.ts" },
    { name: "Knowledge Extraction", command: "npx tsx eval_knowledge_extraction.ts" },
    { name: "Knowledge Graph", command: "npx tsx eval_knowledge_graph.ts" },
    { name: "MCP Server", command: "npx tsx eval_mcp.ts" },
    { name: "Core Observability (Tracing & Logging)", command: "npx tsx eval_observability.ts" },
    { name: "OpenAPI Job Configuration", command: "npx tsx eval_openapi.ts" },
    { name: "Pipeline Execution", command: "npx tsx eval_pipeline_execution.ts" },
    { name: "Pipeline Variable Resolution", command: "npx tsx eval_pipeline_variables.ts" },
    { name: "RAG (Retrieval Augmented Generation)", command: "npx tsx eval_rag_quality.ts" },
    { name: "Scheduler & Cron", command: "npx tsx eval_scheduler.ts" },
    { name: "Universal Analyst Search", command: "npx tsx eval_search.ts" },
    { name: "Fine-tuning / Learning Loop", command: "npx tsx eval_training.ts" },
    { name: "Mission Types (Pre-planned vs Dynamic)", command: "npx tsx eval_mission_types.ts" },
    { name: "Webhooks", command: "npx tsx eval_webhooks.ts" }
];

async function runSuite() {
    console.log("🚀 Starting Full Oddjob Evaluation Suite...");
    console.log("===================================================\n");

    const results: EvalResult[] = [];
    let allPassed = true;

    for (const valid of EVAL_SCRIPTS) {
        console.log(`Running: ${valid.name}...`);
        const start = Date.now();
        let passed = false;
        let output = "";

        try {
            // Run relative to the project root so dotenv finds the .env file
            const rootDir = join(__dirname, '../../');
            const scriptPath = join('scripts/evals', valid.command.split(' ').pop() || '');
            const command = `npx tsx ${scriptPath}`;

            const { stdout, stderr } = await execAsync(command, { cwd: rootDir });
            output = stdout + "\n" + stderr;
            passed = true;
        } catch (e: any) {
            output = e.stdout + "\n" + e.stderr + "\nError: " + e.message;
            passed = false;
            allPassed = false;
        }

        const duration = Date.now() - start;
        results.push({
            name: valid.name,
            command: valid.command,
            passed,
            output,
            duration
        });

        console.log(`   ${passed ? "✅ PASS" : "❌ FAIL"} (${duration}ms)\n`);
    }

    // Generate Report
    generateReport(results);

    if (allPassed) {
        console.log("🎉 ALL SYSTEMS GO! Detailed Observability is fully operational.");
        process.exit(0);
    } else {
        console.error("⚠️  Some evaluations failed. See eval_report.md for details.");
        process.exit(1);
    }
}

function generateReport(results: EvalResult[]) {
    let md = `# Detailed Observability Evaluation Report
**Date:** ${new Date().toLocaleString()}

## Summary
| Component | Status | Duration |
|-----------|--------|----------|
`;

    for (const r of results) {
        md += `| ${r.name} | ${r.passed ? "✅ PASS" : "❌ FAIL"} | ${r.duration}ms |\n`;
    }

    md += `\n## Detailed Output\n`;

    for (const r of results) {
        md += `### ${r.name}\n`;
        md += `**Command:** \`${r.command}\`\n`;
        md += `**Status:** ${r.passed ? "Pass" : "Fail"}\n`;
        md += `\n\`\`\`text\n${r.output.trim()}\n\`\`\`\n\n`;
    }

    fs.writeFileSync('eval_report.md', md);
    console.log("📝 Report generated: eval_report.md");
}

runSuite().catch(e => {
    console.error("Suite execution failed:", e);
    process.exit(1);
});
