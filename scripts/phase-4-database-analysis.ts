#!/usr/bin/env node

/**
 * Phase 4A: Database Analysis Script
 * Gathers baseline metrics for performance optimization
 * Task 1.1 & 1.2 from PHASE_4_EXECUTION_TRACKER.md
 */

import { pool } from '../server/database_service.js';
import { createLogger } from '../server/utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('Phase4-Analysis');

interface TableStats {
  schemaname: string;
  tablename: string;
  n_live_tup: number;
  n_dead_tup: number;
  last_vacuum?: string;
  last_autovacuum?: string;
  size_mb: number;
  n_tup_ins?: number;
  n_tup_upd?: number;
  n_tup_del?: number;
}

interface IndexStats {
  schemaname: string;
  tablename: string;
  indexname: string;
  idx_scan: number;
  idx_tup_read: number;
  idx_tup_fetch: number;
  size_mb: number;
  is_unique: boolean;
  is_primary: boolean;
}

async function analyzeTableStatistics(): Promise<TableStats[]> {
  logger.info('📊 Analyzing table statistics...');

  const query = `
    SELECT
      schemaname,
      relname as tablename,
      n_live_tup,
      n_dead_tup,
      last_vacuum,
      last_autovacuum,
      ROUND(pg_total_relation_size(relid)::numeric / 1024 / 1024, 2) as size_mb,
      n_tup_ins,
      n_tup_upd,
      n_tup_del
    FROM pg_stat_user_tables
    WHERE n_live_tup > 100
    ORDER BY n_live_tup DESC
  `;

  const result = await pool.query(query);
  logger.info(`✅ Found ${result.rows.length} tables with >100 live rows`);
  return result.rows;
}

async function analyzeIndexUsage(): Promise<IndexStats[]> {
  logger.info('📈 Analyzing index usage...');

  const query = `
    SELECT
      schemaname,
      relname as tablename,
      indexrelname as indexname,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch,
      ROUND(pg_relation_size(indexrelid)::numeric / 1024 / 1024, 2) as size_mb,
      FALSE as is_unique,
      FALSE as is_primary
    FROM pg_stat_user_indexes
    ORDER BY idx_scan DESC
  `;

  const result = await pool.query(query);
  logger.info(`✅ Found ${result.rows.length} indexes`);
  return result.rows;
}

async function analyzeQueryPlans(): Promise<Record<string, any>> {
  logger.info('🔍 Analyzing common query patterns...');

  // Critical queries from the codebase
  const criticalQueries = [
    {
      name: 'Approval Requests - Organization + Status',
      query: `EXPLAIN ANALYZE SELECT * FROM approval_requests
               WHERE organization_id = 1 AND status = 'pending'
               LIMIT 50;`,
    },
    {
      name: 'Mission Runs - Cycle + Status',
      query: `EXPLAIN ANALYZE SELECT * FROM mission_runs
               WHERE cycle_id = 1 AND status = 'active'
               LIMIT 50;`,
    },
    {
      name: 'Cycle Blueprints - Cycle ID',
      query: `EXPLAIN ANALYZE SELECT * FROM cycle_blueprints
               WHERE cycle_id = 1
               ORDER BY wave_index ASC;`,
    },
    {
      name: 'Jobs - Organization + Type',
      query: `EXPLAIN ANALYZE SELECT * FROM jobs
               WHERE organization_id = 1 AND type = 'mission'
               LIMIT 50;`,
    },
  ];

  const plans: Record<string, any> = {};

  for (const { name, query } of criticalQueries) {
    try {
      const result = await pool.query(query);
      const plan = result.rows[result.rows.length - 1];
      plans[name] = {
        success: true,
        plan: plan['QUERY PLAN'] || plan,
      };
      logger.info(`  ✅ ${name}`);
    } catch (error) {
      plans[name] = {
        success: false,
        error: (error as Error).message,
      };
      logger.warn(`  ⚠️  ${name}: ${(error as Error).message}`);
    }
  }

  return plans;
}

