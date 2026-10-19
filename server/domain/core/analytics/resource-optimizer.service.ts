/**
 * Resource Utilization Optimization Service
 * 
 * Tracks actual vs allocated resource usage across jobs/missions, identifies over-provisioned
 * and under-provisioned resources, suggests resource reallocation, and provides cost optimization.
 * 
 * Expected Impact: Cost savings, better resource utilization, performance improvements
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { jobs, missions, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("ResourceOptimizer");

export interface ResourceUsage {
  jobId?: number;
  missionId?: number;
  name: string;
  allocatedCpu: number;
  allocatedMemory: number;
  actualCpu: number;
  actualMemory: number;
  utilizationRate: number;
  cost: number;
}

export interface ResourceRecommendation {
  type: "job" | "mission";
  id: number;
  name: string;
  action: "increase" | "decrease" | "reallocate";
  resource: "cpu" | "memory" | "budget";
  currentValue: number;
  recommendedValue: number;
  reason: string;
  expectedSavings: number;
}

export interface CostOptimization {
  totalCost: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendations: ResourceRecommendation[];
}

export class ResourceOptimizerService {
  private usageCache: Map<string, ResourceUsage[]> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Track resource usage for a job
   */
  async trackJobResourceUsage(jobId: number, actualCpu: number, actualMemory: number): Promise<void> {
    logger.debug(`[ResourceOptimizer] Tracking resource usage for job ${jobId}`);

    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job.length === 0) return;

    const usage: ResourceUsage = {
      jobId,
      name: job[0].name,
      allocatedCpu: job[0].cpuLimitMillicores || 1000,
      allocatedMemory: job[0].memoryLimitMb || 512,
      actualCpu,
      actualMemory,
      utilizationRate: this.calculateUtilization(job[0].cpuLimitMillicores || 1000, actualCpu),
      cost: this.calculateCost(job[0].cpuLimitMillicores || 1000, job[0].memoryLimitMb || 512)
    };

    const cacheKey = `job-${jobId}`;
    const cached = this.usageCache.get(cacheKey) || [];
    cached.push(usage);
    this.usageCache.set(cacheKey, cached.slice(-100)); // Keep last 100
  }

  /**
   * Track resource usage for a mission
   */
  async trackMissionResourceUsage(missionId: number, actualSpend: number): Promise<void> {
    logger.debug(`[ResourceOptimizer] Tracking resource usage for mission ${missionId}`);

    const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (mission.length === 0) return;

    const budgetLimit = parseFloat(mission[0].budgetLimitUsd?.toString() || "5.00");
    const utilizationRate = actualSpend / budgetLimit;

    const usage: ResourceUsage = {
      missionId,
      name: mission[0].name,
      allocatedCpu: 0, // N/A for missions
      allocatedMemory: 0,
      actualCpu: 0,
      actualMemory: 0,
      utilizationRate,
      cost: actualSpend
    };

    const cacheKey = `mission-${missionId}`;
    const cached = this.usageCache.get(cacheKey) || [];
    cached.push(usage);
    this.usageCache.set(cacheKey, cached.slice(-100));
  }

  /**
   * Identify over-provisioned resources
   */
  async identifyOverProvisioned(organizationId: number): Promise<ResourceRecommendation[]> {
    logger.info(`[ResourceOptimizer] Identifying over-provisioned resources for org ${organizationId}`);

    const recommendations: ResourceRecommendation[] = [];
    const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));

    for (const job of orgJobs) {
      if (!job.cpuLimitMillicores || !job.memoryLimitMb) continue;

      const cacheKey = `job-${job.id}`;
      const usageHistory = this.usageCache.get(cacheKey) || [];

      if (usageHistory.length > 0) {
        const avgCpu = usageHistory.reduce((sum, u) => sum + u.actualCpu, 0) / usageHistory.length;
        const avgMemory = usageHistory.reduce((sum, u) => sum + u.actualMemory, 0) / usageHistory.length;

        // Check for over-provisioned CPU
        if (avgCpu < job.cpuLimitMillicores * 0.3) {
          const recommendedCpu = Math.ceil(avgCpu * 1.5); // 50% buffer
          recommendations.push({
            type: "job",
            id: job.id,
            name: job.name,
            action: "decrease",
            resource: "cpu",
            currentValue: job.cpuLimitMillicores,
            recommendedValue: recommendedCpu,
            reason: `CPU utilization at ${(avgCpu / job.cpuLimitMillicores * 100).toFixed(0)}% - can be reduced`,
            expectedSavings: this.calculateCostSavings(job.cpuLimitMillicores, recommendedCpu, job.memoryLimitMb)
          });
        }

        // Check for over-provisioned memory
        if (avgMemory < job.memoryLimitMb * 0.3) {
          const recommendedMemory = Math.ceil(avgMemory * 1.5);
          recommendations.push({
            type: "job",
            id: job.id,
            name: job.name,
            action: "decrease",
            resource: "memory",
            currentValue: job.memoryLimitMb,
            recommendedValue: recommendedMemory,
            reason: `Memory utilization at ${(avgMemory / job.memoryLimitMb * 100).toFixed(0)}% - can be reduced`,
            expectedSavings: this.calculateCostSavings(job.cpuLimitMillicores, job.cpuLimitMillicores, recommendedMemory)
          });
        }
      }
    }

    return recommendations.sort((a, b) => b.expectedSavings - a.expectedSavings);
  }

  /**
   * Identify under-provisioned resources
   */
  async identifyUnderProvisioned(organizationId: number): Promise<ResourceRecommendation[]> {
    logger.info(`[ResourceOptimizer] Identifying under-provisioned resources for org ${organizationId}`);

    const recommendations: ResourceRecommendation[] = [];
    const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));

    for (const job of orgJobs) {
      if (!job.cpuLimitMillicores || !job.memoryLimitMb) continue;

      const cacheKey = `job-${job.id}`;
      const usageHistory = this.usageCache.get(cacheKey) || [];

      if (usageHistory.length > 0) {
        const avgCpu = usageHistory.reduce((sum, u) => sum + u.actualCpu, 0) / usageHistory.length;
        const avgMemory = usageHistory.reduce((sum, u) => sum + u.actualMemory, 0) / usageHistory.length;

        // Check for under-provisioned CPU
        if (avgCpu > job.cpuLimitMillicores * 0.9) {
          const recommendedCpu = Math.ceil(avgCpu * 1.5);
          recommendations.push({
            type: "job",
            id: job.id,
            name: job.name,
            action: "increase",
            resource: "cpu",
            currentValue: job.cpuLimitMillicores,
            recommendedValue: recommendedCpu,
            reason: `CPU utilization at ${(avgCpu / job.cpuLimitMillicores * 100).toFixed(0)}% - needs increase`,
            expectedSavings: 0 // No savings, but performance improvement
          });
        }

        // Check for under-provisioned memory
        if (avgMemory > job.memoryLimitMb * 0.9) {
          const recommendedMemory = Math.ceil(avgMemory * 1.5);
          recommendations.push({
            type: "job",
            id: job.id,
            name: job.name,
            action: "increase",
            resource: "memory",
            currentValue: job.memoryLimitMb,
            recommendedValue: recommendedMemory,
            reason: `Memory utilization at ${(avgMemory / job.memoryLimitMb * 100).toFixed(0)}% - needs increase`,
            expectedSavings: 0
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * Generate cost optimization recommendations
   */
  async generateCostOptimization(organizationId: number): Promise<CostOptimization> {
    logger.info(`[ResourceOptimizer] Generating cost optimization for org ${organizationId}`);

    const overProvisioned = await this.identifyOverProvisioned(organizationId);
    const totalPotentialSavings = overProvisioned.reduce((sum, r) => sum + r.expectedSavings, 0);

    // Calculate total current cost (simplified)
    const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));
    const totalCost = orgJobs.reduce((sum, job) => {
      return sum + this.calculateCost(job.cpuLimitMillicores || 1000, job.memoryLimitMb || 512);
    }, 0);

    const savingsPercentage = totalCost > 0 ? (totalPotentialSavings / totalCost) * 100 : 0;

    return {
      totalCost,
      potentialSavings: totalPotentialSavings,
      savingsPercentage,
      recommendations: overProvisioned
    };
  }

  /**
   * Get resource utilization statistics
   */
  async getUtilizationStats(organizationId: number): Promise<{
    totalJobs: number;
    jobsWithLimits: number;
    averageCpuUtilization: number;
    averageMemoryUtilization: number;
    overProvisionedCount: number;
    underProvisionedCount: number;
  }> {
    const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));
    const jobsWithLimits = orgJobs.filter(j => j.cpuLimitMillicores && j.memoryLimitMb);

    let totalCpuUtil = 0;
    let totalMemUtil = 0;
    let utilizationCount = 0;

    for (const job of jobsWithLimits) {
      const cacheKey = `job-${job.id}`;
      const usageHistory = this.usageCache.get(cacheKey) || [];

      if (usageHistory.length > 0) {
        const avgCpu = usageHistory.reduce((sum, u) => sum + u.actualCpu, 0) / usageHistory.length;
        const avgMemory = usageHistory.reduce((sum, u) => sum + u.actualMemory, 0) / usageHistory.length;

        totalCpuUtil += avgCpu / job.cpuLimitMillicores!;
        totalMemUtil += avgMemory / job.memoryLimitMb!;
        utilizationCount++;
      }
    }

    const averageCpuUtilization = utilizationCount > 0 ? (totalCpuUtil / utilizationCount) * 100 : 0;
    const averageMemoryUtilization = utilizationCount > 0 ? (totalMemUtil / utilizationCount) * 100 : 0;

    const overProvisioned = await this.identifyOverProvisioned(organizationId);
    const underProvisioned = await this.identifyUnderProvisioned(organizationId);

    return {
      totalJobs: orgJobs.length,
      jobsWithLimits: jobsWithLimits.length,
      averageCpuUtilization,
      averageMemoryUtilization,
      overProvisionedCount: overProvisioned.length,
      underProvisionedCount: underProvisioned.length
    };
  }

  /**
   * Calculate utilization rate
   */
  private calculateUtilization(allocated: number, actual: number): number {
    return allocated > 0 ? actual / allocated : 0;
  }

  /**
   * Calculate cost based on CPU and memory
   */
  private calculateCost(cpuMillicores: number, memoryMb: number): number {
    // Simplified cost calculation: $0.001 per 1000 millicores, $0.0001 per MB
    return (cpuMillicores / 1000) * 0.001 + memoryMb * 0.0001;
  }

  /**
   * Calculate cost savings from resource reduction
   */
  private calculateCostSavings(currentCpu: number, recommendedCpu: number, currentMemory: number, recommendedMemory?: number): number {
    const currentCost = this.calculateCost(currentCpu, currentMemory);
    const newCost = this.calculateCost(recommendedCpu, recommendedMemory || currentMemory);
    return currentCost - newCost;
  }

  /**
   * Clear usage cache
   */
  clearCache(): void {
    this.usageCache.clear();
    logger.info("[ResourceOptimizer] Cache cleared");
  }
}

// Singleton instance
export const resourceOptimizerService = new ResourceOptimizerService();
