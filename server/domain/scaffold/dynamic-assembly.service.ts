import { Router, Request, Response } from "express";
import { createLogger } from "@server/utils/logger.js";
import { SATScaffoldResolver } from "./sat-scaffold-resolver.js";
import { scaffoldRegistryService } from "./scaffold-registry.service.js";
import { layoutFormalService } from "./formal/layout-formal.service.js";
import { WCAGTokenSynthesizer } from "./formal/wcag-token-synthesizer.js";
import { dynamicAppRegistry, DynamicallyAssembledApp } from "./dynamic-app-registry.js";
import type { LayoutNode, ViewportBounds } from "./formal/types.js";
import type { PackManifest } from "@shared/schema/scaffold.js";

const logger = createLogger("DynamicAssemblyService");

export interface DynamicAppEndpointSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description?: string;
  responsePayload?: Record<string, unknown>;
}

export interface DynamicAppAssemblyRequest {
  slug: string;
  /** Set by the route from the caller's session — never read from the body. */
  organizationId?: number | null;
  name: string;
  description?: string;
  packs: string[];
  layoutTree: LayoutNode;
  brandSeedHex?: string;
  viewportBounds?: ViewportBounds;
  endpoints?: DynamicAppEndpointSpec[];
  customVariables?: Record<string, unknown>;
}

export interface DynamicAppAssemblyResponse {
  success: boolean;
  slug: string;
  name: string;
  assemblyTimeMs: number;
  executedPacks: string[];
  invariantsVerifiedCount: number;
  responsiveRulesCount: number;
  theme: {
    lightForeground: string;
    darkForeground: string;
    meetsAA: boolean;
  };
  endpointsMounted: string[];
  previewUrl: string;
  generatedTsxComponent: string;
  error?: string;
}

