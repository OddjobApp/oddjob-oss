import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb, decimal, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { orgs } from '../auth.js';
import { knowledgeNodes } from './graph.js';
import { missions } from '../missions/core.js';

/**
 * Calculation Node Types
 * 
 * These are specialized node labels for mathematical/computational operations.
 * They extend the existing knowledge graph without modifying the base schema.
 */
export const calculationNodeLabelEnum = [
    "CALCULATION",         // General mathematical calculation
    "AGGREGATION",         // Sum, average, count operations
    "TRANSFORMATION",      // Unit conversion, data transformation
    "METRIC",              // Business/system metric
    "FORECAST",            // Predictive calculation
    "ANOMALY_DETECTION",   // Statistical anomaly detection
] as const;

export type CalculationNodeLabel = (typeof calculationNodeLabelEnum)[number];

/**
 * Calculation Operation Types
 */
export const calculationOperationEnum = [
    // Basic arithmetic. FORMULA is the free-form expression the service evaluates
    // with the basic evaluator; the builder's default, so it has to validate.
    "FORMULA", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MODULO", "POWER",
    
    // Statistical
    "SUM", "AVERAGE", "COUNT", "MIN", "MAX", "STDDEV", "VARIANCE",
    
    // Time-based (Temporal Calculations)
    "MOVING_AVERAGE", "YEAR_OVER_YEAR", "MONTH_OVER_MONTH", "CAGR",
    "EXPONENTIAL_SMOOTHING", "ROLLING_SUM", "ROLLING_AVERAGE",
    
    // Conditional
    "IF_ELSE", "CASE",
    
    // Advanced
    "REGRESSION", "FORECAST", "ANOMALY_SCORE",
    
    // Probabilistic (Bayesian & Monte Carlo)
    "MONTE_CARLO_SIMULATION", "BAYESIAN_INFERENCE", "PROBABILITY_DISTRIBUTION",
    "CONFIDENCE_INTERVAL", "RISK_ASSESSMENT", "SENSITIVITY_ANALYSIS",
    
    // Constraint & Rule Validation
    "RULE_VALIDATION", "CONDITIONAL_LOGIC", "POLICY_ENFORCEMENT",
    "CONSTRAINT_CHECK", "GATE_CONDITION", "COMPLIANCE_CHECK",
    
    // Graph Algorithms
    "PAGERANK", "BETWEENNESS_CENTRALITY", "CLOSENESS_CENTRALITY",
    "SHORTEST_PATH", "MINIMUM_SPANNING_TREE", "COMMUNITY_DETECTION",
    "INFLUENCE_PROPAGATION", "GRAPH_CLUSTERING", "NETWORK_ANALYSIS",
    
    // Machine Learning Inference
    "MODEL_PREDICTION", "CLASSIFICATION", "REGRESSION_INFERENCE",
    "ANOMALY_DETECTION", "FEATURE_EXTRACTION", "MODEL_ENSEMBLE",
    "CLUSTERING_INFERENCE", "DIMENSIONALITY_REDUCTION",
] as const;

export type CalculationOperation = (typeof calculationOperationEnum)[number];

/**
 * Calculation Status
 */
export const calculationStatusEnum = ["ACTIVE", "DISABLED", "ERROR"] as const;
export type CalculationStatus = (typeof calculationStatusEnum)[number];

/**
 * Calculation Nodes Table
 * 
 * Stores metadata for calculation nodes. The actual node data is stored in
 * knowledgeNodes with label matching one of calculationNodeLabelEnum.
 * This table provides calculation-specific structure and validation.
 */
