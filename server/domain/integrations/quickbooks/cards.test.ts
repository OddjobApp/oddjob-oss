import { describe, expect, it } from 'vitest';
import { workspaceResultPayload, resolveWorkspaceSelection } from '../../crew/core/crew-workspace-results.js';
import { QUICKBOOKS_ENTITIES, QUICKBOOKS_REPORTS } from './client.js';

describe('QuickBooks accounting cards', () => {
    it.each(['CompanyInfo', ...QUICKBOOKS_ENTITIES])('renders single and multiple %s records with stable selection identities', entity => {
        for (const tool of ['quickbooks_get_record', 'quickbooks_list_records']) {
            const card = workspaceResultPayload(tool, { entity, items: [{ Id: '1', DisplayName: 'Example', DocNumber: '001' }, { Id: '2', DisplayName: 'Example', DocNumber: '002' }], nextStart: 3 }, { entity });
            expect(card?.items.map(i => i.id)).toEqual([`${entity}:1`, `${entity}:2`]);
            expect(card?.items.every(i => i.platform === 'quickbooks' && i.kind === 'accounting')).toBe(true);
            if (tool === 'quickbooks_list_records') expect(card?.nextStart).toBe(3);
        }
    });
    it.each(QUICKBOOKS_REPORTS)('retains the exact %s report source', report => {
        const card = workspaceResultPayload('quickbooks_get_report', { Header: { ReportName: report }, Rows: { Row: [{ ColData: [{ value: 'Total' }, { value: '100' }] }] } }, { report });
        expect(card?.items[0].quickBooksReport).toBe(report);
        expect(card?.items[0].body).toContain('Total | 100');
    });
    it('keeps an empty successful list distinct from a retrieval failure', () => {
        expect(workspaceResultPayload('quickbooks_list_records', { entity: 'Invoice', items: [], nextStart: null }, { entity: 'Invoice', outstanding: true })).toMatchObject({ title: 'QuickBooks', items: [], nextStart: null });
    });
    it('keeps distinct record identities and readable accounting content', async () => {
        const card = workspaceResultPayload('quickbooks_list_records', { entity: 'Invoice', items: [
            { Id: '1', DocNumber: '1001', CustomerRef: { name: 'Acme' }, TotalAmt: 120, Balance: 120 },
            { Id: '2', DocNumber: '1002', CustomerRef: { name: 'Acme' }, TotalAmt: 200, Balance: 0 },
        ] }, { entity: 'Invoice' });
        expect(card?.title).toBe('QuickBooks');
        expect(card?.items.map(item => item.id)).toEqual(['Invoice:1', 'Invoice:2']);
        expect(card?.items[0]).toMatchObject({ kind: 'accounting', platform: 'quickbooks', quickBooksEntity: 'Invoice', quickBooksRecordId: '1' });
        expect(card?.items[0].body).toContain('120');
        expect(card?.items[0].body).not.toContain('"CustomerRef"');
    });
    it('flattens nested reports into readable rows while retaining read context', () => {
        const card = workspaceResultPayload('quickbooks_get_report', { Header: { ReportName: 'Profit and Loss', Currency: 'USD' }, Rows: { Row: [
            { Header: { ColData: [{ value: 'Income' }] }, Rows: { Row: [{ ColData: [{ value: 'Sales' }, { value: '500' }] }] } },
        ] } }, { report: 'ProfitAndLoss', start_date: '2026-10-01', end_date: '2026-10-08' });
        expect(card?.items[0]).toMatchObject({ quickBooksReport: 'ProfitAndLoss', reportStart: '2026-10-01', reportEnd: '2026-10-08' });
        expect(card?.items[0].body).toContain('Sales | 500');
    });
});
