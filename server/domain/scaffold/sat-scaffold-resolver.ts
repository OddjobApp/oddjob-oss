/**
 * SAT / MaxSAT Scaffold Pack & Feature Solver
 * Solves complex dependency configurations, optional packages, version constraints,
 * and mutually exclusive conflicts using DPLL and Pseudo-Boolean optimization.
 */

import type { PackManifest } from "@shared/schema/scaffold.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SATScaffoldResolver");

export type Literal = number; // positive for variable, negative for negation
export type Clause = Literal[];

export interface SATResolutionResult {
  satisfiable: boolean;
  selectedPacks: PackManifest[];
  unresolvedDependencies: string[];
  conflictsDetected: Array<{ packA: string; packB: string }>;
  executionOrder: PackManifest[];
  proofExplanation: string;
}

export class SATScaffoldResolver {
  private registry: Map<string, PackManifest>;
  private varToPack: Map<number, string>;
  private packToVar: Map<string, number>;
  private varCounter: number;

  constructor(registryPacks: PackManifest[] = []) {
    this.registry = new Map(registryPacks.map(p => [p.id, p]));
    this.varToPack = new Map();
    this.packToVar = new Map();
    this.varCounter = 1;

    // Index all known packs to integer variables
    this.registry.forEach((_, id) => {
      this.getOrCreateVar(id);
    });
  }

  private getOrCreateVar(packId: string): number {
    if (!this.packToVar.has(packId)) {
      const v = this.varCounter++;
      this.packToVar.set(packId, v);
      this.varToPack.set(v, packId);
      return v;
    }
    return this.packToVar.get(packId)!;
  }

  /**
   * Resolves the optimal, conflict-free pack selection satisfying requested features
   * and maximizing soft recommendations via MaxSAT.
   */
  public solve(
    requestedPackIds: string[],
    options: { includeRecommendations?: boolean; allowPartial?: boolean } = {}
  ): SATResolutionResult {
    const { includeRecommendations = true } = options;
    logger.info(`[SATScaffoldResolver] Solving pack configuration for requested: [${requestedPackIds.join(", ")}]`);

    // Verify all requested exist
    const missing = requestedPackIds.filter(id => !this.registry.has(id));
    if (missing.length > 0) {
      return {
        satisfiable: false,
        selectedPacks: [],
        unresolvedDependencies: missing,
        conflictsDetected: [],
        executionOrder: [],
        proofExplanation: `Requested pack(s) not found in registry: ${missing.join(", ")}`
      };
    }

    const clauses: Clause[] = [];

    // 1. Hard clauses for requested packs (must be true: [p])
    requestedPackIds.forEach(id => {
      const v = this.getOrCreateVar(id);
      clauses.push([v]);
    });

    // 2. Dependency implication clauses (p => req) equivalent to (¬p ∨ req)
    this.registry.forEach(pack => {
      const pVar = this.getOrCreateVar(pack.id);
      const allRequires = [...(pack.requires || []), ...(pack.extends ? [pack.extends] : [])];

      allRequires.forEach(reqId => {
        if (this.registry.has(reqId)) {
          const reqVar = this.getOrCreateVar(reqId);
          // p => req  <=>  ¬p ∨ req
          clauses.push([-pVar, reqVar]);
        } else {
          // If required pack does not exist in registry, p cannot be selected: (¬p)
          clauses.push([-pVar]);
        }
      });

      // 3. Conflict exclusion clauses (p => ¬conflict) equivalent to (¬p ∨ ¬conflict)
      (pack.conflicts || []).forEach(conflictId => {
        if (this.registry.has(conflictId)) {
          const conflictVar = this.getOrCreateVar(conflictId);
          clauses.push([-pVar, -conflictVar]);
        }
      });
    });

    // 4. Solve CNF using DPLL
    let model = this.solveDPLL(clauses, this.varCounter - 1);

    if (!model) {
      const unresolved = this.diagnoseMissingDependencies(requestedPackIds);
      // Find conflict pair for proof explanation
      const conflicts = this.diagnoseConflicts(requestedPackIds);
      return {
        satisfiable: false,
        selectedPacks: [],
        unresolvedDependencies: unresolved,
        conflictsDetected: conflicts,
        executionOrder: [],
        proofExplanation: unresolved.length > 0
          ? `Scaffold pack not found: required dependency ${unresolved.join(", ")}.`
          : `Unsatisfiable pack constraint: Mutually conflicting packs or impossible requirements.`
      };
    }

    // 5. Greedy partial MaxSAT: accept each reachable recommendation only if
    // it preserves SAT. Keep accepted recommendations as unit clauses and use
    // the resulting model, so their transitive requirements are returned too.
    let workingClauses = clauses;
    if (includeRecommendations) {
      const considered = new Set<string>();
      let changed = true;
      while (changed) {
        changed = false;
        const selectedNow = this.selectedIds(model);
        for (const id of selectedNow) {
          for (const recId of this.registry.get(id)?.recommends || []) {
            if (considered.has(recId) || selectedNow.includes(recId) || !this.registry.has(recId)) continue;
            considered.add(recId);
            const testClauses = [...workingClauses, [this.getOrCreateVar(recId)]];
            const testModel = this.solveDPLL(testClauses, this.varCounter - 1);
            if (testModel) {
              workingClauses = testClauses;
              model = testModel;
              changed = true;
            }
          }
        }
      }
    }

    const selectedPackIds = this.selectedIds(model);
    const selectedPacks = selectedPackIds.map(id => this.registry.get(id)!);
    const executionOrder = this.topologicalSort(selectedPacks);

    if (executionOrder.length !== selectedPacks.length) {
      const ordered = new Set(executionOrder.map((pack) => pack.id));
      const cyclic = selectedPacks.map((pack) => pack.id).filter((id) => !ordered.has(id));
      return {
        satisfiable: false,
        selectedPacks: [],
        unresolvedDependencies: cyclic,
        conflictsDetected: [],
        executionOrder: [],
        proofExplanation: `Unsatisfiable pack constraint: cyclic dependency involving ${cyclic.join(", ")}.`,
      };
    }

    logger.info(`[SATScaffoldResolver] ✅ SAT Proof complete. Selected ${selectedPacks.length} packs in order.`);

    return {
      satisfiable: true,
      selectedPacks,
      unresolvedDependencies: [],
      conflictsDetected: [],
      executionOrder,
      proofExplanation: `SAT Certificate: Valid configuration found with ${selectedPacks.length} packs.`
    };
  }