export const calculationNodes = pgTable("calculation_nodes", {
    id: serial("id").primaryKey(),
    nodeId: integer("node_id").references(() => knowledgeNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: 'set null' }),
    
    // Calculation definition
    operation: text("operation").notNull(), // CalculationOperation
    formula: text("formula").notNull(), // Human-readable formula
    formulaCompiled: jsonb("formula_compiled").default({}), // Parsed/compiled formula structure
    
    // Input references
    inputReferences: jsonb("input_references").default(sql`'[]'::jsonb`), // Array of { nodeId, variable, alias }
    
    // Output configuration
    outputUnit: text("output_unit"), // Unit for the result (%, $, etc.)
    outputPrecision: integer("output_precision").default(2), // Decimal places
    
    // Temporal calculation configuration
    windowSize: integer("window_size"), // For moving averages, rolling calculations
    timePeriod: text("time_period"), // "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"
    smoothingFactor: decimal("smoothing_factor", { precision: 3, scale: 2 }), // For exponential smoothing (0-1)
    baselineDate: timestamp("baseline_date"), // For YoY/MoM calculations
    
    // Probabilistic calculation configuration
    distributionType: text("distribution_type"), // "NORMAL", "UNIFORM", "TRIANGULAR", "BETA", "LOGNORMAL"
    distributionParameters: jsonb("distribution_parameters").default({}), // { mean, stdDev, min, max, alpha, beta }
    simulationIterations: integer("simulation_iterations").default(10000), // Monte Carlo iterations
    confidenceLevel: decimal("confidence_level", { precision: 3, scale: 2 }).default("0.95"), // 0.90, 0.95, 0.99
    priorDistribution: jsonb("prior_distribution").default({}), // Bayesian prior
    likelihoodFunction: text("likelihood_function"), // Bayesian likelihood function type
    
    // Constraint & rule validation configuration
    ruleDefinition: jsonb("rule_definition").default({}), // Rule conditions and actions
    ruleType: text("rule_type"), // "VALIDATION", "TRANSFORMATION", "ENFORCEMENT", "NOTIFICATION"
    constraintType: text("constraint_type"), // "RANGE", "EQUALITY", "EXISTENCE", "UNIQUE", "CUSTOM"
    constraintParameters: jsonb("constraint_parameters").default({}), // { min, max, allowedValues, pattern }
    enforcementAction: text("enforcement_action"), // "BLOCK", "WARN", "LOG", "CORRECT"
    gateCondition: jsonb("gate_condition").default({}), // Condition for gate logic
    complianceThreshold: decimal("compliance_threshold", { precision: 3, scale: 2 }), // Compliance percentage threshold
    
    // Graph algorithm configuration
    graphAlgorithmType: text("graph_algorithm_type"), // "CENTRALITY", "PATHFINDING", "CLUSTERING", "PROPAGATION"
    targetNodeId: integer("target_node_id"), // For pathfinding algorithms
    maxDepth: integer("max_depth"), // For graph traversal
    dampingFactor: decimal("damping_factor", { precision: 3, scale: 2 }), // For PageRank (default 0.85)
    iterations: integer("iterations"), // For iterative algorithms
    edgeWeightProperty: text("edge_weight_property"), // Property name for edge weights
    nodeWeightProperty: text("node_weight_property"), // Property name for node weights
    communityDetectionMethod: text("community_detection_method"), // "LOUVAIN", "LEIDEN", "LABEL_PROPAGATION"
    
    // Machine Learning inference configuration
    modelId: text("model_id"), // Reference to ML model
    modelVersion: text("model_version"), // Model version for A/B testing
    modelType: text("model_type"), // "REGRESSION", "CLASSIFICATION", "CLUSTERING", "ANOMALY_DETECTION"
    featureConfig: jsonb("feature_config").default({}), // Feature extraction configuration
    predictionThreshold: decimal("prediction_threshold", { precision: 3, scale: 2 }), // Threshold for binary classification
    confidenceThreshold: decimal("confidence_threshold", { precision: 3, scale: 2 }), // Minimum confidence for predictions
    ensembleStrategy: text("ensemble_strategy"), // "MAJORITY_VOTE", "WEIGHTED_AVERAGE", "STACKING"
    anomalyDetectionMethod: text("anomaly_detection_method"), // "ISOLATION_FOREST", "AUTOENCODER", "STATISTICAL"
    
    // Caching and performance
    cachedResult: decimal("cached_result", { precision: 20, scale: 10 }),
    lastCalculatedAt: timestamp("last_calculated_at"),
    cacheTtlSeconds: integer("cache_ttl_seconds").default(300), // 5 minutes default
    
    // Status and validation
    status: text("status").notNull().default("ACTIVE"), // CalculationStatus
    validationError: text("validation_error"),
    
    // Metadata
    description: text("description"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("calc_node_node_idx").on(table.nodeId),
    index("calc_node_org_idx").on(table.organizationId),
    index("calc_node_mission_idx").on(table.missionId),
    index("calc_node_status_idx").on(table.status),
]);

