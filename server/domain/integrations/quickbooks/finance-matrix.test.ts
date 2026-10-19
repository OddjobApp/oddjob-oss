import { describe, expect, it } from 'vitest';
import { QUICKBOOKS_ENTITIES, QUICKBOOKS_REPORTS } from './client.js';
import { QUICKBOOKS_PERMISSIONS, QUICKBOOKS_REPORT_ACCESS } from '@shared/finance-roles.js';
import { QUICKBOOKS_WRITE_PERMISSIONS } from '@domain/tools/v1/capabilities/quickbooks.js';

// An entity or report missing from the matrix would be readable by nobody,
// silently; one missing from QUICKBOOKS_WRITE_PERMISSIONS could not be approved.
describe('QuickBooks finance matrix coverage', () => {
    it('covers every entity and report the integration reads', () => {
        expect(Object.keys(QUICKBOOKS_PERMISSIONS).sort()).toEqual([...QUICKBOOKS_ENTITIES].sort());
        expect(Object.keys(QUICKBOOKS_REPORT_ACCESS).sort()).toEqual([...QUICKBOOKS_REPORTS].sort());
    });
    it('maps every approval-gated write to a matrix entity', () => {
        for (const { entity } of Object.values(QUICKBOOKS_WRITE_PERMISSIONS)) expect(QUICKBOOKS_ENTITIES).toContain(entity);
    });
});
