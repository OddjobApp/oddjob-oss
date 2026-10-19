import { numericNodeInput } from './financial-input.js';
import { sumMoneyNumber } from '@shared/financial-money.js';
import { db } from "@server/database_service.js";
import {
    calculationNodes,
    calculationExecutionLogs,
    calculationDependencies,
    calculationTimeSeries,
    monteCarloResults,
    bayesianInferenceResults,
    constraintValidationResults,
    ruleDefinitions,
    graphAlgorithmResults,
    graphCentralityScores,
    mlModelVersions,
    mlInferenceResults,
    featureExtractionPipelines,
    type CalculationNode,
    type CreateCalculationNodeInput,
    type UpdateCalculationNodeInput,
    type InsertCalculationExecutionLog,
    type InsertCalculationTimeSeries,
    type InsertMonteCarloResult,
    type InsertBayesianInferenceResult,
    type InsertConstraintValidationResult,
    type InsertRuleDefinition,
    type InsertGraphAlgorithmResult,
    type InsertGraphCentralityScore,
    type InsertMLModelVersion,
    type InsertMLInferenceResult,
    type InsertFeatureExtractionPipeline,
} from "@shared/schema/knowledge/calculations.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/knowledge/graph.js";
import { eq, and, sql, desc, inArray, gte, lte } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
// requireOrgId rather than reading orgContext.organizationId directly: the
// field is `number | null`, and every use here scopes a tenant query or writes
// a NOT NULL column. Passing null would have widened a query past its
// organization; this turns that into a 403 at the boundary instead.
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { getOrgConditions } from "@server/utils/index.js";
import { basicEvaluator } from "./evaluators/basic.evaluator.js";
import { temporalEvaluator } from "./evaluators/temporal.evaluator.js";
import { probabilisticEvaluator } from "./evaluators/probabilistic.evaluator.js";
import { constraintEvaluator } from "./evaluators/constraint.evaluator.js";
import { graphEvaluator } from "./evaluators/graph.evaluator.js";
import { mlEvaluator } from "./evaluators/ml.evaluator.js";
import { layoutVerificationEvaluator } from "./evaluators/layout-verification.evaluator.js";

const logger = createLogger("CalculationService");

/**
 * Safe formula evaluation context
 */
interface FormulaContext {
    [variable: string]: number;
}

/**
 * Calculation result with metadata
 */
interface CalculationResult {
    value: number;
    executionTimeMs: number;
    cached: boolean;
    error?: string;
}

/**
 * Numeric columns stored as SQL DECIMAL.
 *
 * Drizzle types `decimal()` as `string` so that precision survives the round
 * trip, but the zod input schemas declare these as `z.number()` — which is the
 * right thing for a caller to pass. Without a conversion at the write boundary
 * every insert and update of a calculation node failed to type-check.
 */
const DECIMAL_FIELDS = [
    "smoothingFactor",
    "confidenceLevel",
    "complianceThreshold",
    "dampingFactor",
    "predictionThreshold",
    "confidenceThreshold",
    "cachedResult",
] as const;

type DecimalField = (typeof DECIMAL_FIELDS)[number];

/**
 * The same payload with its DECIMAL-backed fields widened from number to string.
 *
 * Homomorphic, so optionality is preserved: `smoothingFactor?: number` becomes
 * `smoothingFactor?: string`. Exclude keeps null and undefined, which are
 * meaningful here — they mean "no value for this column".
 */
type DecimalsAsStrings<T> = {
    [K in keyof T]: K extends DecimalField ? string | Exclude<T[K], number> : T[K];
};

/**
 * Renders the DECIMAL-backed fields of a calculation payload as strings.
 *
 * Only converts keys that are actually present and numeric, so a partial update
 * stays partial and an explicit null survives as a null rather than becoming
 * the string "null".
 */
function withDecimalsAsStrings<T extends Record<string, unknown>>(input: T): DecimalsAsStrings<T> {
    const out: Record<string, unknown> = { ...input };

    for (const field of DECIMAL_FIELDS) {
        const value = out[field];
        if (typeof value === "number") {
            out[field] = String(value);
        }
    }

    return out as DecimalsAsStrings<T>;
}

/**
 * Calculation Service
 *
 * Provides safe mathematical computation within the knowledge graph.
 * Uses a sandboxed evaluation environment to prevent code injection.
 */
