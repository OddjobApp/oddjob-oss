import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrewSurfaceConnections } from './CrewSurfaceConnections';
import { surfaceAdapters } from '@shared/crew-surface-connections';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
const surface = { title: 'SDLC suite', blueprint: 'sdlc-workbench', path: '/app/org342/pm-workbench' };
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CrewSurfaceConnections surface={surface} roomKey="room" organizationId={342} /></QueryClientProvider>); }
beforeEach(() => request.mockReset());
describe('Surface connections', () => {
  it('follows route contracts without assuming unknown surfaces have no dependencies', () => {
    expect(surfaceAdapters(surface)).toEqual(['jira', 'confluence']);
    expect(surfaceAdapters({ ...surface, path: '/app/org342/qa-workbench' })).toEqual([]);
    expect(surfaceAdapters({ ...surface, path: '/app/org342/finance-workbench' })).toBeNull();
    expect(surfaceAdapters({ title: 'IT Portal', blueprint: 'it-ticketing-portal', path: '/app/it-portal/tickets' })).toEqual([]);
    expect(surfaceAdapters({ title: 'Support Desk', blueprint: 'support-agent-dashboard', path: '/app/support-dashboard/kb-editor' })).toEqual(['confluence']);
    expect(surfaceAdapters({ title: 'Support Desk', blueprint: 'support-agent-dashboard', path: '/app/support-dashboard/queue' })).toEqual([]);
  });
  it('labels configured adapters as unverified and missing adapters explicitly', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ organizationId: 342, sessionKey: 'room', projectId: null, checkedAt: '2026-10-13T12:00:00Z', checks: [], integrations: [{ platform: 'jira', status: 'connected', scope: 'organization' }] }) });
    show();
    expect(await screen.findByText('Configured · credentials and provider health unverified')).toBeInTheDocument();
    expect(screen.getByText('Missing connection')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(request).toHaveBeenCalledWith('GET', '/api/crew/room/readiness?orgId=342&studio=app');
  });
  it('does not turn failed inventory reads into missing connections', async () => {
    request.mockResolvedValue({ ok: false, status: 503 });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection checks unavailable');
    expect(screen.queryByText('Missing connection')).toBeNull();
  });
});
