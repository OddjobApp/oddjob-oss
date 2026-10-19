/**
 * CI/CD Blast Radius Impact Gate Service
 *
 * Evaluates PR change diffs against System Graph & Xray Lineage topology.
 * Calculates cumulative blast radius score and enforces automated CI blocking gates.
 */

import { createLogger } from "@server/utils/logger.js";
import { xrayLineageService, ImpactAnalysis } from "./xray-lineage.service.js";
import { db } from "@server/database_service.js";
import { datasets } from "@shared/schema/datasets.js";
import { ilike, or } from "drizzle-orm";

const logger = createLogger("CIImpactGateService");

export interface CIImpactCheckParams {
  modifiedFiles: string[];
  branchName?: string;
  maxBlastRadiusScore?: number; // Default: 50
  organizationId?: number;
}

export interface CIImpactCheckResult {
  passed: boolean;
  totalImpactScore: number;
  maxAllowedScore: number;
  blastRadiusCategory: "minimal" | "moderate" | "significant" | "critical";
  matchedDatasetsCount: number;
  affectedEntitiesCount: number;
  blockedReason?: string;
  summary: {
    modifiedFilesCount: number;
    directlyAffectedCount: number;
    indirectlyAffectedCount: number;
    recommendedActions: string[];
  };
  details: Array<{
    file: string;
    matchedDatasetId?: number;
    matchedDatasetName?: number | string;
    impactScore: number;
    blastRadius: string;
  }>;
}

export class CIImpactGateService {
  /**
   * Evaluates pull request modified file list against System Graph lineage
   */
  async evaluatePullRequestImpact(params: CIImpactCheckParams): Promise<CIImpactCheckResult> {
    const { modifiedFiles, maxBlastRadiusScore = 50 } = params;
    logger.info(`[CIImpactGate] Evaluating PR impact across ${modifiedFiles.length} changed files (Max Score Threshold: ${maxBlastRadiusScore})`);

    let cumulativeImpactScore = 0;
    let maxSingleScore = 0;
    let matchedDatasetsCount = 0;
    let totalDirectlyAffected = 0;
    let totalIndirectlyAffected = 0;
    const allRecommendedActions = new Set<string>();
    const details: CIImpactCheckResult["details"] = [];

    // Query DB datasets matching modified file basenames or schema files
    for (const file of modifiedFiles) {
      const fileName = file.split("/").pop() || file;
      const fileStem = fileName.replace(/\.[^/.]+$/, "");

      let matchedDataset = null;
      try {
        const found = await db.select()
          .from(datasets)
          .where(
            or(
              ilike(datasets.name, `%${fileStem}%`),
              ilike(datasets.description, `%${fileStem}%`)
            )
          )
          .limit(1);
        if (found.length > 0) {
          matchedDataset = found[0];
        }
      } catch (err: any) {
        logger.warn(`[CIImpactGate] Dataset lookup skipped for ${file}: ${err.message}`);
      }

      if (matchedDataset) {
        matchedDatasetsCount++;
        const impact: ImpactAnalysis = await xrayLineageService.analyzeImpact(matchedDataset.id, {
          maxDepth: 5,
          includeIndirect: true,
        });

        cumulativeImpactScore += impact.totalImpactScore;
        if (impact.totalImpactScore > maxSingleScore) {
          maxSingleScore = impact.totalImpactScore;
        }

        totalDirectlyAffected += impact.directlyAffected.length;
        totalIndirectlyAffected += impact.indirectlyAffected.length;
        impact.recommendedActions.forEach((act) => allRecommendedActions.add(act));

        details.push({
          file,
          matchedDatasetId: matchedDataset.id,
          matchedDatasetName: matchedDataset.name,
          impactScore: impact.totalImpactScore,
          blastRadius: impact.blastRadius,
        });
      } else {
        // Base weight for unmapped code files based on file type
        let baseFileScore = 2;
        if (file.includes("schema") || file.includes("migration") || file.includes("database")) {
          baseFileScore = 15;
          allRecommendedActions.add(`Run full schema regression test suite for ${file}`);
        } else if (file.includes("service") || file.includes("orchestrator")) {
          baseFileScore = 8;
        }

        cumulativeImpactScore += baseFileScore;
        details.push({
          file,
          impactScore: baseFileScore,
          blastRadius: baseFileScore > 10 ? "moderate" : "minimal",
        });
      }
    }

    const blastRadiusCategory = this.categorizeBlastRadius(cumulativeImpactScore);
    const passed = cumulativeImpactScore <= maxBlastRadiusScore;

    let blockedReason: string | undefined;
    if (!passed) {
      blockedReason = `Cumulative blast radius score (${cumulativeImpactScore}) exceeds maximum allowed PR threshold (${maxBlastRadiusScore}). Impact level: ${blastRadiusCategory.toUpperCase()}.`;
      allRecommendedActions.add("Request architecture review sign-off before merging high blast-radius PR.");
    }

    logger.info(`[CIImpactGate] PR Evaluation Complete. Score: ${cumulativeImpactScore}/${maxBlastRadiusScore}, Passed: ${passed}, Category: ${blastRadiusCategory}`);

    return {
      passed,
      totalImpactScore: cumulativeImpactScore,
      maxAllowedScore: maxBlastRadiusScore,
      blastRadiusCategory,
      matchedDatasetsCount,
      affectedEntitiesCount: totalDirectlyAffected + totalIndirectlyAffected,
      blockedReason,
      summary: {
        modifiedFilesCount: modifiedFiles.length,
        directlyAffectedCount: totalDirectlyAffected,
        indirectlyAffectedCount: totalIndirectlyAffected,
        recommendedActions: Array.from(allRecommendedActions),
      },
      details,
    };
  }

  private categorizeBlastRadius(score: number): "minimal" | "moderate" | "significant" | "critical" {
    if (score > 80) return "critical";
    if (score > 50) return "significant";
    if (score > 20) return "moderate";
    return "minimal";
  }
}

export const ciImpactGateService = new CIImpactGateService();
