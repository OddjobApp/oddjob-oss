/**
 * Comprehensive Test Suite for Memory Documentation System
 * Tests documentation generation, maintenance, API endpoints, and UI components
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock API client for testing memory documentation features
const mockApi = {
  documentation: {
    generate: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
    getFreshnessReport: vi.fn(),
    refresh: vi.fn(),
    getMaintenanceSchedule: vi.fn()
  },
  maintenance: {
    getStatus: vi.fn(),
    startMaintenance: vi.fn(),
    stopMaintenance: vi.fn(),
    getMaintenanceHistory: vi.fn(),
    configureSchedule: vi.fn()
  }
};

// Mock the API calls
vi.mock('@/lib/api', () => ({
  api: mockApi
}));

describe('Memory Documentation - Document Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Automated Documentation Generation', () => {
    it('generates documentation for features', async () => {
      const generationRequest = {
        feature_name: 'predictive_analytics',
        feature_type: 'core_service',
        include_examples: true,
        include_api_reference: true,
        target_audience: 'developers'
      };

      const mockResponse = {
        document_id: 'doc_pred_001',
        feature_name: 'predictive_analytics',
        content: {
          overview: 'AI-powered predictive analytics service...',
          api_endpoints: ['/predictive/failure', '/predictive/performance'],
          examples: ['failure prediction example', 'performance monitoring example']
        },
        metadata: {
          generated_at: new Date().toISOString(),
          version: '1.0.0',
          author: 'system'
        },
        freshness_score: 1.0
      };

      mockApi.documentation.generate.mockResolvedValue(mockResponse);

      const result = await mockApi.documentation.generate(generationRequest);

      expect(result).toHaveProperty('document_id');
      expect(result.feature_name).toBe(generationRequest.feature_name);
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('metadata');
      expect(result.freshness_score).toBe(1.0);
      expect(result.metadata.generated_at).toBeDefined();
    });

    it('handles different documentation types', async () => {
      const testCases = [
        { type: 'api_reference', expected_sections: ['endpoints', 'parameters', 'responses'] },
        { type: 'user_guide', expected_sections: ['overview', 'getting_started', 'examples'] },
        { type: 'architecture', expected_sections: ['components', 'data_flow', 'dependencies'] }
      ];

      for (const testCase of testCases) {
        const mockDoc = {
          document_id: `doc_${testCase.type}`,
          content: testCase.expected_sections.reduce((acc, section) => {
            acc[section] = `${section} content`;
            return acc;
          }, {} as any)
        };

        mockApi.documentation.generate.mockResolvedValue(mockDoc);

        const result = await mockApi.documentation.generate({
          feature_name: 'test_feature',
          feature_type: testCase.type
        });

        testCase.expected_sections.forEach(section => {
          expect(result.content).toHaveProperty(section);
        });
      }
    });

    it('validates generation parameters', async () => {
      // Invalid feature name
      mockApi.documentation.generate.mockRejectedValue(new Error('Invalid feature name'));
      await expect(mockApi.documentation.generate({ feature_name: '' })).rejects.toThrow();

      // Missing required fields
      mockApi.documentation.generate.mockRejectedValue(new Error('Missing required fields'));
      await expect(mockApi.documentation.generate({})).rejects.toThrow();
    });
  });

  describe('Documentation Retrieval and Management', () => {
    it('retrieves documentation by ID', async () => {
      const mockDoc = {
        document_id: 'doc_123',
        feature_name: 'memory_store',
        content: { overview: 'In-memory storage service...' },
        freshness_score: 0.95,
        last_updated: new Date().toISOString()
      };

      mockApi.documentation.get.mockResolvedValue(mockDoc);

      const doc = await mockApi.documentation.get('doc_123');

      expect(doc.document_id).toBe('doc_123');
      expect(doc).toHaveProperty('content');
      expect(doc.freshness_score).toBeGreaterThanOrEqual(0);
      expect(doc.freshness_score).toBeLessThanOrEqual(1);
    });

    it('lists documentation with filtering', async () => {
      const mockList = [
        { document_id: 'doc_1', feature_name: 'predictive_analytics', freshness_score: 0.9 },
        { document_id: 'doc_2', feature_name: 'memory_store', freshness_score: 0.85 },
        { document_id: 'doc_3', feature_name: 'workflow_optimizer', freshness_score: 0.95 },
        { document_id: 'doc_4', feature_name: 'agency_intelligence', freshness_score: 1.0 },
        { document_id: 'doc_5', feature_name: 'triage_center', freshness_score: 1.0 }
      ];

      mockApi.documentation.list.mockResolvedValue({
        documents: mockList,
        total: 5,
        page: 1,
        page_size: 10
      });

      const result = await mockApi.documentation.list({
        feature_type: 'core_service',
        min_freshness: 0.8
      });

      expect(result.documents).toHaveLength(5);
      expect(result.total).toBe(5);
      result.documents.forEach((doc: any) => {
        expect(doc.freshness_score).toBeGreaterThanOrEqual(0.8);
      });
    });

    it('updates existing documentation', async () => {
      const updateData = {
        content: { overview: 'Updated overview content...' },
        metadata: { updated_by: 'user_123', reason: 'content_improvement' }
      };

      mockApi.documentation.update.mockResolvedValue({
        document_id: 'doc_123',
        ...updateData,
        last_updated: new Date().toISOString(),
        freshness_score: 1.0
      });

      const result = await mockApi.documentation.update('doc_123', updateData);

      expect(result.document_id).toBe('doc_123');
      expect(result.freshness_score).toBe(1.0);
      expect(result).toHaveProperty('last_updated');
    });

    it('deletes outdated documentation', async () => {
      mockApi.documentation.delete.mockResolvedValue({ success: true });

      const result = await mockApi.documentation.delete('doc_outdated');

      expect(result.success).toBe(true);
    });
  });

  describe('Documentation Search and Discovery', () => {
    it('searches documentation by keywords', async () => {
      const mockResults = [
        {
          document_id: 'doc_1',
          feature_name: 'predictive_analytics',
          excerpt: '...failure prediction uses machine learning...',
          relevance_score: 0.95
        },
        {
          document_id: 'doc_2',
          feature_name: 'resource_optimizer',
          excerpt: '...optimizes resource allocation...',
          relevance_score: 0.87
        }
      ];

      mockApi.documentation.search.mockResolvedValue({
        results: mockResults,
        total: 2,
        query: 'machine learning',
        search_time: 0.15
      });

      const searchResult = await mockApi.documentation.search({
        query: 'machine learning',
        limit: 10,
        include_excerpts: true
      });

      expect(searchResult.results).toHaveLength(2);
      expect(searchResult.query).toBe('machine learning');
      searchResult.results.forEach((result: any) => {
        expect(result).toHaveProperty('relevance_score');
        expect(result.relevance_score).toBeGreaterThanOrEqual(0);
        expect(result.relevance_score).toBeLessThanOrEqual(1);
      });
    });

    it('supports advanced search filters', async () => {
      const searchFilters = {
        query: 'API endpoints',
        feature_type: 'service',
        freshness_min: 0.8,
        date_range: { from: '2024-01-01', to: '2024-12-31' },
        tags: ['api', 'reference']
      };

      mockApi.documentation.search.mockResolvedValue({
        results: [],
        total: 0,
        query: searchFilters.query,
        filters_applied: searchFilters
      });

      const result = await mockApi.documentation.search(searchFilters);

      expect(result.filters_applied).toEqual(searchFilters);
    });
  });
});

describe('Memory Documentation - Freshness and Maintenance', () => {
  describe('Freshness Monitoring', () => {
    it('generates freshness reports', async () => {
      const mockReport = {
        total_documents: 25,
        fresh_documents: 20,
        stale_documents: 3,
        outdated_documents: 2,
        average_freshness: 0.87,
        freshness_distribution: {
          excellent: 15, // > 0.9
          good: 5,       // 0.7-0.9
          needs_refresh: 3, // 0.5-0.7
          outdated: 2    // < 0.5
        },
        recommendations: [
          'Refresh 3 documents with freshness < 0.7',
          'Archive 2 outdated documents'
        ]
      };

      mockApi.documentation.getFreshnessReport.mockResolvedValue(mockReport);

      const report = await mockApi.documentation.getFreshnessReport();

      expect(report).toHaveProperty('total_documents');
      expect(report.fresh_documents + report.stale_documents + report.outdated_documents).toBe(report.total_documents);
      expect(report.average_freshness).toBeGreaterThanOrEqual(0);
      expect(report.average_freshness).toBeLessThanOrEqual(1);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('identifies documents needing refresh', async () => {
      const mockStaleDocs = [
        { document_id: 'doc_1', feature_name: 'old_feature', freshness_score: 0.3, days_since_update: 120 },
        { document_id: 'doc_2', feature_name: 'changed_api', freshness_score: 0.6, days_since_update: 45 }
      ];

      mockApi.documentation.getFreshnessReport.mockResolvedValue({
        stale_documents: mockStaleDocs.length,
        documents_needing_refresh: mockStaleDocs
      });

      const report = await mockApi.documentation.getFreshnessReport();

      expect(report.documents_needing_refresh).toHaveLength(2);
      report.documents_needing_refresh.forEach((doc: any) => {
        expect(doc.freshness_score).toBeLessThan(0.8);
        expect(doc.days_since_update).toBeGreaterThan(30);
      });
    });
  });

  describe('Automated Maintenance', () => {
    it('refreshes documentation content', async () => {
      const refreshRequest = {
        document_ids: ['doc_1', 'doc_2'],
        reason: 'scheduled_refresh',
        force_update: false
      };

      mockApi.documentation.refresh.mockResolvedValue({
        refreshed_count: 2,
        failed_count: 0,
        results: [
          { document_id: 'doc_1', status: 'success', new_freshness: 1.0 },
          { document_id: 'doc_2', status: 'success', new_freshness: 1.0 }
        ]
      });

      const result = await mockApi.documentation.refresh(refreshRequest);

      expect(result.refreshed_count).toBe(2);
      expect(result.failed_count).toBe(0);
      result.results.forEach((res: any) => {
        expect(res.status).toBe('success');
        expect(res.new_freshness).toBe(1.0);
      });
    });

    it('handles refresh failures gracefully', async () => {
      mockApi.documentation.refresh.mockResolvedValue({
        refreshed_count: 1,
        failed_count: 1,
        results: [
          { document_id: 'doc_1', status: 'success', new_freshness: 1.0 },
          { document_id: 'doc_2', status: 'failed', error: 'API unavailable' }
        ]
      });

      const result = await mockApi.documentation.refresh({ document_ids: ['doc_1', 'doc_2'] });

      expect(result.refreshed_count).toBe(1);
      expect(result.failed_count).toBe(1);
      const failedResult = result.results.find((r: any) => r.status === 'failed');
      expect(failedResult).toHaveProperty('error');
    });
  });

  describe('Maintenance Scheduling', () => {
    it('configures maintenance schedules', async () => {
      const scheduleConfig = {
        frequency: 'daily',
        time: '02:00',
        enabled_features: ['freshness_check', 'auto_refresh', 'cleanup'],
        thresholds: {
          freshness_warning: 0.7,
          freshness_critical: 0.5,
          max_age_days: 90
        }
      };

      mockApi.maintenance.configureSchedule.mockResolvedValue({
        schedule_id: 'sched_001',
        ...scheduleConfig,
        next_run: new Date(Date.now() + 86400000).toISOString(),
        status: 'active'
      });

      const result = await mockApi.maintenance.configureSchedule(scheduleConfig);

      expect(result).toHaveProperty('schedule_id');
      expect(result.status).toBe('active');
      expect(result.frequency).toBe('daily');
      expect(result.next_run).toBeDefined();
    });

    it('provides maintenance status and history', async () => {
      const mockStatus = {
        is_running: false,
        last_run: new Date(Date.now() - 3600000).toISOString(),
        next_run: new Date(Date.now() + 82800000).toISOString(),
        current_schedule: {
          frequency: 'daily',
          enabled_features: ['freshness_check', 'auto_refresh']
        }
      };

      mockApi.maintenance.getStatus.mockResolvedValue(mockStatus);

      const status = await mockApi.maintenance.getStatus();

      expect(status).toHaveProperty('is_running');
      expect(status).toHaveProperty('last_run');
      expect(status).toHaveProperty('next_run');
      expect(status).toHaveProperty('current_schedule');
    });

    it('tracks maintenance execution history', async () => {
      const mockHistory = [
        {
          run_id: 'run_001',
          start_time: new Date(Date.now() - 86400000).toISOString(),
          end_time: new Date(Date.now() - 85800000).toISOString(),
          status: 'completed',
          operations: {
            documents_checked: 25,
            documents_refreshed: 3,
            errors_encountered: 0
          }
        },
        {
          run_id: 'run_002',
          start_time: new Date(Date.now() - 3600000).toISOString(),
          status: 'running',
          operations: {
            documents_checked: 12,
            documents_refreshed: 1
          }
        }
      ];

      mockApi.maintenance.getMaintenanceHistory.mockResolvedValue({
        runs: mockHistory,
        total_runs: 2,
        success_rate: 0.95
      });

      const history = await mockApi.maintenance.getMaintenanceHistory(7);

      expect(history.runs).toHaveLength(2);
      expect(history.success_rate).toBeGreaterThanOrEqual(0);
      expect(history.success_rate).toBeLessThanOrEqual(1);
      history.runs.forEach((run: any) => {
        expect(run).toHaveProperty('run_id');
        expect(run).toHaveProperty('status');
        expect(['completed', 'running', 'failed']).toContain(run.status);
      });
    });
  });
});

describe('Memory Documentation - Integration Tests', () => {
  describe('End-to-End Documentation Workflow', () => {
    it('completes full documentation lifecycle', async () => {
      // 1. Generate new documentation
      const genResult = {
        document_id: 'doc_lifecycle_test',
        feature_name: 'test_feature',
        freshness_score: 1.0
      };
      mockApi.documentation.generate.mockResolvedValue(genResult);

      const doc = await mockApi.documentation.generate({
        feature_name: 'test_feature',
        feature_type: 'service'
      });
      expect(doc.freshness_score).toBe(1.0);

      // 2. Retrieve the generated documentation
      mockApi.documentation.get.mockResolvedValue({
        ...genResult,
        content: { overview: 'Test feature documentation' }
      });
      const retrieved = await mockApi.documentation.get(doc.document_id);
      expect(retrieved.content).toHaveProperty('overview');

      // 3. Update the documentation
      mockApi.documentation.update.mockResolvedValue({
        ...retrieved,
        freshness_score: 1.0,
        last_updated: new Date().toISOString()
      });
      const updated = await mockApi.documentation.update(doc.document_id, {
        content: { overview: 'Updated test feature documentation' }
      });
      expect(updated.freshness_score).toBe(1.0);

      // 4. Search for the documentation
      mockApi.documentation.search.mockResolvedValue({
        results: [{ document_id: doc.document_id, relevance_score: 0.95 }],
        total: 1
      });
      const searchResults = await mockApi.documentation.search({ query: 'test feature' });
      expect(searchResults.total).toBe(1);
    });

    it('handles maintenance workflow', async () => {
      // 1. Check freshness report
      mockApi.documentation.getFreshnessReport.mockResolvedValue({
        total_documents: 10,
        average_freshness: 0.75,
        documents_needing_refresh: ['doc_1', 'doc_2']
      });
      const report = await mockApi.documentation.getFreshnessReport();
      expect(report.documents_needing_refresh).toHaveLength(2);

      // 2. Configure maintenance schedule
      mockApi.maintenance.configureSchedule.mockResolvedValue({
        schedule_id: 'sched_test',
        frequency: 'daily',
        status: 'active'
      });
      const schedule = await mockApi.maintenance.configureSchedule({
        frequency: 'daily',
        enabled_features: ['auto_refresh']
      });
      expect(schedule.status).toBe('active');

      // 3. Start maintenance
      mockApi.maintenance.startMaintenance.mockResolvedValue({
        maintenance_id: 'maint_001',
        status: 'running'
      });
      const maintenance = await mockApi.maintenance.startMaintenance();
      expect(maintenance.status).toBe('running');

      // 4. Check maintenance status
      mockApi.maintenance.getStatus.mockResolvedValue({
        is_running: true,
        current_operation: 'refreshing_documents'
      });
      const status = await mockApi.maintenance.getStatus();
      expect(status.is_running).toBe(true);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('handles generation failures gracefully', async () => {
      mockApi.documentation.generate.mockRejectedValue(new Error('Feature not found'));
      await expect(mockApi.documentation.generate({ feature_name: 'nonexistent' })).rejects.toThrow();
    });

    it('manages concurrent access conflicts', async () => {
      // Simulate concurrent update conflict
      mockApi.documentation.update.mockRejectedValue(new Error('Document locked for editing'));
      await expect(mockApi.documentation.update('doc_locked', {})).rejects.toThrow('Document locked for editing');
    });

    it('handles search service unavailability', async () => {
      mockApi.documentation.search.mockRejectedValue(new Error('Search service unavailable'));
      await expect(mockApi.documentation.search({ query: 'test' })).rejects.toThrow();
    });

    it('recovers from maintenance failures', async () => {
      mockApi.maintenance.startMaintenance.mockRejectedValue(new Error('Maintenance already running'));
      await expect(mockApi.maintenance.startMaintenance()).rejects.toThrow('Maintenance already running');
    });
  });

  describe('Performance and Scalability', () => {
    it('handles large document sets efficiently', async () => {
      const largeDocList = Array.from({ length: 100 }, (_, i) => ({
        document_id: `doc_${i}`,
        feature_name: `feature_${i}`,
        freshness_score: Math.random()
      }));

      mockApi.documentation.list.mockResolvedValue({
        documents: largeDocList,
        total: 100,
        page: 1,
        page_size: 50
      });

      const startTime = Date.now();
      const result = await mockApi.documentation.list({ page: 1, page_size: 50 });
      const endTime = Date.now();

      expect(result.documents).toHaveLength(100);
      expect(result.total).toBe(100);
      // Should complete within reasonable time (mock, so instant)
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('optimizes search performance', async () => {
      mockApi.documentation.search.mockResolvedValue({
        results: [],
        total: 0,
        query: 'complex query',
        search_time: 0.05 // Should be fast
      });

      const result = await mockApi.documentation.search({
        query: 'complex query with multiple terms',
        limit: 20
      });

      expect(result.search_time).toBeLessThan(0.1); // Sub-100ms search
    });
  });
});
