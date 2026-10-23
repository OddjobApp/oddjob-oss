import { afterEach, describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
const quickBooksConnection = vi.hoisted(() => vi.fn());
vi.mock('@domain/integrations/quickbooks/service.js', () => ({ findQuickBooksConnection: quickBooksConnection }));
vi.mock('../crew-generation.service.js', () => ({ crewGenerationService: { generate } }));
import { crewToolsService } from '../crew-tools.service.js';
import { runToolPasses } from '../crew-speaker-turn.service.js';
import { workspaceContextMessage } from '@shared/crew-workspace-results';

describe('Calendar connection recovery in an actual speaker turn', () => {
  it('repairs a malformed Gmail table using executed message artifacts rather than draft text', async () => {
    const response = (toolCalls: any[] = []) => ({ content: 'Rendering a fictional email now.', toolCalls, providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    generate.mockResolvedValueOnce(response([{ name: 'gmail_list_messages', args: {} }]))
      .mockResolvedValueOnce(response([{ name: 'render_table', args: { columns: [] } }]))
      .mockResolvedValue(response());
    let renderAttempts = 0;
    const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async (name, args: any) => {
      if (name === 'gmail_list_messages') return { record: { name, ok: true, ms: 1 }, output: '{}', artifact: { tool: name, payload: { type: 'google_workspace_results', items: [{ id: 'm1', sender: 'real@example.com', title: 'Verified subject', date: '2026-10-21', preview: 'Verified snippet' }] } } } as any;
      renderAttempts++;
      return renderAttempts === 1 ? { record: { name, ok: false, ms: 1, error: 'invalid arguments — rows: Required' }, output: 'rows required' } as any
        : { record: { name, ok: true, ms: 1 }, output: JSON.stringify(args), artifact: { tool: name, payload: { type: 'assistant_table', ...args } } } as any;
    });
    const names = ['gmail_list_messages', 'render_table'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 7, message: 'Check my email and show a table', messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 7, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['gmail_list_messages', 'render_table', 'render_table']);
    expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({ rows: [{ sender: 'real@example.com', subject: 'Verified subject', received: '2026-10-21', snippet: 'Verified snippet' }] });
    expect(result.result.content).toContain('table shows 1 retrieved messages');
  });
  it('reads outstanding QuickBooks invoices and renders their cards before generation', async () => {
    generate.mockResolvedValue({ content: 'One unpaid invoice.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'quickbooks_list_records', ok: true, ms: 1 }, output: '{"entity":"Invoice","items":[{"Id":"1","Balance":50}]}', artifact: { tool: 'quickbooks_list_records', payload: { type: 'google_workspace_results', items: [{ id: 'Invoice:1', kind: 'accounting', platform: 'quickbooks', title: 'Invoice 1' }] } } });
    const names = ['quickbooks_list_records', 'quickbooks_get_report'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 473, message: 'Show my outstanding QuickBooks invoices', messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 473, projectId: 44 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['quickbooks_list_records']);
    expect(execute.mock.calls[0][1]).toEqual({ entity: 'Invoice', start: 1, limit: 25, outstanding: true });
    expect(result.artifacts[0].payload.type).toBe('google_workspace_results');
    expect(result.toolsUsed[0].ok).toBe(true);
    expect(result.result.content).toContain('Found 1 outstanding QuickBooks invoice');
  });
  it('uses the connected QuickBooks company for a generic outstanding invoice request without model generation', async () => {
    generate.mockClear();
    quickBooksConnection.mockResolvedValue({ status: 'connected' });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'quickbooks_list_records', ok: true, ms: 1 }, output: '{"entity":"Invoice","items":[],"nextStart":null}', artifact: { tool: 'quickbooks_list_records', payload: { type: 'google_workspace_results', items: [] } } });
    const names = ['quickbooks_list_records', 'stripe_list_invoices'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 473, message: 'List all outstanding invoices', messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 473, projectId: 44 }, turnMaxTokens: 1000 });
    expect(quickBooksConnection).toHaveBeenCalledWith(473, 44);
    expect(execute.mock.calls.map(call => call[0])).toEqual(['quickbooks_list_records']);
    expect(execute.mock.calls[0][1]).toEqual({ entity: 'Invoice', start: 1, limit: 100, outstanding: true });
    expect(generate).not.toHaveBeenCalled();
    expect(result.result.content).toContain('No matching invoices');
  });
  it('counts full rendered invoice cards rather than the truncated model-facing digest', async () => {
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'quickbooks_list_records', ok: true, ms: 1 }, output: '{"items":[{"Id":"1"}]}', artifact: { tool: 'quickbooks_list_records', payload: { type: 'google_workspace_results', nextStart: 26, items: [{ id: 'Invoice:1' }, { id: 'Invoice:2' }] } } });
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 473, message: 'Show my outstanding QuickBooks invoices', messages: [], availableTools: [{ definition: { name: 'quickbooks_list_records', parameters: {} }, reason: 'declared-read-safe' }] as any, functionDeclarations: [], toolContext: { organizationId: 473, projectId: 44 }, turnMaxTokens: 1000 });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.result.content).toContain('Showing the first 2 outstanding QuickBooks invoices');
    expect(result.result.content).toContain('Load more');
  });
  afterEach(() => vi.restoreAllMocks());
  it('reads selected YouTube comments with the exact YouTube tool instead of a Google document tool', async () => {
    generate.mockResolvedValue({ content: 'The viewer asks a question.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'youtube_get_comment', ok: true, ms: 1 }, output: '{"items":[{"id":"comment1","snippet":{"textDisplay":"Question"}}]}', artifact: null });
    const names = ['youtube_get_comment', 'gdocs_read_text'];
    await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Draft a reply.', [{ id: 'comment1', kind: 'video', platform: 'youtube', youtubeKind: 'comment', title: 'Viewer comment' }]), messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['youtube_get_comment']);
    expect(execute.mock.calls[0][1]).toEqual({ comment_id: 'comment1' });
  });
  it.each(['gdocs_read_text', 'm365_read_document'])('reads all pages through %s beyond the legacy 8000-character cutoff', async (documentTool) => {
    generate.mockResolvedValue({ content: 'The conclusion is FINAL SECTION.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const text = 'a'.repeat(9000) + 'FINAL SECTION';
    const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async (name, args: any) => {
      const next = args.offset + args.max_characters;
      const data = { text: text.slice(args.offset, next), next_offset: next < text.length ? next : null };
      return { record: { name, ok: true, ms: 1 }, output: JSON.stringify(data), artifact: { tool: name, payload: { type: 'google_workspace_results', sourceArgs: args, items: [{ id: 'doc123', kind: 'document', title: 'Google document', body: data.text }], nextOffset: data.next_offset } } };
    });
    const messages: any[] = [];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Summarize this document.', [{ id: 'doc123', kind: 'document', title: 'Project plan', ...(documentTool === 'm365_read_document' ? { platform: 'microsoft365' as const, driveId: 'library' } : {}) }]), messages, availableTools: [{ definition: { name: documentTool, parameters: {} }, reason: 'declared-read-safe' }] as any, functionDeclarations: [{ name: documentTool }], toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(call => (call[1] as any).offset)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(execute.mock.calls.every(call => call[0] === documentTool)).toBe(true);
    if (documentTool === 'm365_read_document') expect(execute.mock.calls[0][1]).toMatchObject({ drive_id: 'library' });
    expect(messages.some(message => message.content.includes('FINAL SECTION'))).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].payload).toMatchObject({ complete: true, readCharacters: text.length, items: [{ title: 'Project plan' }] });
  });
  it('reads the selected Calendar event directly rather than probing an unrelated document', async () => {
    generate.mockResolvedValue({ content: 'This event starts at 6 PM.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'gcal_get_event', ok: true, ms: 1 }, output: '{"summary":"A cool event","start":{"dateTime":"2026-10-07T18:00:00-07:00"}}', artifact: null });
    const names = ['gcal_get_event', 'gcal_list_calendars', 'scribe_get_document', 'google_search'];
    await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Review the selected item.', [{ id: 'event123', kind: 'calendar', calendarId: 'primary', title: 'A cool event' }]), messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['gcal_get_event']);
    expect(execute.mock.calls[0][1]).toEqual({ calendar_id: 'primary', event_id: 'event123' });
  });
  it('reads a selected email before summarizing and does not redirect it to web search', async () => {
    generate.mockClear();
    generate.mockResolvedValue({ content: 'The sender requests payment by Friday.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'gmail_get_message', ok: true, ms: 1 }, output: '{"decodedText":"Please pay by Friday."}', artifact: null });
    const names = ['gmail_get_message', 'google_search', 'browse_web'];
    const messages: any[] = [];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Read the selected emails and provide a concise summary.', [{ id: 'mail123', kind: 'email', title: 'Invoice' }]), messages, availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls[0][0]).toBe('gmail_get_message');
    expect(execute.mock.calls[0][1]).toMatchObject({ message_id: 'mail123' });
    expect(messages.some(m => m.content.includes('Please pay by Friday'))).toBe(true);
    expect(result.result.content).toContain('Friday');
    expect(result.result.content).not.toContain('web lookup');
  });
  it('creates a real connection card without Scribe, web search, or another chat confirmation', async () => {
    generate.mockResolvedValue({ content: 'Please confirm', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async (name: string) => name === 'gcal_list_calendars'
      ? { record: { name, ok: false, ms: 1, error: 'Google Calendar permission is missing.' }, artifact: null, output: 'Google Calendar permission is missing.' }
      : { record: { name, ok: true, ms: 1 }, output: JSON.stringify({ type: 'connection_request', platform: 'google_calendar' }), artifact: { tool: name, payload: { type: 'connection_request', platform: 'google_calendar' } } });
    const names = ['gcal_list_calendars', 'connect_platform', 'scribe_get_document', 'google_search'];
    const result = await runToolPasses({
      cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any,
      card: { id: 1, name: 'Copilot' } as any, orgId: 473,
      message: 'Can you review the Google calendar', messages: [{ role: 'user', content: 'Review Google Calendar' }],
      availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any,
      functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 473, projectId: 44 }, turnMaxTokens: 1000,
    });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['gcal_list_calendars', 'connect_platform']);
    expect(execute.mock.calls[1][1]).toMatchObject({ platform: 'google_calendar' });
    expect(result.artifacts[0].payload.type).toBe('connection_request');
    expect(result.result.content).toContain('no additional chat confirmation');
    expect(result.toolsUsed[0].ok).toBe(false);
  });
  it('freshly reads a generic calendar request for this week even when generation repeats an old claim', async () => {
    generate.mockResolvedValue({ content: 'The earlier count remains accurate.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async name => ({ record: { name, ok: true, ms: 1 }, output: name === 'gcal_list_events' ? JSON.stringify({ events: [{ id: 'fresh' }], timeZone: 'UTC' }) : JSON.stringify({ calendars: [{ id: 'primary' }] }), artifact: name === 'gcal_list_events' ? { tool: name, payload: { type: 'google_workspace_results', items: [{ id: 'fresh' }] } } : null }));
    const names = ['gcal_list_calendars', 'gcal_list_events', 'connect_platform', 'scribe_get_document'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: 'Please check the calendar for this week', messages: [{ role: 'user', content: 'Please check the calendar for this week' }], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(execute.mock.calls.map(c => c[0])).toEqual(['gcal_list_calendars', 'gcal_list_events']);
    expect(execute.mock.calls[1][1]).toMatchObject({ time_range: 'this_week', calendar_id: 'primary' });
    expect(result.artifacts[0].payload.type).toBe('google_workspace_results');
    expect(result.result.content).toContain('live results are shown below');
    expect(result.result.content).not.toContain('earlier count remains accurate');
    expect(execute.mock.calls[1][2].map(t => t.definition.name)).not.toContain('scribe_get_document');
  });
  it('reports a failed live Calendar read instead of repeating a successful old claim', async () => {
    generate.mockResolvedValue({ content: 'There are two events.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
    vi.spyOn(crewToolsService, 'execute').mockImplementation(async name => name === 'gcal_list_calendars' ? { record: { name, ok: true, ms: 1 }, output: '{}', artifact: null } : { record: { name, ok: false, ms: 1, error: 'Calendar access expired' }, output: 'Calendar access expired', artifact: null });
    const names = ['gcal_list_calendars', 'gcal_list_events'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: 'Please check the calendar for this week', messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342, projectId: 3 }, turnMaxTokens: 1000 });
    expect(result.result.content).toContain('Calendar access expired');
    expect(result.result.content).not.toContain('two events');
    expect(result.toolsUsed[1].ok).toBe(false);
  });
});


describe('Financial calculation preflight', () => {
  it('executes a forecast for the room cashflow request instead of searching knowledge',async()=>{
    quickBooksConnection.mockResolvedValue({status:'connected'});
    const execute=vi.spyOn(crewToolsService,'execute').mockResolvedValue({record:{name:'quickbooks_forecast_cashflow',ok:true,ms:1},output:JSON.stringify({complete:true,forecasts:[{currency:'USD',series:[{value:'100.00'}]}]}),artifact:null});
    const result=await runToolPasses({cost:{modelCalls:0,generationMs:0,toolCalls:0} as any,card:{id:1,name:'Copilot'} as any,orgId:473,message:'What is our projected cashflow?',messages:[],availableTools:[{definition:{name:'quickbooks_forecast_cashflow',parameters:{}},reason:'declared-read-safe'}] as any,functionDeclarations:[],toolContext:{organizationId:473,projectId:44},turnMaxTokens:1000});
    expect(execute).toHaveBeenCalledWith('quickbooks_forecast_cashflow',{horizonWeeks:13},expect.any(Array),expect.objectContaining({organizationId:473,projectId:44}));expect(result.result.content).toContain('$100.00');
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(['Please add all the open invoices up and give me a total.', 'What is the sum of all open invoices?', 'Show me the total of open invoices'])('executes a grounded balance calculation for %s', async message => {
    quickBooksConnection.mockResolvedValue({ status: 'connected' });
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'quickbooks_calculate_total', ok: true, ms: 1 }, output: JSON.stringify({ complete: true, matchedRecords: 20, totals: [{ currency: 'USD', value: '5281.52', count: 20 }] }), artifact: null });
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 473, message, messages: [], availableTools: [{ definition: { name: 'quickbooks_calculate_total', parameters: {} }, reason: 'declared-read-safe' }] as any, functionDeclarations: [], toolContext: { organizationId: 473, projectId: 44 }, turnMaxTokens: 1000 });
    expect(execute).toHaveBeenCalledWith('quickbooks_calculate_total', { entity: 'Invoice', field: 'Balance', outstanding: true }, expect.any(Array), expect.objectContaining({ organizationId: 473, projectId: 44 }));
    expect(result.result.content).toContain('$5,281.52');
    expect(result.toolsUsed[0]).toMatchObject({ name: 'quickbooks_calculate_total', ok: true });
  });
  it('does not turn a failed or incomplete calculation into an amount', async () => {
    const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'quickbooks_calculate_total', ok: false, ms: 1, error: 'rate limit' }, output: 'rate limit', artifact: null });
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 473, message: 'Sum all open QuickBooks invoices', messages: [], availableTools: [{ definition: { name: 'quickbooks_calculate_total', parameters: {} }, reason: 'declared-read-safe' }] as any, functionDeclarations: [], toolContext: { organizationId: 473 }, turnMaxTokens: 1000 });
    expect(result.result.content).toContain('calculation failed: rate limit');
    expect(result.result.content).not.toContain('$');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});


