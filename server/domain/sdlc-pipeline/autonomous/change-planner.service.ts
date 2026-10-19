/**
 * Change Planner Service
 *
 * Produces an ordered multi-file edit plan from a session objective plus
 * repository context. Responsible for:
 *   - Analyzing the objective against repository context
 *   - Determining necessary file operations (create, modify, delete)
 *   - Computing dependency order between operations (topological sort)
 *   - Annotating each operation with rationale referencing detected conventions
 *   - Including specific code regions with surrounding context for modify operations
 *
 * This is a pure domain logic service — no direct DB access needed.
 *
 * Validates: Requirements 2.1, 2.3, 2.4
 */

import { createLogger } from "@server/utils/logger.js";
import { artifactRegistryService } from "../core/artifact-registry.service.js";
import { artifactContractValidator } from "../core/artifact-contract-validator.js";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import { editPlanContract } from "./contracts.js";
import { buildConsensusMatrix } from "./consensus-matrix.js";
import { planAdaptiveScaling } from "./adaptive-scaling.js";
import type {
  EditPlan,
  FileOperation,
  CodeChange,
  RepositoryContext,
  ValidationResult,
  ValidationError,
  DetectedConventions,
  DependencyGraph,
  RelevantFile,
  PipelineLifecycleEvent,
} from "../core/types.js";

const logger = createLogger("ChangePlanner");

// Fallback context budget when the caller does not pass the session's configured
// value (keeps adaptive-scaling telemetry meaningful; matches the config default).
const DEFAULT_CONTEXT_TOKEN_BUDGET = 100_000;

// ─── Topological Sort (Kahn's Algorithm) ────────────────────────────────────

/**
 * Performs a topological sort on a set of operations using Kahn's algorithm.
 * Returns the sorted operation IDs or throws if a cycle is detected.
 */
function topologicalSort(operations: FileOperation[]): string[] {
  const idSet = new Set(operations.map((op) => op.id));
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize in-degree and adjacency list
  for (const op of operations) {
    inDegree.set(op.id, 0);
    adjacencyList.set(op.id, []);
  }

  // Build the graph: for each dependency, add an edge from dependency → dependent
  for (const op of operations) {
    for (const depId of op.dependsOn) {
      if (!idSet.has(depId)) {
        // Skip references to non-existent operations (caught by validatePlan)
        continue;
      }
      adjacencyList.get(depId)!.push(op.id);
      inDegree.set(op.id, (inDegree.get(op.id) ?? 0) + 1);
    }
  }

  // Collect nodes with zero in-degree
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    // Sort the queue to produce deterministic output
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacencyList.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If sorted doesn't include all nodes, there's a cycle
  if (sorted.length !== operations.length) {
    const remaining = operations
      .filter((op) => !sorted.includes(op.id))
      .map((op) => op.id);
    throw new Error(
      `Circular dependency detected among operations: ${remaining.join(", ")}`
    );
  }

  return sorted;
}

// ─── Dependency Analysis ────────────────────────────────────────────────────

/**
 * Determines dependencies between planned file operations based on:
 * - Import relationships in the existing dependency graph
 * - New file creation ordering (type/interface files before consumers)
 * - Logical ordering (shared modules before dependents)
 */
function computeOperationDependencies(
  operations: FileOperation[],
  depGraph: DependencyGraph
): FileOperation[] {
  const pathToOpId = new Map<string, string>();
  for (const op of operations) {
    pathToOpId.set(op.filePath, op.id);
  }

  // Build existing import relationships from the dep graph
  const importedBy = new Map<string, Set<string>>();
  for (const edge of depGraph.edges) {
    if (!importedBy.has(edge.target)) {
      importedBy.set(edge.target, new Set());
    }
    importedBy.get(edge.target)!.add(edge.source);
  }

  return operations.map((op) => {
    const deps: string[] = [];

    // If this operation's file imports from another file that's also being operated on,
    // the imported file's operation should complete first
    for (const edge of depGraph.edges) {
      if (edge.source === op.filePath) {
        const targetOpId = pathToOpId.get(edge.target);
        if (targetOpId && targetOpId !== op.id) {
          deps.push(targetOpId);
        }
      }
    }

    // For create operations: if another create operation produces a file
    // that this file would import, add the dependency
    if (op.type === "create") {
      for (const otherOp of operations) {
        if (otherOp.id === op.id) continue;
        if (otherOp.type === "create") {
          // Check if this new file's content references the other new file
          if (
            op.newContent &&
            otherOp.filePath &&
            contentReferencesFile(op.newContent, otherOp.filePath)
          ) {
            deps.push(otherOp.id);
          }
        }
      }
    }

    // For modify/delete: if modifying a file that depends on a newly created file
    if (op.type === "modify" || op.type === "delete") {
      for (const otherOp of operations) {
        if (otherOp.id === op.id) continue;
        if (otherOp.type === "create") {
          // If this file imports from the newly created file
          const importPath = deriveImportPath(otherOp.filePath);
          if (op.changes?.some((c) => c.newCode.includes(importPath))) {
            deps.push(otherOp.id);
          }
        }
      }
    }

    return { ...op, dependsOn: [...new Set(deps)] };
  });
}