export type CalculationNode = typeof calculationNodes.$inferSelect;
export type InsertCalculationNode = typeof calculationNodes.$inferInsert;

/**
 * Calculation Input Reference Schema
 */
export const calculationInputReferenceSchema = z.object({
    nodeId: z.number().int().positive(),
    variable: z.string().min(1), // Variable name in formula
    alias: z.string().optional(), // Optional display name
    field: z.string().min(1).optional(), // Explicit node.data path, e.g. Balance
    currency: z.string().regex(/^[A-Z]{3}$/).optional(), // Expected monetary unit
    required: z.boolean().default(true),
    defaultValue: z.number().optional(),
});

/**
 * Calculation Node Creation Schema
 */
export const createCalculationNodeSchema = z.object({
    nodeId: z.number().int().positive(),
    organizationId: z.number().int().positive(),
    missionId: z.number().int().positive().optional().nullable(),
    operation: z.enum(calculationOperationEnum),
    formula: z.string().min(1).max(1000),
    formulaCompiled: z.record(z.any()).optional().default({}),
    inputReferences: z.array(calculationInputReferenceSchema).default([]),
    outputUnit: z.string().max(50).optional().nullable(),
    outputPrecision: z.number().int().min(0).max(10).default(2),
    windowSize: z.number().int().min(1).optional(), // For temporal calculations
    timePeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
    smoothingFactor: z.number().min(0).max(1).optional(), // For exponential smoothing
    baselineDate: z.date().optional(), // For YoY/MoM calculations
    distributionType: z.enum(["NORMAL", "UNIFORM", "TRIANGULAR", "BETA", "LOGNORMAL"]).optional(),
    distributionParameters: z.record(z.any()).optional(),
    simulationIterations: z.number().int().min(100).max(1000000).default(10000),
    confidenceLevel: z.number().min(0).max(1).default(0.95),
    priorDistribution: z.record(z.any()).optional(),
    likelihoodFunction: z.string().optional(),
    ruleDefinition: z.record(z.any()).optional(),
    ruleType: z.enum(["VALIDATION", "TRANSFORMATION", "ENFORCEMENT", "NOTIFICATION"]).optional(),
    // SET_MEMBERSHIP is evaluated by both the service and the constraint evaluator
    // and offered by the builder, but was missing here.
    constraintType: z.enum(["RANGE", "EQUALITY", "EXISTENCE", "UNIQUE", "SET_MEMBERSHIP", "CUSTOM"]).optional(),
    constraintParameters: z.record(z.any()).optional(),
    enforcementAction: z.enum(["BLOCK", "WARN", "LOG", "CORRECT"]).optional(),
    gateCondition: z.record(z.any()).optional(),
    complianceThreshold: z.number().min(0).max(1).optional(),
    graphAlgorithmType: z.enum(["CENTRALITY", "PATHFINDING", "CLUSTERING", "PROPAGATION"]).optional(),
    targetNodeId: z.number().int().positive().optional(),
    maxDepth: z.number().int().min(1).max(100).optional(),
    dampingFactor: z.number().min(0).max(1).optional(),
    iterations: z.number().int().min(1).max(10000).optional(),
    edgeWeightProperty: z.string().optional(),
    nodeWeightProperty: z.string().optional(),
    communityDetectionMethod: z.enum(["LOUVAIN", "LEIDEN", "LABEL_PROPAGATION"]).optional(),
    modelId: z.string().optional(),
    modelVersion: z.string().optional(),
    modelType: z.enum(["REGRESSION", "CLASSIFICATION", "CLUSTERING", "ANOMALY_DETECTION"]).optional(),
    featureConfig: z.record(z.any()).optional(),
    predictionThreshold: z.number().min(0).max(1).optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    ensembleStrategy: z.enum(["MAJORITY_VOTE", "WEIGHTED_AVERAGE", "STACKING"]).optional(),
    anomalyDetectionMethod: z.enum(["ISOLATION_FOREST", "AUTOENCODER", "STATISTICAL"]).optional(),
    cacheTtlSeconds: z.number().int().min(0).default(300),
    status: z.enum(calculationStatusEnum).default("ACTIVE"),
    description: z.string().max(500).optional().nullable(),
    createdBy: z.string().optional().nullable(),
});