it('preserves a single successfully read Gmail source for a follow-up missing its API ID', async () => {
  const { executeToolCalls } = await import('../crew-speaker-turn.service');
  const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'gmail_get_message', ok: true, ms: 1 }, output: '{}', artifact: null });
  await executeToolCalls([{ name: 'gmail_get_message', args: {} }], { availableTools: [] as any, toolContext: { organizationId: 342 }, cost: { toolCalls: 0 } as any, toolsUsed: [], artifacts: [{ tool: 'gmail_get_message', payload: { type: 'google_workspace_results', sourceArgs: { message_id: '1a12165fa68a38aa' }, items: [] } } as any] });
  expect(execute.mock.calls[0][1]).toEqual({ message_id: '1a12165fa68a38aa' });
  execute.mockRestore();
});

it('binds parallel Gmail receipts to their own successful reads and excludes failed reads', async () => {
  const { executeToolCalls } = await import('../crew-speaker-turn.service');
  const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async (name, args: any) => ({ record: { name, ok: args.message_id !== 'failed', ms: 1 }, output: JSON.stringify({ body: args.message_id }), artifact: null }));
  const toolContext: any = { organizationId: 342 };
  await executeToolCalls(['first', 'second', 'failed'].map(message_id => ({ name: 'gmail_get_message', args: { message_id } })),
    { availableTools: [{ definition: { name: 'gmail_get_message', idempotency: 'read-safe' } }] as any, toolContext, cost: { toolCalls: 0 } as any, toolsUsed: [], artifacts: [] });
  expect(toolContext.calendarSourceReceipts.map((source: any) => source.messageId)).toEqual(['first', 'second']);
  expect(toolContext.calendarSourceReceipts[0].contentHash).not.toEqual(toolContext.calendarSourceReceipts[1].contentHash);
  execute.mockRestore();
});