export const calculationService = {
    /**
     * Create a calculation node
     */
    async createCalculation(input: CreateCalculationNodeInput, orgContext: OrgContext): Promise<CalculationNode> {
        const [calculation] = await db.insert(calculationNodes)
            .values({
                ...withDecimalsAsStrings(input),
                organizationId: requireOrgId(orgContext),
                // Defaults to ACTIVE but honours an explicit status. This sat
                // AFTER the spread as a bare `status: "ACTIVE"`, which silently
                // discarded whatever the caller asked for — creating a DISABLED
                // calculation was impossible, and it came back enabled and ran.
                status: input.status ?? "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        // Create dependency records for reactive updates
        if (input.inputReferences && input.inputReferences.length > 0) {
            const dependencies = input.inputReferences.map(ref => ({
                calculationNodeId: calculation.id,
                dependsOnNodeId: ref.nodeId,
                organizationId: requireOrgId(orgContext),
                variableName: ref.variable,
                required: ref.required ?? true,
            }));

            await db.insert(calculationDependencies).values(dependencies);
        }

        logger.info("Calculation node created", { 
            calculationId: calculation.id, 
            nodeId: calculation.nodeId,
            operation: calculation.operation 
        });

        return calculation;
    },

    /**
     * Get calculation by ID
     */
    async getCalculationById(id: number, orgContext: OrgContext): Promise<CalculationNode | null> {
        const [calculation] = await db.select()
            .from(calculationNodes)
            .where(and(
                eq(calculationNodes.id, id),
                eq(calculationNodes.organizationId, requireOrgId(orgContext))
            ))
            .limit(1);

        return calculation ?? null;
    },

    /**
     * Get calculation by node ID
     */
    async getCalculationByNodeId(nodeId: number, orgContext: OrgContext): Promise<CalculationNode | null> {
        const [calculation] = await db.select()
            .from(calculationNodes)
            .where(and(
                eq(calculationNodes.nodeId, nodeId),
                eq(calculationNodes.organizationId, requireOrgId(orgContext))
            ))
            .limit(1);

        return calculation ?? null;
    },

    /**
     * Update calculation node
     */
    async updateCalculation(id: number, input: UpdateCalculationNodeInput, orgContext: OrgContext): Promise<CalculationNode> {
        const existing = await this.getCalculationById(id, orgContext);
        if (!existing) {
            throw new Error(`Calculation ${id} not found`);
        }

        const [updated] = await db.update(calculationNodes)
            .set({
                ...withDecimalsAsStrings(input),
                updatedAt: new Date(),
                // Clear cache if formula or inputs changed
                cachedResult: input.formula || input.inputReferences || input.outputUnit !== undefined || input.outputPrecision !== undefined ? null : existing.cachedResult,
                lastCalculatedAt: input.formula || input.inputReferences || input.outputUnit !== undefined || input.outputPrecision !== undefined ? null : existing.lastCalculatedAt,
            })
            .where(and(
                eq(calculationNodes.id, id),
                eq(calculationNodes.organizationId, requireOrgId(orgContext))
            ))
            .returning();

        // Update dependencies if input references changed
        if (input.inputReferences) {
            // Delete existing dependencies
            await db.delete(calculationDependencies)
                .where(eq(calculationDependencies.calculationNodeId, id));

            // Create new dependencies
            if (input.inputReferences.length > 0) {
                const dependencies = input.inputReferences.map(ref => ({
                    calculationNodeId: id,
                    dependsOnNodeId: ref.nodeId,
                    organizationId: requireOrgId(orgContext),
                    variableName: ref.variable,
                    required: ref.required ?? true,
                }));

                await db.insert(calculationDependencies).values(dependencies);
            }
        }

        logger.info("Calculation node updated", { calculationId: id });
        return updated;
    },

    /**
     * Delete calculation node
     */
    async deleteCalculation(id: number, orgContext: OrgContext): Promise<boolean> {
        const existing = await this.getCalculationById(id, orgContext);
        if (!existing) {
            throw new Error(`Calculation ${id} not found`);
        }

        await db.delete(calculationNodes)
            .where(and(
                eq(calculationNodes.id, id),
                eq(calculationNodes.organizationId, requireOrgId(orgContext))
            ));

        logger.info("Calculation node deleted", { calculationId: id });
        return true;
    },

    /**
     * Execute a calculation
     */
    async executeCalculation(
        calculationId: number,
        orgContext: OrgContext,
        options: { forceRecalculate?: boolean; triggeredBy?: string; triggeredByNodeId?: number } = {}
    ): Promise<CalculationResult> {
        const calculation = await this.getCalculationById(calculationId, orgContext);
        if (!calculation) {
            throw new Error(`Calculation ${calculationId} not found`);
        }

        if (calculation.status !== "ACTIVE") {
            return {
                value: 0,
                executionTimeMs: 0,
                cached: false,
                error: `Calculation is ${calculation.status}`,
            };
        }

        // Check cache
        if (!options.forceRecalculate && calculation.cachedResult && calculation.lastCalculatedAt) {
            const cacheAge = Date.now() - calculation.lastCalculatedAt.getTime();
            const ttl = (calculation.cacheTtlSeconds ?? 300) * 1000;

            if (cacheAge < ttl) {
                logger.debug("Using cached calculation result", { calculationId });
                return {
                    value: Number(calculation.cachedResult),
                    executionTimeMs: 0,
                    cached: true,
                };
            }
        }

        const startTime = Date.now();

        try {
            // Resolve input values from referenced nodes
            const context = await this.resolveInputContext(calculationId, orgContext);

            // Execute formula
            const rawResult = await this.evaluateFormula(calculation.formula, calculation.operation, context, calculation);
            const result = /^[A-Z]{3}$/.test(calculation.outputUnit ?? '') ? sumMoneyNumber([rawResult], calculation.outputUnit!) : rawResult;

            const executionTimeMs = Date.now() - startTime;

            // Update cache
            await db.update(calculationNodes)
                .set({
                    cachedResult: result.toString(),
                    lastCalculatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(calculationNodes.id, calculationId));

            // Log execution
            await this.logExecution(calculationId, requireOrgId(orgContext), {
                inputs: context,
                result: result.toString(),
                executionTimeMs,
                status: "SUCCESS",
                triggeredBy: options.triggeredBy ?? "system",
                triggeredByNodeId: options.triggeredByNodeId,
            });

            logger.info("Calculation executed successfully", { 
                calculationId, 
                result, 
                executionTimeMs 
            });

            return {
                value: result,
                executionTimeMs,
                cached: false,
            };
        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Log failure
            await this.logExecution(calculationId, requireOrgId(orgContext), {
                inputs: {},
                result: null,
                executionTimeMs,
                status: "ERROR",
                errorMessage,
                triggeredBy: options.triggeredBy ?? "system",
                triggeredByNodeId: options.triggeredByNodeId,
            });

            // Update calculation status
            await db.update(calculationNodes)
                .set({
                    status: "ERROR",
                    validationError: errorMessage,
                    updatedAt: new Date(),
                })
                .where(eq(calculationNodes.id, calculationId));

            logger.error("Calculation execution failed", { 
                calculationId, 
                error: errorMessage 
            });

            return {
                value: 0,
                executionTimeMs,
                cached: false,
                error: errorMessage,
            };
        }
    },

    /**
     * Resolve input context from referenced nodes
     * Supports both legacy inputReferences and edge-based INPUT_TO relations
     */
async resolveInputContext(calculationId: number, orgContext: OrgContext): Promise<FormulaContext> {
        const context: FormulaContext = {};
        const calculation = await this.getCalculationById(calculationId, orgContext);
        if (!calculation) throw new Error(`Calculation ${calculationId} not found`);
        const inputCurrencies = new Set<string>();
        const references = (calculation.inputReferences ?? []) as Array<{ nodeId: number; variable: string; field?: string; currency?: string }>;
        const currency = /^[A-Z]{3}$/.test(calculation.outputUnit ?? '') ? calculation.outputUnit! : undefined;

        // First, try to resolve from legacy inputReferences (backward compatibility)
        const dependencies = await db.select()
            .from(calculationDependencies)
            .where(and(eq(calculationDependencies.calculationNodeId, calculationId), eq(calculationDependencies.organizationId, requireOrgId(orgContext))));

        if (dependencies.length > 0) {
            // Legacy approach: use calculation_dependencies table
            for (const dep of dependencies) {
                const node = await db.select()
                    .from(knowledgeNodes)
                    .where(and(
                        eq(knowledgeNodes.id, dep.dependsOnNodeId),
                        eq(knowledgeNodes.organizationId, requireOrgId(orgContext))
                    ))
                    .limit(1);

                if (node.length > 0) {
                    const ref = references.find(r => r.nodeId === dep.dependsOnNodeId && r.variable === dep.variableName);
                    if (currency && ref?.currency && ref.currency !== currency) throw new Error("Calculation currency differs from its input currency.");
                    if (currency && !ref?.field) throw new Error("Financial calculations require an explicit input field.");
                    if (ref?.currency) inputCurrencies.add(ref.currency);
                    if (inputCurrencies.size > 1) throw new Error("Financial inputs use mixed currencies.");
                    const value = numericNodeInput(node[0], { field: ref?.field, currency: currency ?? ref?.currency });
                    if (Object.prototype.hasOwnProperty.call(context, dep.variableName)) throw new Error(`Duplicate calculation variable: ${dep.variableName}`);
                    context[dep.variableName] = value;
                } else if (dep.required || currency) {
                    throw new Error(`Required input node ${dep.dependsOnNodeId} not found`);
                }
            }
        } else {
            // Hybrid approach: resolve from INPUT_TO edges
            const calculation = await this.getCalculationById(calculationId, orgContext);
            if (!calculation) {
                throw new Error(`Calculation ${calculationId} not found`);
            }

            const inputEdges = await db.select()
                .from(knowledgeEdges)
                .where(and(
                    eq(knowledgeEdges.targetId, calculation.nodeId),
                    eq(knowledgeEdges.relation, "INPUT_TO"),
                    eq(knowledgeEdges.organizationId, requireOrgId(orgContext))
                ));

            for (const edge of inputEdges) {
                const node = await db.select()
                    .from(knowledgeNodes)
                    .where(and(
                        eq(knowledgeNodes.id, edge.sourceId),
                        eq(knowledgeNodes.organizationId, requireOrgId(orgContext))
                    ))
                    .limit(1);

                if (node.length > 0) {
                    // Extract variable name from edge data or use node name
                    const edgeData = edge.data as Record<string, any>;
                    const variableName = edgeData.variableName || node[0].name.toLowerCase().replace(/\s+/g, '_');
                    if (currency && edgeData.currency && edgeData.currency !== currency) throw new Error("Calculation currency differs from its input currency.");
                    if (currency && !edgeData.field) throw new Error("Financial calculations require an explicit input field.");
                    if (edgeData.currency) inputCurrencies.add(edgeData.currency);
                    if (inputCurrencies.size > 1) throw new Error("Financial inputs use mixed currencies.");
                    const value = numericNodeInput(node[0], { field: edgeData.field, currency: currency ?? edgeData.currency });
                    if (Object.prototype.hasOwnProperty.call(context, variableName)) throw new Error(`Duplicate calculation variable: ${variableName}`);
                    context[variableName] = value;
                } else {
                    throw new Error(`Input node ${edge.sourceId} not found`);
                }
            }
        }

        return context;
    },

    /**
     * Extract numeric value from a knowledge node
     * Handles variable nodes, metric nodes, and general data structures
     */
extractValueFromNode(node: any): number {
        return numericNodeInput(node);
    },

    /**
     * Safely evaluate a mathematical formula
     */
/*
      `calculation` is not optional despite arriving last: every temporal,
      probabilistic, constraint, graph and ML branch of the switch below reads
      configuration off the node (windowSize, distributionType, ruleDefinition,
      …) and passes it to a helper typed `(context, calculation: CalculationNode)`.

      It was referenced throughout the switch without ever being declared, so
      those ~35 sites were a plain ReferenceError at runtime: every operation
      past the basic arithmetic set threw the moment it was reached. The single
      caller already holds the node, so threading it through is all that was
      missing.
    */
async evaluateFormula(
        formula: string,
        operation: string,
        context: FormulaContext,
        calculation: CalculationNode
    ): Promise<number> {
        // Built-in mathematical functions
        const mathContext = {
            ...context,
            // Basic operations
            add: (a: number, b: number) => a + b,
            subtract: (a: number, b: number) => a - b,
            multiply: (a: number, b: number) => a * b,
            divide: (a: number, b: number) => {
                if (b === 0) throw new Error("Division by zero");
                return a / b;
            },
            modulo: (a: number, b: number) => a % b,
            power: (a: number, b: number) => Math.pow(a, b),
            
            // Statistical
            sum: (...values: number[]) => values.reduce((a, b) => a + b, 0),
            average: (...values: number[]) => values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
            count: (...values: any[]) => values.length,
            min: (...values: number[]) => Math.min(...values),
            max: (...values: number[]) => Math.max(...values),
            
            // Advanced
            abs: Math.abs,
            round: Math.round,
            floor: Math.floor,
            ceil: Math.ceil,
            sqrt: Math.sqrt,
            log: Math.log,
            exp: Math.exp,
        };

        /*
          The evaluators get `context`, not `mathContext`: a FormulaContext is
          `{ [variable: string]: number }`, and mathContext adds helper functions.
          A formula reaches functions only through the strict engine's own
          whitelist (sum, min, max, round, pow, if and the rest); these helpers are
          used directly by the SUM/AVERAGE/MIN/MAX cases below.
        */
        switch (operation) {
            case "FORMULA":
                return basicEvaluator.evaluateFormula(formula, context);
            case "ADD":
                return this.evalArithmetic(formula, context, '+');
            case "SUBTRACT":
                return this.evalArithmetic(formula, context, '-');
            case "MULTIPLY":
                return this.evalArithmetic(formula, context, '*');
            case "DIVIDE":
                return this.evalArithmetic(formula, context, '/');
            case "SUM":
                return /^[A-Z]{3}$/.test(calculation.outputUnit ?? '') ? sumMoneyNumber(Object.values(context), calculation.outputUnit!) : mathContext.sum(...Object.values(context));
            case "AVERAGE":
                return mathContext.average(...Object.values(context));
            case "COUNT":
                return Object.keys(context).length;
            case "MIN":
                return mathContext.min(...Object.values(context));
            case "MAX":
                return mathContext.max(...Object.values(context));
            // Temporal operations
            case "MOVING_AVERAGE":
                return this.calculateMovingAverage(context, calculation);
            case "YEAR_OVER_YEAR":
                return this.calculateYearOverYear(context, calculation);
            case "MONTH_OVER_MONTH":
                return this.calculateMonthOverMonth(context, calculation);
            case "CAGR":
                return this.calculateCAGR(context, calculation);
            case "EXPONENTIAL_SMOOTHING":
                return this.calculateExponentialSmoothing(context, calculation);
            case "ROLLING_SUM":
                return this.calculateRollingSum(context, calculation);
            case "ROLLING_AVERAGE":
                return this.calculateRollingAverage(context, calculation);
            // Probabilistic operations
            case "MONTE_CARLO_SIMULATION":
                return this.calculateMonteCarloSimulation(context, calculation);
            case "BAYESIAN_INFERENCE":
                return this.calculateBayesianInference(context, calculation);
            case "CONFIDENCE_INTERVAL":
                return this.calculateConfidenceInterval(context, calculation);
            case "RISK_ASSESSMENT":
                return this.calculateRiskAssessment(context, calculation);
            case "SENSITIVITY_ANALYSIS":
                return this.calculateSensitivityAnalysis(context, calculation);
            // Constraint & rule validation operations
            case "RULE_VALIDATION":
                return this.validateRule(context, calculation);
            case "CONDITIONAL_LOGIC":
                return this.evaluateConditionalLogic(context, calculation);
            case "POLICY_ENFORCEMENT":
                return this.enforcePolicy(context, calculation);
            case "CONSTRAINT_CHECK":
                return this.checkConstraint(context, calculation);
            case "GATE_CONDITION":
                return this.evaluateGateCondition(context, calculation);
            case "COMPLIANCE_CHECK":
                return this.checkCompliance(context, calculation);
            // Graph algorithm operations
            case "PAGERANK":
                return this.calculatePageRank(context, calculation);
            case "BETWEENNESS_CENTRALITY":
                return this.calculateBetweennessCentrality(context, calculation);
            case "CLOSENESS_CENTRALITY":
                return this.calculateClosenessCentrality(context, calculation);
            case "SHORTEST_PATH":
                return this.calculateShortestPath(context, calculation);
            case "MINIMUM_SPANNING_TREE":
                return this.calculateMinimumSpanningTree(context, calculation);
            case "COMMUNITY_DETECTION":
                return this.detectCommunities(context, calculation);
            case "INFLUENCE_PROPAGATION":
                return this.propagateInfluence(context, calculation);
            case "GRAPH_CLUSTERING":
                return this.clusterGraph(context, calculation);
            case "NETWORK_ANALYSIS":
                return this.analyzeNetwork(context, calculation);
            // Machine Learning inference operations
            case "MODEL_PREDICTION":
                return this.performModelPrediction(context, calculation);
            case "CLASSIFICATION":
                return this.performClassification(context, calculation);
            case "REGRESSION_INFERENCE":
                return this.performRegressionInference(context, calculation);
            case "ANOMALY_DETECTION":
                return this.detectAnomalies(context, calculation);
            case "FEATURE_EXTRACTION":
                return this.extractFeatures(context, calculation);
            case "MODEL_ENSEMBLE":
                return this.performModelEnsemble(context, calculation);
            case "CLUSTERING_INFERENCE":
                return this.performClusteringInference(context, calculation);
            case "DIMENSIONALITY_REDUCTION":
                return this.performDimensionalityReduction(context, calculation);
            default:
                // For custom formulas, use a simple expression evaluator
                return this.evalExpression(formula, context);
        }
    },

    /**
     * Evaluate simple arithmetic expression
     */
evalArithmetic(formula: string, context: FormulaContext, operator: '+' | '-' | '*' | '/'): number {
        const parts = formula.split(operator).map(p => p.trim());
        if (parts.length !== 2) {
            throw new Error(`Invalid arithmetic formula: ${formula}`);
        }

        const left = this.resolveValue(parts[0], context);
        const right = this.resolveValue(parts[1], context);

        switch (operator) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': 
                if (right === 0) throw new Error("Division by zero");
                return left / right;
        }
    },

    /**
     * Resolve a value from context or literal
     */
resolveValue(value: string, context: FormulaContext): number {
        // Check if it's a variable reference
        if (context.hasOwnProperty(value)) {
            return context[value];
        }

        // Try to parse as number
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
            return parsed;
        }

        throw new Error(`Cannot resolve value: ${value}`);
    },

    /**
     * Calculate moving average from time series data
     */
async calculateMovingAverage(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const windowSize = calculation.windowSize ?? 5;
        const timeSeries = await this.getTimeSeriesData(calculation.id, windowSize);
        
        if (timeSeries.length === 0) {
            return Object.values(context).reduce((a, b) => a + b, 0) / Object.keys(context).length;
        }
        
        const values = timeSeries.map(ts => Number(ts.value));
        return values.reduce((a, b) => a + b, 0) / values.length;
    },

    /**
     * Calculate year-over-year growth rate
     */
async calculateYearOverYear(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const baselineDate = calculation.baselineDate;
        if (!baselineDate) {
            throw new Error("YEAR_OVER_YEAR calculation requires baselineDate");
        }
        
        const currentValue = Object.values(context)[0] || 0;
        const baselineValue = await this.getValueAtDate(calculation.id, baselineDate);
        
        if (baselineValue === 0) {
            throw new Error("Cannot calculate YoY growth with zero baseline");
        }
        
        return ((currentValue - baselineValue) / baselineValue) * 100;
    },

    /**
     * Calculate month-over-month growth rate
     */
async calculateMonthOverMonth(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const baselineDate = calculation.baselineDate;
        if (!baselineDate) {
            throw new Error("MONTH_OVER_MONTH calculation requires baselineDate");
        }
        
        const currentValue = Object.values(context)[0] || 0;
        const baselineValue = await this.getValueAtDate(calculation.id, baselineDate);
        
        if (baselineValue === 0) {
            throw new Error("Cannot calculate MoM growth with zero baseline");
        }
        
        return ((currentValue - baselineValue) / baselineValue) * 100;
    },

    /**
     * Calculate Compound Annual Growth Rate (CAGR)
     */
async calculateCAGR(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const timeSeries = await this.getTimeSeriesData(calculation.id, 2);
        
        if (timeSeries.length < 2) {
            throw new Error("CAGR requires at least 2 data points");
        }
        
        const startValue = Number(timeSeries[timeSeries.length - 1].value);
        const endValue = Number(timeSeries[0].value);
        const startDate = timeSeries[timeSeries.length - 1].timestamp;
        const endDate = timeSeries[0].timestamp;
        
        const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        
        if (startValue <= 0 || years <= 0) {
            throw new Error("Invalid values for CAGR calculation");
        }
        
        return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
    },

    /**
     * Calculate exponential smoothing
     */
async calculateExponentialSmoothing(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const smoothingFactor = calculation.smoothingFactor ? Number(calculation.smoothingFactor) : 0.3;
        const timeSeries = await this.getTimeSeriesData(calculation.id, 10);
        
        if (timeSeries.length === 0) {
            return Object.values(context)[0] || 0;
        }
        
        const values = timeSeries.map(ts => Number(ts.value)).reverse();
        let smoothed = values[0];
        
        for (let i = 1; i < values.length; i++) {
            smoothed = smoothingFactor * values[i] + (1 - smoothingFactor) * smoothed;
        }
        
        return smoothed;
    },

    /**
     * Calculate rolling sum over a window
     */
async calculateRollingSum(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const windowSize = calculation.windowSize ?? 5;
        const timeSeries = await this.getTimeSeriesData(calculation.id, windowSize);
        
        if (timeSeries.length === 0) {
            return Object.values(context).reduce((a, b) => a + b, 0);
        }
        
        return timeSeries.reduce((sum, ts) => sum + Number(ts.value), 0);
    },

    /**
     * Calculate rolling average over a window
     */
async calculateRollingAverage(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const windowSize = calculation.windowSize ?? 5;
        const timeSeries = await this.getTimeSeriesData(calculation.id, windowSize);
        
        if (timeSeries.length === 0) {
            return Object.values(context).reduce((a, b) => a + b, 0) / Object.keys(context).length;
        }
        
        const sum = timeSeries.reduce((sum, ts) => sum + Number(ts.value), 0);
        return sum / timeSeries.length;
    },

    /**
     * Calculate Monte Carlo simulation
     */
async calculateMonteCarloSimulation(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const iterations = calculation.simulationIterations ?? 10000;
        const distributionType = calculation.distributionType ?? "NORMAL";
        const params = calculation.distributionParameters as Record<string, any> || {};
        
        const samples: number[] = [];
        
        // Generate random samples based on distribution
        for (let i = 0; i < iterations; i++) {
            const sample = this.generateRandomSample(distributionType, params);
            samples.push(sample);
        }
        
        // Calculate statistics
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const sortedSamples = [...samples].sort((a, b) => a - b);
        const median = sortedSamples[Math.floor(samples.length / 2)];
        
        // Store Monte Carlo results
        const stdDev = Math.sqrt(samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length);
        const confidenceLevel = calculation.confidenceLevel ? Number(calculation.confidenceLevel) : 0.95;
        const zScore = this.getZScore(confidenceLevel);
        const marginOfError = zScore * (stdDev / Math.sqrt(samples.length));
        
        await db.insert(monteCarloResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            iterations,
            seed: Math.floor(Math.random() * 1000000),
            mean: mean.toString(),
            median: median.toString(),
            stdDev: stdDev.toString(),
            min: sortedSamples[0].toString(),
            max: sortedSamples[sortedSamples.length - 1].toString(),
            percentile5: sortedSamples[Math.floor(samples.length * 0.05)].toString(),
            percentile25: sortedSamples[Math.floor(samples.length * 0.25)].toString(),
            percentile75: sortedSamples[Math.floor(samples.length * 0.75)].toString(),
            percentile95: sortedSamples[Math.floor(samples.length * 0.95)].toString(),
            confidenceLevel: confidenceLevel.toString(),
            confidenceIntervalLower: (mean - marginOfError).toString(),
            confidenceIntervalUpper: (mean + marginOfError).toString(),
            samples: samples.slice(0, 1000), // Store subset of samples
        });
        
        return mean;
    },

    /**
     * Calculate Bayesian inference
     */
async calculateBayesianInference(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const prior = calculation.priorDistribution as Record<string, any> || {};
        const likelihood = calculation.likelihoodFunction || "NORMAL";
        const dataPoints = Object.values(context);
        
        // Simple Bayesian update for normal distribution
        const priorMean = prior.mean || 0;
        const priorStdDev = prior.stdDev || 1;
        const dataMean = dataPoints.reduce((a, b) => a + b, 0) / dataPoints.length;
        const dataStdDev = Math.sqrt(dataPoints.reduce((sum, val) => sum + Math.pow(val - dataMean, 2), 0) / dataPoints.length);
        
        // Posterior parameters (conjugate prior for normal-normal)
        const posteriorMean = (priorStdDev * priorMean + dataStdDev * dataMean) / (priorStdDev + dataStdDev);
        const posteriorStdDev = Math.sqrt((priorStdDev * dataStdDev) / (priorStdDev + dataStdDev));
        
        // Store Bayesian results
        await db.insert(bayesianInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            priorDistribution: prior,
            likelihoodFunction: likelihood,
            posteriorDistribution: { mean: posteriorMean, stdDev: posteriorStdDev },
            evidence: "1", // Simplified evidence calculation; DECIMAL column, so a string
            posteriorMean: posteriorMean.toString(),
            posteriorStdDev: posteriorStdDev.toString(),
            posteriorMode: posteriorMean.toString(), // For normal, mode = mean
            dataPoints: dataPoints.length,
        });
        
        return posteriorMean;
    },

    /**
     * Calculate confidence interval
     */
