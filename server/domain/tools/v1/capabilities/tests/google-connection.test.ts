// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: mocks.token }));
import { GOOGLE_WORKSPACE_TOOLS } from '../google-workspace.js';
import { CONNECTOR_TOOLS } from '../connector-tools.js';
import { googleConnectionUrl, GOOGLE_CONNECTION_PROFILES } from '@shared/google-connection.js';

describe('Google connections used by CREW', () => {
  it('reads Google events with timezone bounds and reports pagination', async () => {
    mocks.token.mockResolvedValue('calendar-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'event' }], nextPageToken: 'next', timeZone: 'America/Los_Angeles' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = JSON.parse(String(await GOOGLE_WORKSPACE_TOOLS.gcal_list_events.execute({ calendar_id: 'primary', time_min: '2026-10-07T00:00:00-07:00', time_max: '2026-10-08T00:00:00-07:00' }, { organizationId: 7, projectId: 12 })));
    expect(mocks.token).toHaveBeenCalledWith(7, 12, 'calendar_read');
    expect(result.nextPageToken).toBe('next');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('timeMin')).toBe('2026-10-07T00:00:00-07:00');
  });
  it('requests Calendar consent instead of claiming the calendar is empty', async () => {
    mocks.token.mockResolvedValue(null);
    await expect(GOOGLE_WORKSPACE_TOOLS.gcal_list_calendars.execute({}, { organizationId: 7, projectId: 12 })).rejects.toThrow('google_calendar');
  });
  it('combines Drive folder and search filters using the required conjunction', async () => {
    mocks.token.mockResolvedValue('drive-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await GOOGLE_WORKSPACE_TOOLS.gdrive_list_files.execute({ query: "name contains 'report'", folder_id: 'folder' }, { organizationId: 7, projectId: 12 });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('q')).toBe("(name contains 'report') and 'folder' in parents");
  });
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => vi.unstubAllGlobals());
  it('refuses a requested mailbox that differs from the connected Gmail account', async () => {
    mocks.token.mockResolvedValue('adapter-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ emailAddress: 'other@example.com' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(GOOGLE_WORKSPACE_TOOLS.gmail_search.execute({ query: 'newer_than:1d', mailbox: 'admin@oddjob.app' }, { organizationId: 7, projectId: 12 })).rejects.toThrow('No messages were read');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('uses the adapter token in the Gmail API request', async () => {
    mocks.token.mockResolvedValue('adapter-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await GOOGLE_WORKSPACE_TOOLS.gmail_search.execute({ query: 'subject:invoice' }, { organizationId: 7, projectId: 12 })).toBe('No messages found.');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('gmail.googleapis.com'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer adapter-token' }),
    }));
  });
  it('requests Gmail consent scoped to the room project', async () => {
    const payload = JSON.parse(await CONNECTOR_TOOLS.connect_platform.execute({ platform: 'gmail', reason: 'Find invoices' }, { organizationId: 7, projectId: 12 }) as string);
    expect(payload.type).toBe('connection_request');
    const url = new URL(payload.connectUrl, 'https://oddjob.test');
    expect(url.searchParams.get('for')).toBe('gmail');
    expect(url.searchParams.get('projectId')).toBe('12');
  });
  it('keeps project-key and return-path parameters intact', () => {
    const url = new URL(googleConnectionUrl('workspace', { projectKey: 'billing', returnTo: '/projects/billing?tab=integrations' }), 'https://oddjob.test');
    expect(url.searchParams.get('projectKey')).toBe('billing');
    expect(url.searchParams.get('returnTo')).toBe('/projects/billing?tab=integrations');
    expect(GOOGLE_CONNECTION_PROFILES.workspace.scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(GOOGLE_CONNECTION_PROFILES.workspace.scopes).toContain('https://www.googleapis.com/auth/drive');
  });
  it('reports missing Gmail consent as a failed call with connection guidance', async () => {
    mocks.token.mockResolvedValue(null);
    await expect(GOOGLE_WORKSPACE_TOOLS.gmail_search.execute({ query: 'invoice' }, { organizationId: 7, projectId: 12 })).rejects.toThrow('connect_platform');
    expect(mocks.token).toHaveBeenCalledWith(7, 12, 'gmail_read');
  });
});