/**
 * Calculation Node Update Schema
 */
export const updateCalculationNodeSchema = createCalculationNodeSchema.partial().extend({
    nodeId: z.number().int().positive().optional(),
    organizationId: z.number().int().positive().optional(),
});

/*
  z.input, not z.infer.

  These name what a CALLER supplies, which is the pre-parse shape. z.infer is
  z.output, where every `.default()` field — status, formulaCompiled,
  outputPrecision, simulationIterations, confidenceLevel, cacheTtlSeconds — is
  required, because after parsing it is always present. Typing the input side
  with the output type therefore demanded that callers pass the very values the
  defaults exist to supply, and every call site in the codebase failed to
  type-check.

  Nothing depends on the defaults being present at runtime: createCalculation
  spreads the input straight into a drizzle insert, and the columns carry their
  own defaults.
*/
export type CreateCalculationNodeInput = z.input<typeof createCalculationNodeSchema>;
export type UpdateCalculationNodeInput = z.input<typeof updateCalculationNodeSchema>;

/**
 * Calculation Execution Log
 * 
 * Tracks each calculation execution for debugging and auditing.
 */
export const calculationExecutionLogs = pgTable("calculation_execution_logs", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Execution details
    inputs: jsonb("inputs").notNull().default({}), // Actual input values used
    result: decimal("result", { precision: 20, scale: 10 }),
    executionTimeMs: integer("execution_time_ms"), // Performance tracking
    
    // Status
    status: text("status").notNull(), // "SUCCESS" | "ERROR"
    errorMessage: text("error_message"),
    
    // Context
    triggeredBy: text("triggered_by"), // "system", "user", "node_update"
    triggeredByNodeId: integer("triggered_by_node_id"), // Which node change triggered this
    
    // Timestamps
    executedAt: timestamp("executed_at").defaultNow(),
}, (table) => [
    index("calc_exec_calc_idx").on(table.calculationNodeId),
    index("calc_exec_org_idx").on(table.organizationId),
    index("calc_exec_status_idx").on(table.status),
    index("calc_exec_time_idx").on(table.executedAt),
]);

export type CalculationExecutionLog = typeof calculationExecutionLogs.$inferSelect;
export type InsertCalculationExecutionLog = typeof calculationExecutionLogs.$inferInsert;

/**
 * Calculation Dependencies
 * 
 * Tracks which calculations depend on which nodes for reactive updates.
 */
export const calculationDependencies = pgTable("calculation_dependencies", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    dependsOnNodeId: integer("depends_on_node_id").references(() => knowledgeNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Dependency metadata
    variableName: text("variable_name").notNull(), // Variable name in formula
    required: boolean("required").default(true),
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("calc_dep_calc_idx").on(table.calculationNodeId),
    index("calc_dep_node_idx").on(table.dependsOnNodeId),
    index("calc_dep_org_idx").on(table.organizationId),
    /*
      Keyed on the variable too, not just the node.

      A calculation may bind two formula variables to the same source node —
      resolveInputContext builds its context by variable_name, so that needs two
      rows. Without variableName here, `{input1: nodeB, input2: nodeB}` was a
      duplicate-key 500 with no way to express it.

      This index also did not exist in the database until migration 0040: 0033
      wrote an inline table constraint under a Postgres-generated name instead,
      so this declaration had been drifting from reality since the table was
      created.
    */
    uniqueIndex("calc_dep_unique").on(
        table.calculationNodeId,
        table.dependsOnNodeId,
        table.variableName,
    ),
]);

export type CalculationDependency = typeof calculationDependencies.$inferSelect;
export type InsertCalculationDependency = typeof calculationDependencies.$inferInsert;

