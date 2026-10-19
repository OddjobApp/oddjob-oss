/**
 * Calculation engine integration tests.
 *
 * These had never run once. The suite imported `@jest/globals` in a Vitest
 * project, so every invocation died at import with "Do not import
 * @jest/globals outside of the Jest test environment" and was reported as
 * 0 tests — which is how it drifted out of step with the service it covers
 * without anyone seeing red.
 *
 * Two things had to be true before it was safe to turn on:
 *
 *  1. It must never reach a real database. It writes knowledge nodes and
 *     calculation rows, and its cleanup deletes by organization — so aimed at
 *     dev it would have deleted that organization's entire knowledge graph.
 *     The URL now comes from requireTestDatabaseUrl(), which refuses any
 *     database whose name lacks a distinct "test" segment.
 *
 *  2. It must own its data. It hardcoded organization 1 — a real organization
 *     in dev — and deleted every knowledge node belonging to it after each
 *     test. It now creates a throwaway organization per run and scopes both
 *     its writes and its cleanup to that.
 *
 * DATABASE_URL is assigned before the service is imported: database_service
 * builds its pool at module load, so a static import would bind the pool to
 * whatever URL happened to be ambient. That is why db and the service are
 * dynamic imports.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { Pool } from "pg";
import { calculationNodes, calculationExecutionLogs, calculationDependencies } from "@shared/schema/knowledge/calculations.js";
import { knowledgeNodes } from "@shared/schema/knowledge/graph.js";
import { eq, and } from "drizzle-orm";
import { type OrgContext } from "@server/utils/auth-context.js";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const { db } = await import("@server/database_service.js");
const { calculationService } = await import("./calculation.service.js");

/** Direct handle, used only to create and drop this run's organization. */
const adminPool = new Pool({ connectionString: databaseUrl });

/** The throwaway organization every row in this suite belongs to. */
let testOrgId = 0;

