import { describe, expect, it } from 'vitest';
import { resolveWorkspaceSelection, workspaceResultPayload, digestWorkspaceResultForModel } from '../crew-workspace-results.js';
import { splitWorkspaceContext, workspaceContextMessage } from '@shared/crew-workspace-results.js';
describe('Google result surfaces and context', () => {
  it('creates currency-specific forecast cards with exclusions',()=>{
    const data={complete:true,asOf:'2026-10-09',warnings:['Overdue invoice excluded'],assumptions:['Dated commitments only'],forecasts:[{complete:true,currency:'USD',method:'cashflow',periodUnit:'week',series:[{period:1,value:'100.00'}],assumptions:['No future sales'],scenarios:[]}]};
    const card=workspaceResultPayload('quickbooks_forecast_cashflow',data,{horizonWeeks:13})?.items[0];
    expect(card?.forecast).toMatchObject({currency:'USD',warnings:data.warnings,asOf:data.asOf});
    expect(card?.forecast?.assumptions).toEqual(['Dated commitments only','No future sales']);
  });
  it('creates calculation cards only for complete valid financial totals', () => {
    const args = {entity:'Invoice',field:'Balance',outstanding:true};
    const data = {...args,complete:true,matchedRecords:20,totals:[{currency:'USD',value:'5281.52',count:20}]};
    expect(workspaceResultPayload('quickbooks_calculate_total',data,args)?.items[0].calculation).toMatchObject({operation:'SUM',field:'Balance',filter:'Outstanding balances',matchedRecords:20});
    expect(workspaceResultPayload('quickbooks_calculate_total',{...data,complete:false},args)).toBeNull();
    expect(workspaceResultPayload('quickbooks_calculate_total',{...data,totals:[{currency:'USD',value:'NaN',count:20}]},args)).toBeNull();
  });
  it('normalizes multiple emails with stable message identifiers', () => {
    const p = workspaceResultPayload('gmail_list_messages', { messages: [{ id: 'm1', subject: 'Invoice', from: 'a@example.com' }, { id: 'm2', subject: 'Contract' }], nextPageToken: 'next' }, { query: 'in:inbox' });
    expect(p?.items.map(i => i.id)).toEqual(['m1', 'm2']);
    expect(p?.items[0]).toMatchObject({ kind: 'email', title: 'Invoice', sender: 'a@example.com' });
    expect(p?.nextPageToken).toBe('next');
  });
  it('decodes full email content for a single card', () => {
    const p = workspaceResultPayload('gmail_get_message', { id: 'm1', threadId: 't1', payload: { headers: [{ name: 'Subject', value: 'Hello' }], mimeType: 'text/plain', body: { data: Buffer.from('Full body').toString('base64url') } } }, {});
    expect(p?.items[0]).toMatchObject({ title: 'Hello', body: 'Full body', threadId: 't1' });
  });
  it('keeps calendar identifiers and all-day boundaries for agenda selections', () => {
    const p = workspaceResultPayload('gcal_list_events', { events: [{ id: 'e1', summary: 'Conference', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } }] }, { calendar_id: 'team' }, 'Show my agenda');
    expect(p?.presentation).toBe('agenda');
    expect(p?.items[0]).toMatchObject({ id: 'e1', calendarId: 'team', start: '2026-10-07', end: '2026-10-08' });
  });
  it('normalizes single calendar details and multiple Drive documents', () => {
    expect(workspaceResultPayload('gcal_get_event', { id: 'event', summary: 'Meeting' }, {})?.items).toHaveLength(1);
    expect(workspaceResultPayload('gdrive_list_files', [{ id: 'd1', name: 'Proposal' }, { id: 'd2', name: 'Plan' }], {})?.items.map(i => i.title)).toEqual(['Proposal', 'Plan']);
  });
  it('preserves document continuation offsets and identity', () => {
    const p = workspaceResultPayload('gdocs_read_text', { text: 'Document content', next_offset: 12000 }, { document_id: 'd1' });
    expect(p?.items[0]).toMatchObject({ id: 'd1', kind: 'document', body: 'Document content' });
    expect(p?.nextOffset).toBe(12000);
  });
  it('preserves Microsoft platform, library identity and document continuation', () => {
    const p = workspaceResultPayload('m365_read_document', { documentId: 'doc', title: 'Plan.docx', text: 'Actual text', next_offset: 2000, webUrl: 'https://tenant.sharepoint.com/Plan.docx' }, { document_id: 'doc', drive_id: 'library' });
    expect(p?.items[0]).toMatchObject({ id: 'doc', platform: 'microsoft365', driveId: 'library', body: 'Actual text' });
    expect(p?.nextOffset).toBe(2000);
  });
  it('does not mistake unrelated tool outputs for Google results', () => {
    expect(workspaceResultPayload('google_search', { items: [] }, {})).toBeNull();
  });
  it('keeps selected context readable in chat and excludes copied bodies', () => {
    const message = workspaceContextMessage('Draft a reply', [{ id: 'm1', kind: 'email', title: 'Invoice', body: 'Private long body' }]);
    expect(message).not.toContain('Private long body');
    expect(message).toContain('does not authorize sending');
    expect(splitWorkspaceContext(message)).toMatchObject({ message: 'Draft a reply', labels: ['Invoice'] });
  });
  it('resolves selections only from saved source artifacts and ignores client content', async () => {
    const item = { id: 'm1', kind: 'email', title: 'Actual saved email' };
    const items = await resolveWorkspaceSelection([{ turnId: 42, tool: 'gmail_get_message', itemId: 'm1', title: 'Injected title', body: 'Injected content' }], async () => ({ artifacts: [{ tool: 'gmail_get_message', payload: { type: 'google_workspace_results', items: [item] } }] }));
    expect(items).toEqual([item]);
  });
  it('rejects unavailable and cross-room turn references', async () => {
    await expect(resolveWorkspaceSelection([{ turnId: 42, tool: 'gmail_get_message', itemId: 'm1' }], async () => undefined)).rejects.toThrow('unavailable in this room');
  });
  it('rejects invalid or oversized context before reading turns', async () => {
    await expect(resolveWorkspaceSelection(Array.from({ length: 21 }, () => ({})), async () => undefined)).rejects.toThrow('at most 20');
    await expect(resolveWorkspaceSelection([{ turnId: -1 }], async () => undefined)).rejects.toThrow('Invalid source');
  });
  it('extracts text from native Docs tabs and tables', () => {
    const data = { documentId: 'd1', title: 'Native doc', tabs: [{ documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello\n' } }] } }] } } }] };
    expect(workspaceResultPayload('gdocs_get_document', data, {})?.items[0].body).toBe('Hello\n');
  });
});


describe('QuickBooks monetary display', () => {
  it('formats record balances and line amounts in the source currency without changing identifiers', () => {
    const item = workspaceResultPayload('quickbooks_get_record', { entity: 'Invoice', items: [{ Id: '50', DocNumber: '001', TotalAmt: 50, Balance: 0, CurrencyRef: { value: 'EUR' }, Line: [{ Amount: 12.5 }] }] }, {})?.items[0];
    expect(item?.preview).toContain('Total: €50.00');
    expect(item?.body).toContain('Balance: €0.00');
    expect(item?.body).toContain('Amount: €12.50');
    expect(item?.body).toContain('Document number: 001');
  });
  it('formats only Money columns in report output shared with mobile and copied context', () => {
    const item = workspaceResultPayload('quickbooks_get_report', {
      Header: { Currency: 'GBP' }, Columns: { Column: [{ ColTitle: 'Account', ColType: 'String' }, { ColTitle: 'Total', ColType: 'Money' }, { ColTitle: 'Quantity', ColType: 'Integer' }] },
      Rows: { Row: [{ ColData: [{ value: 'Sales' }, { value: '1234.5' }, { value: '2' }] }] }
    }, { report: 'ProfitAndLoss' })?.items[0];
    expect(item?.body).toContain('Sales | £1,234.50 | 2');
  });
});

describe('digestWorkspaceResultForModel', () => {
  it('produces a concise evidence summary without echoing raw JSON', () => {
    const payload = workspaceResultPayload('quickbooks_get_record', {
      entity: 'Invoice',
      items: [
        { Id: '50', DocNumber: '001', TotalAmt: 50, Balance: 0, CurrencyRef: { value: 'EUR' }, Line: [{ Amount: 12.5 }] },
        { Id: '51', DocNumber: '002', TotalAmt: 150, Balance: 150, CurrencyRef: { value: 'EUR' }, Line: [{ Amount: 150 }] },
      ]
    }, {});
    expect(payload).not.toBeNull();
    const digest = digestWorkspaceResultForModel(payload!);
    expect(digest).toContain('Rendered surface: "QuickBooks" (2 items)');
    expect(digest).toContain('Invoice 001');
    expect(digest).toContain('Invoice 002');
    expect(digest).not.toContain('"CurrencyRef"');
    expect(digest).not.toContain('"DocNumber"');
  });

  it('caps items and reports remaining count when item list is large', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      kind: 'document' as const,
      title: `Document ${i}`,
      preview: `Summary of doc ${i}`,
    }));
    const digest = digestWorkspaceResultForModel({
      type: 'google_workspace_results',
      title: 'Documents',
      presentation: 'cards',
      items,
      sourceTool: 'gdrive_list_files',
      sourceArgs: {},
    });
    expect(digest).toContain('Rendered surface: "Documents" (12 items)');
    expect(digest).toContain('Document 0');
    expect(digest).toContain('Document 5');
    expect(digest).toContain('...and 6 more items rendered on the card.');
    expect(digest).not.toContain('Document 6');
  });
});