/**
 * Time Series Data Points
 * 
 * Stores historical data points for temporal calculations.
 * Enables time-series analysis, moving averages, and trend calculations.
 */
export const calculationTimeSeries = pgTable("calculation_time_series", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Data point
    timestamp: timestamp("timestamp").notNull(), // When this data point was recorded
    value: decimal("value", { precision: 20, scale: 10 }).notNull(), // The value at this timestamp
    
    // Metadata
    sourceNodeId: integer("source_node_id").references(() => knowledgeNodes.id, { onDelete: 'set null' }), // Which node provided this value
    period: text("period"), // "DAILY", "WEEKLY", "MONTHLY", etc.
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("calc_ts_calc_idx").on(table.calculationNodeId),
    index("calc_ts_org_idx").on(table.organizationId),
    index("calc_ts_timestamp_idx").on(table.timestamp),
    index("calc_ts_calc_timestamp_idx").on(table.calculationNodeId, table.timestamp),
]);

export type CalculationTimeSeries = typeof calculationTimeSeries.$inferSelect;
export type InsertCalculationTimeSeries = typeof calculationTimeSeries.$inferInsert;

/**
 * Monte Carlo Simulation Results
 * 
 * Stores results from Monte Carlo simulations for probabilistic calculations.
 * Enables statistical analysis and confidence interval calculations.
 */
export const monteCarloResults = pgTable("monte_carlo_results", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Simulation metadata
    iterations: integer("iterations").notNull(), // Number of simulation runs
    seed: integer("seed"), // Random seed for reproducibility
    
    // Statistical results
    mean: decimal("mean", { precision: 20, scale: 10 }).notNull(),
    median: decimal("median", { precision: 20, scale: 10 }).notNull(),
    stdDev: decimal("std_dev", { precision: 20, scale: 10 }).notNull(),
    min: decimal("min", { precision: 20, scale: 10 }).notNull(),
    max: decimal("max", { precision: 20, scale: 10 }).notNull(),
    
    // Percentiles
    percentile5: decimal("percentile_5", { precision: 20, scale: 10 }),
    percentile25: decimal("percentile_25", { precision: 20, scale: 10 }),
    percentile75: decimal("percentile_75", { precision: 20, scale: 10 }),
    percentile95: decimal("percentile_95", { precision: 20, scale: 10 }),
    
    // Confidence intervals
    confidenceLevel: decimal("confidence_level", { precision: 3, scale: 2 }).notNull(),
    confidenceIntervalLower: decimal("confidence_interval_lower", { precision: 20, scale: 10 }),
    confidenceIntervalUpper: decimal("confidence_interval_upper", { precision: 20, scale: 10 }),
    
    // Raw samples (stored as JSON array for analysis)
    samples: jsonb("samples").default(sql`'[]'::jsonb`),
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("mc_calc_idx").on(table.calculationNodeId),
    index("mc_org_idx").on(table.organizationId),
    index("mc_created_idx").on(table.createdAt),
]);

export type MonteCarloResult = typeof monteCarloResults.$inferSelect;
export type InsertMonteCarloResult = typeof monteCarloResults.$inferInsert;

/**
 * Bayesian Inference Results
 * 
 * Stores results from Bayesian inference calculations.
 * Tracks posterior distributions and evidence updates.
 */
export const bayesianInferenceResults = pgTable("bayesian_inference_results", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Bayesian components
    priorDistribution: jsonb("prior_distribution").notNull(), // Prior distribution parameters
    likelihoodFunction: text("likelihood_function").notNull(),
    posteriorDistribution: jsonb("posterior_distribution").notNull(), // Posterior distribution parameters
    evidence: decimal("evidence", { precision: 20, scale: 10 }), // Marginal likelihood
    
    // Posterior statistics
    posteriorMean: decimal("posterior_mean", { precision: 20, scale: 10 }),
    posteriorStdDev: decimal("posterior_std_dev", { precision: 20, scale: 10 }),
    posteriorMode: decimal("posterior_mode", { precision: 20, scale: 10 }),
    
    // Update metadata
    dataPoints: integer("data_points").notNull(), // Number of data points used
    lastUpdateAt: timestamp("last_update_at").defaultNow(),
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("bayes_calc_idx").on(table.calculationNodeId),
    index("bayes_org_idx").on(table.organizationId),
    index("bayes_update_idx").on(table.lastUpdateAt),
]);

