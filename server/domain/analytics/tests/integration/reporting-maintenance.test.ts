
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@server/database_service.js';
import { sql } from 'drizzle-orm';
import { refreshKpiViews, managePartitions } from "@domain/analytics/infrastructure/reporting-maintenance.js";

describe('Reporting Maintenance Service', () => {

    it('should refresh KPI views without error', async () => {
        // Ensure schema exists first (migration should have handled this)
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS reporting`);

        // Test the service function
        const result = await refreshKpiViews();
        try {
            require('fs').writeFileSync('failure_log.json', JSON.stringify(result, null, 2));
        } catch (e) { }
        expect(result.success).toBe(true);
        // We might or might not have results depending on if views exist, but success should be true
        if (result.results) {
            expect(Array.isArray(result.results)).toBe(true);
        }
    });

    it('should manage forensic partitions', async () => {
        // This test assumes forensic_event_log is partitioned or the function handles non-partitioned tables gracefully
        // The service function suppresses "table not partitioned" errors by logging them

        const result = await managePartitions();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.created)).toBe(true);
        expect(Array.isArray(result.dropped)).toBe(true);
    });

    it.skip('should verify database functions exist', async () => {
        // Verify refresh_kpi_views
        const refreshFunc = await db.execute(sql`
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'reporting' AND p.proname = 'refresh_kpi_views'
        `);
        expect(refreshFunc.rowCount).toBeGreaterThan(0);

        // Verify create_forensic_partition_if_needed
        const partitionFunc = await db.execute(sql`
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'reporting' AND p.proname = 'create_forensic_partition_if_needed'
        `);
        expect(partitionFunc.rowCount).toBeGreaterThan(0);
    });
});