describe("CalculationService", () => {
    let orgContext: OrgContext;
    let testNodeId: number;
    let inputNodeId1: number;
    let inputNodeId2: number;
    /** Offset -> real knowledge node id, reset per test. See extraNode(). */
    const extraNodes = new Map<number, number>();

    beforeAll(async () => {
        const org = await adminPool.query(
            `INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`,
            [`calc-tests-${Date.now()}`],
        );
        testOrgId = org.rows[0].org_id;
    }, 60_000);

    afterAll(async () => {
        // Ordered by dependency: rows first, then the organization itself.
        await db.delete(calculationDependencies).where(eq(calculationDependencies.organizationId, testOrgId));
        await db.delete(calculationExecutionLogs).where(eq(calculationExecutionLogs.organizationId, testOrgId));
        await db.delete(calculationNodes).where(eq(calculationNodes.organizationId, testOrgId));
        await db.delete(knowledgeNodes).where(eq(knowledgeNodes.organizationId, testOrgId));
        await adminPool.query(`DELETE FROM orgs WHERE org_id = $1`, [testOrgId]);
        await adminPool.end();
    }, 60_000);

    beforeEach(async () => {
        // Setup test organization context
        orgContext = {
            organizationId: testOrgId,
            userId: "test-user",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: true,
        };

        // Create test knowledge nodes for inputs
        const [node1] = await db.insert(knowledgeNodes)
            .values({
                label: "Metric",
                name: "Revenue Q1",
                data: { value: 100000 },
                organizationId: testOrgId,
                verificationStatus: "verified",
            })
            .returning();
        inputNodeId1 = node1.id;

        const [node2] = await db.insert(knowledgeNodes)
            .values({
                label: "Metric",
                name: "Revenue Q2",
                data: { value: 120000 },
                organizationId: testOrgId,
                verificationStatus: "verified",
            })
            .returning();
        inputNodeId2 = node2.id;

        // Create test knowledge node for calculation
        const [calcNode] = await db.insert(knowledgeNodes)
            .values({
                label: "CALCULATION",
                name: "Revenue Growth Rate",
                data: { description: "Calculates revenue growth between quarters" },
                organizationId: testOrgId,
                verificationStatus: "verified",
            })
            .returning();
        testNodeId = calcNode.id;
        extraNodes.clear();
    });

    /**
     * A distinct knowledge node to hang a calculation off.
     *
     * The suite asked for these by adding an offset to testNodeId — arithmetic
     * on a serial id, assuming both that ids are contiguous and that anything
     * past the last one created already exists. Neither holds, and
     * calculation_nodes.node_id is a foreign key, so every one of those inserts
     * violated it. (The input nodes are in fact *below* testNodeId, so even an
     * offset of 1 pointed at nothing.)
     *
     * Each offset now maps to a real node, created on first use and reused for
     * the rest of the test, which preserves what the offsets were expressing:
     * "a different node from the last one".
     */
    async function extraNode(offset: number): Promise<number> {
        const cached = extraNodes.get(offset);
        if (cached !== undefined) return cached;

        const [node] = await db
            .insert(knowledgeNodes)
            .values({
                label: "CALCULATION",
                name: `Calculation target ${offset}`,
                data: {},
                organizationId: testOrgId,
                verificationStatus: "verified",
            })
            .returning();

        extraNodes.set(offset, node.id);
        return node.id;
    }

    afterEach(async () => {
        // Cleanup test data
        await db.delete(calculationDependencies)
            .where(eq(calculationDependencies.organizationId, testOrgId));
        await db.delete(calculationExecutionLogs)
            .where(eq(calculationExecutionLogs.organizationId, testOrgId));
        await db.delete(calculationNodes)
            .where(eq(calculationNodes.organizationId, testOrgId));
        await db.delete(knowledgeNodes)
            .where(eq(knowledgeNodes.organizationId, testOrgId));
    });

    describe("createCalculation", () => {
        it("should create a calculation node with dependencies", async () => {
            const input = {
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "DIVIDE" as const,
                formula: "(currentRevenue - previousRevenue) / previousRevenue * 100",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "previousRevenue", required: true },
                    { nodeId: inputNodeId2, variable: "currentRevenue", required: true },
                ],
                outputUnit: "%",
                outputPrecision: 2,
                description: "Revenue growth calculation",
            };

            const calculation = await calculationService.createCalculation(input, orgContext);

            expect(calculation).toBeDefined();
            expect(calculation.nodeId).toBe(testNodeId);
            expect(calculation.operation).toBe("DIVIDE");
            expect(calculation.formula).toBe(input.formula);
            expect(calculation.status).toBe("ACTIVE");

            // Verify dependencies were created
            const dependencies = await db.select()
                .from(calculationDependencies)
                .where(eq(calculationDependencies.calculationNodeId, calculation.id));

            expect(dependencies).toHaveLength(2);
        });

        it("should create calculation without input references", async () => {
            const input = {
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "SUM" as const,
                formula: "sum(values)",
                inputReferences: [],
            };

            const calculation = await calculationService.createCalculation(input, orgContext);

            expect(calculation).toBeDefined();
            expect(calculation.inputReferences).toEqual([]);
        });

        it("binds two formula variables to the same source node", async () => {
            /*
              calculation_dependencies used to be UNIQUE(calculation_node_id,
              depends_on_node_id), so a second variable pointing at a node the
              calculation already referenced was a raw duplicate-key error —
              a 500 with no way to express the model. resolveInputContext keys
              the context by variable_name and needs both rows, so the fix was
              to widen the key rather than de-duplicate (migration 0040).
            */
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "first + second",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "first", required: true },
                    { nodeId: inputNodeId1, variable: "second", required: true },
                ],
            }, orgContext);

            const dependencies = await db.select()
                .from(calculationDependencies)
                .where(eq(calculationDependencies.calculationNodeId, calculation.id));

            expect(dependencies).toHaveLength(2);
            expect(dependencies.map((d) => d.variableName).sort()).toEqual(["first", "second"]);
            // Both bindings resolve, so the formula can actually be evaluated.
            const result = await calculationService.executeCalculation(calculation.id, orgContext);
            expect(result.error).toBeUndefined();
            expect(result.value).toBe(200000); // 100000 + 100000
        });
    });

    describe("getCalculationById", () => {
        it("should retrieve calculation by ID", async () => {
            const created = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [],
            }, orgContext);

            const retrieved = await calculationService.getCalculationById(created.id, orgContext);

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(created.id);
        });

        it("should return null for non-existent calculation", async () => {
            const result = await calculationService.getCalculationById(99999, orgContext);
            expect(result).toBeNull();
        });
    });

    describe("getCalculationByNodeId", () => {
        it("should retrieve calculation by knowledge node ID", async () => {
            await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [],
            }, orgContext);

            const retrieved = await calculationService.getCalculationByNodeId(testNodeId, orgContext);

            expect(retrieved).toBeDefined();
            expect(retrieved?.nodeId).toBe(testNodeId);
        });
    });

    describe("updateCalculation", () => {
        it("should update calculation and refresh dependencies", async () => {
            const created = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "a", required: true },
                ],
            }, orgContext);

            const updated = await calculationService.updateCalculation(created.id, {
                operation: "MULTIPLY",
                formula: "a * b",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "a", required: true },
                    { nodeId: inputNodeId2, variable: "b", required: true },
                ],
            }, orgContext);

            expect(updated.operation).toBe("MULTIPLY");
            expect(updated.formula).toBe("a * b");

            // Verify dependencies were updated
            const dependencies = await db.select()
                .from(calculationDependencies)
                .where(eq(calculationDependencies.calculationNodeId, created.id));

            expect(dependencies).toHaveLength(2);
        });

        it("should throw error for non-existent calculation", async () => {
            await expect(
                calculationService.updateCalculation(99999, { operation: "ADD" as const }, orgContext)
            ).rejects.toThrow("Calculation 99999 not found");
        });
    });

    describe("deleteCalculation", () => {
        it("should delete calculation and its dependencies", async () => {
            const created = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "a", required: true },
                ],
            }, orgContext);

            const result = await calculationService.deleteCalculation(created.id, orgContext);

            expect(result).toBe(true);

            // Verify calculation is deleted
            const retrieved = await calculationService.getCalculationById(created.id, orgContext);
            expect(retrieved).toBeNull();

            // Verify dependencies are deleted
            const dependencies = await db.select()
                .from(calculationDependencies)
                .where(eq(calculationDependencies.calculationNodeId, created.id));

            expect(dependencies).toHaveLength(0);
        });
    });

    describe("executeCalculation", () => {
        it("should execute calculation with cached result", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "SUM" as const,
                formula: "sum(values)",
                inputReferences: [],
                cacheTtlSeconds: 300,
            }, orgContext);

            // Set a cached result
            await db.update(calculationNodes)
                .set({
                    cachedResult: "42.5",
                    lastCalculatedAt: new Date(),
                })
                .where(eq(calculationNodes.id, calculation.id));

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(42.5);
            expect(result.cached).toBe(true);
            expect(result.executionTimeMs).toBe(0);
        });

        it("should force recalculate when requested", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "SUM" as const,
                formula: "sum(values)",
                inputReferences: [],
                cacheTtlSeconds: 300,
            }, orgContext);

            // Set a cached result
            await db.update(calculationNodes)
                .set({
                    cachedResult: "42.5",
                    lastCalculatedAt: new Date(),
                })
                .where(eq(calculationNodes.id, calculation.id));

            const result = await calculationService.executeCalculation(
                calculation.id,
                orgContext,
                { forceRecalculate: true }
            );

            // Should recalculate (result will be 0 since no inputs)
            expect(result.cached).toBe(false);
        });

        it("should return error for disabled calculation", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [],
                status: "DISABLED" as const,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.error).toContain("DISABLED");
        });

        it("should execute arithmetic operations", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "100 + 200",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(300);
            expect(result.error).toBeUndefined();
        });

        it("should log execution history", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "100 + 200",
                inputReferences: [],
            }, orgContext);

            await calculationService.executeCalculation(calculation.id, orgContext);

            const logs = await db.select()
                .from(calculationExecutionLogs)
                .where(eq(calculationExecutionLogs.calculationNodeId, calculation.id));

            expect(logs).toHaveLength(1);
            expect(logs[0].status).toBe("SUCCESS");
            // `result` is DECIMAL(20,10), which pg returns as a full-scale
            // string ("300.0000000000"). Compare the number, not its formatting.
            expect(Number(logs[0].result)).toBe(300);
        });
    });

    describe("triggerReactiveUpdates", () => {
        it("should trigger calculations that depend on a node", async () => {
            // Create calculation that depends on inputNodeId1
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "value + 10",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value", required: true },
                ],
            }, orgContext);

            // Trigger reactive update
            await calculationService.triggerReactiveUpdates(inputNodeId1, orgContext, "node_update");

            // Verify calculation was executed (check execution log)
            const logs = await db.select()
                .from(calculationExecutionLogs)
                .where(eq(calculationExecutionLogs.calculationNodeId, calculation.id));

            expect(logs.length).toBeGreaterThan(0);
            expect(logs[0].triggeredBy).toBe("node_update");
        });
    });

    describe("listCalculations", () => {
        it("should list all calculations for organization", async () => {
            await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.listCalculations(orgContext);

            expect(result.calculations).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should filter by status", async () => {
            await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "a + b",
                inputReferences: [],
                status: "ACTIVE" as const,
            }, orgContext);

            await calculationService.createCalculation({
                nodeId: await extraNode(1), // Different node ID
                organizationId: testOrgId,
                operation: "SUBTRACT" as const,
                formula: "a - b",
                inputReferences: [],
                status: "DISABLED" as const,
            }, orgContext);

            const result = await calculationService.listCalculations(orgContext, { status: "ACTIVE" });

            expect(result.calculations).toHaveLength(1);
            expect(result.calculations[0].status).toBe("ACTIVE");
        });

        it("should support pagination", async () => {
            // Create multiple calculations
            for (let i = 0; i < 5; i++) {
                await calculationService.createCalculation({
                    nodeId: await extraNode(i),
                    organizationId: testOrgId,
                    operation: "ADD" as const,
                    formula: `a + ${i}`,
                    inputReferences: [],
                }, orgContext);
            }

            const page1 = await calculationService.listCalculations(orgContext, { limit: 2, offset: 0 });
            const page2 = await calculationService.listCalculations(orgContext, { limit: 2, offset: 2 });

            expect(page1.calculations).toHaveLength(2);
            expect(page2.calculations).toHaveLength(2);
            expect(page1.total).toBe(5);
        });
    });

    describe("formula evaluation safety", () => {
        it("should reject unsafe expressions", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "ADD" as const,
                formula: "process.exit(1)", // Malicious attempt
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.error).toBeDefined();
            // What matters is that the expression is refused and nothing is
            // evaluated — not the wording. The evaluator reports it as
            // "Invalid arithmetic formula: process.exit(1)"; asserting the old
            // "Invalid expression" string tested the message, not the guard.
            expect(result.error).toMatch(/invalid/i);
        });

        it("should handle division by zero", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "DIVIDE" as const,
                formula: "100 / 0",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.error).toBeDefined();
            expect(result.error).toContain("Division by zero");
        });
    });

    describe("Temporal Calculations", () => {
        beforeEach(async () => {
            // Add time series data for temporal calculation tests
            const calculation = await calculationService.createCalculation({
                nodeId: testNodeId,
                organizationId: testOrgId,
                operation: "MOVING_AVERAGE" as const,
                formula: "moving_average",
                inputReferences: [],
                windowSize: 3,
            }, orgContext);

            // Add historical data points
            const now = new Date();
            for (let i = 0; i < 5; i++) {
                const timestamp = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000)); // Daily data
                await calculationService.addTimeSeriesPoint(
                    calculation.id,
                    100 + i * 10, // 100, 110, 120, 130, 140
                    timestamp,
                    orgContext
                );
            }
        });

        it("should calculate moving average from time series", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(100),
                organizationId: testOrgId,
                operation: "MOVING_AVERAGE" as const,
                formula: "moving_average",
                inputReferences: [],
                windowSize: 3,
            }, orgContext);

            // Chronological: the oldest point is 100 and the newest is 140.
            // This loop used to subtract `i` days, which paired the LARGEST
            // values with the OLDEST timestamps — so the three most recent
            // points were 100/110/120 and the average was 110, not the 130 the
            // assertion below describes. getTimeSeriesData orders by timestamp
            // desc (most recent N), which is the correct window; the fixture was
            // the thing that had the series backwards.
            const now = new Date();
            for (let i = 0; i < 5; i++) {
                const timestamp = new Date(now.getTime() - ((4 - i) * 24 * 60 * 60 * 1000));
                await calculationService.addTimeSeriesPoint(
                    calculation.id,
                    100 + i * 10,
                    timestamp,
                    orgContext
                );
            }

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeCloseTo(130, 0); // Average of 120, 130, 140
            expect(result.error).toBeUndefined();
        });

        it("should calculate CAGR from time series", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(101),
                organizationId: testOrgId,
                operation: "CAGR" as const,
                formula: "cagr",
                inputReferences: [],
            }, orgContext);

            // Add time series data with known growth
            const now = new Date();
            const startDate = new Date(now.getTime() - (365 * 2 * 24 * 60 * 60 * 1000)); // 2 years ago
            
            await calculationService.addTimeSeriesPoint(calculation.id, 100, startDate, orgContext);
            await calculationService.addTimeSeriesPoint(calculation.id, 121, now, orgContext); // 10% annual growth compounded

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeCloseTo(10, 1); // ~10% CAGR
            expect(result.error).toBeUndefined();
        });

        it("should calculate exponential smoothing", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(102),
                organizationId: testOrgId,
                operation: "EXPONENTIAL_SMOOTHING" as const,
                formula: "exponential_smoothing",
                inputReferences: [],
                smoothingFactor: 0.3,
            }, orgContext);

            // Add volatile time series data
            const now = new Date();
            const values = [100, 150, 80, 120, 90];
            for (let i = 0; i < values.length; i++) {
                const timestamp = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
                await calculationService.addTimeSeriesPoint(
                    calculation.id,
                    values[i],
                    timestamp,
                    orgContext
                );
            }

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            // Exponential smoothing should reduce volatility
            expect(result.value).toBeGreaterThan(80);
            expect(result.value).toBeLessThan(150);
            expect(result.error).toBeUndefined();
        });

        it("should calculate rolling sum", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(103),
                organizationId: testOrgId,
                operation: "ROLLING_SUM" as const,
                formula: "rolling_sum",
                inputReferences: [],
                windowSize: 3,
            }, orgContext);

            // Chronological, oldest first — see the note on the moving-average
            // fixture. Reversed, the newest three points were 10/15/20 and the
            // sum was 45 rather than the 75 asserted below.
            const now = new Date();
            for (let i = 0; i < 5; i++) {
                const timestamp = new Date(now.getTime() - ((4 - i) * 24 * 60 * 60 * 1000));
                await calculationService.addTimeSeriesPoint(
                    calculation.id,
                    10 + i * 5, // 10, 15, 20, 25, 30
                    timestamp,
                    orgContext
                );
            }

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeCloseTo(75, 0); // Sum of 20, 25, 30
            expect(result.error).toBeUndefined();
        });

        it("should add time series point", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(104),
                organizationId: testOrgId,
                operation: "MOVING_AVERAGE" as const,
                formula: "moving_average",
                inputReferences: [],
            }, orgContext);

            const timestamp = new Date();
            await calculationService.addTimeSeriesPoint(
                calculation.id,
                42.5,
                timestamp,
                orgContext,
                inputNodeId1
            );

            const timeSeries = await calculationService.getTimeSeriesRange(
                calculation.id,
                orgContext,
                new Date(timestamp.getTime() - 1000),
                new Date(timestamp.getTime() + 1000)
            );

            expect(timeSeries).toHaveLength(1);
            expect(Number(timeSeries[0].value)).toBe(42.5);
            expect(timeSeries[0].sourceNodeId).toBe(inputNodeId1);
        });

        it("should require baseline date for YoY calculation", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(105),
                organizationId: testOrgId,
                operation: "YEAR_OVER_YEAR" as const,
                formula: "yoy_growth",
                inputReferences: [],
                // Missing baselineDate
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.error).toContain("baselineDate");
        });

        it("should get time series range", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(106),
                organizationId: testOrgId,
                operation: "MOVING_AVERAGE" as const,
                formula: "moving_average",
                inputReferences: [],
            }, orgContext);

            const now = new Date();
            const startDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
            const endDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

            // Add data points within range
            await calculationService.addTimeSeriesPoint(calculation.id, 100, new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), orgContext);
            await calculationService.addTimeSeriesPoint(calculation.id, 200, now, orgContext);

            // Add data point outside range
            await calculationService.addTimeSeriesPoint(calculation.id, 50, new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), orgContext);

            const timeSeries = await calculationService.getTimeSeriesRange(
                calculation.id,
                orgContext,
                startDate,
                endDate
            );

            expect(timeSeries).toHaveLength(2);
        });
    });

    describe("Probabilistic Calculations", () => {
        it("should calculate Monte Carlo simulation with normal distribution", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(200),
                organizationId: testOrgId,
                operation: "MONTE_CARLO_SIMULATION" as const,
                formula: "monte_carlo",
                inputReferences: [],
                distributionType: "NORMAL",
                distributionParameters: { mean: 100, stdDev: 15 },
                simulationIterations: 1000,
                confidenceLevel: 0.95,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(50);
            expect(result.value).toBeLessThan(150);
            expect(result.error).toBeUndefined();
        });

        it("should calculate Monte Carlo simulation with uniform distribution", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(201),
                organizationId: testOrgId,
                operation: "MONTE_CARLO_SIMULATION" as const,
                formula: "monte_carlo",
                inputReferences: [],
                distributionType: "UNIFORM",
                distributionParameters: { min: 0, max: 100 },
                simulationIterations: 1000,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0);
            expect(result.value).toBeLessThan(100);
            expect(result.error).toBeUndefined();
        });

        it("should calculate Bayesian inference", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(202),
                organizationId: testOrgId,
                operation: "BAYESIAN_INFERENCE" as const,
                formula: "bayesian",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "data1", required: true },
                    { nodeId: inputNodeId2, variable: "data2", required: true },
                ],
                priorDistribution: { mean: 50, stdDev: 10 },
                likelihoodFunction: "NORMAL",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should calculate confidence interval", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(203),
                organizationId: testOrgId,
                operation: "CONFIDENCE_INTERVAL" as const,
                formula: "confidence_interval",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                    { nodeId: inputNodeId2, variable: "value2", required: true },
                ],
                confidenceLevel: 0.95,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should calculate risk assessment", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(204),
                organizationId: testOrgId,
                operation: "RISK_ASSESSMENT" as const,
                formula: "risk_assessment",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                    { nodeId: inputNodeId2, variable: "value2", required: true },
                ],
                distributionParameters: { threshold: 50 },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.value).toBeLessThanOrEqual(100);
            expect(result.error).toBeUndefined();
        });

        it("should calculate sensitivity analysis", async () => {
            // Every input needs a value: since ec9795a68 a missing numeric input is
            // an error rather than a silent zero, and an extraNode carries no value.
            const [input2] = await db.insert(knowledgeNodes)
                .values({ label: "Metric", name: "Revenue Q3", data: { value: 90000 }, organizationId: testOrgId, verificationStatus: "verified" })
                .returning();
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(205),
                organizationId: testOrgId,
                operation: "SENSITIVITY_ANALYSIS" as const,
                formula: "sensitivity_analysis",
                // Three distinct nodes. "input1" and "input2" both pointed at
                // inputNodeId2, which calculation_dependencies rejects —
                // UNIQUE(calculation_node_id, depends_on_node_id) — so creating
                // the calculation failed on a raw duplicate-key error before any
                // sensitivity was computed. Three separate inputs is also what
                // the analysis is actually about.
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "base", required: true },
                    { nodeId: inputNodeId2, variable: "input1", required: true },
                    { nodeId: input2.id, variable: "input2", required: true },
                ],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should respect simulation iteration limits", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(206),
                organizationId: testOrgId,
                operation: "MONTE_CARLO_SIMULATION" as const,
                formula: "monte_carlo",
                inputReferences: [],
                distributionType: "NORMAL",
                distributionParameters: { mean: 100, stdDev: 15 },
                simulationIterations: 100, // Lower iterations for faster test
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(result.error).toBeUndefined();
        });

        it("should handle missing distribution parameters gracefully", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(207),
                organizationId: testOrgId,
                operation: "MONTE_CARLO_SIMULATION" as const,
                formula: "monte_carlo",
                inputReferences: [],
                distributionType: "NORMAL",
                // Missing distributionParameters - should use defaults
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(result.error).toBeUndefined();
        });
    });

    describe("Constraint Validation", () => {
        it("should validate range constraint successfully", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(300),
                organizationId: testOrgId,
                operation: "CONSTRAINT_CHECK" as const,
                formula: "range_check",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "RANGE",
                // value1 is 100000 (see the fixture in beforeEach). The bounds
                // were 50-150, which that value fails — so this test asserted a
                // pass while describing a range its own input could never be in.
                constraintParameters: { min: 50000, max: 150000 },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Passed
            expect(result.error).toBeUndefined();
        });

        it("should fail range constraint when value out of range", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(301),
                organizationId: testOrgId,
                operation: "CONSTRAINT_CHECK" as const,
                formula: "range_check",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "RANGE",
                constraintParameters: { min: 200, max: 300 }, // Value 100000 is out of range
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(0); // Failed
            expect(result.error).toBeUndefined();
        });

        it("should validate equality constraint", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(302),
                organizationId: testOrgId,
                operation: "RULE_VALIDATION" as const,
                formula: "equality_check",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "EQUALITY",
                constraintParameters: { expectedValue: 100000 },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Passed (value is 100000)
            expect(result.error).toBeUndefined();
        });

        it("should evaluate conditional logic with if-then", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(303),
                organizationId: testOrgId,
                operation: "CONDITIONAL_LOGIC" as const,
                formula: "conditional",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                gateCondition: {
                    if: "value1 > 50000",
                    then: "1",
                    else: "0"
                },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Condition met
            expect(result.error).toBeUndefined();
        });

        it("should evaluate gate condition with operators", async () => {
            /*
              value1 is 100000 and value2 is 120000, so "value1 > value2" is
              false and the gate is 0. This asserted 1 with the comment
              "100000 > 120000 is false, but logic handles it" — an expectation
              contradicted by its own reasoning.

              Both directions are checked, because a gate that returned 0
              unconditionally (its behaviour for any unrecognised operator) would
              satisfy the false case on its own and prove nothing.
            */
            const gate = async (left: string, right: string, offset: number) => {
                const calculation = await calculationService.createCalculation({
                    nodeId: await extraNode(offset),
                    organizationId: testOrgId,
                    operation: "GATE_CONDITION" as const,
                    formula: "gate",
                    inputReferences: [
                        { nodeId: inputNodeId1, variable: "value1", required: true },
                        { nodeId: inputNodeId2, variable: "value2", required: true },
                    ],
                    gateCondition: { operator: ">", left, right },
                }, orgContext);

                return calculationService.executeCalculation(calculation.id, orgContext);
            };

            const notGreater = await gate("value1", "value2", 304);
            expect(notGreater.value).toBe(0); // 100000 > 120000 is false
            expect(notGreater.error).toBeUndefined();

            const result = await gate("value2", "value1", 3041);
            expect(result.value).toBe(1); // 120000 > 100000 is true
            expect(result.error).toBeUndefined();
        });

        it("should enforce policy with BLOCK action", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(305),
                organizationId: testOrgId,
                operation: "POLICY_ENFORCEMENT" as const,
                formula: "policy",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "RANGE",
                // Bounds that value1 (100000) actually satisfies — the assertion
                // below is about a policy that PASSES and therefore does not
                // block, so the range has to be one the input can meet.
                constraintParameters: { min: 50000, max: 150000 },
                enforcementAction: "BLOCK",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Passed, so not blocked
            expect(result.error).toBeUndefined();
        });

        it("should check compliance with threshold", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(306),
                organizationId: testOrgId,
                operation: "COMPLIANCE_CHECK" as const,
                formula: "compliance",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                    { nodeId: inputNodeId2, variable: "value2", required: true },
                ],
                ruleDefinition: {
                    complianceRules: [
                        { condition: "value1 > 0" },
                        { condition: "value2 > 0" }
                    ]
                },
                complianceThreshold: 0.8,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Compliant
            expect(result.error).toBeUndefined();
        });

        it("should handle unique constraint", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(307),
                organizationId: testOrgId,
                operation: "CONSTRAINT_CHECK" as const,
                formula: "unique_check",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                    { nodeId: inputNodeId2, variable: "value2", required: true },
                ],
                constraintType: "UNIQUE",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Values are unique
            expect(result.error).toBeUndefined();
        });

        it("should handle missing required keys in existence constraint", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(308),
                organizationId: testOrgId,
                operation: "RULE_VALIDATION" as const,
                formula: "existence_check",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "EXISTENCE",
                constraintParameters: { requiredKeys: ["value1", "value2"] }, // value2 is missing
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(0); // Failed - missing required key
            expect(result.error).toBeUndefined();
        });

        it("should evaluate custom rule condition", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(309),
                organizationId: testOrgId,
                operation: "RULE_VALIDATION" as const,
                formula: "custom_rule",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                ],
                constraintType: "CUSTOM",
                ruleDefinition: {
                    condition: "value1 > 50000"
                },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBe(1); // Condition met
            expect(result.error).toBeUndefined();
        });
    });

    describe("Graph Algorithms", () => {
        it("should calculate PageRank centrality", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(400),
                organizationId: testOrgId,
                operation: "PAGERANK" as const,
                formula: "pagerank",
                inputReferences: [],
                dampingFactor: 0.85,
                iterations: 10,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0);
            expect(result.error).toBeUndefined();
        });

        it("should calculate betweenness centrality", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(401),
                organizationId: testOrgId,
                operation: "BETWEENNESS_CENTRALITY" as const,
                formula: "betweenness",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();
        });

        it("should calculate closeness centrality", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(402),
                organizationId: testOrgId,
                operation: "CLOSENESS_CENTRALITY" as const,
                formula: "closeness",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();
        });

        it("should calculate shortest path", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(403),
                organizationId: testOrgId,
                operation: "SHORTEST_PATH" as const,
                formula: "shortest_path",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "source", required: true },
                ],
                targetNodeId: inputNodeId2,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(-1); // -1 if no path found
            expect(result.error).toBeUndefined();
        });

        it("should require targetNodeId for shortest path", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(404),
                organizationId: testOrgId,
                operation: "SHORTEST_PATH" as const,
                formula: "shortest_path",
                inputReferences: [],
                // Missing targetNodeId
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.error).toContain("targetNodeId");
        });

        it("should calculate minimum spanning tree", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(405),
                organizationId: testOrgId,
                operation: "MINIMUM_SPANNING_TREE" as const,
                formula: "mst",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();
        });

        it("should detect communities", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(406),
                organizationId: testOrgId,
                operation: "COMMUNITY_DETECTION" as const,
                formula: "communities",
                inputReferences: [],
                communityDetectionMethod: "LABEL_PROPAGATION",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0); // At least 1 community
            expect(result.error).toBeUndefined();
        });

        it("should propagate influence", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(407),
                organizationId: testOrgId,
                operation: "INFLUENCE_PROPAGATION" as const,
                formula: "influence",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "source", required: true },
                ],
                maxDepth: 3,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(1); // At least source node
            expect(result.error).toBeUndefined();
        });

        it("should cluster graph", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(408),
                organizationId: testOrgId,
                operation: "GRAPH_CLUSTERING" as const,
                formula: "clustering",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0); // At least 1 cluster
            expect(result.error).toBeUndefined();
        });

        it("should analyze network metrics", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(409),
                organizationId: testOrgId,
                operation: "NETWORK_ANALYSIS" as const,
                formula: "network_analysis",
                inputReferences: [],
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0); // Clustering coefficient
            expect(result.value).toBeLessThanOrEqual(1);
            expect(result.error).toBeUndefined();
        });

        it("should respect maxDepth for influence propagation", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(410),
                organizationId: testOrgId,
                operation: "INFLUENCE_PROPAGATION" as const,
                formula: "influence",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "source", required: true },
                ],
                maxDepth: 1, // Limited depth
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(1);
            expect(result.error).toBeUndefined();
        });

        it("should respect dampingFactor for PageRank", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(411),
                organizationId: testOrgId,
                operation: "PAGERANK" as const,
                formula: "pagerank",
                inputReferences: [],
                dampingFactor: 0.5, // Different damping factor
                iterations: 5,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0);
            expect(result.error).toBeUndefined();
        });
    });

    describe("ML Inference", () => {
        it("should perform model prediction", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(500),
                organizationId: testOrgId,
                operation: "MODEL_PREDICTION" as const,
                formula: "prediction",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                    { nodeId: inputNodeId2, variable: "feature2", required: true },
                ],
                modelId: "test_model",
                modelVersion: "1.0",
                modelType: "REGRESSION",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should perform classification", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(501),
                organizationId: testOrgId,
                operation: "CLASSIFICATION" as const,
                formula: "classification",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                modelId: "classifier_model",
                modelVersion: "1.0",
                modelType: "CLASSIFICATION",
                predictionThreshold: 0.5,
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.value).toBeLessThanOrEqual(1);
            expect(result.error).toBeUndefined();
        });

        it("should perform regression inference", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(502),
                organizationId: testOrgId,
                operation: "REGRESSION_INFERENCE" as const,
                formula: "regression",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                modelId: "regressor_model",
                modelVersion: "1.0",
                modelType: "REGRESSION",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should detect anomalies", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(503),
                organizationId: testOrgId,
                operation: "ANOMALY_DETECTION" as const,
                formula: "anomaly_detection",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "value1", required: true },
                    { nodeId: inputNodeId2, variable: "value2", required: true },
                ],
                anomalyDetectionMethod: "STATISTICAL",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.value).toBeLessThanOrEqual(1);
            expect(result.error).toBeUndefined();
        });

        it("should extract features", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(504),
                organizationId: testOrgId,
                operation: "FEATURE_EXTRACTION" as const,
                formula: "feature_extraction",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "raw_feature", required: true },
                ],
                featureConfig: {
                    featureMapping: { raw_feature: "processed_feature" },
                    transformations: { processed_feature: "normalize" },
                },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0);
            expect(result.error).toBeUndefined();
        });

        it("should perform model ensemble", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(505),
                organizationId: testOrgId,
                operation: "MODEL_ENSEMBLE" as const,
                formula: "ensemble",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                ensembleStrategy: "MAJORITY_VOTE",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });

        it("should perform clustering inference", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(506),
                organizationId: testOrgId,
                operation: "CLUSTERING_INFERENCE" as const,
                formula: "clustering",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                modelType: "CLUSTERING",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();
        });

        it("should perform dimensionality reduction", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(507),
                organizationId: testOrgId,
                operation: "DIMENSIONALITY_REDUCTION" as const,
                formula: "pca",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                    { nodeId: inputNodeId2, variable: "feature2", required: true },
                ],
                modelType: "CLUSTERING",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(2); // Minimum reduced dimensions
            expect(result.error).toBeUndefined();
        });

        it("should respect prediction threshold for classification", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(508),
                organizationId: testOrgId,
                operation: "CLASSIFICATION" as const,
                formula: "classification",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                modelId: "classifier_model",
                modelVersion: "1.0",
                modelType: "CLASSIFICATION",
                predictionThreshold: 0.9, // High threshold
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.value).toBeLessThanOrEqual(1);
            expect(result.error).toBeUndefined();
        });

        it("should apply feature transformations", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(509),
                organizationId: testOrgId,
                operation: "FEATURE_EXTRACTION" as const,
                formula: "feature_extraction",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "raw_feature", required: true },
                ],
                featureConfig: {
                    transformations: { raw_feature: "log" },
                },
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeGreaterThan(0);
            expect(result.error).toBeUndefined();
        });

        it("should use weighted average ensemble strategy", async () => {
            const calculation = await calculationService.createCalculation({
                nodeId: await extraNode(510),
                organizationId: testOrgId,
                operation: "MODEL_ENSEMBLE" as const,
                formula: "ensemble",
                inputReferences: [
                    { nodeId: inputNodeId1, variable: "feature1", required: true },
                ],
                ensembleStrategy: "WEIGHTED_AVERAGE",
            }, orgContext);

            const result = await calculationService.executeCalculation(calculation.id, orgContext);

            expect(result.value).toBeDefined();
            expect(typeof result.value).toBe("number");
            expect(result.error).toBeUndefined();
        });
    });
});
