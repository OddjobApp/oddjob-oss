import { describe, it, expect, vi, beforeEach } from 'vitest';
import { containerReconciliationService } from '../../server/domain/infrastructure/container-reconciliation.service';

describe('Container Reconciliation Service', () => {
  it('reserves available ports in range 3000-3999', () => {
    const port = containerReconciliationService.reservePort();
    expect(port).toBeGreaterThanOrEqual(3000);
    expect(port).toBeLessThanOrEqual(3999);
  });

  it('reclaims allocated ports', () => {
    const port = containerReconciliationService.reservePort();
    const reclaimed = containerReconciliationService.reclaimStalePort(port);
    expect(reclaimed).toBe(true);
  });

  it('provides reconciliation stats', () => {
    const stats = containerReconciliationService.getLastReconciliationStats();
    expect(stats).toHaveProperty('status');
    expect(stats).toHaveProperty('dockerAvailable');
  });
});
