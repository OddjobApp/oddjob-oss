import { createLogger } from '@server/utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('TenantIsolationService');

export interface TenantKeyContext {
  tenantId: number;
  kmsKeyId: string;
  region: string;
  dataResidency: 'us_east' | 'eu_west' | 'ap_south' | 'on_prem';
  isEncrypted: boolean;
}

export class TenantIsolationService {
  private tenantKeys = new Map<number, TenantKeyContext>();

  /**
   * Provisions a dedicated KMS encryption key boundary for an enterprise tenant.
   */
  provisionTenantKey(tenantId: number, dataResidency: TenantKeyContext['dataResidency'] = 'us_east'): TenantKeyContext {
    logger.info(`Provisioning dedicated KMS key boundary for tenant #${tenantId} [Residency: ${dataResidency}]`);

    const kmsKeyId = `kms_key_${tenantId}_${crypto.randomBytes(6).toString('hex')}`;
    const keyCtx: TenantKeyContext = {
      tenantId,
      kmsKeyId,
      region: dataResidency === 'eu_west' ? 'eu-central-1' : 'us-east-1',
      dataResidency,
      isEncrypted: true
    };

    this.tenantKeys.set(tenantId, keyCtx);
    return keyCtx;
  }

  /**
   * Retrieves the KMS tenant key context for encryption operations.
   */
  getTenantKey(tenantId: number): TenantKeyContext {
    let keyCtx = this.tenantKeys.get(tenantId);
    if (!keyCtx) {
      keyCtx = this.provisionTenantKey(tenantId);
    }
    return keyCtx;
  }

  /**
   * Verifies data residency compliance before processing payload.
   */
  verifyDataResidency(tenantId: number, targetRegion: string): boolean {
    const keyCtx = this.getTenantKey(tenantId);
    logger.info(`Verifying data residency for tenant #${tenantId}: tenant residency '${keyCtx.dataResidency}' vs target region '${targetRegion}'`);

    if (keyCtx.dataResidency === 'on_prem' && targetRegion !== 'local') {
      return false;
    }

    if (keyCtx.dataResidency === 'eu_west' && !targetRegion.startsWith('eu')) {
      return false;
    }

    return true;
  }
}

export const tenantIsolationService = new TenantIsolationService();
