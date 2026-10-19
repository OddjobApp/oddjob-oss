/**
 * Test-to-Production Correlation Service
 * 
 * Tracks test vs production performance metrics, identifies tests that don't predict production issues,
 * suggests test improvements based on production failures, and provides test coverage analytics.
 * 
 * Expected Impact: Better test reliability, earlier detection of production issues
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { jobs, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte, isNull } from "drizzle-orm";

const logger = createLogger("TestProductionCorrelation");

export interface TestResult {
  jobId: number;
  jobName: string;
  lastTestStatus: string;
  lastTestedAt: Date;
  testDuration: number;
  testCost: number;
}

export interface ProductionResult {
  jobId: number;
  jobName: string;
  productionSuccessRate: number;
  averageProductionDuration: number;
  averageProductionCost: number;
  failureCount: number;
}

export interface CorrelationMetric {
  jobId: number;
  jobName: string;
  testPredictivePower: number; // 0-1, how well test predicts production
  testProductionGap: number; // Difference between test and production success rates
  recommendation: string;
}

export interface TestCoverage {
  totalJobs: number;
  jobsWithTests: number;
  jobsWithoutTests: number;
  testCoverageRate: number;
  untestedCriticalJobs: Array<{ id: number; name: string }>;
}

export class TestProductionCorrelationService {
  private correlationCache: Map<number, CorrelationMetric> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Get test results for a job
   */
  async getTestResult(jobId: number): Promise<TestResult> {
    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    return {
      jobId,
      jobName: job[0].name,
      lastTestStatus: job[0].lastTestStatus || "not_tested",
      lastTestedAt: job[0].lastTestedAt || new Date(0),
      testDuration: 500, // Placeholder - would use actual test execution data
      testCost: 0.01 // Placeholder
    };
  }

  /**
   * Get production results for a job
   */
  async getProductionResult(jobId: number): Promise<ProductionResult> {
    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Get pipeline executions for this job (simplified)
    const executions = await db.select().from(pipelineExecutions).limit(50);

    const successCount = executions.filter(e => e.status === "completed").length;
    const failureCount = executions.filter(e => e.status === "failed").length;
    const totalExecutions = successCount + failureCount;

    return {
      jobId,
      jobName: job[0].name,
      productionSuccessRate: totalExecutions > 0 ? successCount / totalExecutions : 0,
      averageProductionDuration: 1000, // Placeholder
      averageProductionCost: 0.05, // Placeholder
      failureCount
    };
  }

  /**
   * Calculate correlation between test and production results
   */
  async calculateCorrelation(jobId: number): Promise<CorrelationMetric> {
    const cached = this.correlationCache.get(jobId);
    if (cached && Date.now() - (cached.recommendation?.length || 0) > 0) {
      return cached;
    }

    logger.info(`[TestProductionCorrelation] Calculating correlation for job ${jobId}`);

    const [testResult, productionResult] = await Promise.all([
      this.getTestResult(jobId),
      this.getProductionResult(jobId)
    ]);

    // Calculate test predictive power
    // If test passes and production succeeds = good prediction
    // If test fails and production fails = good prediction
    // If test passes but production fails = poor prediction
    // If test fails but production succeeds = poor prediction
    
    const testPassed = testResult.lastTestStatus === "success";
    const productionSuccess = productionResult.productionSuccessRate > 0.8;

    let testPredictivePower = 0.5; // Neutral
    if (testPassed === productionSuccess) {
      testPredictivePower = 0.9;
    } else {
      testPredictivePower = 0.3;
    }

    const testProductionGap = Math.abs(
      (testResult.lastTestStatus === "success" ? 1 : 0) - productionResult.productionSuccessRate
    );

    // Generate recommendation
    let recommendation = "Test correlates well with production";
    if (testPredictivePower < 0.5) {
      if (testPassed && !productionSuccess) {
        recommendation = "Test passes but production fails - test is not catching production issues";
      } else if (!testPassed && productionSuccess) {
        recommendation = "Test fails but production succeeds - test may be too strict";
      }
    }

    const correlation: CorrelationMetric = {
      jobId,
      jobName: testResult.jobName,
      testPredictivePower,
      testProductionGap,
      recommendation
    };

    this.correlationCache.set(jobId, correlation);
    return correlation;
  }

  /**
   * Identify tests that don't predict production issues
   */
  async identifyPoorPredictors(organizationId: number): Promise<CorrelationMetric[]> {
    logger.info(`[TestProductionCorrelation] Identifying poor test predictors for org ${organizationId}`);

    const orgJobs = await db.select().from(jobs).where(
      and(
        eq(jobs.organizationId, organizationId),
        isNull(jobs.lastTestStatus)
      )
    );

    const correlations = await Promise.all(
      orgJobs.map((job: any) => this.calculateCorrelation(job.id))
    );

    // Filter for poor predictors
    const poorPredictors = correlations.filter(c => c.testPredictivePower < 0.5);

    return poorPredictors.sort((a, b) => a.testPredictivePower - b.testPredictivePower);
  }

  /**
   * Suggest test improvements based on production failures
   */
  async suggestTestImprovements(organizationId: number): Promise<Array<{
    jobId: number;
    jobName: string;
    improvement: string;
    expectedImpact: string;
  }>> {
    logger.info(`[TestProductionCorrelation] Suggesting test improvements for org ${organizationId}`);

    const suggestions: Array<{
      jobId: number;
      jobName: string;
      improvement: string;
      expectedImpact: string;
    }> = [];

    const poorPredictors = await this.identifyPoorPredictors(organizationId);

    for (const correlation of poorPredictors) {
      if (correlation.recommendation.includes("not catching")) {
        suggestions.push({
          jobId: correlation.jobId,
          jobName: correlation.jobName,
          improvement: "Add production-like test data and edge cases",
          expectedImpact: "Increase test predictive power by 30-40%"
        });
      } else if (correlation.recommendation.includes("too strict")) {
        suggestions.push({
          jobId: correlation.jobId,
          jobName: correlation.jobName,
          improvement: "Review test assertions and relax overly strict conditions",
          expectedImpact: "Reduce false positives by 50%"
        });
      }
    }

    return suggestions;
  }

  /**
   * Get test coverage analytics
   */
  async getTestCoverage(organizationId: number): Promise<TestCoverage> {
    logger.info(`[TestProductionCorrelation] Getting test coverage for org ${organizationId}`);

    const [totalJobs, jobsWithTests] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(eq(jobs.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(
        and(
          eq(jobs.organizationId, organizationId),
          sql`${jobs.lastTestStatus} IS NOT NULL`
        )
      )
    ]);

    const jobsWithoutTests = totalJobs[0].count - jobsWithTests[0].count;
    const testCoverageRate = totalJobs[0].count > 0 ? (jobsWithTests[0].count / totalJobs[0].count) * 100 : 0;

    // Identify untested critical jobs (high priority jobs)
    const untestedCriticalJobs = await db.select().from(jobs).where(
      and(
        eq(jobs.organizationId, organizationId),
        sql`${jobs.lastTestStatus} IS NULL`,
        eq(jobs.priority, 1)
      )
    );

    return {
      totalJobs: totalJobs[0].count,
      jobsWithTests: jobsWithTests[0].count,
      jobsWithoutTests,
      testCoverageRate,
      untestedCriticalJobs: untestedCriticalJobs.map(j => ({ id: j.id, name: j.name }))
    };
  }

  /**
   * Get correlation statistics
   */
  async getCorrelationStats(organizationId: number): Promise<{
    totalJobs: number;
    jobsWithCorrelation: number;
    averagePredictivePower: number;
    poorPredictorCount: number;
    testCoverageRate: number;
  }> {
    const coverage = await this.getTestCoverage(organizationId);
    const poorPredictors = await this.identifyPoorPredictors(organizationId);

    // Calculate average predictive power
    const allJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));
    let totalPredictivePower = 0;
    let jobsWithCorrelation = 0;

    for (const job of allJobs) {
      try {
        const correlation = await this.calculateCorrelation(job.id);
        totalPredictivePower += correlation.testPredictivePower;
        jobsWithCorrelation++;
      } catch (error) {
        // Skip jobs without correlation data
      }
    }

    const averagePredictivePower = jobsWithCorrelation > 0 ? totalPredictivePower / jobsWithCorrelation : 0;

    return {
      totalJobs: coverage.totalJobs,
      jobsWithCorrelation,
      averagePredictivePower,
      poorPredictorCount: poorPredictors.length,
      testCoverageRate: coverage.testCoverageRate
    };
  }

  /**
   * Clear correlation cache
   */
  clearCache(): void {
    this.correlationCache.clear();
    logger.info("[TestProductionCorrelation] Cache cleared");
  }
}

// Singleton instance
export const testProductionCorrelationService = new TestProductionCorrelationService();