/**
 * Checks if file content references another file path (via import/require).
 */
function contentReferencesFile(content: string, filePath: string): boolean {
  const importPath = deriveImportPath(filePath);
  return content.includes(importPath);
}

/**
 * Derives a likely import path from a full file path.
 * Strips extension and converts to a relative-style reference.
 */
function deriveImportPath(filePath: string): string {
  // Remove common extensions for import matching
  return filePath.replace(/\.(ts|js|tsx|jsx|mts|mjs)$/, "");
}

// ─── Rationale Generation ───────────────────────────────────────────────────

/**
 * Generates a rationale string for an operation, referencing detected conventions.
 */
function generateRationale(
  op: Pick<FileOperation, "type" | "filePath">,
  conventions: DetectedConventions,
  objective: string
): string {
  const parts: string[] = [];

  // Reference the operation type
  switch (op.type) {
    case "create":
      parts.push(`Create new file to fulfill objective: "${objective}".`);
      break;
    case "modify":
      parts.push(`Modify existing file to fulfill objective: "${objective}".`);
      break;
    case "delete":
      parts.push(`Remove file as part of objective: "${objective}".`);
      break;
  }

  // Reference architectural patterns
  if (conventions.architecturalPatterns.length > 0) {
    parts.push(
      `Follows detected architectural pattern(s): ${conventions.architecturalPatterns.join(", ")}.`
    );
  }

  // Reference naming conventions if applicable
  const matchingNaming = conventions.namingPatterns.find((np) => {
    try {
      return new RegExp(np.pattern).test(op.filePath);
    } catch {
      return false;
    }
  });
  if (matchingNaming) {
    parts.push(
      `Conforms to naming convention: ${matchingNaming.scope} (${matchingNaming.pattern}).`
    );
  }

  // Reference testing conventions
  if (conventions.testingConventions.length > 0) {
    const testConv = conventions.testingConventions[0];
    if (op.filePath.includes("test") || op.filePath.includes("spec")) {
      parts.push(
        `Aligns with testing convention: ${testConv.framework} in ${testConv.location}.`
      );
    }
  }

  return parts.join(" ");
}

// ─── Plan Generation ────────────────────────────────────────────────────────

/**
 * Analyzes the objective and context to determine required file operations.
 * This produces a list of FileOperations with unique IDs and preliminary
 * dependency information based on the repository's dependency graph.
 */
function analyzeObjective(
  sessionId: string,
  objective: string,
  context: RepositoryContext
): FileOperation[] {
  const operations: FileOperation[] = [];
  let opIndex = 0;

  // Analyze relevant files to determine needed modifications
  for (const file of context.relevantFiles) {
    if (file.relevanceScore > 0) {
      const op: FileOperation = {
        id: `op-${opIndex++}`,
        type: "modify",
        filePath: file.path,
        dependsOn: [],
        rationale: "",
        changes: buildDefaultChanges(file),
      };
      operations.push(op);
    }
  }

  // If no relevant files found, create a placeholder operation for new file creation
  if (operations.length === 0) {
    operations.push({
      id: `op-${opIndex++}`,
      type: "create",
      filePath: inferNewFilePath(objective, context),
      dependsOn: [],
      rationale: "",
      newContent: "",
    });
  }

  return operations;
}

/**
 * Builds default CodeChange entries for a modify operation based on the file's content.
 * Includes context lines for accurate diff application.
 */
function buildDefaultChanges(file: RelevantFile): CodeChange[] {
  const lines = file.content.split("\n");
  if (lines.length === 0) return [];

  // Default: target the file content with surrounding context
  const contextLines = 3;
  return [
    {
      startLine: 1,
      endLine: Math.min(lines.length, 10),
      originalCode: lines.slice(0, Math.min(lines.length, 10)).join("\n"),
      newCode: "",
      contextLines,
    },
  ];
}

/**
 * Infers a new file path based on the objective and context conventions.
 */
