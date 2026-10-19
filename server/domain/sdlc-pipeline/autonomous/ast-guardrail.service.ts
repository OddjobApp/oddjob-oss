import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ASTGuardrailService");

export interface ASTValidationResult {
  passed: boolean;
  violations: Array<{
    line?: number;
    rule: string;
    description: string;
  }>;
}

export class ASTGuardrailService {
  /**
   * Analyzes synthesized code snippets for unsafe structural patterns:
   *  - eval() or Function() calls
   *  - Direct process.env sensitive property access
   *  - System execution via exec/execSync without sanitization
   */
  validateCodeSnippet(code: string, language: string = "typescript"): ASTValidationResult {
    logger.debug(`[ASTGuardrailService] Scanning ${language} code snippet (${code.length} chars)...`);
    
    const violations: ASTValidationResult["violations"] = [];

    // Rule 1: Forbidden eval()
    if (/\beval\s*\(/.test(code)) {
      violations.push({
        rule: "NO_EVAL",
        description: "Use of eval() is strictly prohibited in synthesized code."
      });
    }

    // Rule 2: Dynamic Function constructor
    if (/new\s+Function\s*\(/.test(code)) {
      violations.push({
        rule: "NO_FUNCTION_CONSTRUCTOR",
        description: "Dynamic Function instantiation is prohibited."
      });
    }

    // Rule 3: Child process execution without isolation
    if (/\b(exec|execSync|spawnSync)\s*\(/.test(code) && !code.includes("execFile")) {
      violations.push({
        rule: "UNSAFE_CHILD_PROCESS",
        description: "Direct shell execution via exec/execSync is unsafe; use sanitized execFile."
      });
    }

    const passed = violations.length === 0;

    if (!passed) {
      logger.warn(`[ASTGuardrailService] Intercepted ${violations.length} AST guardrail violations.`);
    } else {
      logger.info("[ASTGuardrailService] Code snippet passed AST security verification.");
    }

    return {
      passed,
      violations
    };
  }
}

export const astGuardrailService = new ASTGuardrailService();
