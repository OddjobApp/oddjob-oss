import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
vi.mock('@/components/ui/copy-button', () => ({ CopyButton: () => null }));
import { OrgOAuthAppSettings } from './OrgOAuthAppSettings';
beforeEach(() => { vi.resetAllMocks(); mocks.request.mockResolvedValue({ json: async () => ({ organizationId: 19, configured: false, canManage: true, callbackUri: 'https://oddjob.test/callback' }) }); });
function form(orgId = 19, onSaved = vi.fn()) {
  return <OrgOAuthAppSettings provider="google" orgId={orgId} onSaved={onSaved} />;
}
it('clears unsaved secrets when switching organizations', async () => {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>{form()}</QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText('Client secret'), { target: { value: 'private-org-19' } });
  view.rerender(<QueryClientProvider client={client}>{form(27)}</QueryClientProvider>);
  expect(await screen.findByLabelText('Client secret')).toHaveValue('');
  expect(mocks.request).toHaveBeenCalledWith('GET', '/api/saas/connectors/google/oauth/app?organizationId=27');
});
it('saves against the selected org and clears the submitted secret', async () => {
  const saved = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>{form(19, saved)}</QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText('Client ID'), { target: { value: 'owned-app' } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'private-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization OAuth app' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(mocks.request).toHaveBeenCalledWith('PUT', '/api/saas/connectors/google/oauth/app?organizationId=19', { clientId: 'owned-app', clientSecret: 'private-secret' });
  expect(screen.getByLabelText('Client secret')).toHaveValue('');
});
it('does not expose credential inputs to organization members', async () => {
  mocks.request.mockResolvedValue({ json: async () => ({ organizationId: 19, configured: true, source: 'organization', canManage: false }) });
  render(<QueryClientProvider client={new QueryClient()}>{form()}</QueryClientProvider>);
  expect(await screen.findByText('An organization admin must configure or connect this service.')).toBeTruthy();
  expect(screen.queryByLabelText('Client secret')).toBeNull();
});
