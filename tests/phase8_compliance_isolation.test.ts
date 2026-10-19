import { describe, it, expect } from 'vitest';
import { compliancePackService } from '@domain/governor/core/compliance-pack.service.js';
import { tenantIsolationService } from '@domain/auth/core/tenant-isolation.service.js';

describe('Phase 8 High-Compliance & Tenant Isolation Suite', () => {
  describe('Compliance Pack Service', () => {
    it('generates ITIL compliance evidence package cleanly', async () => {
      const pkg = await compliancePackService.generateCompliancePackage({
        framework: 'ITIL',
        organizationId: 101,
        startDate: '2026-01-01',
        endDate: '2026-07-29'
      });

      expect(pkg.framework).toBe('ITIL');
      expect(pkg.complianceStatus).toBe('compliant');
      expect(pkg.evidenceItems.length).toBeGreaterThan(0);
      expect(pkg.evidenceItems[0].category).toContain('Change Management');
    });

    it('generates HIPAA compliance evidence package with PHI access logs', async () => {
      const pkg = await compliancePackService.generateCompliancePackage({
        framework: 'HIPAA',
        organizationId: 102,
        startDate: '2026-01-01',
        endDate: '2026-07-29'
      });

      expect(pkg.framework).toBe('HIPAA');
      expect(pkg.evidenceItems[0].category).toContain('PHI Access Logging');
    });

    it('generates SOC 2 evidence package with zero-trust evidence', async () => {
      const pkg = await compliancePackService.generateCompliancePackage({
        framework: 'SOC2',
        organizationId: 103,
        startDate: '2026-01-01',
        endDate: '2026-07-29'
      });

      expect(pkg.framework).toBe('SOC2');
      expect(pkg.evidenceItems.length).toBe(2);
    });
  });

  describe('Tenant Isolation Service', () => {
    it('provisions KMS key boundary for enterprise tenants', () => {
      const keyCtx = tenantIsolationService.provisionTenantKey(55, 'eu_west');
      expect(keyCtx.kmsKeyId).toContain('kms_key_55_');
      expect(keyCtx.dataResidency).toBe('eu_west');
      expect(keyCtx.region).toBe('eu-central-1');
    });

    it('verifies data residency compliance boundaries', () => {
      tenantIsolationService.provisionTenantKey(77, 'on_prem');

      const isAllowedLocal = tenantIsolationService.verifyDataResidency(77, 'local');
      const isAllowedCloud = tenantIsolationService.verifyDataResidency(77, 'us-east-1');

      expect(isAllowedLocal).toBe(true);
      expect(isAllowedCloud).toBe(false);
    });
  });
});
