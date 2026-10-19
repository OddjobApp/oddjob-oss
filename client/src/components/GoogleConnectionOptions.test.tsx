import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, resolveActiveOrgId: () => 473 }));
vi.mock('@/components/ui/copy-button', () => ({ CopyButton: () => <button>Copy callback URL</button> }));
import { GoogleConnectionOptions } from './GoogleConnectionOptions';

function mount(projectKey?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GoogleConnectionOptions projectKey={projectKey} /></QueryClientProvider>);
}
describe('Google sign-in choices', () => {
  beforeEach(() => vi.resetAllMocks());
  it('offers scoped Google links when sign-in is configured', async () => {
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ configured: true }) });
    mount('billing');
    const link = await screen.findByRole('link', { name: 'Connect Gmail' });
    const url = new URL(link.getAttribute('href')!, 'https://oddjob.test');
    expect(url.searchParams.get('projectKey')).toBe('billing');
    expect(url.searchParams.get('for')).toBe('gmail');
    expect(url.searchParams.get('orgId')).toBe('473');
    expect(screen.getByRole('link', { name: 'Connect Gmail + Google Drive' })).toBeTruthy();
  });
  it('shows administrator setup instead of sending users to an unusable consent screen', async () => {
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ configured: false, callbackUri: 'https://oddjob.test/api/saas/connectors/google/oauth/callback' }) });
    mount();
    expect(await screen.findByRole('status')).toHaveTextContent('administrator');
    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
    expect(screen.getByText('https://oddjob.test/api/saas/connectors/google/oauth/callback')).toBeTruthy();
  });
  it('distinguishes a status failure from missing configuration', async () => {
    mocks.request.mockRejectedValue(new Error('Network unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check');
    expect(screen.queryByText(/administrator needs/)).toBeNull();
  });
});
