import React from "react";

/**
 * Shared lazy registry of all packaged UI blocks, resolvable by module name.
 *
 * Vite requires the import.meta.glob call to be written literally, and every
 * packaged block is a default export. This is the single source of truth shared
 * by the component gallery (live previews) and the copilot's InstantAppRenderer
 * (instant apps), so both resolve blocks identically.
 *
 * Note: this file is `.ts` (no JSX), so it is NOT matched by the `./*.tsx` glob.
 */
const packagedModules = import.meta.glob([
  "./*.tsx",
  "!./*.test.tsx",
  "!./*.spec.tsx",
]) as Record<
  string,
  () => Promise<{ default: React.ComponentType<any> }>
>;

const packagedByName: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {};
for (const [filePath, importer] of Object.entries(packagedModules)) {
  if (filePath.includes(".test.") || filePath.includes(".spec.")) continue;
  const base = filePath.split(/[\\/]/).pop()!.replace(/\.tsx$/, "");
  packagedByName[base] = importer;
}

// Explicit fallback bindings for dynamically registered builder pods
if (!packagedByName["OntologyObjectTypePod"]) {
  packagedByName["OntologyObjectTypePod"] = () => import("./OntologyObjectTypePod.js");
}
if (!packagedByName["OntologyActionTypePod"]) {
  packagedByName["OntologyActionTypePod"] = () => import("./OntologyActionTypePod.js");
}
if (!packagedByName["ScribeStudioPod"]) {
  packagedByName["ScribeStudioPod"] = () => import("./ScribeStudioPod.js");
}
if (!packagedByName["AppStudioPod"]) {
  packagedByName["AppStudioPod"] = () => import("./AppStudioPod.js");
}
if (!packagedByName["FormStudioPod"]) {
  packagedByName["FormStudioPod"] = () => import("./FormStudioPod.js");
}
if (!packagedByName["ProjectPlanningPod"]) {
  packagedByName["ProjectPlanningPod"] = () => import("./ProjectPlanningPod.js");
}
if (!packagedByName["ProjectStudioPod"]) {
  packagedByName["ProjectStudioPod"] = () => import("./ProjectStudioPod.js");
}
if (!packagedByName["DecisionMatrixPod"]) {
  packagedByName["DecisionMatrixPod"] = () => import("./DecisionMatrixPod.js");
}
if (!packagedByName["CrewDecisionMatrixRail"]) {
  packagedByName["CrewDecisionMatrixRail"] = () => import("./CrewDecisionMatrixRail.js");
}
if (!packagedByName["AgentUpskillingPod"]) {
  packagedByName["AgentUpskillingPod"] = () => import("./AgentUpskillingPod.js");
}
if (!packagedByName["ToolScaffoldPod"]) {
  packagedByName["ToolScaffoldPod"] = () => import("./ToolScaffoldPod.js");
}
if (!packagedByName["MediaStudioPod"]) {
  packagedByName["MediaStudioPod"] = () => import("./MediaStudioPod.js");
}
if (!packagedByName["MediaConfigPod"]) {
  packagedByName["MediaConfigPod"] = () => import("./MediaConfigPod.js");
}
if (!packagedByName["ComputerUseStudioPod"]) {
  packagedByName["ComputerUseStudioPod"] = () => import("./ComputerUseStudioPod.js");
}
if (!packagedByName["FlowStudioPod"]) {
  packagedByName["FlowStudioPod"] = () => import("./FlowStudioPod.js");
}
if (!packagedByName["SignalStudioPod"]) {
  packagedByName["SignalStudioPod"] = () => import("./SignalStudioPod.js");
}
if (!packagedByName["PredictionStudioPod"]) {
  packagedByName["PredictionStudioPod"] = () => import("./PredictionStudioPod.js");
}
if (!packagedByName["MapPod"]) {
  packagedByName["MapPod"] = () => import("./MapPod.js");
}
if (!packagedByName["GeneratedImageCardPod"]) {
  packagedByName["GeneratedImageCardPod"] = () => import("./GeneratedImageCardPod.js");
}
if (!packagedByName["FinancialReportCardPod"]) {
  packagedByName["FinancialReportCardPod"] = () => import("./FinancialReportCardPod.js");
}

const lazyCache: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {};

/** Resolve a packaged block by module name to a lazy component, or null if unknown. */
export function getLazyPackagedComponent(
  moduleName: string,
): React.LazyExoticComponent<React.ComponentType<any>> | null {
  if (!moduleName || !packagedByName[moduleName]) return null;
  if (!lazyCache[moduleName]) {
    lazyCache[moduleName] = React.lazy(async () => {
      const mod: any = await packagedByName[moduleName]();
      const Comp = mod.default ?? mod[moduleName] ?? Object.values(mod).find((v) => typeof v === "function");
      if (!Comp) throw new Error(`No renderable export in ${moduleName}`);
      return { default: Comp as React.ComponentType<any> };
    });
  }
  return lazyCache[moduleName];
}

/** All packaged block module names (sorted). */
export function packagedComponentNames(): string[] {
  return Object.keys(packagedByName).sort();
}
