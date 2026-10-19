import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ orgId: 342, request: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, resolveActiveOrgId: () => mocks.orgId }));
vi.mock('@domain-ui/core/ui/hooks/use-org-context', () => ({ useOrgContextOptional: () => ({ selectedOrgId: mocks.orgId }) }));
vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('wouter', () => ({ useSearch: () => 'tab=capability', useLocation: () => ['/platform-maintenance/documentation', vi.fn()] }));
import DocumentationManager from './DocumentationManager';

describe('Capabilities organization scope', () => {
  beforeEach(() => {
    mocks.orgId = 342;
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (_method: string, url: string) => {
      const orgId = new URL(url, 'http://localhost').searchParams.get('orgId');
      return new Response(JSON.stringify(url.includes('/availability') ? {} : {
        markdown: `# Guide for ${orgId}`, status: 'up-to-date', persisted: true,
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/status') ? null : { features: [] },
    ))));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads the selected organization, avoids reusing another organization’s guide, and scopes regeneration', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = () => <QueryClientProvider client={client}><DocumentationManager /></QueryClientProvider>;
    const mounted = render(view());
    await screen.findByRole('heading', { name: 'Guide for 342' });
    expect(mocks.request).toHaveBeenCalledWith('GET', '/api/documentation/specs/capability/availability?orgId=342');

    mocks.orgId = 473;
    mounted.rerender(view());
    await screen.findByRole('heading', { name: 'Guide for 473' });
    expect(screen.queryByRole('heading', { name: 'Guide for 342' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Regenerate$/ }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('POST', '/api/documentation/generate-spec/capability?orgId=473'));
    client.clear();
  });
});
