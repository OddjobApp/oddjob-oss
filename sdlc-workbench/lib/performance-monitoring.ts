/**
 * Performance Monitoring Service
 * Tracks blueprint execution performance metrics and provides analytics
 */

import { getDatabase } from './db';

export interface PerformanceMetrics {
  execution_id: string;
  blueprint_id: string;
  mission_id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  step_metrics: StepMetric[];
  memory_usage?: number;
  cpu_usage?: number;
  error_count?: number;
}

export interface StepMetric {
  step_id: string;
  step_name: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retry_count?: number;
  error_message?: string;
}

export interface PerformanceSummary {
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  average_duration_ms: number;
  success_rate: number;
  slowest_step: string;
  fastest_step: string;
  most_failed_step: string;
}

/**
 * Performance Monitoring Service
 */
export class PerformanceMonitoringService {
  /**
   * Record performance metrics for a blueprint execution
   */
  async recordMetrics(metrics: PerformanceMetrics): Promise<void> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query(
        `INSERT INTO performance_metrics 
         (execution_id, blueprint_id, mission_id, user_id, start_time, end_time, duration_ms, status, step_metrics, memory_usage, cpu_usage, error_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          metrics.execution_id,
          metrics.blueprint_id,
          metrics.mission_id,
          metrics.user_id,
          metrics.start_time,
          metrics.end_time || null,
          metrics.duration_ms || null,
          metrics.status,
          JSON.stringify(metrics.step_metrics),
          metrics.memory_usage || null,
          metrics.cpu_usage || null,
          metrics.error_count || 0
        ]
      );
      
      console.log('[Performance Metrics Recorded]', JSON.stringify({
        execution_id: metrics.execution_id,
        duration_ms: metrics.duration_ms,
        status: metrics.status
      }, null, 2));
    } finally {
      client.release();
    }
  }

  /**
   * Get performance metrics for a specific execution
   */
  async getExecutionMetrics(executionId: string): Promise<PerformanceMetrics | null> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query(
        'SELECT * FROM performance_metrics WHERE execution_id = $1',
        [executionId]
      );
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        execution_id: row.execution_id,
        blueprint_id: row.blueprint_id,
        mission_id: row.mission_id,
        user_id: row.user_id,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_ms: row.duration_ms,
        status: row.status,
        step_metrics: JSON.parse(row.step_metrics),
        memory_usage: row.memory_usage,
        cpu_usage: row.cpu_usage,
        error_count: row.error_count
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get performance summary for a blueprint
   */
  async getBlueprintSummary(blueprintId: string, timeRange: string = '7 days'): Promise<PerformanceSummary> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(duration_ms) as avg_duration
         FROM performance_metrics 
         WHERE blueprint_id = $1 AND start_time > NOW() - INTERVAL '${timeRange}'`,
        [blueprintId]
      );
      
      const row = result.rows[0];
      const total = parseInt(row.total) || 0;
      const successful = parseInt(row.successful) || 0;
      const failed = parseInt(row.failed) || 0;
      const avgDuration = parseFloat(row.avg_duration) || 0;
      
      return {
        total_executions: total,
        successful_executions: successful,
        failed_executions: failed,
        average_duration_ms: avgDuration,
        success_rate: total > 0 ? (successful / total) * 100 : 0,
        slowest_step: 'N/A',
        fastest_step: 'N/A',
        most_failed_step: 'N/A'
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get performance metrics for a user
   */
  async getUserPerformance(userId: string, limit: number = 10): Promise<PerformanceMetrics[]> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query(
        `SELECT * FROM performance_metrics 
         WHERE user_id = $1 
         ORDER BY start_time DESC 
         LIMIT $2`,
        [userId, limit]
      );
      
      return result.rows.map(row => ({
        execution_id: row.execution_id,
        blueprint_id: row.blueprint_id,
        mission_id: row.mission_id,
        user_id: row.user_id,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_ms: row.duration_ms,
        status: row.status,
        step_metrics: JSON.parse(row.step_metrics),
        memory_usage: row.memory_usage,
        cpu_usage: row.cpu_usage,
        error_count: row.error_count
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Identify performance bottlenecks
   */
  async identifyBottlenecks(blueprintId: string): Promise<string[]> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query(
        `SELECT step_metrics FROM performance_metrics 
         WHERE blueprint_id = $1 AND status = 'completed'
         ORDER BY start_time DESC 
         LIMIT 20`,
        [blueprintId]
      );
      
      const stepDurations: Record<string, number[]> = {};
      
      result.rows.forEach(row => {
        const stepMetrics: StepMetric[] = JSON.parse(row.step_metrics);
        stepMetrics.forEach(step => {
          if (step.duration_ms) {
            if (!stepDurations[step.step_name]) {
              stepDurations[step.step_name] = [];
            }
            stepDurations[step.step_name].push(step.duration_ms);
          }
        });
      });
      
      const bottlenecks: string[] = [];
      const threshold = 5000; // 5 seconds threshold
      
      Object.entries(stepDurations).forEach(([stepName, durations]) => {
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        if (avgDuration > threshold) {
          bottlenecks.push(`${stepName} (avg: ${Math.round(avgDuration)}ms)`);
        }
      });
      
      return bottlenecks;
    } finally {
      client.release();
    }
  }
}

// Singleton instance
let performanceServiceInstance: PerformanceMonitoringService | null = null;

export function getPerformanceMonitoringService(): PerformanceMonitoringService {
  if (!performanceServiceInstance) {
    performanceServiceInstance = new PerformanceMonitoringService();
  }
  return performanceServiceInstance;
}