async calculateConfidenceInterval(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const values = Object.values(context);
        const confidenceLevel = calculation.confidenceLevel ? Number(calculation.confidenceLevel) : 0.95;
        
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);
        const zScore = this.getZScore(confidenceLevel);
        const marginOfError = zScore * (stdDev / Math.sqrt(values.length));
        
        // Return the upper bound of confidence interval
        return mean + marginOfError;
    },

    /**
     * Calculate risk assessment
     */
async calculateRiskAssessment(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const values = Object.values(context);
        const params = calculation.distributionParameters as Record<string, any> || {};
        const threshold = params.threshold || 0;
        
        // Calculate probability of exceeding threshold
        const exceedCount = values.filter(v => v > threshold).length;
        const riskProbability = exceedCount / values.length;
        
        return riskProbability * 100; // Return as percentage
    },

    /**
     * Calculate sensitivity analysis
     */
async calculateSensitivityAnalysis(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const values = Object.values(context);
        const baseValue = values[0] || 0;
        const sensitivity = 0.1; // 10% variation
        
        // Calculate sensitivity by varying each input
        let totalSensitivity = 0;
        for (let i = 1; i < values.length; i++) {
            const originalValue = values[i];
            const variedValue = originalValue * (1 + sensitivity);
            const change = Math.abs(variedValue - originalValue);
            totalSensitivity += change / Math.abs(originalValue || 1);
        }
        
        return (totalSensitivity / (values.length - 1)) * 100;
    },

    /**
     * Generate random sample from distribution
     */
