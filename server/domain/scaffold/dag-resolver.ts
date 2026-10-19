import type { PackManifest } from "@shared/schema/scaffold.js";
import type { BlueprintStage } from "@shared/schema/assembly-blueprint.js";

export type StageReadiness = "verified" | "active" | "ready" | "blocked";

export interface StageStatusReport {
  stage: BlueprintStage;
  readiness: StageReadiness;
  missingPrerequisites: string[];
}

export class DAGResolver {
  private registry: Map<string, PackManifest>;

  constructor(registryPacks: PackManifest[] = []) {
    this.registry = new Map(registryPacks.map(p => [p.id, p]));
  }

  // =========================================================================
  // PACK MANIFEST RESOLUTION
  // =========================================================================

  public resolveExecutionOrder(requestedPackIds: string[]): PackManifest[] {
    const selectedPacks = new Map<string, PackManifest>();

    const expandDependencies = (packId: string) => {
      if (selectedPacks.has(packId)) return;
      const pack = this.registry.get(packId);
      if (!pack) {
        throw new Error(`Scaffold pack not found in registry: '${packId}'`);
      }

      selectedPacks.set(packId, pack);

      for (const req of pack.requires) {
        expandDependencies(req);
      }
      if (pack.extends) {
        expandDependencies(pack.extends);
      }
    };

    for (const id of requestedPackIds) {
      expandDependencies(id);
    }

    const allPacks = Array.from(selectedPacks.values());
    this.validateConflicts(allPacks);
    return this.topologicalSortPacks(allPacks);
  }

  private validateConflicts(packs: PackManifest[]): void {
    const packIds = new Set(packs.map(p => p.id));
    for (const pack of packs) {
      for (const conflictId of pack.conflicts) {
        if (packIds.has(conflictId)) {
          throw new Error(
            `Scaffold conflict rule violation: Pack '${pack.id}' conflicts with '${conflictId}'`
          );
        }
      }
    }
  }

  private topologicalSortPacks(packs: PackManifest[]): PackManifest[] {
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const pack of packs) {
      inDegree.set(pack.id, 0);
      graph.set(pack.id, []);
    }

    for (const pack of packs) {
      const deps = [...pack.requires, ...(pack.extends ? [pack.extends] : [])];
      for (const dep of deps) {
        if (graph.has(dep)) {
          graph.get(dep)!.push(pack.id);
          inDegree.set(pack.id, (inDegree.get(pack.id) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    const resultOrder: PackManifest[] = [];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const pack = packs.find(p => p.id === currId)!;
      resultOrder.push(pack);

      for (const neighbor of graph.get(currId) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (resultOrder.length !== packs.length) {
      throw new Error("Circular dependency detected in scaffold manifest DAG resolution.");
    }

    return resultOrder;
  }

  // =========================================================================
  // BLUEPRINT STAGE RESOLUTION & READINESS
  // =========================================================================

  public resolveStageOrder(stages: BlueprintStage[]): BlueprintStage[] {
    const stageMap = new Map(stages.map(s => [s.id, s]));

    // Validate that all referenced prerequisites exist
    for (const stage of stages) {
      const requires = stage.requires || (stage as any).dependencies || [];
      const conflicts = stage.conflicts || [];
      for (const req of requires) {
        if (!stageMap.has(req)) {
          throw new Error(`Stage '${stage.id}' requires nonexistent prerequisite stage '${req}'`);
        }
      }
      for (const conflict of conflicts) {
        if (stageMap.has(conflict)) {
          throw new Error(`Blueprint stage conflict: '${stage.id}' conflicts with '${conflict}'`);
        }
      }
    }

    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const stage of stages) {
      inDegree.set(stage.id, 0);
      graph.set(stage.id, []);
    }

    for (const stage of stages) {
      const requires = stage.requires || (stage as any).dependencies || [];
      for (const req of requires) {
        graph.get(req)!.push(stage.id);
        inDegree.set(stage.id, (inDegree.get(stage.id) || 0) + 1);
      }
    }

    const queue: string[] = [];
    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    const resultOrder: BlueprintStage[] = [];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      resultOrder.push(stageMap.get(currId)!);

      for (const neighbor of graph.get(currId) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (resultOrder.length !== stages.length) {
      throw new Error("Circular dependency detected in Blueprint Stage DAG.");
    }

    return resultOrder;
  }

  public computeStageReadiness(
    stages: BlueprintStage[],
    verifiedStageIds: Set<string>,
    activeStageId?: string
  ): StageStatusReport[] {
    return stages.map(stage => {
      if (verifiedStageIds.has(stage.id)) {
        return { stage, readiness: "verified", missingPrerequisites: [] };
      }

      const requires = stage.requires || (stage as any).dependencies || [];
      const missing = requires.filter(reqId => !verifiedStageIds.has(reqId));
      if (missing.length > 0) {
        return { stage, readiness: "blocked", missingPrerequisites: missing };
      }

      if (activeStageId && stage.id === activeStageId) {
        return { stage, readiness: "active", missingPrerequisites: [] };
      }

      return { stage, readiness: "ready", missingPrerequisites: [] };
    });
  }
}
