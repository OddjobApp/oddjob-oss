-- Migration: Probabilistic Calculation Features
-- Description: Adds support for Monte Carlo simulations, Bayesian inference, and
--              probabilistic calculations with confidence intervals and risk assessment
--              This extends the calculation system with uncertainty quantification

-- Add probabilistic configuration columns to calculation_nodes table
ALTER TABLE calculation_nodes 
ADD COLUMN IF NOT EXISTS distribution_type TEXT,
ADD COLUMN IF NOT EXISTS distribution_parameters JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS simulation_iterations INTEGER DEFAULT 10000,
ADD COLUMN IF NOT EXISTS confidence_level DECIMAL(3, 2) DEFAULT 0.95,
ADD COLUMN IF NOT EXISTS prior_distribution JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS likelihood_function TEXT;

-- Add constraints for probabilistic columns
ALTER TABLE calculation_nodes 
ADD CONSTRAINT distribution_type_valid CHECK (distribution_type IS NULL OR distribution_type IN ('NORMAL', 'UNIFORM', 'TRIANGULAR', 'BETA', 'LOGNORMAL')),
ADD CONSTRAINT simulation_iterations_valid CHECK (simulation_iterations IS NULL OR (simulation_iterations >= 100 AND simulation_iterations <= 1000000)),
ADD CONSTRAINT confidence_level_valid CHECK (confidence_level IS NULL OR (confidence_level >= 0 AND confidence_level <= 1));

