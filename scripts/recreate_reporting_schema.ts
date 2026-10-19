
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

async function recreateSchema() {
    console.log("Starting regeneration of reporting schema...");

    const statements = [
        // 1. Create Schema
        `CREATE SCHEMA IF NOT EXISTS reporting;`,

        // 2. Drop existing views to ensure clean state
        `DROP MATERIALIZED VIEW IF EXISTS reporting.kpi_pipeline_performance CASCADE;`,
        `DROP MATERIALIZED VIEW IF EXISTS reporting.kpi_ai_usage CASCADE;`,
        `DROP MATERIALIZED VIEW IF EXISTS reporting.kpi_error_hotspots CASCADE;`,

        // 3. Create kpi_pipeline_performance
        `CREATE MATERIALIZED VIEW reporting.kpi_pipeline_performance AS
        SELECT p.id AS pipeline_id,
            p.name AS pipeline_name,
            COALESCE(p.organization_id, -1) AS organization_id,
            count(pe.id) AS total_executions,
            count(CASE WHEN pe.status = 'completed' THEN 1 END) AS successful_executions,
            count(CASE WHEN pe.status = 'failed' THEN 1 END) AS failed_executions,
            round(CASE WHEN count(pe.id) > 0 THEN (count(CASE WHEN pe.status = 'completed' THEN 1 END)::numeric / count(pe.id)::numeric) * 100 ELSE 0 END, 2) AS success_rate_percentage,
            COALESCE(round(avg(EXTRACT(epoch FROM (pe.completed_at - pe.started_at)))::numeric, 2), 0) AS avg_duration_seconds,
            COALESCE(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (pe.completed_at - pe.started_at)))::numeric, 2), 0) AS p95_duration_seconds,
            max(pe.started_at) AS last_execution_time,
            now() AS refreshed_at
        FROM pipelines p
        LEFT JOIN pipeline_executions pe ON p.id = pe.pipeline_id AND pe.status IN ('completed', 'failed')
        GROUP BY p.id, p.name, p.organization_id;`,

        // 4. Create kpi_ai_usage
        `CREATE MATERIALIZED VIEW reporting.kpi_ai_usage AS
        SELECT 
            l.model,
            l.provider,
            COALESCE(l.organization_id, -1) AS organization_id,
            count(l.id) as request_count,
            sum(l.total_tokens) as total_tokens,
            COALESCE(round(avg((f.end_time_ns - f.start_time_ns) / 1000000)::numeric, 2), 0) as avg_latency_ms,
            max(l.created_at) as last_used_at,
            now() as refreshed_at
        FROM ai_usage_logs l
        LEFT JOIN forensic_event_log f ON l.step_execution_id = f.step_execution_id
        GROUP BY l.model, l.provider, l.organization_id;`,

        // 5. Create kpi_error_hotspots
        `CREATE MATERIALIZED VIEW reporting.kpi_error_hotspots AS
        SELECT 
            f.error_message,
            p.name as pipeline_name,
            f.pipeline_id,
            COALESCE(f.organization_id, -1) AS organization_id,
            count(f.id) as occurrence_count,
            max(f.created_at) as last_seen,
            now() as refreshed_at
        FROM forensic_event_log f
        JOIN pipelines p ON f.pipeline_id = p.id
        WHERE f.status = 'failure' AND f.error_message IS NOT NULL
        GROUP BY f.error_message, p.name, f.pipeline_id, f.organization_id;`,

        // 6. Create Indexes
        // Unique indexes are required for CONCURRENTLY refresh
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_pipeline_unique ON reporting.kpi_pipeline_performance(pipeline_id, organization_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_ai_unique ON reporting.kpi_ai_usage(model, provider, organization_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_error_unique ON reporting.kpi_error_hotspots(pipeline_id, error_message, organization_id);`,

        `CREATE INDEX IF NOT EXISTS idx_kpi_pipe_org ON reporting.kpi_pipeline_performance(organization_id);`,
        `CREATE INDEX IF NOT EXISTS idx_kpi_ai_org ON reporting.kpi_ai_usage(organization_id);`,
        `CREATE INDEX IF NOT EXISTS idx_kpi_error_org ON reporting.kpi_error_hotspots(organization_id);`,

        // 7. Refresh Function
        `CREATE OR REPLACE FUNCTION reporting.refresh_kpi_views()
        RETURNS TABLE(view_name text, refresh_duration_ms bigint)
        LANGUAGE plpgsql
        AS $$
        DECLARE
            start_time TIMESTAMPTZ;
            end_time TIMESTAMPTZ;
        BEGIN
            -- Refresh pipeline performance
            start_time := clock_timestamp();
            REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.kpi_pipeline_performance;
            end_time := clock_timestamp();
            view_name := 'kpi_pipeline_performance';
            refresh_duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::BIGINT;
            RETURN NEXT;

            -- Refresh AI usage
            start_time := clock_timestamp();
            REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.kpi_ai_usage;
            end_time := clock_timestamp();
            view_name := 'kpi_ai_usage';
            refresh_duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::BIGINT;
            RETURN NEXT;

            -- Refresh error hotspots
            start_time := clock_timestamp();
            REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.kpi_error_hotspots;
            end_time := clock_timestamp();
            view_name := 'kpi_error_hotspots';
            refresh_duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::BIGINT;
            RETURN NEXT;
        END;
        $$;`
    ];

    for (const stmt of statements) {
        try {
            console.log(`Executing: ${stmt.substring(0, 50)}...`);
            await db.execute(sql.raw(stmt));
        } catch (error: any) {
            console.error(`Error executing statement: ${error.message} `);
        }
    }

    console.log("\nRegeneration complete!");
    process.exit(0);
}

recreateSchema().catch(err => {
    console.error(err);
    process.exit(1);
});
