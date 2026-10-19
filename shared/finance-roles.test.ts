import { describe, expect, it } from 'vitest';
import {
    EXECUTIVE_APPROVAL, FINANCE_ROLES, QUICKBOOKS_PERMISSIONS, QUICKBOOKS_REPORT_ACCESS,
    financeAccess, permissionCell, requiresExecutiveApproval,
} from './finance-roles';

describe('QuickBooks finance roles', () => {
    it('gives a member with no finance role no access at all', () => {
        const none = financeAccess([]);
        expect(none.any).toBe(false);
        for (const entity of Object.keys(QUICKBOOKS_PERMISSIONS)) expect(none.can(entity, 'read')).toBe(false);
        for (const report of Object.keys(QUICKBOOKS_REPORT_ACCESS)) expect(none.canReport(report)).toBe(false);
    });

    it('keeps receivables and payables apart', () => {
        const ar = financeAccess(['ar']), ap = financeAccess(['ap']);
        expect(ar.can('Invoice', 'create')).toBe(true);
        expect(ar.can('Vendor', 'read')).toBe(false);
        expect(ar.can('Bill', 'read')).toBe(false);
        expect(ap.can('Bill', 'create')).toBe(true);
        expect(ap.can('Customer', 'read')).toBe(true);
        expect(ap.can('Invoice', 'create')).toBe(false);
        expect(ar.canReport('AgedReceivables')).toBe(true);
        expect(ar.canReport('AgedPayables')).toBe(false);
        expect(ar.canReport('ProfitAndLoss')).toBe(false);
    });

    it('lets Audit read everything and write nothing', () => {
        const audit = financeAccess(['audit']);
        for (const entity of Object.keys(QUICKBOOKS_PERMISSIONS)) {
            expect(audit.can(entity, 'read')).toBe(true);
            for (const op of ['create', 'update', 'delete'] as const) expect(audit.can(entity, op)).toBe(false);
        }
        for (const report of Object.keys(QUICKBOOKS_REPORT_ACCESS)) expect(audit.canReport(report)).toBe(true);
    });

    it('lets an Executive read everything but create nothing', () => {
        const exec = financeAccess(['executive']);
        for (const entity of Object.keys(QUICKBOOKS_PERMISSIONS)) {
            expect(exec.can(entity, 'read')).toBe(true);
            expect(exec.can(entity, 'create')).toBe(false);
        }
    });

    it('writes no ledger records through any role', () => {
        for (const entity of ['Account', 'Item', 'JournalEntry', 'Transfer']) {
            for (const role of FINANCE_ROLES) {
                expect(permissionCell(role, entity).replace('R', '')).toBe('');
            }
        }
    });

    it('takes the union of roles', () => {
        const both = financeAccess(['ar', 'ap']);
        expect(both.can('Invoice', 'create') && both.can('Bill', 'create')).toBe(true);
        expect(both.roles).toEqual(['ar', 'ap']);
    });

    it('needs an Executive for voids, refunds and money going out, and only where the role can do it', () => {
        expect(requiresExecutiveApproval('Invoice', 'delete')).toBe(true);
        expect(requiresExecutiveApproval('BillPayment', 'create')).toBe(true);
        expect(requiresExecutiveApproval('Invoice', 'create')).toBe(false);
        for (const key of EXECUTIVE_APPROVAL) {
            const [entity, op] = key.split(':') as [string, any];
            expect(FINANCE_ROLES.some(role => financeAccess([role]).can(entity, op)), key).toBe(true);
        }
        expect(permissionCell('ar', 'Invoice')).toBe('CRUD†');
        expect(permissionCell('ap', 'BillPayment')).toBe('C†R');
    });

    it('ignores values that are not finance roles', () => {
        expect(financeAccess(['admin' as any, 'ar']).roles).toEqual(['ar']);
    });
});
