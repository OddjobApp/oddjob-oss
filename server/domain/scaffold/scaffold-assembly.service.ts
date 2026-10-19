import fs from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import { SATScaffoldResolver } from "./sat-scaffold-resolver.js";
import { layoutFormalService } from "./formal/layout-formal.service.js";
import { WCAGTokenSynthesizer } from "./formal/wcag-token-synthesizer.js";
import { ASTRuleEngine } from "./ast-rule-engine.js";
import type { PackManifest, AssemblyManifest } from "@shared/schema/scaffold.js";
import { createLogger } from "@server/utils/logger.js";
import { xrayCompositionService } from "@domain/xray/core/xray-composition.service.js";

const logger = createLogger("ScaffoldAssemblyService");

export interface AssemblyResult {
  success: boolean;
  appName: string;
  targetDir: string;
  executedPacks: string[];
  error?: string;
}

export class ScaffoldAssemblyService {
  private astEngine: ASTRuleEngine;
  private static templateCache = new Map<string, HandlebarsTemplateDelegate>();

  constructor() {
    this.astEngine = new ASTRuleEngine();
  }

  public static clearTemplateCache(): void {
    ScaffoldAssemblyService.templateCache.clear();
  }

  private getCompiledTemplate(cacheKey: string, content: string): HandlebarsTemplateDelegate {
    let compiled = ScaffoldAssemblyService.templateCache.get(cacheKey);
    if (!compiled) {
      compiled = Handlebars.compile(content);
      ScaffoldAssemblyService.templateCache.set(cacheKey, compiled);
    }
    return compiled;
  }

  public async assemble(
    manifest: AssemblyManifest,
    availablePacks: PackManifest[],
    packTemplatesBaseDir?: string
  ): Promise<AssemblyResult> {
    try {
      logger.info(`[ScaffoldAssembly] Beginning assembly for app '${manifest.appName}' in '${manifest.targetDir}'`);

      // 1. Resolve a conflict-free execution order. UNSAT is an assembly
      // boundary, not a reason to bypass constraints through the legacy DAG.
      const satSolver = new SATScaffoldResolver(availablePacks);
      const satResult = satSolver.solve(manifest.packs, { includeRecommendations: false });
      if (!satResult.satisfiable) throw new Error(satResult.proofExplanation);
      const executionOrder: PackManifest[] = satResult.executionOrder;

      // 2. Formal Layout & WCAG Token Verification & Synthesis
      if ((manifest.variables as any)?.uiLayoutTree) {
        const proof = layoutFormalService.verifyAndSynthesize((manifest.variables as any).uiLayoutTree);
        logger.info(`[ScaffoldAssembly] Pre-emission UI verification: ${proof.certificate.status}`);
        (manifest.variables as any).layoutProof = proof;
        (manifest.variables as any).synthesizedCss = proof.repair?.cssStylesheet || "";
      }

      if ((manifest.variables as any)?.brandSeedHex) {
        const theme = WCAGTokenSynthesizer.synthesizeAccessiblePalette((manifest.variables as any).brandSeedHex);
        (manifest.variables as any).wcagTheme = theme;
      }

      await fs.mkdir(manifest.targetDir, { recursive: true });

      // 2. Process File Templates & AST Injections in Topological Order
      for (const pack of executionOrder) {
        logger.info(`[ScaffoldAssembly] Applying pack '${pack.id}'`);

        // A. Copy & Render Templates (Parallel Processing with Compiled Template Cache)
        if (pack.templates && pack.templates.length > 0) {
          await Promise.all(pack.templates.map(async tmpl => {
            let srcPath = (pack as any).packDir
              ? path.join((pack as any).packDir, "templates", tmpl.source)
              : path.join(process.cwd(), "packages/scaffold-registry", pack.category, pack.id === "ui-oddjob-design-system" ? "design-system" : pack.id, "templates", tmpl.source);

            const destPath = path.join(manifest.targetDir, tmpl.destination);
            await fs.mkdir(path.dirname(destPath), { recursive: true });

            let content = "";
            try {
              content = await fs.readFile(srcPath, "utf-8");
            } catch {
              content = `// Auto-generated module by pack ${pack.id}\n`;
            }

            const compiled = this.getCompiledTemplate(srcPath, content);
            const rendered = compiled({
              appName: manifest.appName,
              packId: pack.id,
              ...manifest.variables
            });

            await fs.writeFile(destPath, rendered, "utf-8");
          }));
        }

        // B. Apply AST & JSON Transformation Rules
        if (pack.inject && pack.inject.length > 0) {
          for (const rule of pack.inject) {
            const targetPath = path.join(manifest.targetDir, rule.target);
            await this.astEngine.createSnapshot(targetPath);
            await this.astEngine.applyRule(targetPath, rule);
          }
        }
      }

      // 3. Drop the X-Ray composition cache so the new components are picked up
      // on the next graph build. Skipped when the caller did not scope the
      // assembly to an org, since the cache is partitioned by organization.
      if (manifest.organizationId != null) {
        try {
          await xrayCompositionService.invalidateCache(manifest.appName, manifest.organizationId);
        } catch (err: any) {
          logger.warn(`[ScaffoldAssembly] X-Ray cache invalidation skipped: ${err.message}`);
        }
      }

      logger.info(`[ScaffoldAssembly] Assembly completed successfully for app '${manifest.appName}'`);
      return {
        success: true,
        appName: manifest.appName,
        targetDir: manifest.targetDir,
        executedPacks: executionOrder.map(p => p.id)
      };
    } catch (err: any) {
      logger.error(`[ScaffoldAssembly] Assembly failed: ${err.message}. Triggering rollback...`);
      await this.astEngine.rollback();

      return {
        success: false,
        appName: manifest.appName,
        targetDir: manifest.targetDir,
        executedPacks: [],
        error: err.message
      };
    }
  }
}

export const scaffoldAssemblyService = new ScaffoldAssemblyService();