it('refuses to snapshot an older result while a fresh financial result is not yet persisted', async () => {
 const { executeToolCalls } = await import('../crew-speaker-turn.service');
 const execute=vi.spyOn(crewToolsService,'execute');
 const [result]=await executeToolCalls([{name:'propose_financial_snapshot',args:{name:'Fresh forecast'}}],
  {availableTools:[] as any,toolContext:{organizationId:473},cost:{toolCalls:0} as any,toolsUsed:[],artifacts:[{tool:'quickbooks_forecast_cashflow',payload:{type:'google_workspace_results',items:[]}} as any]});
 expect(result.record.ok).toBe(false);expect(result.output).toContain('Do not substitute an older result');
 expect(execute).not.toHaveBeenCalled();execute.mockRestore();
});

it('prepares the requested snapshot from the exact persisted turn and records the follow-up result', async () => {
 const {completeFinancialSnapshotHandoff}=await import('../crew-speaker-turn.service');
 const {db}=await import('@server/database_service');
 const where=vi.fn().mockResolvedValue(undefined),set=vi.fn((_value:any)=>({where}));
 const update=vi.spyOn(db,'update').mockReturnValue({set} as any);
 const execute=vi.spyOn(crewToolsService,'execute').mockResolvedValue({record:{name:'propose_financial_snapshot',ok:true,ms:1},output:'{"snapshot":{"id":"draft-id"}}',artifact:{tool:'propose_financial_snapshot',payload:{type:'google_workspace_results',items:[]}} as any});
 const turn:any={id:123,organizationId:473,content:'Forecast calculated.',toolsUsed:[{name:'quickbooks_forecast_cashflow',ok:true,ms:1}],artifacts:[{tool:'quickbooks_forecast_cashflow',payload:{type:'google_workspace_results',items:[]}}]};
 try{
  await completeFinancialSnapshotHandoff(turn,'Forecast our cashflow and save a snapshot named October baseline.',{availableTools:[{definition:{name:'propose_financial_snapshot'}}] as any,toolContext:{organizationId:473,sessionKey:'room'},cost:{toolCalls:0} as any});
  expect(execute.mock.calls[0][1]).toEqual({name:'October baseline',sourceTurnId:123,artifactIndex:0});
  expect(set.mock.calls[0][0].toolsUsed).toHaveLength(2);
  expect(set.mock.calls[0][0].content).toContain('press Save snapshot');
  expect(turn.artifacts).toHaveLength(2);
 }finally{execute.mockRestore();update.mockRestore();}
});

