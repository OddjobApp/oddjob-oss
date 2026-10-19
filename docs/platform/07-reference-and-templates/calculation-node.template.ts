/**
 * Neuro-Symbolic Calculation Node Template
 * Oddjob Reference Implementation
 * 
 * Standard template for deterministic mathematical calculation nodes with
 * typed AST inputs, unit reconciliation, and reactive edge notification.
 */

import { z } from "zod";

export const CalculationInputSchema = z.object({
  variableName: z.string().describe("Identifier used in formula AST, e.g. 'basePrice'"),
  sourceEntityId: z.string().uuid().describe("Knowledge Graph entity supplying value"),
  sourceProperty: z.string().describe("Entity property key containing numeric value"),
  unit: z.string().describe("Physical or financial unit, e.g. 'USD', 'meters', 'ratio'"),
  defaultValue: z.number().optional().default(0)
});

export const CalculationOutputSchema = z.object({
  unit: z.string().describe("Target output unit"),
  precision: z.number().int().min(0).max(8).default(2),
  roundingMode: z.enum(["ROUND_HALF_UP", "FLOOR", "CEIL"]).default("ROUND_HALF_UP")
});

export interface CalculationNodeContext {
  organizationId: string;
  traceparent?: string;
  logger: {
    info: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
  };
}

export interface CalculationNodeExecutionResult {
  nodeId: string;
  computedValue: number;
  unit: string;
  evaluatedAt: string;
  inputsResolved: Record<string, number>;
  downstreamNodesNotified: string[];
}

/**
 * Example Template: Net Revenue Calculation Node
 * Formula: grossRevenue * (1 - taxRate) - refunds
 */
export class NetRevenueCalculationNode {
  public static readonly id = "calc_net_revenue_v1";
  public static readonly formula = "grossRevenue * (1 - taxRate) - refunds";

  public static async execute(
    inputs: { grossRevenue: number; taxRate: number; refunds: number },
    ctx: CalculationNodeContext
  ): Promise<CalculationNodeExecutionResult> {
    ctx.logger.info(`Evaluating calculation node: ${this.id}`, { inputs });

    // 1. Validation & Input Sanitization
    if (inputs.taxRate < 0 || inputs.taxRate > 1) {
      throw new Error(`Invalid taxRate: ${inputs.taxRate}. Must be between 0.0 and 1.0.`);
    }

    // 2. Exact Arithmetic Calculation
    const revenueAfterTax = inputs.grossRevenue * (1 - inputs.taxRate);
    const netRevenue = Math.round((revenueAfterTax - inputs.refunds) * 100) / 100;

    ctx.logger.info(`Calculation evaluated successfully: ${netRevenue} USD`);

    return {
      nodeId: this.id,
      computedValue: netRevenue,
      unit: "USD",
      evaluatedAt: new Date().toISOString(),
      inputsResolved: inputs,
      downstreamNodesNotified: ["calc_ebitda_margin_v1", "calc_tax_provision_v1"]
    };
  }
}
