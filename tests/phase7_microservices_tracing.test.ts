import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { traceExporterService } from '@domain/core/infrastructure/trace-exporter.service.js';

describe('Phase 7 Microservice Decoupling & Distributed Tracing Suite', () => {
  const originalUrl = process.env.GRAPH_RAG_SERVICE_URL;

  beforeEach(() => {
    process.env.GRAPH_RAG_SERVICE_URL = 'http://localhost:5050';
  });

  afterEach(() => {
    process.env.GRAPH_RAG_SERVICE_URL = originalUrl;
  });

  describe('Graph RAG Client Service', () => {
    /**
     * The client reads GRAPH_RAG_SERVICE_URL once, as a field initialiser, so
     * setting it in beforeEach came too late for an already-imported singleton:
     * the query took the local branch, which returns no nodes without a graph
     * behind it, and nodes[0] was undefined. The module has to be imported
     * after the variable is set.
     */
    it('executes graph queries via decoupled microservice interface', async () => {
      vi.resetModules();
      vi.stubEnv('GRAPH_RAG_SERVICE_URL', 'http://localhost:5050');
      const { graphRagClientService } = await import('@domain/knowledge/core/rag/graph-rag-client.service.js');

      const result = await graphRagClientService.queryGraph({
        organizationId: 1,
        queryText: 'Find microservice architecture components',
        maxResults: 3
      });

      expect(result.isRemoteService).toBe(true);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.nodes[0].label).toContain('microservice architecture components');
      vi.unstubAllEnvs();
    });

    it('falls back to the embedded engine when no service is configured', async () => {
      vi.resetModules();
      vi.stubEnv('GRAPH_RAG_SERVICE_URL', '');
      const { graphRagClientService } = await import('@domain/knowledge/core/rag/graph-rag-client.service.js');

      const result = await graphRagClientService.queryGraph({
        organizationId: 1,
        queryText: 'Find microservice architecture components',
        maxResults: 3
      });

      expect(result.isRemoteService).toBeFalsy();
      expect(Array.isArray(result.nodes)).toBe(true);
      vi.unstubAllEnvs();
    });
  });

  describe('W3C Distributed Trace Exporter', () => {
    it('generates valid W3C traceparent headers', () => {
      const { traceparent, context } = traceExporterService.generateW3CTraceparent();

      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
      expect(context.traceId).toHaveLength(32);
      expect(context.spanId).toHaveLength(16);
    });

    it('parses valid W3C traceparent headers cleanly', () => {
      const sampleHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = traceExporterService.parseW3CTraceparent(sampleHeader);

      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed?.spanId).toBe('00f067aa0ba902b7');
      expect(parsed?.traceFlags).toBe('01');
    });

    it('returns null for invalid traceparent strings', () => {
      const parsed = traceExporterService.parseW3CTraceparent('invalid-header-string');
      expect(parsed).toBeNull();
    });
  });
});