it('exposes a missing snapshot capability as partial completion without executing an unavailable write',async()=>{
 const {completeFinancialSnapshotHandoff}=await import('../crew-speaker-turn.service');
 const {db}=await import('@server/database_service');
 const set=vi.fn((_value:any)=>({where:vi.fn().mockResolvedValue(undefined)}));
 const update=vi.spyOn(db,'update').mockReturnValue({set} as any);
 const turn:any={id:124,organizationId:473,content:'Forecast calculated.',toolsUsed:[{name:'quickbooks_forecast_cashflow',ok:true,ms:1}],artifacts:[{tool:'quickbooks_forecast_cashflow',payload:{type:'google_workspace_results',items:[]}}]};
 try{
  await completeFinancialSnapshotHandoff(turn,'Forecast our cashflow and save a snapshot named October baseline.',{availableTools:[],toolContext:{organizationId:473},cost:{toolCalls:0} as any});
  expect(turn.content).toContain('Snapshot review is unavailable');
  expect(turn.toolsUsed.at(-1)).toMatchObject({name:'propose_financial_snapshot',ok:false,error:'not permitted'});
  expect(turn.artifacts).toHaveLength(1);
 }finally{update.mockRestore();}
});


it('hands a verified selected email to calendar planning rather than mailbox lookup', async () => {
  generate.mockClear();
  generate.mockResolvedValue({ content: 'Prepared the event details.', toolCalls: [], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
  const execute = vi.spyOn(crewToolsService, 'execute').mockResolvedValue({ record: { name: 'gmail_get_message', ok: true, ms: 1 }, output: JSON.stringify({ id: 'email1', snippet: 'October 10, noon EDT, four hours, Zoom' }), artifact: null });
  const messages: any[] = [];
  const names = ['gmail_get_message', 'gmail_get_profile', 'gcal_create_event', 'gcal_get_calendar'];
  await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: 'Schedule this on Google Calendar' + '\n\n[CREW selected Google items]\n' + JSON.stringify([{ id: 'email1', kind: 'email' }]), messages, availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342 }, turnMaxTokens: 1000 });
  expect(execute.mock.calls.map(call => call[0])).toEqual(['gmail_get_message', 'gcal_get_calendar']);
  expect(messages.some(message => message.content.includes('WORKFLOW HANDOFF'))).toBe(true);
  expect(messages.some(message => message.content.includes('do not ask the user for it'))).toBe(true);
  execute.mockRestore();
});

