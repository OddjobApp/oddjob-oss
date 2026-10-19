import { db } from "@server/database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { eq, gte, ilike, or, and, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { TUTORIAL_SNIPPETS } from "@shared/tutorials/registry.js";

const logger = createLogger("ComponentIndexCapability");

/*
  Tutorial linkage.

  Three vocabularies name the same component and none of them agree:

    component_index.component_name   "Platform Agent Swarm"      (title case)
    component_index.import_path      ".../PlatformAgentSwarmBlock" (pascal case)
    TutorialSnippet.componentId      "platform-agent-swarm"      (kebab case)
    TutorialSnippet.sourceFile       ".../PlatformAgentSwarmBlock.tsx"

  So the join needs one canonical form both sides reduce to: lowercase, strip
  everything that is not a letter or digit, then drop a trailing "block" or
  "pod" because the index name omits the suffix the filename carries.

  This replaces a match on `sourceFile.includes(componentName)` in the gallery,
  which could never fire -- a file path does not contain "Platform Agent Swarm".
*/
export function canonicalComponentKey(value: string): string {
    const base = value.split("/").pop() ?? value;
    return base
        .toLowerCase()
        .replace(/.(tsx?|jsx?)$/, "")
        .replace(/[^a-z0-9]/g, "")
        .replace(/(block|pod)$/, "");
}

/** canonical key -> snippet ids, built once from the registry. */
const SNIPPET_IDS_BY_KEY: ReadonlyMap<string, string[]> = (() => {
    const byKey = new Map<string, string[]>();
    const add = (raw: string | undefined, snippetId: string) => {
        if (!raw) return;
        const key = canonicalComponentKey(raw);
        if (!key) return;
        const ids = byKey.get(key) ?? [];
        if (!ids.includes(snippetId)) ids.push(snippetId);
        byKey.set(key, ids);
    };
    for (const snippet of Object.values(TUTORIAL_SNIPPETS)) {
        add(snippet.componentId, snippet.id);
        add(snippet.sourceFile, snippet.id);
    }
    return byKey;
})();

/**
 * Snippets that walk a user through this component, matched on either the
 * index's display name or the identifier in its import path.
 *
 * Empty for every row today: the index holds mountable pods
 * (@domain-ui/packaged/*) while all 11 snippets target app-shell pages and
 * chrome (CommandPalette, Header, KnowledgeGarden). The two sets are disjoint,
 * so this stays empty until a snippet is written against a packaged pod.
 */
export function tutorialSnippetsForComponent(componentName: string, importPath: string): string[] {
    const fromName = SNIPPET_IDS_BY_KEY.get(canonicalComponentKey(componentName)) ?? [];
    const fromPath = SNIPPET_IDS_BY_KEY.get(canonicalComponentKey(importPath)) ?? [];
    return [...new Set([...fromName, ...fromPath])];
}

export interface SearchComponentIndexParams {
  category?: string;
  query?: string;
  minEffectiveness?: number;
  limit?: number;
  organizationId?: number;
}

export async function searchComponentIndex(params: SearchComponentIndexParams) {
  const { category, query, minEffectiveness = 0.0, limit = 20, organizationId } = params;
  logger.info(`[ComponentIndexCapability] Searching index (category=${category || 'all'}, query=${query || 'none'}, minEff=${minEffectiveness}, orgId=${organizationId || 'global'})`);

    let conditions: any[] = [eq(componentIndex.isApprovedForAssembly, true)];

    if (category && category !== "all") {
        conditions.push(eq(componentIndex.componentCategory, category));
    }

    if (query) {
        /*
          ilike, not like. Every component name in the index is Title Case
          ("Tactical Map Control", "Platform Dataset Chart"), and `like` is
          case-sensitive in Postgres, so a lowercase term — which is what an agent
          or a keyword extracted from an objective actually supplies — matched
          nothing at all. `%map%` found 0 rows where `%Map%` found 1. The search
          reported an empty index rather than a failed match, so it read as
          "no such component exists".
        */
        conditions.push(
            or(
                ilike(componentIndex.componentName, `%${query}%`),
                ilike(componentIndex.importPath, `%${query}%`),
                // No usage-summary column exists; the canonical usage snippet is
                // the closest searchable prose the table carries.
                ilike(componentIndex.codeSnippet, `%${query}%`),
            )
        );
    }

    if (minEffectiveness !== undefined) {
        /*
          The floor applies only to components that have actually been measured.

          effectiveness_score is seeded at 5.00 and stays there until
          recordAssemblyFeedback writes a verification outcome, so a bare
          `score >= 4.5` admitted every unmeasured component as though it had
          scored top marks — the filter looked like a quality gate while
          ranking seeds above real measurements. Today that is every row in the
          table: 36 components, none with a verification run.

          Excluding unmeasured rows instead would return nothing at all and
          strand the assembly pipeline, so they pass and are marked
          `isMeasured: false` in the result. The predicate therefore means
          "drop what we have measured and found wanting", which is the only
          claim the data supports.
        */
        conditions.push(
            or(
                eq(componentIndex.verificationRunCount, 0),
                gte(componentIndex.effectivenessScore, String(minEffectiveness)),
            )
        );
    }

    const results = await db.select()
        .from(componentIndex)
        .where(and(...conditions))
        .limit(limit);

  const measuredCount = results.filter(r => (r.verificationRunCount ?? 0) > 0).length;
  logger.info(
    `[ComponentIndexCapability] Found ${results.length} components ` +
    `(${measuredCount} measured, ${results.length - measuredCount} unmeasured)`
  );

  return results.map(row => {
    // Until a verification outcome has actually been recorded, the stored score
    // is the seeded default (5.00 / 100%), not a measurement. Callers must be
    // able to tell the two apart rather than rendering a seed as quality.
    const verificationRuns = row.verificationRunCount ?? 0;
    const isMeasured = verificationRuns > 0;

    return {
      name: row.componentName,
      category: row.componentCategory,
      exportType: row.exportType,
      importPath: row.importPath,
      packageSource: row.packageSource,
      propSchema: row.propSchema,
      dependencies: row.dependencies,
      codeSnippet: row.codeSnippet,
      blueprintTemplate: row.blueprintTemplate,
      effectivenessScore: Number(row.effectivenessScore),
      verificationSuccessRate: Number(row.verificationSuccessRate),
      assembleCount: row.totalAssembleCount ?? 0,
      verificationRuns,
      isMeasured,
      tutorialSnippets: tutorialSnippetsForComponent(row.componentName, row.importPath ?? ""),
    };
  });
}

export async function getComponentBlueprint(componentName: string) {
  logger.info(`[ComponentIndexCapability] Fetching blueprint for ${componentName}`);
  
  const [component] = await db.select()
    .from(componentIndex)
    .where(eq(componentIndex.componentName, componentName))
    .limit(1);

  if (!component) {
    return null;
  }

  return {
    name: component.componentName,
    importPath: component.importPath,
    exportType: component.exportType,
    propSchema: component.propSchema,
    codeSnippet: component.codeSnippet,
    blueprintTemplate: component.blueprintTemplate
  };
}