generateRandomSample(distributionType: string, params: Record<string, any>): number {
        const u1 = Math.random();
        const u2 = Math.random();
        
        switch (distributionType) {
            case "NORMAL":
                const mean = params.mean || 0;
                const stdDev = params.stdDev || 1;
                // Box-Muller transform
                const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                return mean + stdDev * z0;
                
            case "UNIFORM":
                const min = params.min || 0;
                const max = params.max || 1;
                return min + (max - min) * u1;
                
            case "TRIANGULAR":
                const tMin = params.min || 0;
                const tMax = params.max || 1;
                const tMode = params.mode || ((tMin + tMax) / 2);
                const fc = (tMode - tMin) / (tMax - tMin);
                const u = u1;
                if (u < fc) {
                    return tMin + Math.sqrt(u * (tMax - tMin) * (tMode - tMin));
                } else {
                    return tMax - Math.sqrt((1 - u) * (tMax - tMin) * (tMax - tMode));
                }
                
            default:
                return u1; // Default to uniform
        }
    },

    /**
     * Validate rule against context
     */
    async validateRule(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const ruleDefinition = calculation.ruleDefinition as Record<string, any> || {};
        const constraintType = calculation.constraintType || "CUSTOM";
        const params = calculation.constraintParameters as Record<string, any> || {};
        
        const evalResult = constraintEvaluator.evaluateRule(
            context,
            constraintType,
            { ...params, condition: ruleDefinition.condition },
            (expr: string) => !!this.evalExpression(expr, context)
        );
        
        await db.insert(constraintValidationResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            ruleType: calculation.ruleType || "VALIDATION",
            constraintType,
            passed: evalResult.passed,
            complianceScore: evalResult.complianceScore.toString(),
            violations: evalResult.violations,
            enforcementAction: calculation.enforcementAction || "LOG",
            actionTaken: evalResult.passed ? "none" : "logged_violations",
            actionResult: "SUCCESS",
        });
        
        return evalResult.passed ? 1 : 0;
    },

    /**
     * Evaluate conditional logic
     */
    async evaluateConditionalLogic(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const gateCondition = calculation.gateCondition as Record<string, any> || {};
        
        let result = 0;
        
        if (gateCondition.if) {
            const conditionMet = this.evalExpression(gateCondition.if, context);
            if (conditionMet) {
                result = gateCondition.then ? this.evalExpression(gateCondition.then, context) : 1;
            } else if (gateCondition.else) {
                result = this.evalExpression(gateCondition.else, context);
            }
        }
        
        return result;
    },

    /**
     * Enforce policy
     */
    async enforcePolicy(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const enforcementAction = calculation.enforcementAction || "WARN";
        const passed = await this.validateRule(context, calculation);
        
        if (!passed && enforcementAction === "BLOCK") {
            logger.warn("Policy enforcement blocked operation", { calculationId: calculation.id });
        }
        
        return passed ? 1 : 0;
    },

    /**
     * Check constraint
     */
    async checkConstraint(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const constraintType = calculation.constraintType || "CUSTOM";
        const params = calculation.constraintParameters as Record<string, any> || {};
        
        switch (constraintType) {
            case "RANGE": {
                const value = Object.values(context)[0];
                const numValue = Number(value);
                const result = constraintEvaluator.validateRange(numValue, params.min, params.max);
                return result.passed ? 1 : 0;
            }
                
            case "UNIQUE": {
                const values = Object.values(context);
                const uniqueValues = new Set(values);
                return uniqueValues.size === values.length ? 1 : 0;
            }

            case "SET_MEMBERSHIP": {
                const value = Object.values(context)[0];
                const result = constraintEvaluator.validateSet(value, params.allowedSet || []);
                return result.passed ? 1 : 0;
            }

            default:
                return 1;
        }
    },

    /**
     * Evaluate gate condition
     */
    async evaluateGateCondition(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const gateCondition = calculation.gateCondition as Record<string, any> || {};
        
        if (gateCondition.operator && gateCondition.left && gateCondition.right) {
            const left = this.resolveValue(gateCondition.left, context);
            const right = this.resolveValue(gateCondition.right, context);
            
            return constraintEvaluator.evaluateGate(left, right, gateCondition.operator);
        }
        
        return 0;
    },

    /**
     * Check compliance
     */
