import { searchComponentIndex } from "../../tools/v1/capabilities/component-index.js";
import { createLogger } from "@server/utils/logger.js";
import type { RepositoryContext } from "../core/types.js";

const logger = createLogger("ComponentLookupService");

export interface ComponentManifestItem {
  name: string;
  category: string;
  importPath: string;
  exportType: string;
  propSchema: any;
  codeSnippet: string;
  effectivenessScore: number;
}

export interface AssemblyManifestArtifact {
  matchedComponents: ComponentManifestItem[];
  componentImports: string[];
  suggestedBlueprints: string[];
  assemblyContext: {
    targetLanguages: string[];
    relevantFilesCount: number;
    recommendedPatterns: string[];
  };
}

/**
 * Terms that mean the thing being built has a geographic dimension.
 *
 * Kept as whole-word matches. A substring test makes "region" fire on "regional
 * manager" and, worse, "map" fire on "roadmap" and "sitemap" — which would drag
 * a map component into every planning app that exists.
 */
const SPATIAL_TERMS = [
    "spatial", "geographic", "geospatial", "geofence", "geofencing",
    "map", "maps", "mapping", "location", "locations", "gps", "h3",
    "region", "regions", "zone", "zones", "corridor", "corridors",
    "territory", "territories", "route", "routes", "routing",
    "fleet", "logistics", "dispatch", "latitude", "longitude", "coordinates",
    "proximity", "radius", "boundary", "boundaries",
];

/** Search terms used to pull spatial components out of the index, best first. */
const SPATIAL_COMPONENT_QUERIES = ["map", "spatial", "location", "geo"];

export interface SpatialRequirement {
    required: boolean;
    /** Which terms in the objective triggered it — surfaced so the choice is auditable. */
    matchedTerms: string[];
}

/**
 * Does this objective describe work with a geographic dimension?
 *
 * Deliberately a keyword test rather than a model call: it runs on the assembly
 * hot path, it must behave identically when the AI backend is degraded, and a
 * false positive costs one extra component in the manifest while a model call
 * costs a round trip on every assembly.
 */
export function detectSpatialRequirement(objective?: string): SpatialRequirement {
    if (!objective) return { required: false, matchedTerms: [] };
    const words = new Set(
        objective
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean),
    );
    const matchedTerms = SPATIAL_TERMS.filter(term => words.has(term));
    return { required: matchedTerms.length > 0, matchedTerms };
}

export class ComponentLookupService {
  /**
   * Executes the component_lookup phase.
   * Reads repository context, determines required UI/Pattern components,
   * queries component_index, and returns an assembly manifest artifact.
   */
  async resolveAssemblyComponents(
    repositoryContext: RepositoryContext,
    objective?: string
  ): Promise<AssemblyManifestArtifact> {
    logger.info(`[ComponentLookupService] Resolving components for objective: "${objective || 'Standard Assembly'}"`);

    // Extract languages and relevant files
    const primaryLang = repositoryContext.languageMetadata?.primaryLanguage || "typescript";
    const targetLanguages = [primaryLang, ...(repositoryContext.languageMetadata?.frameworks || [])];
    const relevantFilesCount = repositoryContext.relevantFiles?.length || 0;

    // Search Component Index for relevant high-scoring components
    const matchedComponents: ComponentManifestItem[] = [];
    const componentImports: string[] = [];
    const suggestedBlueprints: string[] = [];

    /*
      Preferred categories give the manifest a spread rather than four variants of
      the same thing. They are a PREFERENCE, not a filter.

      They used to be the only query, and `searchComponentIndex` matches category
      with `eq`, so when the index drifted away from this taxonomy the lookup
      silently matched nothing: every one of the 36 live rows is `ui-block`, written
      by the forge-ui harvester, while this list came from a seed script that never
      ran against it. The manifest came back empty every time, and because
      recordComponentAssemblyFeedback() returns early on an empty manifest, the
      component feedback loop could never record an outcome — the assembly stack
      appeared to work while selecting nothing at all.

      So: try the preferred spread, then top up category-agnostically. That holds
      whichever taxonomy the index happens to carry, which is the property the
      original list lacked.
    */
    const PREFERRED_CATEGORIES = ["ui-data-viz", "ui-ai-workflow", "ui-layout", "pattern-auth"];
    const PER_CATEGORY = 3;
    const MIN_EFFECTIVENESS = 4.0;
    const TARGET_COMPONENTS = PREFERRED_CATEGORIES.length * PER_CATEGORY;

    const collected: Awaited<ReturnType<typeof searchComponentIndex>> = [];
    const seenNames = new Set<string>();

    for (const cat of PREFERRED_CATEGORIES) {
      const components = await searchComponentIndex({
        category: cat,
        minEffectiveness: MIN_EFFECTIVENESS,
        limit: PER_CATEGORY,
      });
      for (const comp of components) {
        if (seenNames.has(comp.name)) continue;
        seenNames.add(comp.name);
        collected.push(comp);
      }
    }

    const fromPreferred = collected.length;

    /*
      Spatial components, when the objective calls for them.

      This runs BEFORE the generic top-up so a spatial app actually gets its map
      component rather than losing the slot to whatever sorts highest overall.
      It is additive: spatial work still wants the ordinary data and layout
      components, so this supplements the manifest rather than replacing it.

      Note what is not here: no invented catalogue. The only spatial components
      offered are ones already in the index (today that is Tactical Map Control),
      found by search. Seeding placeholder rows with assumed effectiveness scores
      would put unmeasured numbers into the column whose entire purpose is to
      record measured outcomes.
    */
    const spatial = detectSpatialRequirement(objective);
    if (spatial.required) {
      for (const term of SPATIAL_COMPONENT_QUERIES) {
        const found = await searchComponentIndex({
          query: term,
          minEffectiveness: MIN_EFFECTIVENESS,
          limit: PER_CATEGORY,
        });
        for (const comp of found) {
          if (seenNames.has(comp.name)) continue;
          seenNames.add(comp.name);
          collected.push(comp);
        }
      }
      logger.info(
        `[ComponentLookupService] Spatial requirement detected (${spatial.matchedTerms.join(", ")}); ` +
          `manifest now carries ${collected.length} component(s).`,
      );
    }

    if (collected.length < TARGET_COMPONENTS) {
      const topUp = await searchComponentIndex({
        minEffectiveness: MIN_EFFECTIVENESS,
        limit: TARGET_COMPONENTS,
      });
      for (const comp of topUp) {
        if (collected.length >= TARGET_COMPONENTS) break;
        if (seenNames.has(comp.name)) continue;
        seenNames.add(comp.name);
        collected.push(comp);
      }
      logger.info(
        `[ComponentLookupService] Preferred categories yielded ${fromPreferred} component(s); ` +
          `topped up to ${collected.length} from the index at large.`,
      );
    }

    {
      for (const comp of collected) {
        matchedComponents.push({
          name: comp.name,
          category: comp.category,
          importPath: comp.importPath,
          exportType: comp.exportType,
          propSchema: comp.propSchema,
          codeSnippet: comp.codeSnippet,
          effectivenessScore: comp.effectivenessScore
        });

        const importStmt = comp.exportType === "default" 
          ? `import ${comp.name} from "${comp.importPath}";`
          : `import { ${comp.name} } from "${comp.importPath}";`;
        
        if (!componentImports.includes(importStmt)) {
          componentImports.push(importStmt);
        }

        if (comp.blueprintTemplate) {
          suggestedBlueprints.push(comp.blueprintTemplate);
        }
      }
    }

    logger.info(`[ComponentLookupService] Assembly lookup completed. Matched ${matchedComponents.length} components.`);

    return {
      matchedComponents,
      componentImports,
      suggestedBlueprints,
      assemblyContext: {
        targetLanguages,
        relevantFilesCount,
        recommendedPatterns: matchedComponents.map(c => c.name)
      }
    };
  }

