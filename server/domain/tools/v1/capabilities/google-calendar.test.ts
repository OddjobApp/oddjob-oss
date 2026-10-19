import { describe, it, expect, vi, beforeEach } from 'vitest';
const proposal = vi.hoisted(() => ({ values: vi.fn(() => ({ returning: async () => [{ id: 99 }] })) }));
vi.mock('@server/database_service.js', () => ({ db: { insert: () => proposal } }));
vi.mock('@shared/schema/index.js', () => ({ approvalRequests: { id: 'id' } }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: vi.fn().mockResolvedValue('test-token') }));
import { executeCalendarApproval, GOOGLE_CALENDAR_TOOLS, reconcileCalendarApproval, calendarArgsHash, calendarFailure } from './google-calendar.js';
import { calendarRange } from './calendar-time.js';
import { getGoogleWorkspaceToken } from '@domain/integrations/google-workspace-connector-bridge.js';
describe('Google Calendar', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({ ok: true, status: 200,
    json: async () => options?.method === 'POST' ? JSON.parse(options.body as string) : ({ id: 'event' }) }))); });
  it('resolves a DST transition week in the calendar time zone', () => {
    expect(calendarRange('this_week', 'America/Los_Angeles', new Date('2026-03-08T18:00:00Z'))).toEqual({ time_min: '2026-03-02T08:00:00.000Z', time_max: '2026-03-09T07:00:00.000Z' });
  });
  it('resolves today independently of the server time zone', () => {
    expect(calendarRange('today', 'America/Los_Angeles', new Date('2026-10-08T01:00:00Z'))).toEqual({ time_min: '2026-10-07T07:00:00.000Z', time_max: '2026-10-08T07:00:00.000Z' });
  });
  it('rejects inverted and mixed all-day event boundaries', () => {
    expect(GOOGLE_CALENDAR_TOOLS.gcal_create_event.parameters.safeParse({ event: { summary: 'Pickup', start: { date: '2026-10-07' }, end: { date: '2026-10-07' } } }).success).toBe(false);
  });
  it('uses write access and stable event IDs for approved creates', async () => {
    await executeCalendarApproval('gcal_create_event', { event: { summary: 'Pickup', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } } }, { organizationId: 473, projectId: 44 }, 123);
    expect(getGoogleWorkspaceToken).toHaveBeenCalledWith(473, 44, 'calendar_write');
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('sendUpdates=none');
    expect(JSON.parse(options!.body as string).id).toMatch(/^[a-f0-9]{64}$/);
  });
  it('passes etags to Google for conflict-safe deletes', async () => {
    await executeCalendarApproval('gcal_delete_event', { event_id: 'a/b', etag: 'version1' }, { organizationId: 473 }, 124);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('a%2Fb');
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ 'If-Match': 'version1' });
  });
  it('rejects unrecognized approval actions before fetching', async () => {
    await expect(executeCalendarApproval('arbitrary', {}, { organizationId: 473 }, 1)).rejects.toThrow('Unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saves a reviewable proposal without changing Google', async () => {
    const result = JSON.parse(await GOOGLE_CALENDAR_TOOLS.gcal_create_event.execute({ calendar_id: 'primary', event: { summary: 'Pickup', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } } }, { organizationId: 473, projectId: 44 }));
    expect(result).toMatchObject({ proposalId: 99, kind: 'calendar_action', projectId: 44, status: 'pending' });
    expect(proposal.values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 473, toolArgs: expect.objectContaining({ args: expect.objectContaining({ event: expect.objectContaining({ summary: 'Pickup' }) }) }) }));
    expect(fetch).not.toHaveBeenCalled();
  });
  const args = { calendar_id: 'primary', event: { summary: 'Hackathon', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }, send_updates: 'none', add_meet: false };
  it('recovers a committed create after a lost response without a second POST', async () => {
    let saved: any;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') { saved = JSON.parse(options.body as string); throw new Error('socket closed after commit'); }
      return { ok: true, status: 200, json: async () => saved } as Response;
    });
    const result = await executeCalendarApproval('gcal_create_event', args, { organizationId: 473 }, 123);
    expect(result.id).toBe(saved.id);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe('GET');
  });
  it('marks an unresolved timeout unknown and never retries the create', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    try { await executeCalendarApproval('gcal_create_event', args, { organizationId: 473 }, 123); throw new Error('Expected failure'); }
    catch (error) { expect(calendarFailure(error).state).toBe('outcome_unknown'); }
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  it('refuses recovery when the event schedule was changed but private markers remain', async () => {
    let saved: any;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') { saved = JSON.parse(options.body as string); return { ok: true, status: 200, json: async () => saved } as Response; }
      return { ok: true, status: 200, json: async () => ({ ...saved, start: { date: '2026-10-09' } }) } as Response;
    });
    await executeCalendarApproval('gcal_create_event', args, { organizationId: 473 }, 123);
    await expect(reconcileCalendarApproval(args, { organizationId: 473 }, 123)).rejects.toThrow('changed after approval');
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  it('rejects a conflicting existing event instead of adopting it as success', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'unrelated', extendedProperties: { private: { crewApprovalId: '123', crewArgsHash: calendarArgsHash(args) } } }) } as Response);
    await expect(reconcileCalendarApproval(args, { organizationId: 473 }, 123)).rejects.toThrow('does not match');
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });
  it('persists verified provenance and readiness in the approval without an external write', async () => {
    const result = JSON.parse(await GOOGLE_CALENDAR_TOOLS.gcal_create_event.execute(args, { organizationId: 473, projectId: 44, sessionKey: 'room',
      calendarSourceReceipts: [{ provider: 'gmail', messageId: 'gmail-api-id', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-09T18:00:00.000Z' }],
      calendarDestination: { calendarId: 'primary', metadata: { timeZone: 'America/Los_Angeles' } } }));
    expect(result.workflow).toMatchObject({ version: 1, state: 'awaiting_approval', organizationId: 473, projectId: 44,
      calendarTimeZone: 'America/Los_Angeles', approvedArgsHash: calendarArgsHash(args) });
    expect(result.workflow.sources[0].messageId).toBe('gmail-api-id');
    expect(fetch).not.toHaveBeenCalled();
    await expect(executeCalendarApproval('gcal_create_event', { ...args, event: { ...args.event, summary: 'Changed after review' } },
      { organizationId: 473, projectId: 44, sessionKey: 'room', calendarWorkflow: result.workflow }, 123)).rejects.toThrow('changed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses one destination ID for identical email scheduling proposals across approval IDs', async () => {
    const workflow = { version: 1, recipe: 'email_to_calendar', organizationId: 473, projectId: 44, sessionKey: 'room',
      sources: [{ provider: 'gmail', messageId: 'email1', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-09T18:00:00.000Z' }],
      calendarId: 'primary', calendarTimeZone: 'America/Los_Angeles', approvedArgsHash: calendarArgsHash(args), state: 'awaiting_approval' };
    const context = { organizationId: 473, projectId: 44, sessionKey: 'room', calendarWorkflow: workflow };
    let saved: any;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        if (saved) return { ok: false, status: 409, text: async () => 'duplicate' } as Response;
        saved = JSON.parse(options.body as string);
      }
      if (!saved) return { ok: false, status: 404, text: async () => 'not found' } as Response;
      return { ok: true, status: 200, json: async () => saved } as Response;
    });
    await executeCalendarApproval('gcal_create_event', args, context, 123);
    expect(await executeCalendarApproval('gcal_create_event', args, context, 124)).toEqual(saved);
    const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(saved.extendedProperties.private.crewWorkflowId).toBe(saved.id);
    saved.summary = 'Changed in Google';
    await expect(executeCalendarApproval('gcal_create_event', args, context, 125)).rejects.toThrow('changed after approval');
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'));
    await expect(executeCalendarApproval('gcal_create_event', args, context, 126)).rejects.toThrow('connection failed');
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
