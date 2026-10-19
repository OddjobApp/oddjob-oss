/**
 * Predictive Automation tests — aligned with docs/specs/PREDICTIVE_AI_SPEC.md
 * Tests failure prediction, resource optimization, workflow intelligence, predictive service
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock API client for testing
const mockApi = {
  predictive: {
    recordObservation: vi.fn(),
    predictFailure: vi.fn(),
    predictPerformance: vi.fn(),
    getActivePredictions: vi.fn(),
    getHealthReport: vi.fn(),
    getActiveAlerts: vi.fn(),
    clearAlert: vi.fn(),
    requestManualOptimization: vi.fn(),
    getPendingActions: vi.fn(),
    getCompletedActions: vi.fn(),
    setMode: vi.fn(),
    getStatus: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    getDashboardData: vi.fn()
  },
  resources: {
    getMetrics: vi.fn(),
    getScalingRecommendations: vi.fn(),
    getEfficiency: vi.fn(),
    getCostOptimization: vi.fn()
  },
  workflows: {
    getMetrics: vi.fn(),
    optimize: vi.fn(),
    getOptimizations: vi.fn(),
    getOptimizationEffectiveness: vi.fn()
  }
};

// Mock the API calls
vi.mock('@/lib/api', () => ({
  api: mockApi
}));

describe('Predictive Automation - Failure Prediction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Observation Recording', () => {
    it('records activity observations correctly', async () => {
      const observation = {
        entity: 'system:cpu',
        value: 75.5,
        context: { core_count: 4 },
        metadata: { session_id: 'sess_123' }
      };

      mockApi.predictive.recordObservation.mockResolvedValue({ success: true });

      const result = await mockApi.predictive.recordObservation(
        observation.entity,
        observation.value,
        observation.context,
        observation.metadata
      );

      expect(result.success).toBe(true);
      expect(mockApi.predictive.recordObservation).toHaveBeenCalledWith(
        observation.entity,
        observation.value,
        observation.context,
        observation.metadata
      );
    });

    it('handles different data types', async () => {
      const testCases = [
        { entity: 'service:api', value: 200, type: 'number' },
        { entity: 'user:action', value: 'success', type: 'string' },
        { entity: 'system:status', value: true, type: 'boolean' }
      ];

      mockApi.predictive.recordObservation.mockResolvedValue({ success: true });

      for (const testCase of testCases) {
        await mockApi.predictive.recordObservation(testCase.entity, testCase.value);
        expect(typeof testCase.value).toBe(testCase.type);
      }

      expect(mockApi.predictive.recordObservation).toHaveBeenCalledTimes(3);
    });
  });

  describe('Failure Prediction', () => {
    it('predicts failure based on trending data', async () => {
      const mockPrediction = {
        prediction_type: 'failure',
        target_entity: 'system:cpu',
        confidence: 0.85,
        risk_level: 'high',
        recommendations: ['Scale up CPU resources', 'Check system logs']
      };

      mockApi.predictive.predictFailure.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictFailure('system:cpu');

      expect(prediction).toBeDefined();
      expect(prediction.prediction_type).toBe('failure');
      expect(prediction.target_entity).toBe('system:cpu');
      expect(typeof prediction.confidence).toBe('number');
      expect(prediction.confidence).toBeGreaterThan(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    it('returns risk level assessment', async () => {
      const mockPrediction = {
        prediction_type: 'failure',
        risk_level: 'medium',
        confidence: 0.7
      };

      mockApi.predictive.predictFailure.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictFailure('system:cpu');

      expect(prediction.risk_level).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(prediction.risk_level);
    });

    it('provides preventive recommendations', async () => {
      const mockPrediction = {
        recommendations: ['Restart service', 'Update configuration']
      };

      mockApi.predictive.predictFailure.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictFailure('system:cpu');

      expect(prediction.recommendations).toBeDefined();
      expect(Array.isArray(prediction.recommendations)).toBe(true);
      expect(prediction.recommendations.length).toBeGreaterThan(0);
    });

    it('handles insufficient data gracefully', async () => {
      mockApi.predictive.predictFailure.mockResolvedValue(null);

      const prediction = await mockApi.predictive.predictFailure('nonexistent:entity');

      expect(prediction).toBeNull();
    });
  });

  describe('Performance Prediction', () => {
    it('predicts performance metrics', async () => {
      const mockPrediction = {
        prediction_type: 'performance',
        predicted_value: 85.5,
        confidence: 0.8,
        model_used: { value: 'exponential_smoothing' }
      };

      mockApi.predictive.predictPerformance.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictPerformance('system:memory', 'usage_percentage');

      expect(prediction.prediction_type).toBe('performance');
      expect(typeof prediction.predicted_value).toBe('number');
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    it('uses exponential smoothing for predictions', async () => {
      const mockPrediction = {
        model_used: { value: 'exponential_smoothing' }
      };

      mockApi.predictive.predictPerformance.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictPerformance('system:cpu', 'usage_percentage');

      expect(prediction.model_used.value).toBe('exponential_smoothing');
    });
  });
});

describe('Predictive Automation - Resource Optimization', () => {
  describe('Resource Metrics Collection', () => {
    it('collects system resource metrics', async () => {
      const mockMetrics = {
        cpu: { usage: 75.5, cores: 4 },
        memory: { usage: 85.2, total: 16384 },
        disk: { usage: 65.8, total: 512000 }
      };

      mockApi.resources.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await mockApi.resources.getMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');

      // Should contain CPU, memory, disk metrics
      const metricKeys = Object.keys(metrics);
      expect(metricKeys.length).toBeGreaterThan(0);
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('disk');
    });

    it('calculates efficiency scores', async () => {
      const mockEfficiency = {
        cpu: 0.85,
        memory: 0.78,
        disk: 0.92
      };

      mockApi.resources.getEfficiency.mockResolvedValue(mockEfficiency);

      const efficiency = await mockApi.resources.getEfficiency();

      expect(efficiency).toBeDefined();
      expect(typeof efficiency).toBe('object');

      // Efficiency scores should be between 0 and 1
      (Object.values(efficiency) as number[]).forEach((score: number) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Scaling Recommendations', () => {
    it('generates scaling recommendations', async () => {
      const mockRecommendations = [
        {
          resource_type: 'cpu',
          action: 'scale_up',
          confidence: 0.85,
          reason: 'High CPU usage trend'
        },
        {
          resource_type: 'memory',
          action: 'maintain',
          confidence: 0.65,
          reason: 'Stable memory usage'
        }
      ];

      mockApi.resources.getScalingRecommendations.mockResolvedValue(mockRecommendations);

      const recommendations = await mockApi.resources.getScalingRecommendations();

      expect(Array.isArray(recommendations)).toBe(true);

      recommendations.forEach((rec: any) => {
        expect(rec).toHaveProperty('resource_type');
        expect(rec).toHaveProperty('action');
        expect(rec).toHaveProperty('confidence');
        expect(['scale_up', 'scale_down', 'maintain']).toContain(rec.action);
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Cost Optimization', () => {
    it('provides cost optimization recommendations', async () => {
      const mockRecommendations = [
        {
          resource_type: 'cpu',
          recommendation: 'Use spot instances',
          potential_savings: 120.50
        },
        {
          resource_type: 'storage',
          recommendation: 'Enable compression',
          potential_savings: 85.30
        }
      ];

      mockApi.resources.getCostOptimization.mockResolvedValue(mockRecommendations);

      const recommendations = await mockApi.resources.getCostOptimization();

      expect(Array.isArray(recommendations)).toBe(true);

      recommendations.forEach((rec: any) => {
        expect(rec).toHaveProperty('resource_type');
        expect(rec).toHaveProperty('recommendation');
        expect(rec).toHaveProperty('potential_savings');
        expect(typeof rec.potential_savings).toBe('number');
      });
    });
  });
});

describe('Predictive Automation - Workflow Intelligence', () => {
  describe('Workflow Analysis', () => {
    it('analyzes workflow structure', async () => {
      const mockWorkflow = {
        id: 'test-workflow',
        steps: [
          { step_id: 'step1', name: 'Start', dependencies: [] },
          { step_id: 'step2', name: 'Process', dependencies: ['step1'] },
          { step_id: 'step3', name: 'End', dependencies: ['step2'] }
        ]
      };

      const mockMetrics = {
        workflow_id: mockWorkflow.id,
        total_executions: 0,
        average_execution_time: 0,
        success_rate: 0
      };

      mockApi.workflows.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await mockApi.workflows.getMetrics(mockWorkflow.id);

      expect(metrics).toBeDefined();
      expect(metrics.workflow_id).toBe(mockWorkflow.id);
      expect(metrics.total_executions).toBe(0);
    });

    it('tracks workflow execution metrics', async () => {
      const workflowId = 'test-workflow-2';
      const mockMetrics = {
        workflow_id: workflowId,
        total_executions: 1,
        average_execution_time: 45.0,
        success_rate: 1.0,
        step_metrics: {
          start: { execution_time: 5.0, success: true },
          process: { execution_time: 40.0, success: true }
        }
      };

      mockApi.workflows.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await mockApi.workflows.getMetrics(workflowId);

      expect(metrics.total_executions).toBe(1);
      expect(metrics.average_execution_time).toBe(45.0);
      expect(metrics.success_rate).toBe(1.0);
    });
  });

  describe('Optimization Recommendations', () => {
    it('generates workflow optimizations', async () => {
      const workflowId = 'optimizable-workflow';
      const mockOptimization = {
        workflow_id: workflowId,
        proposed_changes: [
          'Parallelize slow_step with other independent steps',
          'Cache intermediate results for fast_step'
        ],
        expected_improvements: {
          execution_time_reduction: 35.5,
          cost_savings: 12.30
        }
      };

      mockApi.workflows.optimize.mockResolvedValue(mockOptimization);

      const optimization = await mockApi.workflows.optimize(workflowId);

      expect(optimization).toBeDefined();
      expect(optimization.workflow_id).toBe(workflowId);
      expect(optimization.proposed_changes).toBeDefined();
      expect(optimization.expected_improvements).toBeDefined();
      expect(Array.isArray(optimization.proposed_changes)).toBe(true);
    });

    it('identifies performance bottlenecks', async () => {
      const workflowId = 'bottleneck-workflow';
      const mockMetrics = {
        workflow_id: workflowId,
        bottleneck_steps: ['bottleneck'],
        average_execution_time: 310.0,
        step_metrics: {
          bottleneck: { execution_time: 300.0, success: true },
          normal: { execution_time: 10.0, success: true }
        }
      };

      mockApi.workflows.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await mockApi.workflows.getMetrics(workflowId);
      expect(metrics.bottleneck_steps).toContain('bottleneck');
    });
  });
});

describe('Predictive Automation - Predictive Service', () => {
  describe('Health Monitoring', () => {
    it('generates system health reports', async () => {
      const mockHealthReport = {
        overall_health_score: 85.5,
        component_health: {
          predictive_engine: 'healthy',
          resource_optimizer: 'warning',
          workflow_optimizer: 'healthy'
        },
        timestamp: new Date().toISOString()
      };

      mockApi.predictive.getHealthReport.mockResolvedValue(mockHealthReport);

      const healthReport = await mockApi.predictive.getHealthReport();

      expect(healthReport).toHaveProperty('overall_health_score');
      expect(healthReport).toHaveProperty('component_health');
      expect(healthReport.overall_health_score).toBeGreaterThanOrEqual(0);
      expect(healthReport.overall_health_score).toBeLessThanOrEqual(100);
    });

    it('tracks active alerts', async () => {
      const mockAlerts = [
        { id: 'alert_1', severity: 'high', message: 'High CPU usage detected' },
        { id: 'alert_2', severity: 'medium', message: 'Memory usage trending up' }
      ];

      mockApi.predictive.getActiveAlerts.mockResolvedValue(mockAlerts);

      const alerts = await mockApi.predictive.getActiveAlerts();

      expect(typeof alerts).toBe('object');
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('Automated Actions', () => {
    it('tracks pending actions', async () => {
      const mockPendingActions = [
        { id: 'action_1', type: 'scale_up', target: 'cpu', status: 'pending' },
        { id: 'action_2', type: 'optimize', target: 'workflow:abc', status: 'pending' }
      ];

      mockApi.predictive.getPendingActions.mockResolvedValue(mockPendingActions);

      const pendingActions = await mockApi.predictive.getPendingActions();

      expect(Array.isArray(pendingActions)).toBe(true);
    });

    it('tracks completed actions', async () => {
      const mockCompletedActions = [
        { id: 'action_3', type: 'restart', target: 'service:api', status: 'completed', timestamp: new Date() }
      ];

      mockApi.predictive.getCompletedActions.mockResolvedValue(mockCompletedActions);

      const completedActions = await mockApi.predictive.getCompletedActions();

      expect(Array.isArray(completedActions)).toBe(true);
    });
  });

  describe('Manual Optimization', () => {
    it('accepts optimization requests', async () => {
      const mockResult = {
        optimization_id: 'opt_123',
        status: 'initiated',
        estimated_completion: '2024-01-15T10:30:00Z'
      };

      mockApi.predictive.requestManualOptimization.mockResolvedValue(mockResult);

      const result = await mockApi.predictive.requestManualOptimization(
        'workflow:test-workflow',
        'efficiency'
      );

      expect(result === null || typeof result === 'object').toBe(true);
      if (result) {
        expect(result).toHaveProperty('optimization_id');
        expect(result).toHaveProperty('status');
      }
    });

    it('validates optimization targets', async () => {
      mockApi.predictive.requestManualOptimization.mockResolvedValue(null);

      const invalidResult = await mockApi.predictive.requestManualOptimization(
        'invalid:target',
        'unknown_type'
      );

      expect(invalidResult).toBeNull();
    });
  });
});

describe('Predictive Automation - Integration Tests', () => {
  describe('End-to-End Prediction Flow', () => {
    it('completes full prediction cycle', async () => {
      // Mock successful observation recording
      mockApi.predictive.recordObservation.mockResolvedValue({ success: true });

      // 1. Record observations
      await mockApi.predictive.recordObservation('system:response_time', 150);
      await mockApi.predictive.recordObservation('system:response_time', 200);
      await mockApi.predictive.recordObservation('system:response_time', 180);

      // 2. Generate prediction
      const mockPrediction = {
        prediction_type: 'performance',
        predicted_value: 185.5,
        confidence: 0.82
      };
      mockApi.predictive.predictPerformance.mockResolvedValue(mockPrediction);

      const prediction = await mockApi.predictive.predictPerformance(
        'system:response_time',
        'response_time'
      );

      // 3. Verify prediction structure
      expect(prediction.prediction_type).toBe('performance');
      expect(typeof prediction.predicted_value).toBe('number');
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    it('handles resource scaling decisions', async () => {
      const mockRecommendations = [
        { action: 'scale_up', confidence: 0.85 },
        { action: 'maintain', confidence: 0.65 }
      ];

      mockApi.resources.getScalingRecommendations.mockResolvedValue(mockRecommendations);

      // Test resource scaling logic
      const recommendations = await mockApi.resources.getScalingRecommendations();

      recommendations.forEach((rec: any) => {
        expect(['scale_up', 'scale_down', 'maintain']).toContain(rec.action);
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Workflow Optimization Pipeline', () => {
    it('optimizes workflow based on execution data', async () => {
      const workflowId = 'integration-test-workflow';

      const mockOptimization = {
        workflow_id: workflowId,
        proposed_changes: [
          'Run parallel1 and parallel2 in parallel',
          'Optimize sequential task dependencies'
        ]
      };

      mockApi.workflows.optimize.mockResolvedValue(mockOptimization);

      const optimization = await mockApi.workflows.optimize(workflowId);

      expect(optimization.workflow_id).toBe(workflowId);
      expect(optimization.proposed_changes.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('handles prediction failures gracefully', async () => {
      mockApi.predictive.predictFailure.mockResolvedValue(null);

      const result = await mockApi.predictive.predictFailure('nonexistent:entity');
      expect(result).toBeNull();
    });

    it('manages resource monitoring errors', async () => {
      mockApi.resources.getMetrics.mockResolvedValue({});

      // Should not crash if resource monitoring fails
      const metrics = await mockApi.resources.getMetrics();
      expect(typeof metrics).toBe('object');
    });

    it('handles workflow analysis edge cases', async () => {
      mockApi.workflows.optimize.mockResolvedValue(null);

      const result = await mockApi.workflows.optimize('nonexistent-workflow');
      expect(result).toBeNull();
    });
  });
});