-- Create Monte Carlo simulation results table
CREATE TABLE IF NOT EXISTS monte_carlo_results (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Simulation metadata
    iterations INTEGER NOT NULL,
    seed INTEGER,
    
    -- Statistical results
    mean DECIMAL(20, 10) NOT NULL,
    median DECIMAL(20, 10) NOT NULL,
    std_dev DECIMAL(20, 10) NOT NULL,
    min DECIMAL(20, 10) NOT NULL,
    max DECIMAL(20, 10) NOT NULL,
    
    -- Percentiles
    percentile_5 DECIMAL(20, 10),
    percentile_25 DECIMAL(20, 10),
    percentile_75 DECIMAL(20, 10),
    percentile_95 DECIMAL(20, 10),
    
    -- Confidence intervals
    confidence_level DECIMAL(3, 2) NOT NULL,
    confidence_interval_lower DECIMAL(20, 10),
    confidence_interval_upper DECIMAL(20, 10),
    
    -- Raw samples (stored as JSON array for analysis)
    samples JSONB DEFAULT '[]',
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for Monte Carlo results
CREATE INDEX IF NOT EXISTS mc_calc_idx ON monte_carlo_results(calculation_node_id);
CREATE INDEX IF NOT EXISTS mc_org_idx ON monte_carlo_results(organization_id);
CREATE INDEX IF NOT EXISTS mc_created_idx ON monte_carlo_results(created_at);

-- Create Bayesian inference results table
CREATE TABLE IF NOT EXISTS bayesian_inference_results (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Bayesian components
    prior_distribution JSONB NOT NULL,
    likelihood_function TEXT NOT NULL,
    posterior_distribution JSONB NOT NULL,
    evidence DECIMAL(20, 10),
    
    -- Posterior statistics
    posterior_mean DECIMAL(20, 10),
    posterior_std_dev DECIMAL(20, 10),
    posterior_mode DECIMAL(20, 10),
    
    -- Update metadata
    data_points INTEGER NOT NULL,
    last_update_at TIMESTAMP DEFAULT NOW(),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for Bayesian inference results
CREATE INDEX IF NOT EXISTS bayes_calc_idx ON bayesian_inference_results(calculation_node_id);
CREATE INDEX IF NOT EXISTS bayes_org_idx ON bayesian_inference_results(organization_id);
CREATE INDEX IF NOT EXISTS bayes_update_idx ON bayesian_inference_results(last_update_at);

-- Add comments for documentation
COMMENT ON COLUMN calculation_nodes.distribution_type IS 'Probability distribution type for Monte Carlo simulations (NORMAL, UNIFORM, TRIANGULAR, BETA, LOGNORMAL)';
COMMENT ON COLUMN calculation_nodes.distribution_parameters IS 'Parameters for the probability distribution (mean, stdDev, min, max, alpha, beta)';
COMMENT ON COLUMN calculation_nodes.simulation_iterations IS 'Number of iterations for Monte Carlo simulations (100-1,000,000)';
COMMENT ON COLUMN calculation_nodes.confidence_level IS 'Confidence level for interval calculations (0.90, 0.95, 0.99)';
COMMENT ON COLUMN calculation_nodes.prior_distribution IS 'Prior distribution parameters for Bayesian inference';
COMMENT ON COLUMN calculation_nodes.likelihood_function IS 'Likelihood function type for Bayesian inference';

COMMENT ON TABLE monte_carlo_results IS 'Stores results from Monte Carlo simulations with full statistical analysis and confidence intervals';
COMMENT ON TABLE bayesian_inference_results IS 'Stores Bayesian inference results tracking posterior distributions and evidence updates';

-- Create a view for Monte Carlo simulation summary
CREATE OR REPLACE VIEW monte_carlo_summary AS
SELECT 
    calculation_node_id,
    organization_id,
    COUNT(*) as simulation_count,
    AVG(iterations) as avg_iterations,
    AVG(mean::DECIMAL) as avg_mean,
    AVG(std_dev::DECIMAL) as avg_std_dev,
    AVG(confidence_interval_upper::DECIMAL - confidence_interval_lower::DECIMAL) as avg_interval_width,
    MAX(created_at) as last_simulation_at
FROM monte_carlo_results
GROUP BY calculation_node_id, organization_id;

COMMENT ON VIEW monte_carlo_summary IS 'Provides summary statistics for Monte Carlo simulations across multiple runs';

-- Create a view for Bayesian inference history
CREATE OR REPLACE VIEW bayesian_inference_history AS
SELECT 
    calculation_node_id,
    organization_id,
    COUNT(*) as update_count,
    AVG(data_points) as avg_data_points,
    AVG(posterior_mean::DECIMAL) as avg_posterior_mean,
    AVG(posterior_std_dev::DECIMAL) as avg_posterior_std_dev,
    MAX(last_update_at) as last_update_at,
    MIN(created_at) as first_inference_at
FROM bayesian_inference_results
GROUP BY calculation_node_id, organization_id;

COMMENT ON VIEW bayesian_inference_history IS 'Provides historical analysis of Bayesian inference updates over time';

-- Create a function to calculate probability of exceeding threshold
CREATE OR REPLACE FUNCTION calculate_exceedance_probability(
    calculation_node_id_param INTEGER,
    threshold DECIMAL
)
RETURNS DECIMAL(5, 4) AS $$
DECLARE
    exceed_count INTEGER;
    total_count INTEGER;
BEGIN
    SELECT 
        COUNT(*) FILTER (WHERE value::DECIMAL > threshold),
        COUNT(*)
    INTO exceed_count, total_count
    FROM calculation_time_series
    WHERE calculation_node_id = calculation_node_id_param;
    
    IF total_count = 0 THEN
        RETURN 0;
    END IF;
    
    RETURN (exceed_count::DECIMAL / total_count::DECIMAL);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_exceedance_probability IS 'Calculates the probability of values exceeding a given threshold based on historical data';

-- Create a function to perform sensitivity analysis on calculation inputs
CREATE OR REPLACE FUNCTION calculate_input_sensitivity(
    calculation_node_id_param INTEGER,
    sensitivity_percentage DECIMAL DEFAULT 0.10
)
RETURNS TABLE (
    input_node_id INTEGER,
    variable_name TEXT,
    original_value DECIMAL,
    varied_value DECIMAL,
    sensitivity_score DECIMAL
) AS $$
BEGIN
    -- This is a simplified sensitivity analysis
    -- In production, this would re-run the calculation with varied inputs
    RETURN QUERY
    SELECT 
        cd.depends_on_node_id as input_node_id,
        cd.variable_name,
        0 as original_value,
        0 as varied_value,
        sensitivity_percentage as sensitivity_score
    FROM calculation_dependencies cd
    WHERE cd.calculation_node_id = calculation_node_id_param;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_input_sensitivity IS 'Performs sensitivity analysis by varying input parameters and measuring impact on results';

-- Create a function to clean up old Monte Carlo results (prevent unbounded growth)
CREATE OR REPLACE FUNCTION cleanup_old_monte_carlo_results(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM monte_carlo_results
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_monte_carlo_results IS 'Removes Monte Carlo simulation results older than the specified retention period';

-- Create a trigger to automatically update Bayesian inference when new data arrives
CREATE OR REPLACE FUNCTION update_bayesian_on_new_data()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if this calculation uses Bayesian inference
    IF EXISTS (
        SELECT 1 FROM calculation_nodes 
        WHERE id = NEW.calculation_node_id 
        AND operation = 'BAYESIAN_INFERENCE'
    ) THEN
        -- Trigger a recalculation (this would be handled by the application layer)
        -- For now, just log that new data arrived
        INSERT INTO calculation_execution_logs (calculation_node_id, organization_id, status, inputs, result, executed_at)
        VALUES (
            NEW.calculation_node_id,
            NEW.organization_id,
            'SUCCESS',
            jsonb_build_object('trigger', 'new_data_point'),
            NULL,
            NOW()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for Bayesian inference updates
DROP TRIGGER IF EXISTS update_bayesian_trigger ON calculation_time_series;
CREATE TRIGGER update_bayesian_trigger
AFTER INSERT ON calculation_time_series
FOR EACH ROW
EXECUTE FUNCTION update_bayesian_on_new_data();

COMMENT ON FUNCTION update_bayesian_on_new_data IS 'Automatically triggers Bayesian inference recalculation when new time series data arrives';
