import { describe, it, expect, vi, beforeEach } from 'vitest';
import { graphRagClientService } from '../../server/domain/knowledge/core/rag/graph-rag-client.service';

describe('Graph RAG Client Microservice Router', () => {
  beforeEach(() => {
    delete process.env.GRAPH_RAG_SERVICE_URL;
  });

  it('routes query to embedded local engine when GRAPH_RAG_SERVICE_URL is unset', async () => {
    const result = await graphRagClientService.queryGraph({
      organizationId: 1,
      queryText: 'Test query for local Graph RAG'
    });

    expect(result).toHaveProperty('nodes');
    expect(result.isRemoteService).toBe(false);
  });

  it('routes query to remote microservice when GRAPH_RAG_SERVICE_URL is set', async () => {
    (graphRagClientService as any).remoteServiceUrl = 'http://localhost:50051';

    const result = await graphRagClientService.queryGraph({
      organizationId: 1,
      queryText: 'Test query for microservice'
    });

    expect(result).toHaveProperty('nodes');
    expect(result.isRemoteService).toBe(true);
  });
});