function inferNewFilePath(
  objective: string,
  context: RepositoryContext
): string {
  // Use project structure to find a reasonable location
  const slug = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  // Try to place in a directory that matches the project's conventions
  if (context.projectStructure.length > 0) {
    const srcDir = context.projectStructure.find(
      (node) =>
        node.type === "directory" &&
        (node.path.includes("src") || node.path.includes("server"))
    );
    if (srcDir) {
      return `${srcDir.path}/${slug}.ts`;
    }
  }

  return `src/${slug}.ts`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generates a complete edit plan from the session objective and repository context.
 *
 * Steps:
 * 1. Analyze objective to determine needed file operations
 * 2. Compute inter-operation dependencies from the dependency graph
 * 3. Annotate each operation with a rationale referencing conventions
 * 4. Compute topological sort for execution order
 * 5. Enforce human review threshold based on maxFileCount
 * 6. Assemble the final EditPlan
 */
async function generatePlan(
  sessionId: string,
  objective: string,
  context: RepositoryContext,
  maxFileCount?: number,
  contextTokenBudget?: number
): Promise<EditPlan> {
  logger.info(
    `Generating edit plan: session=${sessionId} objective="${objective.slice(0, 80)}..."`
  );

  // Step 1: Analyze the objective against context
  let operations = analyzeObjective(sessionId, objective, context);
  logger.info(`Identified ${operations.length} file operation(s)`);

  // Step 2: Compute dependencies between operations
  operations = computeOperationDependencies(operations, context.dependencyGraph);

  // Step 3: Annotate each operation with rationale
  operations = operations.map((op) => ({
    ...op,
    rationale: generateRationale(op, context.conventions, objective),
  }));

  // Step 4: Compute topological sort for execution order
  let dependencyOrder: string[];
  try {
    dependencyOrder = topologicalSort(operations);
  } catch (err) {
    logger.warn(
      `Topological sort failed, falling back to sequential order: ${(err as Error).message}`
    );
    // Fall back to natural order if cycle detected
    dependencyOrder = operations.map((op) => op.id);
  }

  // Step 5: Agentic Consensus Matrix — architect → security/perf → refiner.
  // The refiner forces human review only on concrete high/critical findings in
  // the diffed code (targeted security-critical paths are recorded as telemetry).
  const { consensusMatrix, humanReviewTriggered } = buildConsensusMatrix(
    operations,
    context.conventions,
    objective
  );

  // Step 6: Adaptive Resource Scaling — detect extensive refactors and record
  // the scaled budgets + model-tier routing for the orchestrator to act on.
  const effectiveMaxFileCount = maxFileCount ?? 50;
  const adaptiveScaling = planAdaptiveScaling({
    operationCount: operations.length,
    observedTokenCount: context.tokenCount,
    maxFileCount: effectiveMaxFileCount,
    contextTokenBudget: contextTokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
    dependencyFanout: context.blastRadius?.totalDependantsPulled,
  });

  // Step 7: Assemble the edit plan. Human review is forced by either the file-
  // count threshold or the consensus security audit.
  const totalFileCount = operations.length;
  const requiresHumanReview = totalFileCount > effectiveMaxFileCount || humanReviewTriggered;

  const plan: EditPlan = {
    sessionId,
    objective,
    operations,
    dependencyOrder,
    totalFileCount,
    requiresHumanReview,
    consensusMatrix,
    adaptiveScaling,
  };

  logger.info(
    `Edit plan generated: ${plan.totalFileCount} operations, requiresHumanReview=${plan.requiresHumanReview} ` +
      `(threshold=${effectiveMaxFileCount}, consensusScore=${consensusMatrix.consensusScore.toFixed(2)}, ` +
      `adaptiveScaling=${adaptiveScaling.triggered ? adaptiveScaling.trigger : "none"})`
  );

  return plan;
}

/**
 * Validates an edit plan for structural integrity:
 * - All dependsOn references point to existing operation IDs
 * - No circular dependencies exist in the operation graph
 * - Modify operations have valid code changes
 */
function validatePlan(plan: EditPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const operationIds = new Set(plan.operations.map((op) => op.id));

  // Check reference integrity: all dependsOn IDs must exist
  for (const op of plan.operations) {
    for (const depId of op.dependsOn) {
      if (!operationIds.has(depId)) {
        errors.push({
          path: `operations[${op.id}].dependsOn`,
          message: `Dependency "${depId}" references a non-existent operation ID`,
          keyword: "referenceIntegrity",
          params: { operationId: op.id, missingDep: depId },
        });
      }
    }
  }

  // Check for circular dependencies using topological sort
  try {
    topologicalSort(plan.operations);
  } catch (err) {
    errors.push({
      path: "operations",
      message: (err as Error).message,
      keyword: "acyclicDependency",
      params: {},
    });
  }

  // Validate modify operations have proper changes
  for (const op of plan.operations) {
    if (op.type === "modify") {
      if (!op.changes || op.changes.length === 0) {
        errors.push({
          path: `operations[${op.id}].changes`,
          message: `Modify operation "${op.id}" must have at least one code change`,
          keyword: "required",
          params: { operationId: op.id },
        });
      } else {
        for (let i = 0; i < op.changes.length; i++) {
          const change = op.changes[i];
          if (change.startLine > change.endLine) {
            errors.push({
              path: `operations[${op.id}].changes[${i}]`,
              message: `Code change has invalid line range: startLine (${change.startLine}) > endLine (${change.endLine})`,
              keyword: "lineRange",
              params: {
                operationId: op.id,
                startLine: change.startLine,
                endLine: change.endLine,
              },
            });
          }
          if (change.contextLines < 0) {
            errors.push({
              path: `operations[${op.id}].changes[${i}].contextLines`,
              message: `contextLines must be non-negative, got ${change.contextLines}`,
              keyword: "minimum",
              params: { operationId: op.id, contextLines: change.contextLines },
            });
          }
        }
      }
    }

    // All operations must have a non-empty rationale
    if (!op.rationale || op.rationale.trim().length === 0) {
      errors.push({
        path: `operations[${op.id}].rationale`,
        message: `Operation "${op.id}" must have a non-empty rationale`,
        keyword: "minLength",
        params: { operationId: op.id },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Plan Persistence & Lifecycle ───────────────────────────────────────────

/**
 * Generates, validates, and persists an edit plan as an artifact.
 *
 * Orchestrates the full plan lifecycle:
 * 1. Calls `generatePlan()` with the maxFileCount threshold
 * 2. Validates the plan with `validatePlan()`
 * 3. If plan requires human review, emits `human_review_requested` lifecycle event
 * 4. Validates against the editPlanContract artifact contract
 * 5. Persists via `artifactRegistryService.persist()` with phase "change_plan" and name "edit_plan"
 * 6. Returns the plan along with validation status
 */
async function generatePlanAndPersist(
  sessionId: string,
  objective: string,
  context: RepositoryContext,
  maxFileCount?: number,
  missionRunId?: number,
  contextTokenBudget?: number
): Promise<{ plan: EditPlan; validation: ValidationResult; contractValidation: ValidationResult }> {
  logger.info(`Generating and persisting plan: session=${sessionId}`);

  // Step 1: Generate the plan with threshold enforcement
  const plan = await generatePlan(sessionId, objective, context, maxFileCount, contextTokenBudget);

  // Step 2: Validate the plan (cycle detection, reference integrity, well-formedness)
  const validation = validatePlan(plan);
  if (!validation.valid) {
    logger.warn(
      `Plan validation failed for session=${sessionId}: ${validation.errors.length} error(s)`
    );
  }

  // Step 3: If plan requires human review, emit lifecycle event
  if (plan.requiresHumanReview) {
    logger.info(
      `Plan exceeds file count threshold (${plan.totalFileCount} > ${maxFileCount ?? 50}). Requesting human review.`
    );

    const lifecycleEvent: PipelineLifecycleEvent = {
      eventType: "human_review_requested",
      sessionId,
      orgId: 0, // Will be resolved by session context in production
      timestamp: new Date(),
      payload: {
        reason: "file_count_threshold_exceeded",
        totalFileCount: plan.totalFileCount,
        maxFileCount: maxFileCount ?? 50,
        operationCount: plan.operations.length,
      },
    };

    sessionLifecycleManager.emitEvent(lifecycleEvent);
  }

  // Step 4: Validate against artifact contract
  const contractValidation = artifactContractValidator.validate(plan, editPlanContract);
  if (!contractValidation.valid) {
    logger.warn(
      `Artifact contract validation failed for session=${sessionId}: ${contractValidation.errors.length} error(s)`
    );
  }

  // Step 5: Persist the plan artifact
  await artifactRegistryService.persist({
    sessionId,
    phase: "change_plan",
    name: "edit_plan",
    content: plan,
    mimeType: "application/json",
    missionRunId: missionRunId ?? 0,
  });

  logger.info(`Plan persisted for session=${sessionId}`);

  return { plan, validation, contractValidation };
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const changePlannerService = {
  generatePlan,
  validatePlan,
  generatePlanAndPersist,
};

// Also export utilities for testing
export { topologicalSort, computeOperationDependencies, generateRationale };
