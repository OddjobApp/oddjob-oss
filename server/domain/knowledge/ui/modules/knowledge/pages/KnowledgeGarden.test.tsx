import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, fireEvent, cleanup} from '@testing-library/react';
import {QueryClient, QueryClientProvider, focusManager} from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({request: vi.fn()}));
vi.mock('@/lib/queryClient', async importOriginal => ({...await importOriginal<typeof import('@/lib/queryClient')>(), apiRequest: mocks.request}));
vi.mock('@domain-ui/core/ui/hooks/use-org-context', () => ({useOrgContext: () => ({selectedOrgId: 1})}));
vi.mock('@domain-ui/knowledge/ui/components/knowledge/garden/SourceDocumentPanel', () => ({SourceDocumentPanel: () => null}));
import KnowledgeGarden from './KnowledgeGarden';
afterEach(() => {cleanup();vi.clearAllMocks();focusManager.setFocused(undefined);});
describe('Knowledge Garden live extraction results', () => {
  it('refreshes entities and counters after background extraction and manual refresh', async () => {
    let phase = 1;
    mocks.request.mockImplementation(async (_method: string, url: string) => ({json: async () => {
      if (url.includes('/staging/stats')) return {byStatus:{staging:phase,verified:0,rejected:0},byLabel:{},byTopic:{},totalStaging:phase};
      if (url.includes('/staging?')) return {nodes:[{id:phase,label:'Entity',name:`Extraction entity ${phase}`,data:{},verificationStatus:'staging',createdAt:'2026-10-22T12:00:00Z'}],total:phase,page:1,limit:50};
      return [];
    }}));
    focusManager.setFocused(true);
    const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const view=render(<QueryClientProvider client={client}><KnowledgeGarden /></QueryClientProvider>);
    await screen.findByText('Extraction entity 1');
    phase=2;
    await screen.findByText('Extraction entity 2',{}, {timeout:12_000});
    await screen.findByText(/2 Pending/);
    phase=3;
    fireEvent.click(screen.getByRole('button',{name:'Refresh staging nodes'}));
    await screen.findByText('Extraction entity 3');
    await screen.findByText(/3 Pending/);
    view.unmount();client.clear();
  },20_000);
});
