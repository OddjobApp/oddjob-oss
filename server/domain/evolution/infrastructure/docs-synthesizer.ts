import fs from 'fs';
import path from 'path';
import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DocsSynthesizer");

export class DocsSynthesizer {
    private docsPath = path.resolve(process.cwd(), 'docs', 'SYSTEM_ARCHITECTURE.md');

    /**
     * Synthesizes the current system state into a human-readable (and AI-readable) 
     * markdown document. This is the 'Self-Documentation' capability of Goal 8.
     */
    async synthesizeArchitecture() {
        logger.info("[DocsSynthesizer] Synchronizing architecture documentation...");

        const pods = podRegistry.getPodMetadata();
        
        let content = `# Modular Architecture Registry (Oddjob Platform)\n\n`;
        content += `*Generated automatically by the Evolution Engine on ${new Date().toLocaleString()}*\n\n`;
        
        content += `## 🌐 Central Pod Ecosystem\n`;
        content += `The following domains are currently registered and active in the central pod registry.\n\n`;
        
        // The "Intelligence Density" column was dropped: the number behind it was
        // derived from the pod's name, not measured, and generated docs are read
        // later as though they record something.
        content += `| Domain | Status | Role |\n`;
        content += `| :--- | :--- | :--- |\n`;
        
        for (const pod of pods) {
            const role = this.getPodRole(pod.name);
            content += `| **${pod.name.toUpperCase()}** | ${pod.hasFacade ? '✅ ACTIVE' : '⚠️ DEPENDENT'} | ${role} |\n`;
        }

        content += `\n## 🛠️ Infrastructure Layers\n`;
        content += `- **Core**: Shared utilities, database schemas, and foundational infrastructure.\n`;
        content += `- **AI Layer**: Cross-cutting LLM integration and self-healing protocols.\n`;
        content += `- **Edge Service**: Event stream handling and mission distribution.\n\n`;

        // Query harnesses from operational_cycles and proposals dynamically
        try {
            const { db } = await import("@server/database_service.js");
            const { operationalCycles } = await import("@shared/schema/operational-cycles.js");
            const { harnessProposals } = await import("@shared/schema/harness-proposal.js");
            const { sql } = await import("drizzle-orm");

            const cycles = await db.select().from(operationalCycles);
            if (cycles.length > 0) {
                content += `## ⚙️ Operational Harness Registry\n`;
                content += `The following operational cycles and self-improving harnesses are active in the registry.\n\n`;
                content += `| Harness Name | Status | Budget Limit | Created By | Created At |\n`;
                content += `| :--- | :--- | :--- | :--- | :--- |\n`;
                
                for (const cycle of cycles) {
                    content += `| **${cycle.name}** | ${cycle.status.toUpperCase()} | $${cycle.budgetLimitUsd || '0.00'} | ${cycle.createdBy} | ${new Date(cycle.createdAt).toLocaleDateString()} |\n`;
                }
                content += `\n`;
            }

            // Aggregate only — deliberately no per-proposal detail.
            //
            // This previously selected the five most recent proposals across EVERY
            // tenant and wrote each one's `proposedChange.filePath` into this
            // repo-committed document. That is a cross-tenant read exporting one
            // organization's staged source diff into a file that gets checked in.
            // `synthesizeArchitecture()` has no tenant context and no place to get
            // one, so the fix is not to scope the query — it is to stop emitting
            // tenant-identifying content here at all.
            const proposalCounts = await db
                .select({ status: harnessProposals.validationStatus, count: sql<number>`count(*)::int` })
                .from(harnessProposals)
                .groupBy(harnessProposals.validationStatus);
            const totalProposals = proposalCounts.reduce((sum, row) => sum + row.count, 0);
            if (totalProposals > 0) {
                content += `### 💡 Self-Improvement Proposals\n`;
                content += `${totalProposals} proposal(s) recorded platform-wide. Counts only — proposal contents are tenant-scoped and are not published to this document.\n\n`;
                content += `| Status | Count |\n`;
                content += `| :--- | ---: |\n`;
                for (const row of proposalCounts) {
                    content += `| ${row.status.toUpperCase()} | ${row.count} |\n`;
                }
                content += `\n`;
            }
        } catch (e: any) {
            logger.warn("[DocsSynthesizer] Could not query operational cycles or proposals for documentation", e);
        }

        content += `--- \n`;
        content += `*Note: This document is managed by the Evolution Pod. Manual edits will be reconciled on the next synthesis cycle.*\n`;

        try {
            fs.writeFileSync(this.docsPath, content, 'utf8');
            logger.info(`[DocsSynthesizer] Architecture synchronized: ${this.docsPath}`);
            return { success: true, path: this.docsPath };
        } catch (error) {
            logger.error("[DocsSynthesizer] Failed to write architecture docs", error);
            throw error;
        }
    }

    private getPodRole(podName: string): string {
        const roles: Record<string, string> = {
            'ai': 'Core LLM Logic & Prompt Engineering',
            'mission': 'Dynamic Orchestration & Task Execution',
            'agents': 'Character Synthesis & Specialized Personas',
            'apps': 'AppForge & Public Deployment Middleware',
            'evolution': 'Self-Improving Code & Doc Infrastructure',
            'schedules': 'Unified Chronometric Execution Hub',
            'knowledge': 'RAG & Semantic Memory Management'
        };
        return roles[podName] || 'Specialized Domain Service';
    }
}

export const docsSynthesizer = new DocsSynthesizer();
