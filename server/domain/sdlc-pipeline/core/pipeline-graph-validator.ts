/**
 * PipelineGraphValidator
 *
 * Validates pipeline template configurations for structural correctness:
 * 1. Dependency cycle detection via topological sort
 * 2. Output contract completeness — every phase must declare an output contract
 * 3. Contract compatibility — downstream input contracts must be satisfied by upstream outputs
 *
 * Pure function — no DB access, operates on template config data.
 */

import { artifactContractValidator } from "./artifact-contract-validator.js";
import type { ArtifactContract } from "./types.js";

// ─── Input Types ────────────────────────────────────────────────────────────

export interface PhaseDefinition {
  name: string;
  dependencies: string[];
  artifactContracts: {
    input_contract?: {
      requires: string[]; // e.g., ["requirements.prd", "design.api_specs"]
      contract?: ArtifactContract;
    };
    output_contract?: ArtifactContract;
  };
}

export interface PipelineTemplateConfig {
  phases: PhaseDefinition[];
}

// ─── Output Types ───────────────────────────────────────────────────────────

export interface GraphValidationError {
  type: "cycle" | "missing_output_contract" | "incompatible_contract";
  phase: string;
  message: string;
  details?: string[];
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationError[];
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Validates a pipeline template's dependency graph and artifact contracts.
 *
 * Checks performed:
 * 1. Cycle detection — uses Kahn's algorithm (topological sort). If the sort
 *    cannot process all nodes, a cycle exists.
 * 2. Output contract completeness — every phase must have an `output_contract`
 *    in its `artifactContracts`.
 * 3. Contract compatibility — for each phase with an `input_contract`, verifies
 *    that upstream phases provide compatible output contracts using
 *    `artifactContractValidator.checkCompatibility`.
 *
 * @param template - The pipeline template config with phase definitions
 * @returns A validation result with any errors found
 */
export function validatePipelineGraph(template: PipelineTemplateConfig): GraphValidationResult {
  const errors: GraphValidationError[] = [];

  const phaseMap = new Map<string, PhaseDefinition>();
  for (const phase of template.phases) {
    phaseMap.set(phase.name, phase);
  }

  // 1. Detect dependency cycles using Kahn's algorithm (topological sort)
  const cycleErrors = detectCycles(template.phases, phaseMap);
  errors.push(...cycleErrors);

  // 2. Verify all phases have output contracts
  const outputErrors = checkOutputContracts(template.phases);
  errors.push(...outputErrors);

  // 3. Verify downstream input contracts are satisfied by upstream outputs
  const compatibilityErrors = checkContractCompatibility(template.phases, phaseMap);
  errors.push(...compatibilityErrors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Detects dependency cycles using Kahn's algorithm for topological sorting.
 * If not all nodes can be processed, the remaining nodes form a cycle.
 */
function detectCycles(
  phases: PhaseDefinition[],
  phaseMap: Map<string, PhaseDefinition>
): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  // Build in-degree map and adjacency list
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>(); // from → [to] (downstream phases)

  for (const phase of phases) {
    inDegree.set(phase.name, 0);
    if (!adjacency.has(phase.name)) {
      adjacency.set(phase.name, []);
    }
  }

  // Each dependency edge: dependency → phase (dependency must complete before phase)
  for (const phase of phases) {
    for (const dep of phase.dependencies) {
      if (!phaseMap.has(dep)) {
        // Skip unknown dependencies — could be validated separately
        continue;
      }
      const currentDegree = inDegree.get(phase.name) ?? 0;
      inDegree.set(phase.name, currentDegree + 1);

      const downstreams = adjacency.get(dep) ?? [];
      downstreams.push(phase.name);
      adjacency.set(dep, downstreams);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processedCount++;

    const downstreams = adjacency.get(node) ?? [];
    for (const downstream of downstreams) {
      const degree = inDegree.get(downstream)! - 1;
      inDegree.set(downstream, degree);
      if (degree === 0) {
        queue.push(downstream);
      }
    }
  }

  // If we couldn't process all nodes, there's a cycle
  if (processedCount < phases.length) {
    const cycleNodes = phases
      .filter((p) => (inDegree.get(p.name) ?? 0) > 0)
      .map((p) => p.name);

    errors.push({
      type: "cycle",
      phase: cycleNodes[0],
      message: `Dependency cycle detected involving phases: ${cycleNodes.join(", ")}`,
      details: cycleNodes,
    });
  }

  return errors;
}

/**
 * Verifies that every phase has an output_contract defined in its artifactContracts.
 */
function checkOutputContracts(phases: PhaseDefinition[]): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  for (const phase of phases) {
    if (!phase.artifactContracts.output_contract) {
      errors.push({
        type: "missing_output_contract",
        phase: phase.name,
        message: `Phase "${phase.name}" does not declare an output artifact contract`,
      });
    }
  }

  return errors;
}

/**
 * For each phase with an input_contract, verifies that the upstream phases
 * providing its inputs have compatible output contracts.
 *
 * The input_contract.requires array uses "phase.field" notation to reference
 * specific upstream outputs. We extract the phase name from the prefix and
 * check that the upstream's output contract has compatible fields.
 */
function checkContractCompatibility(
  phases: PhaseDefinition[],
  phaseMap: Map<string, PhaseDefinition>
): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  for (const phase of phases) {
    const inputContract = phase.artifactContracts.input_contract;
    if (!inputContract) {
      continue;
    }

    // Group required fields by upstream phase
    const requiredByUpstream = new Map<string, string[]>();
    for (const requirement of inputContract.requires) {
      const dotIndex = requirement.indexOf(".");
      if (dotIndex === -1) {
        continue; // Malformed requirement, skip
      }
      const upstreamName = requirement.substring(0, dotIndex);
      const fieldName = requirement.substring(dotIndex + 1);
      const fields = requiredByUpstream.get(upstreamName) ?? [];
      fields.push(fieldName);
      requiredByUpstream.set(upstreamName, fields);
    }

    // Check each upstream phase's output contract satisfies the required fields
    for (const [upstreamName, requiredFields] of requiredByUpstream) {
      const upstreamPhase = phaseMap.get(upstreamName);
      if (!upstreamPhase) {
        errors.push({
          type: "incompatible_contract",
          phase: phase.name,
          message: `Phase "${phase.name}" requires inputs from unknown phase "${upstreamName}"`,
        });
        continue;
      }

      const upstreamOutput = upstreamPhase.artifactContracts.output_contract;
      if (!upstreamOutput) {
        errors.push({
          type: "incompatible_contract",
          phase: phase.name,
          message: `Phase "${phase.name}" requires inputs from "${upstreamName}" which has no output contract`,
        });
        continue;
      }

      // Build a synthetic downstream input contract for compatibility check
      const syntheticInputContract: ArtifactContract = inputContract.contract ?? {
        schemaVersion: "1.0.0",
        jsonSchema: {
          type: "object",
          required: requiredFields,
          properties: Object.fromEntries(requiredFields.map((f) => [f, {}])),
        },
        requiredFields,
      };

      const result = artifactContractValidator.checkCompatibility(
        upstreamOutput,
        syntheticInputContract
      );

      if (!result.compatible) {
        errors.push({
          type: "incompatible_contract",
          phase: phase.name,
          message: `Phase "${phase.name}" input contract is not satisfied by "${upstreamName}" output contract`,
          details: result.details,
        });
      }
    }
  }

  return errors;
}

// ─── Singleton Export ───────────────────────────────────────────────────────

export const pipelineGraphValidator = {
  validatePipelineGraph,
};

export type PipelineGraphValidatorType = typeof pipelineGraphValidator;