  /**
   * Classical DPLL (Davis-Putnam-Logemann-Loveland) SAT Algorithm
   */
  private solveDPLL(clauses: Clause[], numVars: number): Map<number, boolean> | null {
    const assignment = new Map<number, boolean>();
    return this.dpllRecursive(clauses, assignment, numVars);
  }

  private selectedIds(model: Map<number, boolean>): string[] {
    const selected: string[] = [];
    model.forEach((value, variable) => {
      const id = this.varToPack.get(variable);
      if (value === true && id && this.registry.has(id)) selected.push(id);
    });
    return selected;
  }

  private dpllRecursive(
    clauses: Clause[],
    assignment: Map<number, boolean>,
    numVars: number
  ): Map<number, boolean> | null {
    // 1. Simplify clauses under current assignment
    const simplified: Clause[] = [];

    for (const clause of clauses) {
      let clauseSatisfied = false;
      const newClause: Literal[] = [];

      for (const lit of clause) {
        const v = Math.abs(lit);
        const isNeg = lit < 0;

        if (assignment.has(v)) {
          const val = assignment.get(v)!;
          if ((!isNeg && val) || (isNeg && !val)) {
            clauseSatisfied = true;
            break;
          }
        } else {
          newClause.push(lit);
        }
      }

      if (!clauseSatisfied) {
        if (newClause.length === 0) {
          return null; // Empty clause -> UNSAT
        }
        simplified.push(newClause);
      }
    }

    if (simplified.length === 0) {
      return assignment; // All clauses satisfied!
    }

    // 2. Unit Propagation
    const unitClause = simplified.find(c => c.length === 1);
    if (unitClause) {
      const lit = unitClause[0];
      const v = Math.abs(lit);
      const val = lit > 0;
      const nextAssignment = new Map(assignment);
      nextAssignment.set(v, val);
      return this.dpllRecursive(simplified, nextAssignment, numVars);
    }

    // 3. Choose unassigned variable (Branching heuristic)
    let nextVar = 1;
    for (let i = 1; i <= numVars; i++) {
      if (!assignment.has(i)) {
        nextVar = i;
        break;
      }
    }

    // Prefer false: pack variables represent optional installation. This gives
    // a minimal model instead of silently enabling unrelated registry packs.
    const tryFalse = new Map(assignment);
    tryFalse.set(nextVar, false);
    const resultFalse = this.dpllRecursive(simplified, tryFalse, numVars);
    if (resultFalse) return resultFalse;

    const tryTrue = new Map(assignment);
    tryTrue.set(nextVar, true);
    return this.dpllRecursive(simplified, tryTrue, numVars);
  }

  private diagnoseConflicts(requestedIds: string[]): Array<{ packA: string; packB: string }> {
    const conflicts: Array<{ packA: string; packB: string }> = [];
    for (const aId of requestedIds) {
      const aPack = this.registry.get(aId);
      if (aPack?.conflicts) {
        for (const bId of requestedIds) {
          if (aPack.conflicts.includes(bId)) {
            conflicts.push({ packA: aId, packB: bId });
          }
        }
      }
    }
    return conflicts;
  }

  private diagnoseMissingDependencies(requestedIds: string[]): string[] {
    const missing = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const pack = this.registry.get(id);
      if (!pack) {
        missing.add(id);
        return;
      }
      for (const dependency of [...(pack.requires || []), ...(pack.extends ? [pack.extends] : [])]) {
        visit(dependency);
      }
    };
    requestedIds.forEach(visit);
    return [...missing];
  }

  private topologicalSort(packs: PackManifest[]): PackManifest[] {
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const pack of packs) {
      inDegree.set(pack.id, 0);
      graph.set(pack.id, []);
    }

    for (const pack of packs) {
      const deps = [...(pack.requires || []), ...(pack.extends ? [pack.extends] : [])];
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

    return resultOrder;
  }
}
