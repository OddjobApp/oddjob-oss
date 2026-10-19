import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
import { CrewReadinessPanel } from './CrewReadinessPanel';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('checks only on demand and never shares cached readiness across organizations', async () => {
  request.mockImplementation(async (_method, url: string) => ({ json: async () => ({ projectId: null, checkedAt: new Date().toISOString(), checks: [{ label: url.includes('orgId=342') ? 'Org A' : 'Org B', state: 'not_checked', detail: 'No execution verified' }], agents: [] }) }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const panel = (org: number) => <QueryClientProvider client={client}><CrewReadinessPanel roomKey="room" organizationId={org} studio={null} /></QueryClientProvider>;
  const view = render(panel(342));
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Capabilities/ }));
  expect(await screen.findByText(/Org A: Not checked/)).toBeTruthy();
  view.rerender(panel(473));
  await waitFor(() => expect(screen.queryByText(/Org A: Not checked/)).toBeNull());
  expect(await screen.findByText(/Org B: Not checked/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith('GET', '/api/crew/room/readiness?orgId=473&studio=none');
  client.clear();
});
it('shows individual recipe gaps and keeps configured resources distinct from execution', async () => {
  request.mockResolvedValue({ json: async () => ({
    projectId: 7, checkedAt: new Date().toISOString(),
    agents: [{ id: 1, name: 'Copilot', tools: ['gmail_get_message'], unavailableDeclaredTools: [] }],
    checks: [{ label: 'QuickBooks connection', state: 'not_checked', detail: 'Company configuration found; OAuth unverified' }],
    recipes: [{ id: 'email_calendar', label: 'Email → reviewed calendar event', agents: [{ id: 1, missingTools: ['gcal_create_event'] }], detail: 'Tool coverage only' }],
    projectBindings: [{ kind: 'jira_project', key: 'OPS', name: 'Operations' }],
    integrations: [{ platform: 'jira', scope: 'project', status: 'connected', lastSync: null, schemaCapturedAt: null }],
    appliedSkills: [{ agentId: 1, augmentationId: 9, skillId: 4, missingTools: ['missing_skill_tool'] }],
  }) });
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><CrewReadinessPanel roomKey="room" organizationId={342} studio={null} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Capabilities/ }));
  expect(await screen.findByText('Copilot: Missing gcal_create_event')).toBeTruthy();
  expect(screen.getByText('QuickBooks connection: Not checked')).toBeTruthy();
  expect(screen.getByText('Operations · jira_project')).toBeTruthy();
  expect(screen.getByText(/Last sync: Never recorded/)).toBeTruthy();
  expect(screen.getByText('Unavailable tools: missing_skill_tool')).toBeTruthy();
  client.clear();
});