export type BayesianInferenceResult = typeof bayesianInferenceResults.$inferSelect;
export type InsertBayesianInferenceResult = typeof bayesianInferenceResults.$inferInsert;

/**
 * Constraint Validation Results
 * 
 * Stores results from rule validation and constraint checks.
 * Tracks compliance status and enforcement actions taken.
 */
export const constraintValidationResults = pgTable("constraint_validation_results", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Validation metadata
    ruleType: text("rule_type").notNull(), // "VALIDATION", "TRANSFORMATION", "ENFORCEMENT", "NOTIFICATION"
    constraintType: text("constraint_type").notNull(), // "RANGE", "EQUALITY", "EXISTENCE", "UNIQUE", "CUSTOM"
    
    // Validation results
    passed: boolean("passed").notNull(),
    complianceScore: decimal("compliance_score", { precision: 5, scale: 2 }), // 0-100
    violations: jsonb("violations").default(sql`'[]'::jsonb`), // Array of violation details
    
    // Enforcement action taken
    enforcementAction: text("enforcement_action"), // "BLOCK", "WARN", "LOG", "CORRECT"
    actionTaken: text("action_taken"), // Description of action taken
    actionResult: text("action_result"), // "SUCCESS", "FAILED", "SKIPPED"
    
    // Context
    evaluatedAt: timestamp("evaluated_at").defaultNow(),
    triggeredBy: text("triggered_by"), // "system", "user", "node_update"
    triggeredByNodeId: integer("triggered_by_node_id"),
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("constraint_calc_idx").on(table.calculationNodeId),
    index("constraint_org_idx").on(table.organizationId),
    index("constraint_passed_idx").on(table.passed),
    index("constraint_evaluated_idx").on(table.evaluatedAt),
]);

export type ConstraintValidationResult = typeof constraintValidationResults.$inferSelect;
export type InsertConstraintValidationResult = typeof constraintValidationResults.$inferInsert;

/**
 * Rule Definitions
 * 
 * Stores reusable rule definitions that can be applied to multiple calculations.
 * Enables centralized rule management and versioning.
 */
export const ruleDefinitions = pgTable("rule_definitions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Rule definition
    name: text("name").notNull(),
    description: text("description"),
    ruleType: text("rule_type").notNull(), // "VALIDATION", "TRANSFORMATION", "ENFORCEMENT", "NOTIFICATION"
    constraintType: text("constraint_type").notNull(), // "RANGE", "EQUALITY", "EXISTENCE", "UNIQUE", "CUSTOM"
    ruleLogic: jsonb("rule_logic").notNull(), // Rule conditions and logic
    constraintParameters: jsonb("constraint_parameters").default({}),
    
    // Enforcement configuration
    enforcementAction: text("enforcement_action").default("WARN"),
    severity: text("severity").default("MEDIUM"), // "LOW", "MEDIUM", "HIGH", "CRITICAL"
    
    // Versioning
    version: integer("version").default(1),
    isActive: boolean("is_active").default(true),
    
    // Metadata
    category: text("category"), // "BUSINESS", "TECHNICAL", "SECURITY", "COMPLIANCE"
    tags: jsonb("tags").default(sql`'[]'::jsonb`),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("rule_org_idx").on(table.organizationId),
    index("rule_type_idx").on(table.ruleType),
    index("rule_category_idx").on(table.category),
    index("rule_active_idx").on(table.isActive),
]);

export type RuleDefinition = typeof ruleDefinitions.$inferSelect;
export type InsertRuleDefinition = typeof ruleDefinitions.$inferInsert;

/**
 * Graph Algorithm Results
 * 
 * Stores results from graph algorithm calculations like centrality,
 * pathfinding, and community detection on the knowledge graph.
 */