  /**
   * Updates component usage statistics and re-calculates effectiveness scores
   * post-verification (Phase 4 Closed-Loop Feedback).
   */
  async recordAssemblyFeedback(componentName: string, verificationSuccess: boolean): Promise<void> {
    const { componentIndex } = await import("@shared/schema/index.js");
    const { eq, sql } = await import("drizzle-orm");
    const { db } = await import("@server/database_service.js");

    logger.info(`[ComponentLookupService] Recording feedback for ${componentName} (success=${verificationSuccess})`);

    const [existing] = await db.select().from(componentIndex).where(eq(componentIndex.componentName, componentName)).limit(1);
    if (!existing) return;

    const priorRuns = existing.verificationRunCount || 0;
    const runCount = priorRuns + 1;

    // The running average is over *verification runs*, not assemblies.
    // total_assemble_count also counts instant-app renders, which carry no
    // pass/fail signal, so using it here diluted real outcomes.
    //
    // The first recorded outcome replaces the seeded default outright rather
    // than averaging against it — otherwise a component's very first failure
    // would still report ~0% wrong, blended with a 100% that was never measured.
    const priorRate = priorRuns === 0 ? null : Number(existing.verificationSuccessRate ?? 100);
    const observed = verificationSuccess ? 100 : 0;
    const newRate =
      priorRate === null
        ? observed
        : Math.round(((priorRate * priorRuns + observed) / runCount) * 100) / 100;

    const newScore = Math.round((newRate / 20) * 100) / 100; // Map 0-100% to 0-5.00 stars

    await db.update(componentIndex)
      .set({
        totalAssembleCount: (existing.totalAssembleCount || 0) + 1,
        verificationRunCount: runCount,
        verificationSuccessRate: String(newRate),
        effectivenessScore: String(newScore),
        updatedAt: new Date(),
      })
      .where(eq(componentIndex.componentName, componentName));

    // Emit CAPABILITY_SOLIDIFIED event if component reaches gold standard.
    // Gated on verification runs, not assemblies — otherwise a component could
    // be declared "gold standard" off render counts it was never verified by.
    if (newRate >= 98 && runCount >= 5) {
      const { eventStream } = await import("../../core/infrastructure/event-stream.service.js");
      await eventStream.publish(
        "CAPABILITY_SOLIDIFIED",
        {
          componentName,
          effectivenessScore: newScore,
          verificationSuccessRate: newRate,
          verificationRunCount: runCount,
          solidifiedAt: new Date().toISOString(),
        },
        { componentName },
        "antigravity_assembly_engine"
      ).catch(err => logger.warn(`Failed to publish CAPABILITY_SOLIDIFIED event: ${err.message}`));
    }
  }
}

export const componentLookupService = new ComponentLookupService();

