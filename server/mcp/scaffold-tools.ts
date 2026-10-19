import { scaffoldRegistryService } from "../domain/scaffold/scaffold-registry.service.js";
import { scaffoldAssemblyService } from "../domain/scaffold/scaffold-assembly.service.js";
import { AssemblyManifestSchema } from "@shared/schema/scaffold.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ScaffoldMcpTools");

export interface ScaffoldMcpTool {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  /**
   * Args are optional so tools that take none stay callable as `handler()`.
   * Without an explicit element type the array collapses to a union of the two
   * tool shapes, and callers can no longer narrow by `name`.
   */
  handler: (args?: any) => Promise<any>;
}

export const scaffoldMcpTools: ScaffoldMcpTool[] = [
  {
    name: "list_scaffold_packs",
    description: "Lists all available Scaffold Feature Packs (e.g. core-node-express, auth-jwt) in the registry",
    inputSchema: {
      type: "object",
      properties: {}
    },
    handler: async () => {
      const packs = await scaffoldRegistryService.loadAllPacks();
      return {
        success: true,
        count: packs.length,
        packs: packs.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          requires: p.requires,
          conflicts: p.conflicts,
          provides: p.provides
        }))
      };
    }
  },
  {
    name: "assemble_scaffold_manifest",
    description: "Executes dynamic AST assembly of scaffold feature packs into a target application workspace",
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", description: "Target application name" },
        targetDir: { type: "string", description: "Target workspace directory path" },
        packs: {
          type: "array",
          items: { type: "string" },
          description: "List of feature pack IDs (e.g. ['core-node-express', 'auth-jwt'])"
        },
        variables: { type: "object", description: "Optional variables for templates" }
      },
      required: ["appName", "targetDir", "packs"]
    },
    handler: async (args: any) => {
      const validated = AssemblyManifestSchema.parse(args);
      const availablePacks = await scaffoldRegistryService.loadAllPacks();
      const result = await scaffoldAssemblyService.assemble(validated, availablePacks);

      return result;
    }
  },
  {
    name: "validate_scaffold_compatibility",
    description: "Formally checks a selection of Scaffold Feature Packs for satisfying dependencies, version constraints, and zero conflicts using the SAT/DPLL solver",
    inputSchema: {
      type: "object",
      properties: {
        packs: {
          type: "array",
          items: { type: "string" },
          description: "List of candidate feature pack IDs to validate"
        },
        includeRecommendations: {
          type: "boolean",
          description: "Whether to run MaxSAT to suggest complementary packs"
        }
      },
      required: ["packs"]
    },
    handler: async (args: any) => {
      const { packs = [], includeRecommendations = true } = args || {};
      const availablePacks = await scaffoldRegistryService.loadAllPacks();
      const { SATScaffoldResolver } = await import("../domain/scaffold/sat-scaffold-resolver.js");
      const satSolver = new SATScaffoldResolver(availablePacks);
      const satResult = satSolver.solve(packs, { includeRecommendations });

      return {
        satisfiable: satResult.satisfiable,
        proofExplanation: satResult.proofExplanation,
        executionOrder: satResult.executionOrder.map(p => p.id),
        unresolvedDependencies: satResult.unresolvedDependencies,
        conflictsDetected: satResult.conflictsDetected,
        selectedPacks: satResult.selectedPacks.map(p => p.id)
      };
    }
  }
];

