import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: mocks.token }));
import { GOOGLE_WORKSPACE_TOOLS } from './google-workspace.js';
const c = { organizationId: 473, projectId: 44 };
const listUrl = () => new URL(String(vi.mocked(fetch).mock.calls[0][0]));
describe('Google Drive file listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token.mockResolvedValue('test-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ files: [] }) }));
  });
  it('passes order_by to the Drive orderBy parameter, not the query', async () => {
    await GOOGLE_WORKSPACE_TOOLS.gdrive_list_files.execute({ order_by: 'modifiedTime desc' }, c);
    const url = listUrl();
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc');
    expect(url.searchParams.get('q')).toBe('trashed = false');
    expect(url.searchParams.get('q')).not.toContain('order');
  });
  it('moves an embedded "order by" out of the query instead of failing with 400', async () => {
    // Models answer "most recent document" with SQL-shaped queries; Drive
    // rejects ordering inside q with a bare "Invalid Value".
    await GOOGLE_WORKSPACE_TOOLS.gdrive_list_files.execute({ query: "mimeType = 'application/vnd.google-apps.document' order by modifiedTime desc" }, c);
    const url = listUrl();
    expect(url.searchParams.get('q')).toBe("mimeType = 'application/vnd.google-apps.document'");
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc');
  });
  it('keeps the trashed filter when a bare order clause empties the query', async () => {
    await GOOGLE_WORKSPACE_TOOLS.gdrive_list_files.execute({ query: 'order by createdTime desc' }, c);
    const url = listUrl();
    expect(url.searchParams.get('q')).toBe('trashed = false');
    expect(url.searchParams.get('orderBy')).toBe('createdTime desc');
  });
  it('rejects sort keys Drive does not support', async () => {
    await expect(GOOGLE_WORKSPACE_TOOLS.gdrive_list_files.execute({ order_by: 'lastModified desc' }, c)).rejects.toThrow('Invalid order_by');
    expect(fetch).not.toHaveBeenCalled();
  });
});