async checkCompliance(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const threshold = calculation.complianceThreshold ? Number(calculation.complianceThreshold) : 0.95;
        const ruleDefinition = calculation.ruleDefinition as Record<string, any> || {};
        
        /*
          Score the RULES against the whole context.

          This used to loop over context entries and evaluate every rule against
          a single-variable context `{ [key]: value }`. Any rule naming a
          different variable — which is the normal case, e.g. rules
          ["value1 > 0", "value2 > 0"] — never had that variable in scope, so
          the identifier survived substitution, the safety check rejected the
          expression, and the whole compliance check threw. A rule set spanning
          more than one input could not pass.

          A rule that cannot be evaluated counts as not compliant rather than
          aborting the calculation: for a compliance check that is the safe
          direction, and it keeps one malformed rule from hiding the verdict on
          all the others.
        */
        const rules = (ruleDefinition.complianceRules as any[]) ?? [];

        let compliantCount = 0;
        const totalCount = rules.length;

        for (const rule of rules) {
            try {
                if (this.evalExpression(rule.condition, context)) compliantCount++;
            } catch {
                // Unevaluable rule — not compliant.
            }
        }

        const complianceScore = totalCount > 0 ? compliantCount / totalCount : 0;
        const passed = complianceScore >= threshold;
        
        await db.insert(constraintValidationResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            ruleType: "VALIDATION",
            constraintType: "CUSTOM",
            passed,
            complianceScore: (complianceScore * 100).toString(),
            violations: passed ? [] : [{ violation: "compliance_threshold_not_met", score: complianceScore, threshold }],
            enforcementAction: calculation.enforcementAction || "LOG",
            actionTaken: passed ? "compliant" : "non_compliant",
            actionResult: "SUCCESS",
        });
        
        return passed ? 1 : 0;
    },

    /**
     * Calculate PageRank centrality
     */
async calculatePageRank(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const dampingFactor = calculation.dampingFactor ? Number(calculation.dampingFactor) : 0.85;
        const iterations = calculation.iterations || 100;
        
        // Get graph structure
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        // Simplified PageRank calculation
        const nodeCount = graph.nodes.length;
        const pageRankScores: Record<number, number> = {};
        
        // Initialize scores
        graph.nodes.forEach(node => {
            pageRankScores[node.id] = 1 / nodeCount;
        });
        
        // Iterate
        for (let i = 0; i < iterations; i++) {
            const newScores: Record<number, number> = {};
            
            graph.nodes.forEach(node => {
                let score = (1 - dampingFactor) / nodeCount;
                
                // Add contributions from incoming edges
                const incomingEdges = graph.edges.filter(e => e.targetId === node.id);
                incomingEdges.forEach(edge => {
                    const sourceNode = graph.nodes.find(n => n.id === edge.sourceId);
                    if (sourceNode) {
                        const outDegree = graph.edges.filter(e => e.sourceId === sourceNode.id).length;
                        if (outDegree > 0) {
                            score += dampingFactor * (pageRankScores[sourceNode.id] / outDegree);
                        }
                    }
                });
                
                newScores[node.id] = score;
            });
            
            Object.assign(pageRankScores, newScores);
        }
        
        // Store centrality scores
        for (const [nodeId, score] of Object.entries(pageRankScores)) {
            await db.insert(graphCentralityScores).values({
                nodeId: Number(nodeId),
                organizationId: calculation.organizationId,
                calculationNodeId: calculation.id,
                pageRank: score.toString(),
                degree: graph.edges.filter(e => e.sourceId === Number(nodeId)).length,
            });
        }
        
        // Store algorithm result
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "CENTRALITY",
            algorithmName: "PAGERANK",
            nodeCount,
            edgeCount: graph.edges.length,
            result: { pageRankScores },
            centralityScores: Object.entries(pageRankScores).map(([nodeId, score]) => ({ nodeId: Number(nodeId), score })),
            iterations,
        });
        
        // Return average PageRank
        const avgScore = Object.values(pageRankScores).reduce((a, b) => a + b, 0) / nodeCount;
        return avgScore;
    },

    /**
     * Calculate betweenness centrality
     */
async calculateBetweennessCentrality(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const graph = await this.buildGraphStructure(calculation.organizationId);
        const betweennessScores: Record<number, number> = {};
        
        // Initialize scores
        graph.nodes.forEach(node => {
            betweennessScores[node.id] = 0;
        });
        
        // Simplified betweenness calculation (sample pairs)
        const samplePairs = this.samplePairs(graph.nodes, 100);
        
        for (const [source, target] of samplePairs) {
            const path = this.findShortestPath(graph, source.id, target.id);
            if (path && path.length > 2) {
                // Add to intermediate nodes
                for (let i = 1; i < path.length - 1; i++) {
                    betweennessScores[path[i]] = (betweennessScores[path[i]] || 0) + 1;
                }
            }
        }
        
        // Normalize scores. Object.keys gives strings, but the map is keyed by
        // number, so index with the parsed key rather than the raw string.
        const maxScore = Math.max(...Object.values(betweennessScores));
        for (const key of Object.keys(betweennessScores)) {
            const nodeId = Number(key);
            betweennessScores[nodeId] = maxScore > 0 ? betweennessScores[nodeId] / maxScore : 0;
        }
        
        // Store results
        for (const [nodeId, score] of Object.entries(betweennessScores)) {
            await db.insert(graphCentralityScores).values({
                nodeId: Number(nodeId),
                organizationId: calculation.organizationId,
                calculationNodeId: calculation.id,
                betweenness: score.toString(),
            }).onConflictDoNothing();
        }
        
        return Object.values(betweennessScores).reduce((a, b) => a + b, 0) / graph.nodes.length;
    },

    /**
     * Calculate closeness centrality
     */
async calculateClosenessCentrality(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const graph = await this.buildGraphStructure(calculation.organizationId);
        const closenessScores: Record<number, number> = {};
        
        for (const node of graph.nodes) {
            let totalDistance = 0;
            let reachableCount = 0;
            
            for (const otherNode of graph.nodes) {
                if (node.id !== otherNode.id) {
                    const path = this.findShortestPath(graph, node.id, otherNode.id);
                    if (path) {
                        totalDistance += path.length - 1;
                        reachableCount++;
                    }
                }
            }
            
            if (reachableCount > 0) {
                closenessScores[node.id] = reachableCount / totalDistance;
            } else {
                closenessScores[node.id] = 0;
            }
        }
        
        // Store results
        for (const [nodeId, score] of Object.entries(closenessScores)) {
            await db.insert(graphCentralityScores).values({
                nodeId: Number(nodeId),
                organizationId: calculation.organizationId,
                calculationNodeId: calculation.id,
                closeness: score.toString(),
            }).onConflictDoNothing();
        }
        
        return Object.values(closenessScores).reduce((a, b) => a + b, 0) / graph.nodes.length;
    },

    /**
     * Calculate shortest path
     */
async calculateShortestPath(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const targetNodeId = calculation.targetNodeId;
        if (!targetNodeId) {
            throw new Error("SHORTEST_PATH requires targetNodeId");
        }
        
        const graph = await this.buildGraphStructure(calculation.organizationId);
        const sourceNodeId = Object.keys(context)[0] ? Number(Object.keys(context)[0]) : graph.nodes[0].id;
        
        const path = this.findShortestPath(graph, sourceNodeId, targetNodeId);
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "PATHFINDING",
            algorithmName: "SHORTEST_PATH",
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            result: { path },
            path: path || [],
            score: path ? (path.length - 1).toString() : "-1",
        });
        
        return path ? path.length - 1 : -1;
    },

    /**
     * Calculate minimum spanning tree
     */
async calculateMinimumSpanningTree(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        // Simplified MST using Prim's algorithm
        const visited = new Set<number>();
        const edges: any[] = [];
        const startNode = graph.nodes[0];
        visited.add(startNode.id);
        
        while (visited.size < graph.nodes.length) {
            let minEdge = null;
            let minWeight = Infinity;
            
            for (const nodeId of visited) {
                const nodeEdges = graph.edges.filter(e => 
                    (e.sourceId === nodeId && !visited.has(e.targetId)) ||
                    (e.targetId === nodeId && !visited.has(e.sourceId))
                );
                
                for (const edge of nodeEdges) {
                    const weight = this.getEdgeWeight(edge);
                    if (weight < minWeight) {
                        minWeight = weight;
                        minEdge = edge;
                    }
                }
            }
            
            if (minEdge) {
                edges.push(minEdge);
                visited.add(minEdge.sourceId === Array.from(visited)[visited.size - 1] ? minEdge.targetId : minEdge.sourceId);
            } else {
                break;
            }
        }
        
        const totalWeight = edges.reduce((sum, edge) => sum + this.getEdgeWeight(edge), 0);
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "PATHFINDING",
            algorithmName: "MINIMUM_SPANNING_TREE",
            nodeCount: graph.nodes.length,
            edgeCount: edges.length,
            result: { edges },
            score: totalWeight.toString(),
        });
        
        return totalWeight;
    },

    /**
     * Detect communities
     */
async detectCommunities(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const method = calculation.communityDetectionMethod || "LABEL_PROPAGATION";
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        // Simplified label propagation
        const labels: Record<number, number> = {};
        graph.nodes.forEach((node, index) => {
            labels[node.id] = index;
        });
        
        for (let iter = 0; iter < 10; iter++) {
            const newLabels: Record<number, number> = {};
            
            for (const node of graph.nodes) {
                const neighbors = this.getNeighbors(graph, node.id);
                const labelCounts: Record<number, number> = {};
                
                neighbors.forEach(neighborId => {
                    const label = labels[neighborId];
                    labelCounts[label] = (labelCounts[label] || 0) + 1;
                });
                
                // Find most common label
                let maxCount = 0;
                let dominantLabel = labels[node.id];
                
                for (const [label, count] of Object.entries(labelCounts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        dominantLabel = Number(label);
                    }
                }
                
                newLabels[node.id] = dominantLabel;
            }
            
            Object.assign(labels, newLabels);
        }
        
        // Group by community
        const communities: Record<number, number[]> = {};
        for (const [nodeId, label] of Object.entries(labels)) {
            if (!communities[label]) {
                communities[label] = [];
            }
            communities[label].push(Number(nodeId));
        }
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "CLUSTERING",
            algorithmName: "COMMUNITY_DETECTION",
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            result: { communities, method },
            communities: Object.values(communities),
            score: Object.keys(communities).length.toString(),
        });
        
        return Object.keys(communities).length;
    },

    /**
     * Propagate influence
     */
