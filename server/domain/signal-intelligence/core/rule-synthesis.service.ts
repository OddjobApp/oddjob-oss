/**
 * Rule Synthesis & Formal Proof Verification Engine
 *
 * Implements Level 3 Supervised / Beta Decision Intelligence capabilities:
 * - Natural language business logic compiler to AST RuleBranchSpec
 * - Formal verification proofs: contradiction detection, inverted boundary validation, and unsatisfiability checks
 * - Verification certificate generation before runtime registration
 */

import { createLogger } from "@server/utils/logger.js";
import type { CrispCondition, RuleBranchSpec } from "./subscription-rule-engine.service.js";

const logger = createLogger("RuleSynthesisService");

export interface RuleVerificationReport {
  isValid: boolean;
  branchId: string;
  contradictions: string[];
  warnings: string[];
  invariantsPassed: string[];
  compiledRule?: RuleBranchSpec;
}

export class RuleSynthesisService {
  /**
   * Compiles natural language business rules into a typed RuleBranchSpec.
   */
  synthesizeRuleFromNaturalLanguage(
    nlText: string,
    branchName: string = "Synthesized Rule Branch"
  ): RuleBranchSpec {
    const conditions: CrispCondition[] = [];
    const textLower = nlText.toLowerCase();

    // 1. Severity extraction
    const severityMatch = nlText.match(/\bseverity\s+(?:is|=|==|equals)\s+['"]?(Critical|High|Medium|Low)['"]?/i);
    if (severityMatch) {
      conditions.push({
        type: "crisp",
        field: "severity",
        operator: "equals",
        value: severityMatch[1],
      });
    }

    // 2. Sector extraction
    const sectorMatch = nlText.match(/\b(?:targetSector|sector)\s+(?:is|=|==|equals)\s+['"]?([A-Za-z0-9_-]+)['"]?/i);
    if (sectorMatch) {
      conditions.push({
        type: "crisp",
        field: "targetSector",
        operator: "equals",
        value: sectorMatch[1],
      });
    }

    // 3. Jurisdiction / Region extraction
    const jurisdictionMatch = nlText.match(/\b(?:jurisdiction|region|country)\s+(?:is|=|==|equals|in)\s+['"]?([A-Za-z0-9_-]+)['"]?/i);
    if (jurisdictionMatch) {
      conditions.push({
        type: "crisp",
        field: "jurisdiction",
        operator: "equals",
        value: jurisdictionMatch[1],
      });
    }

    // 4. Numeric threshold extraction (confidence, price, latency)
    const numericMatch = nlText.match(/\b(confidence|price|latency|blastRadius)\s*(>=|<=|>|<|==|=)\s*([0-9.]+)/i);
    if (numericMatch) {
      const field = numericMatch[1];
      const rawOp = numericMatch[2];
      const val = parseFloat(numericMatch[3]);

      let operator: CrispCondition["operator"] = "equals";
      if (rawOp === ">=") operator = "greater_than_or_equal";
      else if (rawOp === "<=") operator = "less_than_or_equal";
      else if (rawOp === ">") operator = "greater_than";
      else if (rawOp === "<") operator = "less_than";

      conditions.push({
        type: "crisp",
        field,
        operator,
        value: val,
      });
    }

    const branchId = `branch_${Date.now()}`;
    return {
      branchId,
      branchName,
      matchStrategy: textLower.includes(" or ") ? "ANY" : "ALL",
      conditions,
      // The engine dispatches `thenAction` — it reads
      // `ifBranch.thenAction.deliveryMode` and records the whole object as the
      // action taken. This used to emit `actions: [{ actionType: "NOTIFY_AGENT" }]`,
      // a field nothing in the engine looks at, so a synthesized rule would
      // match its conditions and then dispatch nothing at all.
      thenAction: {
        deliveryMode: "notify_agent",
        receiverBinding: {
          targetType: "agent",
          targetId: "synthesized",
          recipientName: `Synthesized rule: ${branchName}`,
        },
      },
    };
  }

  /**
   * Formally verifies an AST RuleBranchSpec for logical consistency, contradictions, and boundary errors.
   */
  verifyRuleFormalConsistency(branch: RuleBranchSpec): RuleVerificationReport {
    const contradictions: string[] = [];
    const warnings: string[] = [];
    const invariantsPassed: string[] = [];

    if (!branch.conditions || branch.conditions.length === 0) {
      warnings.push("Rule branch contains no conditions (vacuous rule).");
    } else {
      invariantsPassed.push("Non-empty condition set");
    }

    const crispConditions = (branch.conditions || []).filter(
      (c): c is CrispCondition => (c as any).type === "crisp" || !(c as any).type
    );

    // Group conditions by field
    const fieldMap = new Map<string, CrispCondition[]>();
    for (const cond of crispConditions) {
      if (!fieldMap.has(cond.field)) {
        fieldMap.set(cond.field, []);
      }
      fieldMap.get(cond.field)!.push(cond);
    }

    // Check invariants per field
    for (const [field, conds] of fieldMap.entries()) {
      // 1. Check for contradictory equality (field == A AND field == B where A != B)
      if (branch.matchStrategy === "ALL") {
        const equalsConds = conds.filter((c) => c.operator === "equals" || c.operator === "==");
        if (equalsConds.length > 1) {
          const distinctVals = new Set(equalsConds.map((c) => String(c.value).toLowerCase()));
          if (distinctVals.size > 1) {
            contradictions.push(
              `Direct contradiction: Field '${field}' cannot simultaneously equal ${Array.from(distinctVals).join(" and ")} under ALL match strategy.`
            );
          }
        }

        // 2. Check for contradictory numeric bounds (e.g. x > 100 AND x < 50)
        const gtConds = conds.filter(
          (c) => c.operator === "greater_than" || c.operator === "greater_than_or_equal"
        );
        const ltConds = conds.filter(
          (c) => c.operator === "less_than" || c.operator === "less_than_or_equal"
        );

        for (const gt of gtConds) {
          for (const lt of ltConds) {
            const gtVal = Number(gt.value);
            const ltVal = Number(lt.value);
            if (!isNaN(gtVal) && !isNaN(ltVal) && gtVal > ltVal) {
              contradictions.push(
                `Unsatisfiable range: Field '${field}' cannot be both > ${gtVal} and < ${ltVal}.`
              );
            }
          }
        }
      }

      // 3. Check for inverted 'between' bounds
      const betweenConds = conds.filter((c) => c.operator === "between");
      for (const b of betweenConds) {
        if (Array.isArray(b.value) && b.value.length === 2) {
          const [min, max] = b.value.map(Number);
          if (!isNaN(min) && !isNaN(max) && min > max) {
            contradictions.push(
              `Inverted boundary: 'between' range for '${field}' has min (${min}) > max (${max}).`
            );
          }
        }
      }
    }

    if (contradictions.length === 0) {
      invariantsPassed.push("Contradiction & Unsatisfiability checks passed");
      invariantsPassed.push("Boundary range consistency verified");
    }

    const isValid = contradictions.length === 0;

    return {
      isValid,
      branchId: branch.branchId,
      contradictions,
      warnings,
      invariantsPassed,
      compiledRule: isValid ? branch : undefined,
    };
  }
}

export const ruleSynthesisService = new RuleSynthesisService();