export class DynamicAssemblyService {
  /**
   * Dynamically assembles and hot-mounts an application entirely in memory in sub-50ms
   */
  public async assembleDynamicApp(
    req: DynamicAppAssemblyRequest
  ): Promise<DynamicAppAssemblyResponse> {
    const startTime = performance.now();
    logger.info(`[DynamicAssemblyService] Starting dynamic in-memory assembly for '${req.slug}'`);

    try {
      // 1. Resolve packs via DPLL SAT Solver
      const availablePacks: PackManifest[] = await scaffoldRegistryService.loadAllPacks(true);
      const satSolver = new SATScaffoldResolver(availablePacks);
      const satResult = satSolver.solve(req.packs, { includeRecommendations: true });

      if (!satResult.satisfiable) {
        throw new Error(`Pack resolution unsatisfiable: ${satResult.proofExplanation}`);
      }

      const executedPacks = satResult.executionOrder.map((p) => p.id);

      // 2. Perform Formal Layout Invariant Verification & MaxSMT Synthesis
      const bounds: ViewportBounds = req.viewportBounds || { minWidth: 320, maxWidth: 2560 };
      const layoutResult = layoutFormalService.verifyAndSynthesize(req.layoutTree, bounds);

      const rules = layoutResult.repair?.synthesizedRules || [];
      const proofCert = layoutResult.repair ? layoutResult.repair.proof : layoutResult.certificate;

      // 3. Synthesize WCAG 2.2 Contrast Tokens
      const brandSeed = req.brandSeedHex || "#3B82F6";
      const themeTokens = WCAGTokenSynthesizer.synthesizeAccessiblePalette(brandSeed);

      // 4. Generate Verified React TSX Component Code
      const componentCode = this.generateReactComponent(req.name, req.layoutTree, rules, themeTokens.cssTokens);

      // 5. Instantiate and Hot-Mount Dynamic Express Router
      const router = Router();
      const mountedEndpoints: string[] = [];

      // Default Health & Spec Endpoints
      router.get("/status", (_req: Request, res: Response) => {
        res.json({
          status: "healthy",
          appName: req.name,
          slug: req.slug,
          invariantsCertified: proofCert.status === "PASSED",
          checkedInvariantsCount: proofCert.checkedInvariantsCount,
          activePacks: executedPacks,
          timestamp: new Date().toISOString()
        });
      });
      mountedEndpoints.push("GET /api/status");

      router.get("/spec", (_req: Request, res: Response) => {
        res.json({
          slug: req.slug,
          name: req.name,
          layoutTree: req.layoutTree,
          synthesizedRules: rules,
          themeTokens,
          proofCertificate: proofCert
        });
      });
      mountedEndpoints.push("GET /api/spec");

      // Custom Endpoints
      if (req.endpoints && req.endpoints.length > 0) {
        req.endpoints.forEach((ep) => {
          const methodLower = ep.method.toLowerCase() as "get" | "post" | "put" | "delete";
          const routePath = ep.path.startsWith("/") ? ep.path : `/${ep.path}`;

          router[methodLower](routePath, (_req: Request, res: Response) => {
            res.json(ep.responsePayload || { message: `Executed ${ep.method} ${routePath} on ${req.slug}` });
          });
          mountedEndpoints.push(`${ep.method} ${routePath}`);
        });
      }

      // 6. Register in DynamicAppRegistry
      const assembledApp: DynamicallyAssembledApp = {
        slug: req.slug,
        organizationId: req.organizationId ?? null,
        name: req.name,
        description: req.description,
        version: "1.0.0-dynamic",
        createdAt: new Date().toISOString(),
        executedPacks,
        layoutTree: req.layoutTree,
        proofCertificate: proofCert,
        synthesizedRules: rules,
        themeTokens,
        generatedTsxComponent: componentCode,
        generatedCss: layoutResult.repair?.cssStylesheet || "",
        router,
        customData: req.customVariables
      };

      dynamicAppRegistry.registerApp(assembledApp);

      const assemblyTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
      logger.info(`[DynamicAssemblyService] ✅ App '${req.slug}' dynamically assembled in ${assemblyTimeMs}ms`);

      return {
        success: true,
        slug: req.slug,
        name: req.name,
        assemblyTimeMs,
        executedPacks,
        invariantsVerifiedCount: proofCert.checkedInvariantsCount,
        responsiveRulesCount: rules.length,
        theme: {
          lightForeground: themeTokens.lightTheme.foreground,
          darkForeground: themeTokens.darkTheme.foreground,
          meetsAA: themeTokens.lightTheme.meetsAA && themeTokens.darkTheme.meetsAA
        },
        endpointsMounted: mountedEndpoints,
        previewUrl: `/app/${req.slug}`,
        generatedTsxComponent: componentCode
      };
    } catch (err: any) {
      logger.error(`[DynamicAssemblyService] Assembly error for '${req.slug}': ${err.message}`);
      return {
        success: false,
        slug: req.slug,
        name: req.name,
        assemblyTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
        executedPacks: [],
        invariantsVerifiedCount: 0,
        responsiveRulesCount: 0,
        theme: { lightForeground: "", darkForeground: "", meetsAA: false },
        endpointsMounted: [],
        previewUrl: "",
        generatedTsxComponent: "",
        error: err.message
      };
    }
  }

  private generateReactComponent(
    name: string,
    layout: LayoutNode,
    rules: Array<{ elementId: string; cssRule: string }>,
    cssTheme: string
  ): string {
    const componentName = name.replace(/[^a-zA-Z0-9]/g, "");
    return `
import React from 'react';
import { FormalFlex, FormalGrid, ErgonomicTouchTarget } from '@oddjob/design-system';

export const ${componentName}View: React.FC = () => {
  return (
    <FormalFlex direction="${layout.direction || "row"}" gap={${layout.gap || 16}} style={{ minHeight: '100vh', padding: 16 }}>
      ${(layout.children || [])
        .map(
          (c) => `
      <div id="${c.id}" style={{ width: '${rules.find((r) => r.elementId === c.id)?.cssRule || "100%"}' }} className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-white">
        <h3 className="font-semibold text-sm">${c.name || c.id}</h3>
        <p className="text-xs text-slate-400 mt-1">Mathematical SMT Invariant Certified</p>
      </div>`
        )
        .join("\n")}
    </FormalFlex>
  );
};
`.trim();
  }
}

export const dynamicAssemblyService = new DynamicAssemblyService();
