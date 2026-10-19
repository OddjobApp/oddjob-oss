import { FormulaContext } from "./basic.evaluator.js";

export interface ConstraintViolation {
    key?: string;
    value?: any;
    violation: string;
    threshold?: number | string | number[];
    expected?: any;
    severity?: "BLOCK" | "WARN" | "INFO";
    message?: string;
}

export interface RuleEvaluationResult {
    passed: boolean;
    complianceScore: number;
    violations: ConstraintViolation[];
}

export const constraintEvaluator = {
    /**
     * Compare a numeric value against a threshold using standard relational operators
     */
    validateThreshold(val: number, threshold: number, operator: string = ">="): boolean {
        switch (operator) {
            case ">": return val > threshold;
            case ">=": return val >= threshold;
            case "<": return val < threshold;
            case "<=": return val <= threshold;
            case "==":
            case "===": return val === threshold;
            case "!=":
            case "!==": return val !== threshold;
            default: return val >= threshold;
        }
    },

    /**
     * Validate whether a value falls within [min, max] interval bounds
     */
    validateRange(val: number, min?: number, max?: number): { passed: boolean; violation?: string } {
        if (min !== undefined && val < min) {
            return { passed: false, violation: "below_minimum" };
        }
        if (max !== undefined && val > max) {
            return { passed: false, violation: "above_maximum" };
        }
        return { passed: true };
    },

    /**
     * Validate whether a value exists in an allowed set / array
     */
    validateSet(val: any, allowedSet: any[]): { passed: boolean; violation?: string } {
        if (!Array.isArray(allowedSet) || allowedSet.length === 0) {
            return { passed: true };
        }
        const passed = allowedSet.includes(val);
        return { passed, violation: passed ? undefined : "not_in_allowed_set" };
    },

    /**
     * Validate whether a string value matches a regex pattern
     */
    validatePattern(val: string, pattern: string): { passed: boolean; violation?: string } {
        try {
            const regex = new RegExp(pattern);
            const passed = regex.test(String(val));
            return { passed, violation: passed ? undefined : "pattern_mismatch" };
        } catch {
            return { passed: false, violation: "invalid_regex_pattern" };
        }
    },

    /**
     * Validate whether all required keys are present in context
     */
    validateExistence(requiredKeys: string[], context: FormulaContext): { passed: boolean; missingKeys: string[] } {
        const missingKeys: string[] = [];
        for (const key of requiredKeys) {
            if (context[key] === undefined || context[key] === null) {
                missingKeys.push(key);
            }
        }
        return { passed: missingKeys.length === 0, missingKeys };
    },

    /**
     * Evaluate binary gate comparison
     */
    evaluateGate(left: any, right: any, operator: string = ">="): number {
        switch (operator) {
            case "===":
            case "==":
                return left === right ? 1 : 0;
            case "!==":
            case "!=":
                return left !== right ? 1 : 0;
            case ">":
                return Number(left) > Number(right) ? 1 : 0;
            case "<":
                return Number(left) < Number(right) ? 1 : 0;
            case ">=":
                return Number(left) >= Number(right) ? 1 : 0;
            case "<=":
                return Number(left) <= Number(right) ? 1 : 0;
            case "&&":
                return (left && right) ? 1 : 0;
            case "||":
                return (left || right) ? 1 : 0;
            default:
                return Number(left) >= Number(right) ? 1 : 0;
        }
    },

    /**
     * Evaluate rule constraint definitions against context
     */
    evaluateRule(
        context: FormulaContext,
        constraintType: string,
        params: Record<string, any> = {},
        evalCustomExpr?: (expr: string) => boolean
    ): RuleEvaluationResult {
        const violations: ConstraintViolation[] = [];
        let passed = true;

        switch (constraintType) {
            case "RANGE": {
                for (const [key, value] of Object.entries(context)) {
                    const numValue = Number(value);
                    const rangeResult = this.validateRange(numValue, params.min, params.max);
                    if (!rangeResult.passed) {
                        violations.push({
                            key,
                            value: numValue,
                            violation: rangeResult.violation || "range_violation",
                            threshold: rangeResult.violation === "below_minimum" ? params.min : params.max,
                            severity: "BLOCK"
                        });
                        passed = false;
                    }
                }
                break;
            }

            case "EQUALITY": {
                for (const [key, value] of Object.entries(context)) {
                    if (params.expectedValue !== undefined && value !== params.expectedValue) {
                        violations.push({
                            key,
                            value,
                            violation: "not_equal",
                            expected: params.expectedValue,
                            severity: "BLOCK"
                        });
                        passed = false;
                    }
                }
                break;
            }

            case "EXISTENCE": {
                const { passed: existPassed, missingKeys } = this.validateExistence(params.requiredKeys || [], context);
                if (!existPassed) {
                    for (const key of missingKeys) {
                        violations.push({
                            key,
                            violation: "missing_required",
                            severity: "BLOCK"
                        });
                    }
                    passed = false;
                }
                break;
            }

            case "SET_MEMBERSHIP": {
                for (const [key, value] of Object.entries(context)) {
                    const setResult = this.validateSet(value, params.allowedSet || []);
                    if (!setResult.passed) {
                        violations.push({
                            key,
                            value,
                            violation: "not_in_allowed_set",
                            expected: params.allowedSet,
                            severity: "WARN"
                        });
                        passed = false;
                    }
                }
                break;
            }

            case "CUSTOM":
            default: {
                if (params.condition && evalCustomExpr) {
                    const conditionResult = evalCustomExpr(params.condition);
                    if (!conditionResult) {
                        violations.push({
                            violation: "custom_condition_failed",
                            severity: "BLOCK"
                        });
                        passed = false;
                    }
                }
                break;
            }
        }

        const complianceScore = passed ? 100 : Math.max(0, 100 - (violations.length * 25));

        return {
            passed,
            complianceScore,
            violations
        };
    },

    /**
     * Evaluate compound boolean logic across multiple sub-rules (AND/OR composition)
     */
    evaluateCompound(
        rules: Array<{ condition: string; weight?: number }>,
        context: FormulaContext,
        operator: "AND" | "OR" = "AND",
        evalExpr: (expr: string) => boolean
    ): { passed: boolean; score: number; passedCount: number; totalCount: number } {
        if (!rules || rules.length === 0) {
            return { passed: true, score: 100, passedCount: 0, totalCount: 0 };
        }

        let passedCount = 0;
        for (const rule of rules) {
            const passed = evalExpr(rule.condition);
            if (passed) passedCount++;
        }

        const totalCount = rules.length;
        const allPassed = passedCount === totalCount;
        const anyPassed = passedCount > 0;

        const passed = operator === "AND" ? allPassed : anyPassed;
        const score = Math.round((passedCount / totalCount) * 100);

        return {
            passed,
            score,
            passedCount,
            totalCount
        };
    }
};

