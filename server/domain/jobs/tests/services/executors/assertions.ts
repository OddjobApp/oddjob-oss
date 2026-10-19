import Ajv from 'ajv';
import { expect } from 'vitest';

export class ExecutorAssertions {
  static assertSuccess(result: any): void {
    if (typeof expect !== 'undefined') {
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    }
  }
  
  static assertFailure(result: any, expectedError?: string): void {
    if (typeof expect !== 'undefined') {
      expect(result.success).toBe(false);
      if (expectedError) {
        expect(result.error).toContain(expectedError);
      }
    }
  }
  
  static assertOutputStructure(result: any, schema: any): void {
    const output = JSON.parse(result.output);
    const validate = new Ajv().compile(schema);
    const valid = validate(output);
    if (typeof expect !== 'undefined') {
      expect(valid).toBe(true);
    }
  }
  
  static assertOutputContains(result: any, key: string): void {
    const output = JSON.parse(result.output);
    if (typeof expect !== 'undefined') {
      expect(output).toHaveProperty(key);
    }
  }
  
  static assertExecutionTime(result: any, maxMs: number): void {
    if (typeof expect !== 'undefined') {
      expect(result.executionTimeMs).toBeLessThan(maxMs);
    }
  }
  
  static assertRetryAttempted(result: any, attempts: number): void {
    if (typeof expect !== 'undefined') {
      expect(result.retryCount).toBe(attempts);
    }
  }
}