async propagateInfluence(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const maxDepth = calculation.maxDepth || 3;
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        const sourceNodeId = Object.keys(context)[0] ? Number(Object.keys(context)[0]) : graph.nodes[0].id;
        const influencedNodes = new Set<number>([sourceNodeId]);
        
        let currentLevel = [sourceNodeId];
        
        for (let depth = 0; depth < maxDepth; depth++) {
            const nextLevel: number[] = [];
            
            for (const nodeId of currentLevel) {
                const neighbors = this.getNeighbors(graph, nodeId);
                neighbors.forEach(neighborId => {
                    if (!influencedNodes.has(neighborId)) {
                        influencedNodes.add(neighborId);
                        nextLevel.push(neighborId);
                    }
                });
            }
            
            currentLevel = nextLevel;
            if (currentLevel.length === 0) break;
        }
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "PROPAGATION",
            algorithmName: "INFLUENCE_PROPAGATION",
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            result: { influencedNodes: Array.from(influencedNodes), sourceNodeId, maxDepth },
            score: influencedNodes.size.toString(),
        });
        
        return influencedNodes.size;
    },

    /**
     * Cluster graph
     */
async clusterGraph(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        // Simplified clustering based on edge density
        const clusters: number[][] = [];
        const visited = new Set<number>();
        
        for (const node of graph.nodes) {
            if (visited.has(node.id)) continue;
            
            const cluster: number[] = [node.id];
            visited.add(node.id);
            
            const neighbors = this.getNeighbors(graph, node.id);
            neighbors.forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    cluster.push(neighborId);
                    visited.add(neighborId);
                }
            });
            
            clusters.push(cluster);
        }
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "CLUSTERING",
            algorithmName: "GRAPH_CLUSTERING",
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            result: { clusters },
            communities: clusters,
            score: clusters.length.toString(),
        });
        
        return clusters.length;
    },

    /**
     * Analyze network
     */
async analyzeNetwork(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const graph = await this.buildGraphStructure(calculation.organizationId);
        
        // Calculate network metrics
        const avgDegree = graph.nodes.length > 0 
            ? graph.edges.length / graph.nodes.length 
            : 0;
        
        const density = graph.nodes.length > 1
            ? (2 * graph.edges.length) / (graph.nodes.length * (graph.nodes.length - 1))
            : 0;
        
        // Calculate clustering coefficient (simplified)
        let clusteringCoefficient = 0;
        for (const node of graph.nodes) {
            const neighbors = this.getNeighbors(graph, node.id);
            if (neighbors.length < 2) continue;
            
            let triangleCount = 0;
            for (let i = 0; i < neighbors.length; i++) {
                for (let j = i + 1; j < neighbors.length; j++) {
                    if (this.hasEdge(graph, neighbors[i], neighbors[j])) {
                        triangleCount++;
                    }
                }
            }
            
            const possibleTriangles = (neighbors.length * (neighbors.length - 1)) / 2;
            clusteringCoefficient += possibleTriangles > 0 ? triangleCount / possibleTriangles : 0;
        }
        
        clusteringCoefficient /= graph.nodes.length;
        
        await db.insert(graphAlgorithmResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            algorithmType: "NETWORK_ANALYSIS",
            algorithmName: "NETWORK_ANALYSIS",
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            result: { avgDegree, density, clusteringCoefficient },
            score: clusteringCoefficient.toString(),
        });
        
        return clusteringCoefficient;
    },

    /**
     * Perform model prediction
     */
async performModelPrediction(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const modelId = calculation.modelId || "default_model";
        const modelVersion = calculation.modelVersion || "1.0";
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        // Extract features from context
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Simulate model prediction (in production, this would call actual ML service)
        const prediction = this.simulateModelPrediction(features, modelId);
        const confidence = 0.85 + Math.random() * 0.1; // Simulated confidence
        
        // Store inference result
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId,
            modelVersion,
            modelType: calculation.modelType || "REGRESSION",
            features,
            prediction: { value: prediction },
            predictionScore: confidence.toString(),
            inferenceTimeMs: Math.floor(Math.random() * 100) + 10,
        });
        
        return prediction;
    },

    /**
     * Perform classification
     */
async performClassification(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const modelId = calculation.modelId || "default_classifier";
        const modelVersion = calculation.modelVersion || "1.0";
        const predictionThreshold = calculation.predictionThreshold ? Number(calculation.predictionThreshold) : 0.5;
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        // Extract features
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Simulate classification
        const classProbabilities = this.simulateClassification(features);
        const predictedClass = Object.keys(classProbabilities).reduce((a, b) => 
            classProbabilities[a] > classProbabilities[b] ? a : b
        );
        const confidence = classProbabilities[predictedClass];
        
        // Convert class to numeric (1 for positive, 0 for negative)
        const numericPrediction = confidence >= predictionThreshold ? 1 : 0;
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId,
            modelVersion,
            modelType: "CLASSIFICATION",
            features,
            prediction: { class: predictedClass },
            predictionScore: confidence.toString(),
            predictionLabel: predictedClass,
            classProbabilities,
            inferenceTimeMs: Math.floor(Math.random() * 100) + 10,
        });
        
        return numericPrediction;
    },

    /**
     * Perform regression inference
     */
async performRegressionInference(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const modelId = calculation.modelId || "default_regressor";
        const modelVersion = calculation.modelVersion || "1.0";
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        // Extract features
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Simulate regression prediction
        const prediction = this.simulateRegression(features);
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId,
            modelVersion,
            modelType: "REGRESSION",
            features,
            prediction: { value: prediction },
            predictionScore: "0.90", // Simulated confidence
            inferenceTimeMs: Math.floor(Math.random() * 50) + 5,
        });
        
        return prediction;
    },

    /**
     * Detect anomalies
     */
async detectAnomalies(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const method = calculation.anomalyDetectionMethod || "STATISTICAL";
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        // Extract features
        const features = this.extractFeaturesFromContext(context, featureConfig);
        const values = Object.values(features).map(v => Number(v));
        
        // Statistical anomaly detection using z-score
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);
        
        const anomalyScores = values.map(value => Math.abs((value - mean) / (stdDev || 1)));
        const maxAnomalyScore = Math.max(...anomalyScores);
        const isAnomaly = maxAnomalyScore > 2; // Threshold of 2 standard deviations
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId: `anomaly_${method.toLowerCase()}`,
            modelVersion: "1.0",
            modelType: "ANOMALY_DETECTION",
            features,
            prediction: { isAnomaly, anomalyScore: maxAnomalyScore },
            predictionScore: maxAnomalyScore.toString(),
            isAnomaly,
            anomalyScore: maxAnomalyScore.toString(),
            inferenceTimeMs: Math.floor(Math.random() * 50) + 5,
        });
        
        return isAnomaly ? 1 : 0;
    },

    /**
     * Extract features
     */
async extractFeatures(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        // Extract features from context
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Return number of features extracted
        return Object.keys(features).length;
    },

    /**
     * Perform model ensemble
     */
async performModelEnsemble(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const ensembleStrategy = calculation.ensembleStrategy || "MAJORITY_VOTE";
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Simulate ensemble predictions from multiple models
        const predictions = [
            this.simulateModelPrediction(features, "model_1"),
            this.simulateModelPrediction(features, "model_2"),
            this.simulateModelPrediction(features, "model_3"),
        ];
        
        let ensemblePrediction: number;
        
        switch (ensembleStrategy) {
            case "MAJORITY_VOTE":
                // For regression, use median
                const sorted = [...predictions].sort((a, b) => a - b);
                ensemblePrediction = sorted[Math.floor(predictions.length / 2)];
                break;
            case "WEIGHTED_AVERAGE":
                // Simulate weighted average
                const weights = [0.5, 0.3, 0.2];
                ensemblePrediction = predictions.reduce((sum, pred, i) => sum + pred * weights[i], 0);
                break;
            default:
                ensemblePrediction = predictions.reduce((a, b) => a + b, 0) / predictions.length;
        }
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId: "ensemble",
            modelVersion: "1.0",
            modelType: "REGRESSION",
            features,
            prediction: { value: ensemblePrediction, individualPredictions: predictions },
            predictionScore: "0.88",
            inferenceTimeMs: Math.floor(Math.random() * 200) + 20,
        });
        
        return ensemblePrediction;
    },

    /**
     * Perform clustering inference
     */
