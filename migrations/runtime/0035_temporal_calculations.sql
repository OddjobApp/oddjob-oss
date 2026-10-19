-- Migration: Temporal Calculation Features
-- Description: Adds support for time-series calculations including moving averages,
--              YoY/MoM growth rates, CAGR, exponential smoothing, and rolling calculations
--              This extends the calculation system with temporal analysis capabilities

-- Add temporal configuration columns to calculation_nodes table
ALTER TABLE calculation_nodes 
ADD COLUMN IF NOT EXISTS window_size INTEGER,
ADD COLUMN IF NOT EXISTS time_period TEXT,
ADD COLUMN IF NOT EXISTS smoothing_factor DECIMAL(3, 2),
ADD COLUMN IF NOT EXISTS baseline_date TIMESTAMP;

-- Add constraints for temporal columns
ALTER TABLE calculation_nodes 
ADD CONSTRAINT window_size_positive CHECK (window_size IS NULL OR window_size > 0),
ADD CONSTRAINT smoothing_factor_range CHECK (smoothing_factor IS NULL OR (smoothing_factor >= 0 AND smoothing_factor <= 1)),
ADD CONSTRAINT time_period_valid CHECK (time_period IS NULL OR time_period IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));

-- Create time series data table
CREATE TABLE IF NOT EXISTS calculation_time_series (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Data point
    "timestamp" TIMESTAMP NOT NULL,
    value DECIMAL(20, 10) NOT NULL,
    
    -- Metadata
    source_node_id INTEGER REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
    period TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for time series queries
CREATE INDEX IF NOT EXISTS calc_ts_calc_idx ON calculation_time_series(calculation_node_id);
CREATE INDEX IF NOT EXISTS calc_ts_org_idx ON calculation_time_series(organization_id);
CREATE INDEX IF NOT EXISTS calc_ts_timestamp_idx ON calculation_time_series("timestamp");
CREATE INDEX IF NOT EXISTS calc_ts_calc_timestamp_idx ON calculation_time_series(calculation_node_id, "timestamp");
CREATE INDEX IF NOT EXISTS calc_ts_source_idx ON calculation_time_series(source_node_id);

-- Add comments for documentation
COMMENT ON COLUMN calculation_nodes.window_size IS 'Window size for moving averages and rolling calculations';
COMMENT ON COLUMN calculation_nodes.time_period IS 'Time period for temporal calculations (DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY)';
COMMENT ON COLUMN calculation_nodes.smoothing_factor IS 'Smoothing factor for exponential smoothing (0-1)';
COMMENT ON COLUMN calculation_nodes.baseline_date IS 'Baseline date for YoY/MoM calculations';

COMMENT ON TABLE calculation_time_series IS 'Stores historical data points for temporal calculations, enabling time-series analysis and trend calculations';
COMMENT ON COLUMN calculation_time_series."timestamp" IS 'When this data point was recorded';
COMMENT ON COLUMN calculation_time_series.value IS 'The value at this timestamp';
COMMENT ON COLUMN calculation_time_series.source_node_id IS 'Which knowledge node provided this value';
COMMENT ON COLUMN calculation_time_series.period IS 'Time period classification (DAILY, WEEKLY, MONTHLY, etc.)';

-- Create a view for time series aggregation
CREATE OR REPLACE VIEW calculation_time_series_summary AS
SELECT 
    calculation_node_id,
    organization_id,
    period,
    COUNT(*) as data_point_count,
    MIN("timestamp") as earliest_timestamp,
    MAX("timestamp") as latest_timestamp,
    MIN(value::DECIMAL) as min_value,
    MAX(value::DECIMAL) as max_value,
    AVG(value::DECIMAL) as avg_value,
    STDDEV(value::DECIMAL) as stddev_value
FROM calculation_time_series
GROUP BY calculation_node_id, organization_id, period;

COMMENT ON VIEW calculation_time_series_summary IS 'Provides summary statistics for time series data, useful for quick analysis and monitoring';

-- Create a function to automatically add time series points after calculation execution
CREATE OR REPLACE FUNCTION log_calculation_to_time_series()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if the calculation has temporal configuration
    IF NEW.operation IN ('MOVING_AVERAGE', 'YEAR_OVER_YEAR', 'MONTH_OVER_MONTH', 'CAGR', 
                        'EXPONENTIAL_SMOOTHING', 'ROLLING_SUM', 'ROLLING_AVERAGE') THEN
        INSERT INTO calculation_time_series (calculation_node_id, organization_id, "timestamp", value, period)
        VALUES (
            NEW.id,
            NEW.organization_id,
            COALESCE(NEW.last_calculated_at, NOW()),
            NEW.cached_result,
            NEW.time_period
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically log temporal calculations
DROP TRIGGER IF EXISTS log_temporal_calculation_trigger ON calculation_nodes;
CREATE TRIGGER log_temporal_calculation_trigger
AFTER UPDATE OF cached_result, last_calculated_at ON calculation_nodes
FOR EACH ROW
WHEN (NEW.cached_result IS NOT NULL AND OLD.cached_result IS DISTINCT FROM NEW.cached_result)
EXECUTE FUNCTION log_calculation_to_time_series();

COMMENT ON FUNCTION log_calculation_to_time_series IS 'Automatically logs calculation results to time series when temporal calculations are executed';

-- Create a function to clean up old time series data (prevent unbounded growth)
CREATE OR REPLACE FUNCTION cleanup_old_time_series(retention_days INTEGER DEFAULT 365)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM calculation_time_series
    WHERE "timestamp" < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_time_series IS 'Removes time series data older than the specified retention period to prevent unbounded table growth';

-- Create a function to calculate moving average over time series data
CREATE OR REPLACE FUNCTION calculate_time_series_moving_average(
    calculation_node_id_param INTEGER,
    window_size_param INTEGER DEFAULT 5
)
RETURNS TABLE (
    "timestamp" TIMESTAMP,
    value DECIMAL(20, 10),
    moving_average DECIMAL(20, 10)
) AS $$
BEGIN
    RETURN QUERY
    WITH ordered_data AS (
        SELECT 
            "timestamp",
            value::DECIMAL(20, 10) as value,
            ROW_NUMBER() OVER (ORDER BY "timestamp") as row_num
        FROM calculation_time_series
        WHERE calculation_node_id = calculation_node_id_param
        ORDER BY "timestamp"
    )
    SELECT 
        o1."timestamp",
        o1.value,
        AVG(o2.value) as moving_average
    FROM ordered_data o1
    JOIN ordered_data o2 ON o2.row_num BETWEEN o1.row_num - window_size_param + 1 AND o1.row_num
    GROUP BY o1."timestamp", o1.value, o1.row_num
    ORDER BY o1."timestamp";
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_time_series_moving_average IS 'Calculates moving average over time series data for a specific calculation node';

-- Create a function to detect anomalies in time series data
CREATE OR REPLACE FUNCTION detect_time_series_anomalies(
    calculation_node_id_param INTEGER,
    std_dev_threshold DECIMAL DEFAULT 2.0
)
RETURNS TABLE (
    "timestamp" TIMESTAMP,
    value DECIMAL(20, 10),
    expected_value DECIMAL(20, 10),
    deviation_score DECIMAL(20, 10),
    is_anomaly BOOLEAN
) AS $$
DECLARE
    avg_val DECIMAL(20, 10);
    stddev_val DECIMAL(20, 10);
BEGIN
    -- Calculate statistics
    SELECT AVG(value::DECIMAL), STDDEV(value::DECIMAL)
    INTO avg_val, stddev_val
    FROM calculation_time_series
    WHERE calculation_node_id = calculation_node_id_param;
    
    -- Return anomaly analysis
    RETURN QUERY
    SELECT 
        "timestamp",
        value::DECIMAL(20, 10),
        avg_val as expected_value,
        ABS(value::DECIMAL - avg_val) / NULLIF(stddev_val, 0) as deviation_score,
        CASE 
            WHEN stddev_val > 0 AND ABS(value::DECIMAL - avg_val) / stddev_val > std_dev_threshold 
            THEN true 
            ELSE false 
        END as is_anomaly
    FROM calculation_time_series
    WHERE calculation_node_id = calculation_node_id_param
    ORDER BY "timestamp";
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_time_series_anomalies IS 'Detects statistical anomalies in time series data using standard deviation threshold';