it('repairs a prose-only email appointment into a real approval proposal with complete timing', async () => {
  generate.mockReset();
  const base = { providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 };
  const args = { calendar_id: 'primary', event: { summary: 'Hackathon', start: { dateTime: '2026-10-10T12:00:00-04:00' }, end: { dateTime: '2026-10-10T16:00:00-04:00' }, location: 'Zoom' }, send_updates: 'none', add_meet: false };
  generate.mockResolvedValueOnce({ ...base, content: 'Would you like to proceed with this proposal?', toolCalls: [] })
    .mockResolvedValueOnce({ ...base, content: '', toolCalls: [{ name: 'gcal_create_event', args }] })
    .mockResolvedValue({ ...base, content: 'Review the saved approval card.', toolCalls: [] });
  const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async name => ({ record: { name, ok: true, ms: 1 }, output: name === 'gcal_get_calendar' ? '{"id":"primary","timeZone":"UTC"}' : '{}', artifact: name === 'gcal_create_event' ? { tool: name, payload: { type: 'approval_request', kind: 'calendar_action', proposalId: 1 } } as any : null }));
  try {
    const names = ['gmail_get_message', 'gcal_get_calendar', 'gcal_create_event'];
    const messages: any[] = [];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Add a calendar appointment', [{ id: 'mail1', kind: 'email', title: 'Hackathon' }]), messages, availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342 }, turnMaxTokens: 600 });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['gmail_get_message', 'gcal_get_calendar', 'gcal_create_event']);
    expect(execute.mock.calls[2][1]).toEqual(args);
    expect(result.artifacts.some(artifact => artifact.payload.type === 'approval_request')).toBe(true);
    expect(generate.mock.calls[0][3].maxTokens).toBeGreaterThanOrEqual(2000);
    expect(messages.some(message => message.content.includes('Use RFC3339 timestamps with the source offset directly'))).toBe(true);
    expect(new Date(args.event.start.dateTime).toISOString()).toBe('2026-10-10T16:00:00.000Z');
  } finally { execute.mockRestore(); }
});

