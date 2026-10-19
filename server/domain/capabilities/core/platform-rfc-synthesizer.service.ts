/**
 * Autonomous Platform RFC Synthesizer
 *
 * Compiles technical RFC documents (`PLATFORM_RFC_<proposal_id>.md`) from high-priority capability proposals.
 */

import fs from "fs/promises";
import path from "path";
import { createLogger } from "@server/utils/logger.js";
import { CapabilityProposal } from "@shared/schema/capabilities/index.js";

const logger = createLogger("PlatformRfcSynthesizer");

export interface PlatformRfcDocument {
  rfcId: string;
  proposalId: number;
  title: string;
  filePath: string;
  markdownContent: string;
  createdAt: Date;
}

export class PlatformRfcSynthesizerService {
  private outputDir = path.resolve(process.cwd(), "docs/platform-rfcs");

  private async ensureDir() {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  /**
   * Compiles and publishes a technical platform RFC markdown document
   */
  async synthesizeRfcFromProposal(proposal: CapabilityProposal, priorityScore = 75): Promise<PlatformRfcDocument> {
    await this.ensureDir();

    const rfcId = `RFC_${proposal.id}_${proposal.proposedCapabilityId.toUpperCase()}`;
    const fileName = `PLATFORM_RFC_${proposal.id}.md`;
    const filePath = path.join(this.outputDir, fileName);
    const createdAt = new Date();

    const markdownLines: string[] = [
      `# Platform RFC: ${proposal.title}`,
      "",
      `> **RFC Document ID:** \`${rfcId}\`  `,
      `> **Proposed Capability ID:** \`${proposal.proposedCapabilityId}\`  `,
      `> **Classification:** \`${proposal.classification}\`  `,
      `> **Priority Score:** **${priorityScore} / 100**  `,
      `> **Creation Date:** ${createdAt.toISOString()}  `,
      `> **Status:** Proposed / Under Governance Review`,
      "",
      "---",
      "",
      "## 1. Problem Rationale & Execution Gap",
      "",
      proposal.rationale,
      "",
      `*Confidence Level:* **${proposal.confidence}%**  `,
      `*Discovery Source:* \`${proposal.source}\``,
      "",
      "---",
      "",
      "## 2. Proposed Capability Tool Manifest Spec",
      "",
      "```json",
      JSON.stringify(proposal.proposedManifest || {
        capability_id: proposal.proposedCapabilityId,
        metadata: {
          display_name: proposal.title,
          description: proposal.rationale,
          version: "1.0.0",
        },
        schema: {
          type: "object",
          properties: {},
          required: [],
        },
      }, null, 2),
      "```",
      "",
      "---",
      "",
      "## 3. Synthetic Regression Benchmarking Strategy",
      "",
      "- **Contract Validation:** Execute JSON Schema validation against input arguments.",
      "- **Sandbox Execution Gate:** Mandate Docker/Container isolation (`--network none`, 512MB RAM).",
      "- **Blast Radius Score:** Minimal (< 20) impact expected across dependent services.",
      "",
      "---",
      "",
      "## 4. Governance Consensus Sign-off Criteria",
      "",
      "- [ ] 100% Automated Unit/Integration Test Pass Rate",
      "- [ ] Oddjob 5-Layer AI Control Plane Policy Audit Compliance",
      "- [ ] Architecture Review Board Consensus Vote",
    ];

    const markdownContent = markdownLines.join("\n");
    await fs.writeFile(filePath, markdownContent, "utf-8");

    logger.info(`[PlatformRfcSynthesizer] Synthesized platform RFC published at: ${filePath}`);

    return {
      rfcId,
      proposalId: proposal.id,
      title: proposal.title,
      filePath,
      markdownContent,
      createdAt,
    };
  }

  async listPublishedRfcs(): Promise<string[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.outputDir);
    return files.filter((f) => f.endsWith(".md"));
  }
}

export const platformRfcSynthesizerService = new PlatformRfcSynthesizerService();