export const graphAlgorithmResults = pgTable("graph_algorithm_results", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Algorithm metadata
    algorithmType: text("algorithm_type").notNull(), // "CENTRALITY", "PATHFINDING", "CLUSTERING", "PROPAGATION"
    algorithmName: text("algorithm_name").notNull(), // "PAGERANK", "BETWEENNESS", "SHORTEST_PATH", etc.
    
    // Graph snapshot
    nodeCount: integer("node_count"),
    edgeCount: integer("edge_count"),
    graphSnapshot: jsonb("graph_snapshot").default({}), // Snapshot of graph structure used
    
    // Results
    result: jsonb("result").notNull(), // Algorithm-specific results
    score: decimal("score", { precision: 20, scale: 10 }), // Primary score/metric
    path: jsonb("path").default(sql`'[]'::jsonb`), // For pathfinding: array of node IDs
    communities: jsonb("communities").default(sql`'[]'::jsonb`), // For community detection
    centralityScores: jsonb("centrality_scores").default(sql`'[]'::jsonb`), // For centrality: { nodeId, score }
    
    // Performance
    executionTimeMs: integer("execution_time_ms"),
    iterations: integer("iterations"),
    
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("graph_calc_idx").on(table.calculationNodeId),
    index("graph_org_idx").on(table.organizationId),
    index("graph_algorithm_idx").on(table.algorithmType),
    index("graph_created_idx").on(table.createdAt),
]);

export type GraphAlgorithmResult = typeof graphAlgorithmResults.$inferSelect;
export type InsertGraphAlgorithmResult = typeof graphAlgorithmResults.$inferInsert;

/**
 * Graph Centrality Scores
 * 
 * Stores centrality scores for nodes in the knowledge graph.
 * Enables efficient querying of important/influential nodes.
 */
export const graphCentralityScores = pgTable("graph_centrality_scores", {
    id: serial("id").primaryKey(),
    nodeId: integer("node_id").references(() => knowledgeNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }),
    
    // Centrality metrics
    pageRank: decimal("page_rank", { precision: 20, scale: 10 }),
    betweenness: decimal("betweenness", { precision: 20, scale: 10 }),
    closeness: decimal("closeness", { precision: 20, scale: 10 }),
    degree: integer("degree"),
    eigenvector: decimal("eigenvector", { precision: 20, scale: 10 }),
    
    // Metadata
    calculatedAt: timestamp("calculated_at").defaultNow(),
    graphSnapshotId: integer("graph_snapshot_id"),
}, (table) => [
    index("centrality_node_idx").on(table.nodeId),
    index("centrality_org_idx").on(table.organizationId),
    index("centrality_calc_idx").on(table.calculationNodeId),
    index("centrality_pagerank_idx").on(table.pageRank),
    uniqueIndex("centrality_node_calc_unique").on(table.nodeId, table.calculationNodeId),
]);

export type GraphCentralityScore = typeof graphCentralityScores.$inferSelect;
export type InsertGraphCentralityScore = typeof graphCentralityScores.$inferInsert;

/**
 * ML Model Versions
 * 
 * Stores version information for ML models used in inference calculations.
 * Enables A/B testing, model rollback, and performance tracking.
 */
export const mlModelVersions = pgTable("ml_model_versions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Model identification
    modelId: text("model_id").notNull(),
    modelVersion: text("model_version").notNull(),
    modelType: text("model_type").notNull(), // "REGRESSION", "CLASSIFICATION", "CLUSTERING", "ANOMALY_DETECTION"
    modelName: text("model_name").notNull(),
    
    // Model metadata
    modelConfig: jsonb("model_config").default({}), // Model hyperparameters and configuration
    featureSchema: jsonb("feature_schema").default({}), // Expected input features
    outputSchema: jsonb("output_schema").default({}), // Expected output structure
    
    // Performance metrics
    accuracy: decimal("accuracy", { precision: 5, scale: 4 }),
    precision: decimal("precision", { precision: 5, scale: 4 }),
    recall: decimal("recall", { precision: 5, scale: 4 }),
    f1Score: decimal("f1_score", { precision: 5, scale: 4 }),
    mse: decimal("mse", { precision: 20, scale: 10 }),
    trainingDataSize: integer("training_data_size"),
    
    // Deployment
    isDeployed: boolean("is_deployed").default(false),
    deploymentDate: timestamp("deployment_date"),
    isDefault: boolean("is_default").default(false),
    
    // Metadata
    description: text("description"),
    tags: jsonb("default_tags").default(sql`'[]'::jsonb`),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("ml_model_org_idx").on(table.organizationId),
    index("ml_model_id_idx").on(table.modelId),
    index("ml_model_version_idx").on(table.modelVersion),
    index("ml_model_type_idx").on(table.modelType),
    index("ml_model_deployed_idx").on(table.isDeployed),
    uniqueIndex("ml_model_unique").on(table.modelId, table.modelVersion),
]);