it('reports a failed appointment instead of displaying an invented proposal or confirmation', async () => {
  generate.mockReset();
  generate.mockResolvedValue({ content: 'The appointment was created.', toolCalls: [{ name: 'gcal_create_event', args: { calendar_id: 'primary' } }], providerId: 1, modelId: 1, modelIdentifier: 'test', isFallback: false, latencyMs: 1 });
  const execute = vi.spyOn(crewToolsService, 'execute').mockImplementation(async name => name === 'gcal_create_event'
    ? { record: { name, ok: false, ms: 1, error: 'invalid arguments — event: Required' }, output: 'event: Required', artifact: null }
    : { record: { name, ok: true, ms: 1 }, output: '{}', artifact: null });
  try {
    const names = ['gmail_get_message', 'gcal_get_calendar', 'gcal_create_event'];
    const result = await runToolPasses({ cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 } as any, card: { id: 1, name: 'Copilot' } as any, orgId: 342, message: workspaceContextMessage('Add a calendar appointment', [{ id: 'mail1', kind: 'email', title: 'Hackathon' }]), messages: [], availableTools: names.map(name => ({ definition: { name, parameters: {} }, reason: 'declared-read-safe' })) as any, functionDeclarations: names.map(name => ({ name })), toolContext: { organizationId: 342 }, turnMaxTokens: 600 });
    expect(result.result.content).toContain('No calendar appointment or approval card was created');
    expect(result.result.content).toContain('event: Required');
    expect(result.artifacts).toHaveLength(0);
  } finally { execute.mockRestore(); }
});
