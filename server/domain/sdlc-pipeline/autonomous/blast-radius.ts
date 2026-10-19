/**
 * Predictive Blast-Radius Scoping (Extension 2 — context_load phase)
 *
 * Traces the import graph to find, for each candidate target file, the upstream
 * dependants that import it (up to `dependencyTraceDepth` hops). Surfacing these
 * dependants lets the pipeline pre-empt downstream regressions: a dependant that
 * is already in the context is flagged `autoIncludedInContext: true`; one that
 * is not is a signal it should be pulled in.
 *
 * Pure, deterministic — computed from the dependency graph and the already
 * loaded relevant-file set. No filesystem access.
 */

import type {
  RelevantFile,
  DependencyGraph,
  BlastRadius,
  BlastRadiusScopedFile,
  BlastRadiusDependant,
} from "../core/types.js";

function riskFor(importType: BlastRadiusDependant["importType"], distance: number): BlastRadiusDependant["regressionRisk"] {
  if (importType === "type_only") return "low";
  if (importType === "dynamic") return "medium";
  // static
  return distance <= 1 ? "high" : "medium";
}

function riskWeight(risk: BlastRadiusDependant["regressionRisk"]): number {
  switch (risk) {
    case "high": return 1;
    case "medium": return 0.6;
    case "low": return 0.3;
  }
}

export interface BlastRadiusResult {
  blastRadius: BlastRadius;
  /** relevantFiles with `inclusionReason` annotated (objective_match | blast_radius). */
  relevantFiles: RelevantFile[];
}

/**
 * Compute the blast radius for the loaded relevant files.
 *
 * @param relevantFiles  the objective-selected target candidates (with content)
 * @param dependencyGraph the repo import graph (edges: source imports target)
 * @param traceDepth      max hops to trace upstream dependants
 */
export function computeBlastRadius(
  relevantFiles: RelevantFile[],
  dependencyGraph: DependencyGraph,
  traceDepth: number
): BlastRadiusResult {
  // Reverse adjacency: for a file, who imports it (immediate upstream dependants).
  const dependantsOf = new Map<string, Array<{ filePath: string; importType: BlastRadiusDependant["importType"] }>>();
  for (const edge of dependencyGraph.edges) {
    if (!dependantsOf.has(edge.target)) dependantsOf.set(edge.target, []);
    dependantsOf.get(edge.target)!.push({ filePath: edge.source, importType: edge.importType });
  }

  const relevantPaths = new Set(relevantFiles.map((f) => f.path));
  const depth = Math.max(0, traceDepth);

  // Files that are an upstream dependant of some other target — used to annotate
  // inclusionReason and to weight aggregate regression risk.
  const dependantPaths = new Set<string>();
  const allDependantRisks: BlastRadiusDependant["regressionRisk"][] = [];

  const scopedFiles: BlastRadiusScopedFile[] = relevantFiles.map((target) => {
    const seen = new Set<string>([target.path]);
    const collected: BlastRadiusDependant[] = [];

    // Breadth-first trace up the dependant chain to `depth` hops.
    let frontier: string[] = [target.path];
    for (let distance = 1; distance <= depth && frontier.length > 0; distance++) {
      const next: string[] = [];
      for (const file of frontier) {
        for (const dep of dependantsOf.get(file) ?? []) {
          if (seen.has(dep.filePath)) continue;
          seen.add(dep.filePath);
          const regressionRisk = riskFor(dep.importType, distance);
          collected.push({
            filePath: dep.filePath,
            importType: dep.importType,
            distance,
            regressionRisk,
          });
          allDependantRisks.push(regressionRisk);
          dependantPaths.add(dep.filePath);
          next.push(dep.filePath);
        }
      }
      frontier = next;
    }

    return {
      targetFile: target.path,
      operationHint: "modify",
      upstreamDependants: collected,
      autoIncludedInContext: collected.some((d) => relevantPaths.has(d.filePath)),
    };
  });

  const totalDependantsPulled = allDependantRisks.length;
  const regressionRiskScore =
    totalDependantsPulled > 0
      ? Number(
          (allDependantRisks.reduce((s, r) => s + riskWeight(r), 0) / totalDependantsPulled).toFixed(4)
        )
      : 0;

  const annotatedFiles: RelevantFile[] = relevantFiles.map((f) => ({
    ...f,
    inclusionReason: dependantPaths.has(f.path) ? "blast_radius" : "objective_match",
  }));

  return {
    blastRadius: {
      traceDepth: depth,
      scopedFiles,
      totalDependantsPulled,
      regressionRiskScore,
    },
    relevantFiles: annotatedFiles,
  };
}
