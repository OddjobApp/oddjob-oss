import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, fireEvent, cleanup} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/queryClient', async importOriginal=>({...await importOriginal<typeof import('@/lib/queryClient')>(),apiRequest:mocks.request}));
import {KnowledgeExtractionProgress} from './KnowledgeExtractionProgress';
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('Knowledge Store extraction recovery',()=>{
 it('loads counts for a completed compact row and opens a working retry dialog',async()=>{
  mocks.request.mockImplementation(async(method:string,url:string)=>({ok:true,status:200,json:async()=>url==='/api/knowledge/schema'?[{id:1,name:'General'}]:{id:9,status:'completed',progress:100,nodesExtracted:0}}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const view=render(<QueryClientProvider client={client}><KnowledgeExtractionProgress documentId={1} schemaId={1} compact initialStatus="completed" initialProgress={100}/></QueryClientProvider>);
  await screen.findByText('No entities found');
  fireEvent.click(screen.getByRole('button',{name:'Re-run'}));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button',{name:'Start Extraction'}));
  await vi.waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('POST','/api/knowledge-extraction',{documentId:1,schemaId:1,priority:5}));
  view.unmount();client.clear();
 });
});
