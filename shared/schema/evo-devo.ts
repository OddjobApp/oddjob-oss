import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import type { DevelopmentEnvironment, GenomeDocument, PhenotypeDocument } from "../evo-devo/contracts.js";
import type { EvaluatedIndividual, FitnessVector } from "../evo-devo/contracts.js";
import type { SelectionConstraints } from "../evo-devo/selection.js";
import type { PhenotypeStage, StageEvidence } from "../evo-devo/lifecycle.js";

export const evoDevoEnvironments = pgTable("evo_devo_environments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  environmentKey: text("environment_key").notNull(),
  version: integer("version").notNull().default(1),
  document: jsonb("document").$type<DevelopmentEnvironment>().notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  keyVersionUnique: uniqueIndex("evo_devo_environment_key_version_unique").on(table.organizationId, table.environmentKey, table.version),
}));

export const evoDevoGenomes = pgTable("evo_devo_genomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  genomeKey: text("genome_key").notNull(),
  speciesId: text("species_id").notNull(),
  generation: integer("generation").notNull(),
  document: jsonb("document").$type<GenomeDocument>().notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  genomeKeyUnique: uniqueIndex("evo_devo_genome_key_unique").on(table.organizationId, table.genomeKey),
  speciesGenerationIdx: index("evo_devo_species_generation_idx").on(table.organizationId, table.speciesId, table.generation),
}));

export const evoDevoGenomeParents = pgTable("evo_devo_genome_parents", {
  childGenomeId: uuid("child_genome_id").notNull().references(() => evoDevoGenomes.id, { onDelete: "cascade" }),
  parentGenomeId: uuid("parent_genome_id").notNull().references(() => evoDevoGenomes.id, { onDelete: "restrict" }),
  ordinal: integer("ordinal").notNull(),
}, (table) => ({
  childOrdinalUnique: uniqueIndex("evo_devo_child_parent_ordinal_unique").on(table.childGenomeId, table.ordinal),
  lineageUnique: uniqueIndex("evo_devo_lineage_unique").on(table.childGenomeId, table.parentGenomeId),
}));

export const evoDevoPhenotypes = pgTable("evo_devo_phenotypes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  genomeId: uuid("genome_id").notNull().references(() => evoDevoGenomes.id, { onDelete: "restrict" }),
  environmentId: uuid("environment_id").notNull().references(() => evoDevoEnvironments.id, { onDelete: "restrict" }),
  seed: integer("seed").notNull(),
  compilerVersion: text("compiler_version").notNull(),
  document: jsonb("document").$type<PhenotypeDocument>().notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  replayUnique: uniqueIndex("evo_devo_phenotype_replay_unique").on(table.genomeId, table.environmentId, table.compilerVersion, table.seed),
  contentHashIdx: index("evo_devo_phenotype_content_hash_idx").on(table.contentHash),
}));

export const evoDevoEvaluations = pgTable("evo_devo_evaluations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  phenotypeId: uuid("phenotype_id").notNull().references(() => evoDevoPhenotypes.id, { onDelete: "restrict" }),
  evaluatorKey: text("evaluator_key").notNull(), evaluatorVersion: text("evaluator_version").notNull(),
  fitness: jsonb("fitness").$type<FitnessVector>().notNull(),
  eligible: boolean("eligible").notNull(), ineligibilityReasons: text("ineligibility_reasons").array().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  phenotypeEvaluatorIdx: index("evo_devo_evaluation_phenotype_idx").on(table.phenotypeId, table.evaluatorKey, table.createdAt),
}));

export const evoDevoPopulations = pgTable("evo_devo_populations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  populationKey: text("population_key").notNull(), speciesId: text("species_id").notNull(),
  constraints: jsonb("constraints").$type<SelectionConstraints>().notNull(),
  status: text("status").notNull().default("active"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ populationKeyUnique: uniqueIndex("evo_devo_population_key_unique").on(table.organizationId, table.populationKey) }));

export const evoDevoPopulationMembers = pgTable("evo_devo_population_members", {
  populationId: uuid("population_id").notNull().references(() => evoDevoPopulations.id, { onDelete: "cascade" }),
  phenotypeId: uuid("phenotype_id").notNull().references(() => evoDevoPhenotypes.id, { onDelete: "restrict" }),
  cohort: integer("cohort").notNull(), admittedAt: timestamp("admitted_at").defaultNow().notNull(),
}, (table) => ({ memberUnique: uniqueIndex("evo_devo_population_member_unique").on(table.populationId, table.phenotypeId) }));

export const evoDevoSelectionRuns = pgTable("evo_devo_selection_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  populationId: uuid("population_id").notNull().references(() => evoDevoPopulations.id, { onDelete: "restrict" }),
  candidates: jsonb("candidates").$type<EvaluatedIndividual[]>().notNull(),
  selectedGenomeIds: text("selected_genome_ids").array().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const evoDevoStageEvents = pgTable("evo_devo_stage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  phenotypeId: uuid("phenotype_id").notNull().references(() => evoDevoPhenotypes.id, { onDelete: "restrict" }),
  fromStage: text("from_stage").$type<PhenotypeStage>(),
  toStage: text("to_stage").$type<PhenotypeStage>().notNull(),
  action: text("action").notNull(), evidence: jsonb("evidence").$type<StageEvidence>().notNull(),
  actorId: text("actor_id").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ phenotypeStageIdx: index("evo_devo_stage_phenotype_idx").on(table.phenotypeId, table.createdAt) }));

export type EvoDevoGenomeRecord = typeof evoDevoGenomes.$inferSelect;
export type EvoDevoPhenotypeRecord = typeof evoDevoPhenotypes.$inferSelect;
