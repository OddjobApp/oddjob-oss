/**
 * Pipeline Error Types
 * 
 * Custom error classes for pipeline execution and validation errors.
 * All pipeline errors now extend AppError for consistent error handling,
 * automatic diagnosis, and proper error response formatting.
 */

import { AppError, ErrorCode } from "../utils/errors.js";

/**
 * Error thrown when a cyclic loop in a pipeline exceeds its maximum iterations.
 */
export class CycleLimitExceededError extends AppError {
  constructor(
    message: string,
    public executionId: number,
    public stepId: number
  ) {
    super(message, 500, ErrorCode.PIPELINE_EXECUTION_FAILED, {
      details: { executionId, stepId, errorType: "CycleLimitExceeded" },
    });
    this.name = "CycleLimitExceededError";
  }
}

/**
 * Error thrown when pipeline execution detects stagnation (no progress).
 */
export class StagnationDetectedError extends AppError {
  constructor(
    message: string,
    public executionId: number,
    public stepId: number
  ) {
    super(message, 500, ErrorCode.PIPELINE_EXECUTION_FAILED, {
      details: { executionId, stepId, errorType: "StagnationDetected" },
    });
    this.name = "StagnationDetectedError";
  }
}

/**
 * Error thrown when pipeline execution exceeds its timeout.
 */
export class TimeoutExceededError extends AppError {
  constructor(message: string, public executionId: number) {
    super(message, 500, ErrorCode.PIPELINE_EXECUTION_FAILED, {
      details: { executionId, errorType: "TimeoutExceeded" },
    });
    this.name = "TimeoutExceededError";
  }
}

/**
 * Error thrown when pipeline graph validation fails.
 */
export class InvalidGraphError extends AppError {
  constructor(
    message: string,
    public errors: Array<{ type: string; message: string; stepId?: number }>
  ) {
    super(message, 400, ErrorCode.VALIDATION_FAILED, {
      details: { errors, errorType: "InvalidGraph" },
    });
    this.name = "InvalidGraphError";
  }
}

/**
 * Error thrown when CEL expression evaluation fails.
 */
export class CELExpressionError extends AppError {
  constructor(message: string, public expression: string) {
    super(message, 400, ErrorCode.VALIDATION_FAILED, {
      details: { expression, errorType: "CELExpression" },
    });
    this.name = "CELExpressionError";
  }
}