async performClusteringInference(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        const features = this.extractFeaturesFromContext(context, featureConfig);
        
        // Simulate clustering (simplified k-means)
        const numClusters = 3;
        const clusterAssignment = Math.floor(Math.random() * numClusters);
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId: "kmeans",
            modelVersion: "1.0",
            modelType: "CLUSTERING",
            features,
            prediction: { cluster: clusterAssignment, numClusters },
            predictionScore: "0.75",
            predictionLabel: `cluster_${clusterAssignment}`,
            inferenceTimeMs: Math.floor(Math.random() * 100) + 10,
        });
        
        return clusterAssignment;
    },

    /**
     * Perform dimensionality reduction
     */
async performDimensionalityReduction(context: FormulaContext, calculation: CalculationNode): Promise<number> {
        const featureConfig = calculation.featureConfig as Record<string, any> || {};
        
        const features = this.extractFeaturesFromContext(context, featureConfig);
        const originalDimensions = Object.keys(features).length;
        
        // Simulate PCA reduction
        const reducedDimensions = Math.max(2, Math.floor(originalDimensions * 0.5));
        
        await db.insert(mlInferenceResults).values({
            calculationNodeId: calculation.id,
            organizationId: calculation.organizationId,
            modelId: "pca",
            modelVersion: "1.0",
            modelType: "CLUSTERING",
            features,
            prediction: { originalDimensions, reducedDimensions },
            predictionScore: "0.95",
            inferenceTimeMs: Math.floor(Math.random() * 100) + 10,
        });
        
        return reducedDimensions;
    },

    /**
     * Extract features from context
     */
extractFeaturesFromContext(context: FormulaContext, config: Record<string, any>): Record<string, any> {
        const features: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(context)) {
            if (config.featureMapping && config.featureMapping[key]) {
                features[config.featureMapping[key]] = value;
            } else {
                features[key] = value;
            }
        }
        
        // Apply transformations if specified
        if (config.transformations) {
            for (const [feature, transformation] of Object.entries(config.transformations)) {
                if (features[feature] !== undefined) {
                    switch (transformation) {
                        case "log":
                            features[feature] = Math.log(Number(features[feature]) + 1);
                            break;
                        case "normalize":
                            features[feature] = Number(features[feature]) / 100; // Simplified
                            break;
                        case "standardize":
                            features[feature] = (Number(features[feature]) - 50) / 10; // Simplified
                            break;
                    }
                }
            }
        }
        
        return features;
    },

    /**
     * Simulate model prediction (placeholder for actual ML service)
     */
simulateModelPrediction(features: Record<string, any>, modelId: string): number {
        // Simple linear combination of features
        const values = Object.values(features).map(v => Number(v) || 0);
        return values.reduce((sum, val) => sum + val, 0) / (values.length || 1);
    },

    /**
     * Simulate classification (placeholder for actual ML service)
     */
simulateClassification(features: Record<string, any>): Record<string, number> {
        const values = Object.values(features).map(v => Number(v) || 0);
        const sum = values.reduce((a, b) => a + b, 0);
        
        // Simulate class probabilities
        const total = sum + Math.random() * 10;
        return {
            class_0: 1 - (sum / total),
            class_1: sum / total,
        };
    },

    /**
     * Simulate regression (placeholder for actual ML service)
     */
simulateRegression(features: Record<string, any>): number {
        const values = Object.values(features).map(v => Number(v) || 0);
        // Simple weighted sum
        return values.reduce((sum, val, i) => sum + val * (i + 1), 0) / values.length;
    },

    /**
     * Build graph structure from database
     */
async buildGraphStructure(organizationId: number): Promise<{ nodes: any[], edges: any[] }> {
        const nodes = await db.select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.organizationId, organizationId));
        
        const edges = await db.select()
            .from(knowledgeEdges)
            .where(eq(knowledgeEdges.organizationId, organizationId));
        
        return { nodes, edges };
    },

    /**
     * Find shortest path using BFS
     */
findShortestPath(graph: { nodes: any[], edges: any[] }, sourceId: number, targetId: number): number[] | null {
        const queue: number[][] = [[sourceId]];
        const visited = new Set<number>([sourceId]);
        
        while (queue.length > 0) {
            const path = queue.shift()!;
            const currentId = path[path.length - 1];
            
            if (currentId === targetId) {
                return path;
            }
            
            const neighbors = this.getNeighbors(graph, currentId);
            for (const neighborId of neighbors) {
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push([...path, neighborId]);
                }
            }
        }
        
        return null;
    },

    /**
     * Get neighbors of a node
     */
getNeighbors(graph: { nodes: any[], edges: any[] }, nodeId: number): number[] {
        const neighbors: number[] = [];
        
        graph.edges.forEach(edge => {
            if (edge.sourceId === nodeId) {
                neighbors.push(edge.targetId);
            } else if (edge.targetId === nodeId) {
                neighbors.push(edge.sourceId);
            }
        });
        
        return neighbors;
    },

    /**
     * Check if edge exists between two nodes
     */
hasEdge(graph: { nodes: any[], edges: any[] }, nodeId1: number, nodeId2: number): boolean {
        return graph.edges.some(edge => 
            (edge.sourceId === nodeId1 && edge.targetId === nodeId2) ||
            (edge.sourceId === nodeId2 && edge.targetId === nodeId1)
        );
    },

    /**
     * Get edge weight
     */
getEdgeWeight(edge: any): number {
        if (edge.data && typeof edge.data === 'object' && 'weight' in edge.data) {
            return Number(edge.data.weight) || 1;
        }
        return 1;
    },

    /**
     * Sample pairs for betweenness calculation
     */
samplePairs(nodes: any[], sampleSize: number): [any, any][] {
        const pairs: [any, any][] = [];
        const indices = Array.from({ length: nodes.length }, (_, i) => i);
        
        for (let i = 0; i < sampleSize && indices.length >= 2; i++) {
            const idx1 = Math.floor(Math.random() * indices.length);
            const node1 = nodes[indices[idx1]];
            indices.splice(idx1, 1);
            
            const idx2 = Math.floor(Math.random() * indices.length);
            const node2 = nodes[indices[idx2]];
            indices.splice(idx2, 1);
            
            pairs.push([node1, node2]);
        }
        
        return pairs;
    },

    /**
     * Get Z-score for confidence level
     */
getZScore(confidenceLevel: number): number {
        const zScores: Record<number, number> = {
            0.90: 1.645,
            0.95: 1.96,
            0.99: 2.576,
        };
        return zScores[confidenceLevel] || 1.96;
    },

    /**
     * Get time series data for a calculation
     */
async getTimeSeriesData(calculationId: number, limit: number): Promise<any[]> {
        const data = await db.select()
            .from(calculationTimeSeries)
            .where(eq(calculationTimeSeries.calculationNodeId, calculationId))
            .orderBy(desc(calculationTimeSeries.timestamp))
            .limit(limit);
        
        return data;
    },

    /**
     * Get value at a specific date from time series
     */
async getValueAtDate(calculationId: number, date: Date): Promise<number> {
        const data = await db.select()
            .from(calculationTimeSeries)
            .where(and(
                eq(calculationTimeSeries.calculationNodeId, calculationId),
                lte(calculationTimeSeries.timestamp, date)
            ))
            .orderBy(desc(calculationTimeSeries.timestamp))
            .limit(1);
        
        return data.length > 0 ? Number(data[0].value) : 0;
    },

    /**
     * Add a data point to time series
     */
    async addTimeSeriesPoint(
        calculationId: number,
        value: number,
        timestamp: Date = new Date(),
        orgContext: OrgContext,
        sourceNodeId?: number
    ): Promise<void> {
        const calculation = await this.getCalculationById(calculationId, orgContext);
        if (!calculation) {
            throw new Error(`Calculation ${calculationId} not found`);
        }

        await db.insert(calculationTimeSeries).values({
            calculationNodeId: calculationId,
            organizationId: requireOrgId(orgContext),
            timestamp,
            value: value.toString(),
            sourceNodeId,
            period: calculation.timePeriod,
        });

        logger.info("Time series point added", { calculationId, value, timestamp });
    },

    /**
     * Get time series data for a calculation with date range
     */
    async getTimeSeriesRange(
        calculationId: number,
        orgContext: OrgContext,
        startDate: Date,
        endDate: Date
    ): Promise<any[]> {
        const calculation = await this.getCalculationById(calculationId, orgContext);
        if (!calculation) {
            throw new Error(`Calculation ${calculationId} not found`);
        }

        return await db.select()
            .from(calculationTimeSeries)
            .where(and(
                eq(calculationTimeSeries.calculationNodeId, calculationId),
                eq(calculationTimeSeries.organizationId, requireOrgId(orgContext)),
                gte(calculationTimeSeries.timestamp, startDate),
                lte(calculationTimeSeries.timestamp, endDate)
            ))
            .orderBy(calculationTimeSeries.timestamp);
    },

    /**
     * A gate condition, rule, compliance check or custom expression, on the strict
     * formula engine (evaluators/basic.evaluator.ts). A condition scores 1 or 0.
     *
     * This used to substitute values into the text and run it with `new Function`
     * once a character class approved it, so its safety rested on that regex, and a
     * name with no value stayed in the text and was refused as "Invalid expression"
     * instead of being reported as the missing input it was.
     */
evalExpression(formula: string, context: FormulaContext): number {
        return basicEvaluator.evaluateFormula(formula, context);
    },

    /**
     * Log calculation execution
     */
