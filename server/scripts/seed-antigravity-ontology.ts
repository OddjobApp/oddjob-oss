import { db } from "../database_service.js";
import { ontologyObjectTypes, ontologyActions, orgs } from "@shared/schema/index.js";
import { createLogger } from "../utils/logger.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("SeedAntigravityOntology");

async function seedAntigravityOntology() {
  logger.info("[SeedAntigravityOntology] Seeding Antigravity Assembly Ontology Object Types & Actions...");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    logger.warn("[SeedAntigravityOntology] No org found in database to attach ontology entries.");
    return;
  }

  const orgId = org.id;

  // 1. Seed Object Type: Component
  const [componentType] = await db.insert(ontologyObjectTypes)
    .values({
      organizationId: orgId,
      name: "Component",
      description: "Indexed UI component, macro, or assembly pattern in the Component Library.",
      titleProperty: "componentName",
      icon: "Hammer",
      backing: "materialized",
      sourceAdapter: "component_index",
      isActive: true,
      propertiesSchema: {
        componentName: { type: "string" },
        category: { type: "string" },
        effectivenessScore: { type: "number" },
        verificationSuccessRate: { type: "number" },
        importPath: { type: "string" },
      }
    })
    .onConflictDoNothing()
    .returning();

  logger.info("  [✓] Ontology Object Type: Component registered.");

  // 2. Seed Object Type: AssemblyManifest
  const [manifestType] = await db.insert(ontologyObjectTypes)
    .values({
      organizationId: orgId,
      name: "AssemblyManifest",
      description: "Dehydrated solid-state assembly manifest freezing ephemeral agent session states into microservices.",
      titleProperty: "assemblyId",
      icon: "Layers",
      backing: "materialized",
      sourceAdapter: "assembly_manifests",
      isActive: true,
      propertiesSchema: {
        assemblyId: { type: "string" },
        intent: { type: "string" },
        buildStatus: { type: "string" },
        endpointUrl: { type: "string" },
      }
    })
    .onConflictDoNothing()
    .returning();

  logger.info("  [✓] Ontology Object Type: AssemblyManifest registered.");

  // 3. Seed Actions
  if (componentType) {
    await db.insert(ontologyActions).values({
      organizationId: orgId,
      name: "PromoteComponentToGoldStandard",
      description: "Promotes a high-effectiveness component to Gold Standard status in the library.",
      objectTypeId: componentType.id,
      parametersSchema: {
        componentName: { type: "string" },
        reason: { type: "string" }
      },
      effect: "write",
      handlerKind: "builtin",
      handlerRef: "componentLookupService.recordAssemblyFeedback",
      isActive: true,
    }).onConflictDoNothing();
  }

  if (manifestType) {
    await db.insert(ontologyActions).values({
      organizationId: orgId,
      name: "DeploySolidStateContainer",
      description: "Compiles and deploys a solid-state microservice container from a dehydrated assembly manifest.",
      objectTypeId: manifestType.id,
      parametersSchema: {
        assemblyId: { type: "string" },
        environment: { type: "string" }
      },
      effect: "write",
      handlerKind: "builtin",
      handlerRef: "dehydrationService.dehydrateSession",
      isActive: true,
    }).onConflictDoNothing();
  }

  logger.info("[SeedAntigravityOntology] Ontology seeding complete.");
}

seedAntigravityOntology()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(`[SeedAntigravityOntology] Failed: ${err.message}`);
    process.exit(1);
  });
