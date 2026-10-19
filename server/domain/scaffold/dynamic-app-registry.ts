import { Router } from "express";
import type { LayoutNode, ProofCertificate, SynthesizedDimensionRule } from "./formal/types.js";
import type { SynthesizedPalette } from "./formal/wcag-token-synthesizer.js";

export interface DynamicallyAssembledApp {
  slug: string;
  /**
   * Owning organization. The registry is one process-wide map, so without this
   * every tenant saw — and could unmount — every other tenant's apps.
   */
  organizationId: number | null;
  name: string;
  description?: string;
  version: string;
  createdAt: string;
  executedPacks: string[];
  layoutTree: LayoutNode;
  proofCertificate: ProofCertificate;
  synthesizedRules: SynthesizedDimensionRule[];
  themeTokens: SynthesizedPalette;
  generatedTsxComponent: string;
  generatedCss: string;
  router: Router;
  customData?: Record<string, unknown>;
}

export class DynamicAppRegistry {
  private static instance: DynamicAppRegistry;
  private apps: Map<string, DynamicallyAssembledApp> = new Map();

  public static getInstance(): DynamicAppRegistry {
    if (!DynamicAppRegistry.instance) {
      DynamicAppRegistry.instance = new DynamicAppRegistry();
    }
    return DynamicAppRegistry.instance;
  }

  public registerApp(app: DynamicallyAssembledApp): void {
    this.apps.set(app.slug.toLowerCase(), app);
  }

  /**
   * `organizationId` is a filter, not decoration: pass it and an app belonging
   * to another organization reads as absent, which is what the routes need to
   * answer 404 rather than hand it over. Omit it only where there is no caller
   * to scope to — the preview dispatcher, which serves whatever was mounted.
   */
  public getApp(slug: string, organizationId?: number | null): DynamicallyAssembledApp | undefined {
    const app = this.apps.get(slug.toLowerCase());
    if (!app) return undefined;
    if (organizationId !== undefined && app.organizationId !== organizationId) return undefined;
    return app;
  }

  public getAppRouter(slug: string): Router | undefined {
    const app = this.apps.get(slug.toLowerCase());
    return app?.router;
  }

  public listApps(organizationId?: number | null): Array<Omit<DynamicallyAssembledApp, "router">> {
    return Array.from(this.apps.values())
      .filter((app) => organizationId === undefined || app.organizationId === organizationId)
      .map(({ router, ...rest }) => rest);
  }

  public removeApp(slug: string, organizationId?: number | null): boolean {
    if (!this.getApp(slug, organizationId)) return false;
    return this.apps.delete(slug.toLowerCase());
  }

  public clear(): void {
    this.apps.clear();
  }
}

export const dynamicAppRegistry = DynamicAppRegistry.getInstance();
