// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ rows: [] as any[], where: vi.fn(), token: vi.fn(), retrieve: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: { select: () => ({ from: () => ({ where: (condition: any) => { mocks.where(condition); return { orderBy: async () => mocks.rows }; } }) }) } }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: { retrieve: mocks.retrieve } }));
vi.mock('./core/oauth/google-oauth.adapter.js', () => ({ googleOAuthAdapter: { getValidAccessToken: mocks.token } }));
import { getGoogleWorkspaceToken } from './google-workspace-connector-bridge.js';

describe('Google adapter token bridge', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.token.mockResolvedValue('refreshed-token'); });
  it('filters by organization and only the requested project or organization-wide connections', async () => {
    await getGoogleWorkspaceToken(7, 12, 'gmail_read');
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.sql).toContain('"org_id" =');
    expect(query.sql).toContain('"project_id" is null');
    expect(query.params).toContain(7);
    expect(query.params).toContain(12);
    expect(query.params).toContain('connected');
  });
  it('never looks up tokens without organization context', async () => {
    expect(await getGoogleWorkspaceToken(null, 12, 'gmail_read')).toBeNull();
    expect(mocks.where).not.toHaveBeenCalled();
  });
  it('reuses YouTube consent and keeps readonly grants from authorizing comment writes', async () => {
    mocks.rows = [{ id: 1 }];
    mocks.retrieve.mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/youtube.readonly'] });
    expect(await getGoogleWorkspaceToken(7, 12, 'youtube_read')).toBe('refreshed-token');
    expect(await getGoogleWorkspaceToken(7, 12, 'youtube_write')).toBeNull();
  });
  it('skips Gmail-only consent when Drive is requested and refreshes the eligible connection', async () => {
    mocks.rows = [{ id: 1 }, { id: 2 }];
    mocks.retrieve.mockResolvedValueOnce({ scopes: ['https://www.googleapis.com/auth/gmail.send'] })
      .mockResolvedValueOnce({ scopes: ['https://www.googleapis.com/auth/drive'] });
    expect(await getGoogleWorkspaceToken(7, 12, 'drive_write')).toBe('refreshed-token');
    expect(mocks.token).toHaveBeenCalledExactlyOnceWith(2);
  });
  it('refuses sending when only Gmail reading was consented', async () => {
    mocks.rows = [{ id: 1 }];
    mocks.retrieve.mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
    expect(await getGoogleWorkspaceToken(7, null, 'gmail_send')).toBeNull();
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