export type MLModelVersion = typeof mlModelVersions.$inferSelect;
export type InsertMLModelVersion = typeof mlModelVersions.$inferInsert;

/**
 * ML Inference Results
 * 
 * Stores results from ML model inference calculations.
 * Tracks predictions, classifications, and anomaly detection results.
 */
export const mlInferenceResults = pgTable("ml_inference_results", {
    id: serial("id").primaryKey(),
    calculationNodeId: integer("calculation_node_id").references(() => calculationNodes.id, { onDelete: 'cascade' }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Model information
    modelId: text("model_id").notNull(),
    modelVersion: text("model_version").notNull(),
    modelType: text("model_type").notNull(),
    
    // Input features
    features: jsonb("features").notNull(), // Input feature vector
    featureHash: text("feature_hash"), // Hash for deduplication
    
    // Prediction results
    prediction: jsonb("prediction").notNull(), // Model prediction output
    predictionScore: decimal("prediction_score", { precision: 20, scale: 10 }), // Confidence/probability score
    predictionLabel: text("prediction_label"), // Class label for classification
    
    // Classification specific
    classProbabilities: jsonb("class_probabilities").default(sql`'{}'::jsonb`),
    isAnomaly: boolean("is_anomaly"),
    anomalyScore: decimal("anomaly_score", { precision: 20, scale: 10 }),
    
    // Performance
    inferenceTimeMs: integer("inference_time_ms"),
    modelVersionUsed: text("model_version_used"),
    
    // Metadata
    executedAt: timestamp("executed_at").defaultNow(),
    triggeredBy: text("triggered_by"),
}, (table) => [
    index("ml_inference_calc_idx").on(table.calculationNodeId),
    index("ml_inference_org_idx").on(table.organizationId),
    index("ml_inference_model_idx").on(table.modelId),
    index("ml_inference_executed_idx").on(table.executedAt),
    index("ml_inference_anomaly_idx").on(table.isAnomaly),
]);

export type MLInferenceResult = typeof mlInferenceResults.$inferSelect;
export type InsertMLInferenceResult = typeof mlInferenceResults.$inferInsert;

/**
 * Feature Extraction Pipelines
 * 
 * Stores feature extraction pipeline configurations for ML calculations.
 * Enables reusable feature engineering workflows.
 */
export const featureExtractionPipelines = pgTable("feature_extraction_pipelines", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: 'cascade' }).notNull(),
    
    // Pipeline definition
    name: text("name").notNull(),
    description: text("description"),
    pipelineConfig: jsonb("pipeline_config").notNull(), // Feature extraction steps
    inputSchema: jsonb("input_schema").default({}), // Expected input structure
    outputSchema: jsonb("output_schema").default({}), // Output feature structure
    
    // Pipeline metadata
    version: integer("version").default(1),
    isActive: boolean("is_active").default(true),
    
    // Performance
    avgExtractionTimeMs: integer("avg_extraction_time_ms"),
    
    // Metadata
    category: text("category"),
    tags: jsonb("tags").default(sql`'[]'::jsonb`),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("feature_pipe_org_idx").on(table.organizationId),
    index("feature_pipe_active_idx").on(table.isActive),
    index("feature_pipe_category_idx").on(table.category),
]);

export type FeatureExtractionPipeline = typeof featureExtractionPipelines.$inferSelect;
export type InsertFeatureExtractionPipeline = typeof featureExtractionPipelines.$inferInsert;