async function generateReport(
  tables: TableStats[],
  indexes: IndexStats[],
  plans: Record<string, any>
) {
  const totalDataSize = tables.reduce((sum, t) => {
    const size = typeof t.size_mb === 'string' ? parseFloat(t.size_mb) : (t.size_mb || 0);
    return sum + size;
  }, 0);

  const totalIndexSize = indexes.reduce((sum, i) => {
    const size = typeof i.size_mb === 'string' ? parseFloat(i.size_mb) : (i.size_mb || 0);
    return sum + size;
  }, 0);

  const report = {
    timestamp: new Date().toISOString(),
    environment: {
      database: process.env.DATABASE_URL?.split('@')[1] || 'unknown',
      nodeEnv: process.env.NODE_ENV,
    },
    summary: {
      totalTables: tables.length,
      totalIndexes: indexes.length,
      totalDataSize: totalDataSize.toFixed(2),
      totalIndexSize: totalIndexSize.toFixed(2),
    },
    tables: {
      bySize: tables.slice(0, 10).map(t => ({
        name: `${t.schemaname}.${t.tablename}`,
        rows: t.n_live_tup,
        deadRows: t.n_dead_tup,
        sizeGb: (t.size_mb / 1024).toFixed(2),
        insertions: t.n_tup_ins,
        updates: t.n_tup_upd,
        deletions: t.n_tup_del,
        lastVacuum: t.last_vacuum,
        lastAutoVacuum: t.last_autovacuum,
      })),
    },
    indexes: {
      unused: indexes.filter(i => i.idx_scan === 0).map(i => ({
        name: i.indexname,
        table: `${i.schemaname}.${i.tablename}`,
        sizeGb: (i.size_mb / 1024).toFixed(4),
        scans: i.idx_scan,
      })),
      mostUsed: indexes.slice(0, 10).map(i => ({
        name: i.indexname,
        table: `${i.schemaname}.${i.tablename}`,
        scans: i.idx_scan,
        sizeGb: (i.size_mb / 1024).toFixed(4),
      })),
    },
    queryPlans: plans,
    recommendations: {
      immediateAction: [
        '✅ Remove or analyze unused indexes (see indexes.unused)',
        '✅ Create indexes for high-traffic queries (see below)',
        '✅ Run VACUUM on tables with high dead row counts',
      ],
      indexesToCreate: [
        'idx_approval_requests_org_status (approval_requests.organization_id, approval_requests.status)',
        'idx_mission_runs_cycle_status (mission_runs.cycle_id, mission_runs.status)',
        'idx_cycle_blueprints_cycle_id (cycle_blueprints.cycle_id)',
        'idx_jobs_org_type (jobs.organization_id, jobs.type)',
        'idx_operational_cycles_org_status (operational_cycles.organization_id, operational_cycles.status)',
        'idx_approval_requests_org_created (approval_requests.organization_id, approval_requests.created_at DESC)',
        'idx_pipeline_executions_org_status (pipeline_executions.organization_id, pipeline_executions.status)',
        'idx_forms_org_status (forms.organization_id, forms.status)',
      ],
    },
  };

  return report;
}

async function main() {
  try {
    logger.info('🚀 Starting Phase 4A Database Analysis');
    logger.info('=====================================\n');

    const tables = await analyzeTableStatistics();
    logger.info('');

    const indexes = await analyzeIndexUsage();
    logger.info('');

    const plans = await analyzeQueryPlans();
    logger.info('');

    const report = await generateReport(tables, indexes, plans);

    // Save analysis report
    const reportPath = path.join(process.cwd(), 'docs', 'history', 'database_analysis.md');
    const markdownReport = generateMarkdownReport(report);
    fs.writeFileSync(reportPath, markdownReport);
    logger.info(`📄 Analysis saved to: ${reportPath}`);

    // Save JSON report
    const jsonPath = path.join(process.cwd(), 'docs', 'history', 'database_analysis.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    logger.info(`📊 JSON report saved to: ${jsonPath}`);

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4A: DATABASE ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    console.log(JSON.stringify(report.summary, null, 2));
    console.log('\nTop 5 Largest Tables:');
    report.tables.bySize.slice(0, 5).forEach(t => {
      console.log(`  • ${t.name}: ${t.rows.toLocaleString()} rows, ${t.sizeGb} GB`);
    });
    console.log('\nTop 5 Unused Indexes:');
    if (report.indexes.unused.length > 0) {
      report.indexes.unused.slice(0, 5).forEach(i => {
        console.log(`  • ${i.name} (${i.sizeGb} GB)`);
      });
    } else {
      console.log('  ✅ All indexes are in use');
    }
    console.log('\n✅ Analysis complete!\n');

  } catch (error) {
    logger.error('❌ Analysis failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function generateMarkdownReport(report: any): string {
  return `# Phase 4A: Database Analysis Report

**Generated:** ${report.timestamp}
**Environment:** ${report.environment.database} (${report.environment.nodeEnv})

## Summary

- **Total Tables:** ${report.summary.totalTables}
- **Total Indexes:** ${report.summary.totalIndexes}
- **Total Data Size:** ${report.summary.totalDataSize} MB
- **Total Index Size:** ${report.summary.totalIndexSize} MB

## Top 10 Largest Tables

| Table | Rows | Dead Rows | Size (GB) | Last Vacuum |
|-------|------|-----------|-----------|-------------|
${report.tables.bySize.map((t: any) =>
  `| ${t.name} | ${t.rows.toLocaleString()} | ${t.deadRows.toLocaleString()} | ${t.sizeGb} | ${t.lastVacuum || 'N/A'} |`
).join('\n')}

## Unused Indexes (Candidates for Removal)

${report.indexes.unused.length > 0
  ? `| Index | Table | Size (GB) |
|-------|-------|----------|
${report.indexes.unused.map((i: any) => `| ${i.name} | ${i.table} | ${i.sizeGb} |`).join('\n')}`
  : '✅ All indexes are in use!'}

## Most Used Indexes

| Index | Table | Scans | Size (GB) |
|-------|-------|-------|----------|
${report.indexes.mostUsed.map((i: any) =>
  `| ${i.name} | ${i.table} | ${i.scans.toLocaleString()} | ${i.sizeGb} |`
).join('\n')}

## Query Plan Analysis

${Object.entries(report.queryPlans).map(([name, result]: [string, any]) =>
  `### ${name}
\`\`\`
${result.success ? 'Status: ✅ OK\n' : `Status: ⚠️ Error\nError: ${result.error}\n`}
\`\`\``
).join('\n\n')}

## Recommendations

### Immediate Actions
${report.recommendations.immediateAction.map((action: any) => `- ${action}`).join('\n')}

### Indexes to Create (Phase 4A Priority)
${report.recommendations.indexesToCreate.map((idx: any) => `- ${idx}`).join('\n')}

---

**Next Step:** Create migration file \`server/migrations/004_add_performance_indexes.sql\` with the indexes listed above.
`;
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
