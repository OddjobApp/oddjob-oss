import { describe, it, expect } from 'vitest';
import { whatIfSimulationService } from '@domain/swarm/services/what-if-simulation.service.js';

describe('What-If Simulation Engine Suite', () => {
  it('simulates destructive schema migration and predicts risk scores + impact deltas', async () => {
    const result = await whatIfSimulationService.simulateAction({
      actionType: 'schema_migration',
      targetResource: 'users_table',
      parameters: { sql: 'ALTER TABLE users DROP COLUMN legacy_auth_hash;' }
    });

    expect(result.simulationId).toMatch(/^sim_/);
    expect(result.predictedOutcome).toBe('breaking_change_risk');
    expect(result.riskScore).toBe(85);
    expect(result.impactDeltas.length).toBeGreaterThan(0);
    expect(result.recommendation).toContain('CAUTION');
  });

  it('simulates deployment scaling action and calculates cost vs throughput deltas', async () => {
    const result = await whatIfSimulationService.simulateAction({
      actionType: 'deployment_scale',
      targetResource: 'oddjob-swarm-runner',
      parameters: { replicas: 4 }
    });

    expect(result.predictedOutcome).toBe('success');
    expect(result.riskScore).toBe(20);
    const costDelta = result.impactDeltas.find(d => d.metric === 'Monthly Compute Cost');
    expect(costDelta).toBeDefined();
    expect(costDelta?.delta).toBe('+$60');
  });
});
