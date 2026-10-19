import { describe, it, expect, beforeEach } from 'vitest';
import { MockExecutorContextBuilder, MockExecutorContext } from './test-utils.js';
import { EXECUTOR_FIXTURES } from './fixtures.js';
import { ExecutorAssertions } from './assertions.js';

export function createExecutorTestSuite(
  executorName: string,
  executor: any,
  validConfig: any,
  invalidConfig: any
) {
  describe(`${executorName} Executor`, () => {
    let context: MockExecutorContext;
    
    beforeEach(() => {
      context = new MockExecutorContextBuilder()
        .withJob({ type: executorName })
        .build();
    });
    
    it('should execute successfully with valid config', async () => {
      const result = await executor.execute(
        context.job,
        validConfig,
        context.pipeline,
        context.variables
      );
      
      ExecutorAssertions.assertSuccess(result);
    });
    
    it('should fail with invalid config', async () => {
      await expect(
        executor.execute(
          context.job,
          invalidConfig,
          context.pipeline,
          context.variables
        )
      ).rejects.toThrow();
    });
    
    it('should complete within timeout', async () => {
      const start = Date.now();
      await executor.execute(
        context.job,
        validConfig,
        context.pipeline,
        context.variables
      );
      const duration = Date.now() - start;
      
      ExecutorAssertions.assertExecutionTime({ executionTimeMs: duration } as any, 30000);
    });
    
    // Add more standard tests as needed
  });
}