async logExecution(
        calculationNodeId: number,
        organizationId: number,
        log: Omit<InsertCalculationExecutionLog, 'calculationNodeId' | 'organizationId' | 'executedAt'>
    ): Promise<void> {
        await db.insert(calculationExecutionLogs).values({
            calculationNodeId,
            organizationId,
            ...log,
            executedAt: new Date(),
        });
    },

    /**
     * Trigger reactive updates for calculations that depend on a node
     * Supports both legacy dependencies and edge-based INPUT_TO relations.
     * Enforces circuit-breaker safety with cycle detection and maximum cascade depth limiting.
     */
    async triggerReactiveUpdates(
        nodeId: number,
        orgContext: OrgContext,
        triggeredBy: string = "node_update",
        visitedNodes: Set<number> = new Set<number>(),
        currentDepth: number = 0,
        maxDepth: number = 10
    ): Promise<void> {
        // 1. Circuit breaker: Check recursion depth limit
        if (currentDepth >= maxDepth) {
            logger.warn("[CalculationService] Reactive calculation cascade depth limit reached. Circuit breaker engaged.", {
                nodeId,
                currentDepth,
                maxDepth,
                triggeredBy
            });
            return;
        }

        // 2. Cycle detection: Prevent infinite loops across mutual dependencies
        if (visitedNodes.has(nodeId)) {
            logger.warn("[CalculationService] Reactive dependency cycle detected on node. Halting cycle propagation.", {
                nodeId,
                currentDepth,
                visitedCount: visitedNodes.size
            });
            return;
        }

        const nextVisited = new Set(visitedNodes);
        nextVisited.add(nodeId);

        // Legacy approach: find calculations via calculation_dependencies table
        const dependencies = await db.select()
            .from(calculationDependencies)
            .where(eq(calculationDependencies.dependsOnNodeId, nodeId));

        for (const dep of dependencies) {
            try {
                await this.executeCalculation(dep.calculationNodeId, orgContext, {
                    forceRecalculate: true,
                    triggeredBy,
                    triggeredByNodeId: nodeId,
                });
            } catch (error) {
                logger.error("Failed to execute reactive calculation update (legacy)", {
                    calculationNodeId: dep.calculationNodeId,
                    nodeId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Hybrid approach: find calculations via INPUT_TO edges
        const inputEdges = await db.select()
            .from(knowledgeEdges)
            .where(and(
                eq(knowledgeEdges.sourceId, nodeId),
                eq(knowledgeEdges.relation, "INPUT_TO"),
                eq(knowledgeEdges.organizationId, requireOrgId(orgContext))
            ));

        for (const edge of inputEdges) {
            // Find the calculation node for this target
            const calculation = await this.getCalculationByNodeId(edge.targetId, orgContext);
            if (calculation) {
                try {
                    await this.executeCalculation(calculation.id, orgContext, {
                        forceRecalculate: true,
                        triggeredBy,
                        triggeredByNodeId: nodeId,
                    });

                    // If calculation has an associated node, recursively propagate to downstream dependents
                    if (calculation.nodeId && calculation.nodeId !== nodeId) {
                        await this.triggerReactiveUpdates(
                            calculation.nodeId,
                            orgContext,
                            `calculation_${calculation.id}_output`,
                            nextVisited,
                            currentDepth + 1,
                            maxDepth
                        );
                    }
                } catch (error) {
                    logger.error("Failed to execute reactive calculation update (edge-based)", {
                        calculationNodeId: calculation.id,
                        nodeId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
    },

    /**
     * Create a calculation using edge-based inputs (Hybrid Model)
     * This is the Option #3 approach where inputs are connected via INPUT_TO edges
     */
    async createEdgeBasedCalculation(
        input: {
            nodeId: number;
            organizationId: number;
            operation: string;
            formula: string;
            inputNodeIds: number[]; // Nodes that will be connected via INPUT_TO edges
            inputVariableNames?: string[]; // Optional variable names for each input
            inputFields?: string[]; // Explicit monetary or numeric node.data paths
            inputCurrencies?: string[]; // Expected units for each input
            outputUnit?: string;
            outputPrecision?: number;
            description?: string;
        },
        orgContext: OrgContext
    ): Promise<{ calculation: CalculationNode; edges: any[] }> {
        // Create the calculation node (without inputReferences)
        const calculation = await this.createCalculation({
            nodeId: input.nodeId,
            organizationId: input.organizationId,
            operation: input.operation as any,
            formula: input.formula,
            inputReferences: [], // Empty - we'll use edges instead
            outputUnit: input.outputUnit,
            outputPrecision: input.outputPrecision,
            description: input.description,
        }, orgContext);

        // Create INPUT_TO edges for each input node
        const edges = [];
        for (let i = 0; i < input.inputNodeIds.length; i++) {
            const inputNodeId = input.inputNodeIds[i];
            const variableName = input.inputVariableNames?.[i] || `input_${i}`;

            const [edge] = await db.insert(knowledgeEdges)
                .values({
                    sourceId: inputNodeId,
                    targetId: input.nodeId,
                    relation: "INPUT_TO",
                    organizationId: input.organizationId,
                    data: { variableName, ...(input.inputFields?.[i] ? { field: input.inputFields[i] } : {}), ...(input.inputCurrencies?.[i] ? { currency: input.inputCurrencies[i] } : {}) },
                    createdBy: orgContext.userId || "system",
                })
                .returning();

            edges.push(edge);
        }

        logger.info("Edge-based calculation created", {
            calculationId: calculation.id,
            nodeId: calculation.nodeId,
            inputCount: edges.length,
        });

        return { calculation, edges };
    },

    /**
     * List calculations for an organization
     */
    async listCalculations(orgContext: OrgContext, options: {
        status?: string;
        operation?: string;
        missionId?: number;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ calculations: CalculationNode[]; total: number }> {
        const conditions = [
            eq(calculationNodes.organizationId, requireOrgId(orgContext)),
        ];

        if (options.status) {
            conditions.push(eq(calculationNodes.status, options.status));
        }

        if (options.operation) {
            conditions.push(eq(calculationNodes.operation, options.operation));
        }

        if (options.missionId) {
            conditions.push(eq(calculationNodes.missionId, options.missionId));
        }

        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(calculationNodes)
            .where(and(...conditions));
        const total = Number(countResult[0]?.count || 0);

        const limit = options.limit || 50;
        const offset = options.offset || 0;

        const calculations = await db.select()
            .from(calculationNodes)
            .where(and(...conditions))
            .orderBy(desc(calculationNodes.createdAt))
            .limit(limit)
            .offset(offset);

        return { calculations, total };
    },

    async getExecutionHistory(calculationId: number, orgId: number, limit = 20) {
        return await db
            .select()
            .from(calculationExecutionLogs)
            .where(
                and(
                    eq(calculationExecutionLogs.calculationNodeId, calculationId),
                    eq(calculationExecutionLogs.organizationId, orgId)
                )
            )
            .orderBy(desc(calculationExecutionLogs.executedAt))
            .limit(limit);
    },

    async getDependencies(calculationId: number, orgId: number) {
        return await db
            .select()
            .from(calculationDependencies)
            .where(
                and(
                    eq(calculationDependencies.calculationNodeId, calculationId),
                    eq(calculationDependencies.organizationId, orgId)
                )
            );
    },

    async addDependency(calculationId: number, dependsOnNodeId: number, variableName: string, required: boolean, orgId: number) {
        const [dep] = await db
            .insert(calculationDependencies)
            .values({
                calculationNodeId: calculationId,
                dependsOnNodeId,
                variableName,
                required: required ?? true,
                organizationId: orgId,
            })
            .returning();
        return dep;
    },

    async removeDependency(depId: number, calculationId: number, orgId: number) {
        await db
            .delete(calculationDependencies)
            .where(
                and(
                    eq(calculationDependencies.id, depId),
                    eq(calculationDependencies.calculationNodeId, calculationId),
                    eq(calculationDependencies.organizationId, orgId)
                )
            );
    },

    async getCentralityScores(orgId: number, limit = 50) {
        return await db
            .select()
            .from(graphCentralityScores)
            .where(eq(graphCentralityScores.organizationId, orgId))
            .orderBy(desc(graphCentralityScores.pageRank))
            .limit(limit);
    },

    async getCommunityResults(orgId: number, limit = 20) {
        return await db
            .select()
            .from(graphAlgorithmResults)
            .where(
                and(
                    eq(graphAlgorithmResults.organizationId, orgId),
                    eq(graphAlgorithmResults.algorithmType, "COMMUNITY_DETECTION")
                )
            )
            .orderBy(desc(graphAlgorithmResults.createdAt))
            .limit(limit);
    },

    async listMlModels(orgId: number) {
        return await db
            .select()
            .from(mlModelVersions)
            .where(eq(mlModelVersions.organizationId, orgId))
            .orderBy(desc(mlModelVersions.createdAt));
    },

    async registerMlModel(values: any) {
        const [model] = await db.insert(mlModelVersions).values(values).returning();
        return model;
    },

    async deployMlModel(id: number, orgId: number) {
        const [deployed] = await db
            .update(mlModelVersions)
            .set({ isDeployed: true, deploymentDate: new Date() })
            .where(
                and(
                    eq(mlModelVersions.id, id),
                    eq(mlModelVersions.organizationId, orgId)
                )
            )
            .returning();
        return deployed ?? null;
    },
};
