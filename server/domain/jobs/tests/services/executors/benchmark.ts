import { MockExecutorContextBuilder } from './test-utils.js';

export class ExecutorBenchmark {
  static async benchmark(
    executor: any,
    config: any,
    iterations: number = 100
  ): Promise<{
    avgTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    p50TimeMs: number;
    p95TimeMs: number;
    p99TimeMs: number;
    successRate: number;
  }> {
    const times: number[] = [];
    let successes = 0;
    
    const context = new MockExecutorContextBuilder()
      .withJob({ type: executor.constructor?.name || 'unknown' })
      .build();
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      try {
        await executor.execute(
          context.job,
          config,
          context.pipeline,
          context.variables
        );
        successes++;
      } catch (error) {
        // Count failures
      }
      times.push(Date.now() - start);
    }
    
    times.sort((a, b) => a - b);
    
    return {
      avgTimeMs: times.reduce((a, b) => a + b, 0) / times.length,
      minTimeMs: times[0],
      maxTimeMs: times[times.length - 1],
      p50TimeMs: times[Math.floor(times.length * 0.50)],
      p95TimeMs: times[Math.floor(times.length * 0.95)],
      p99TimeMs: times[Math.floor(times.length * 0.99)],
      successRate: (successes / iterations) * 100,
    };
  }
}
