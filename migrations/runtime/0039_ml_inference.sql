-- Migration: Machine Learning Inference Features
-- Description: Adds support for ML model inference, including prediction, classification,
--              anomaly detection, feature extraction, and model versioning
--              This extends the calculation system with AI/ML capabilities

-- Add ML inference configuration columns to calculation_nodes table
ALTER TABLE calculation_nodes 
ADD COLUMN IF NOT EXISTS model_id TEXT,
ADD COLUMN IF NOT EXISTS model_version TEXT,
ADD COLUMN IF NOT EXISTS model_type TEXT,
ADD COLUMN IF NOT EXISTS feature_config JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS prediction_threshold DECIMAL(3, 2),
ADD COLUMN IF NOT EXISTS confidence_threshold DECIMAL(3, 2),
ADD COLUMN IF NOT EXISTS ensemble_strategy TEXT,
ADD COLUMN IF NOT EXISTS anomaly_detection_method TEXT;

-- Add constraints for ML inference columns
ALTER TABLE calculation_nodes 
ADD CONSTRAINT model_type_valid CHECK (model_type IS NULL OR model_type IN ('REGRESSION', 'CLASSIFICATION', 'CLUSTERING', 'ANOMALY_DETECTION')),
ADD CONSTRAINT prediction_threshold_valid CHECK (prediction_threshold IS NULL OR (prediction_threshold >= 0 AND prediction_threshold <= 1)),
ADD CONSTRAINT confidence_threshold_valid CHECK (confidence_threshold IS NULL OR (confidence_threshold >= 0 AND confidence_threshold <= 1)),
ADD CONSTRAINT ensemble_strategy_valid CHECK (ensemble_strategy IS NULL OR ensemble_strategy IN ('MAJORITY_VOTE', 'WEIGHTED_AVERAGE', 'STACKING')),
ADD CONSTRAINT anomaly_detection_method_valid CHECK (anomaly_detection_method IS NULL OR anomaly_detection_method IN ('ISOLATION_FOREST', 'AUTOENCODER', 'STATISTICAL'));

-- Create ML model versions table
CREATE TABLE IF NOT EXISTS ml_model_versions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Model identification
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_type TEXT NOT NULL,
    model_name TEXT NOT NULL,
    
    -- Model metadata
    model_config JSONB DEFAULT '{}',
    feature_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    
    -- Performance metrics
    accuracy DECIMAL(5, 4),
    "precision" DECIMAL(5, 4),
    recall DECIMAL(5, 4),
    f1_score DECIMAL(5, 4),
    mse DECIMAL(20, 10),
    training_data_size INTEGER,
    
    -- Deployment
    is_deployed BOOLEAN DEFAULT FALSE,
    deployment_date TIMESTAMP,
    is_default BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    description TEXT,
    tags JSONB DEFAULT '[]',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(model_id, model_version)
);

-- Indexes for ML model versions
CREATE INDEX IF NOT EXISTS ml_model_org_idx ON ml_model_versions(organization_id);
CREATE INDEX IF NOT EXISTS ml_model_id_idx ON ml_model_versions(model_id);
CREATE INDEX IF NOT EXISTS ml_model_version_idx ON ml_model_versions(model_version);
CREATE INDEX IF NOT EXISTS ml_model_type_idx ON ml_model_versions(model_type);
CREATE INDEX IF NOT EXISTS ml_model_deployed_idx ON ml_model_versions(is_deployed);

-- Create ML inference results table
CREATE TABLE IF NOT EXISTS ml_inference_results (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Model information
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_type TEXT NOT NULL,
    
    -- Input features
    features JSONB NOT NULL,
    feature_hash TEXT,
    
    -- Prediction results
    prediction JSONB NOT NULL,
    prediction_score DECIMAL(20, 10),
    prediction_label TEXT,
    
    -- Classification specific
    class_probabilities JSONB DEFAULT '{}',
    is_anomaly BOOLEAN,
    anomaly_score DECIMAL(20, 10),
    
    -- Performance
    inference_time_ms INTEGER,
    model_version_used TEXT,
    
    -- Metadata
    executed_at TIMESTAMP DEFAULT NOW(),
    triggered_by TEXT
);

-- Indexes for ML inference results
CREATE INDEX IF NOT EXISTS ml_inference_calc_idx ON ml_inference_results(calculation_node_id);
CREATE INDEX IF NOT EXISTS ml_inference_org_idx ON ml_inference_results(organization_id);
CREATE INDEX IF NOT EXISTS ml_inference_model_idx ON ml_inference_results(model_id);
CREATE INDEX IF NOT EXISTS ml_inference_executed_idx ON ml_inference_results(executed_at);
CREATE INDEX IF NOT EXISTS ml_inference_anomaly_idx ON ml_inference_results(is_anomaly);

-- Create feature extraction pipelines table
CREATE TABLE IF NOT EXISTS feature_extraction_pipelines (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Pipeline definition
    name TEXT NOT NULL,
    description TEXT,
    pipeline_config JSONB NOT NULL,
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    
    -- Pipeline metadata
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Performance
    avg_extraction_time_ms INTEGER,
    
    -- Metadata
    category TEXT,
    tags JSONB DEFAULT '[]',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for feature extraction pipelines
CREATE INDEX IF NOT EXISTS feature_pipe_org_idx ON feature_extraction_pipelines(organization_id);
CREATE INDEX IF NOT EXISTS feature_pipe_active_idx ON feature_extraction_pipelines(is_active);
CREATE INDEX IF NOT EXISTS feature_pipe_category_idx ON feature_extraction_pipelines(category);

-- Add comments for documentation
COMMENT ON COLUMN calculation_nodes.model_id IS 'Reference to ML model used for inference';
COMMENT ON COLUMN calculation_nodes.model_version IS 'Model version for A/B testing';
COMMENT ON COLUMN calculation_nodes.model_type IS 'Type of ML model (REGRESSION, CLASSIFICATION, CLUSTERING, ANOMALY_DETECTION)';
COMMENT ON COLUMN calculation_nodes.feature_config IS 'Feature extraction configuration and transformations';
COMMENT ON COLUMN calculation_nodes.prediction_threshold IS 'Threshold for binary classification decisions';
COMMENT ON COLUMN calculation_nodes.confidence_threshold IS 'Minimum confidence for predictions';
COMMENT ON COLUMN calculation_nodes.ensemble_strategy IS 'Strategy for combining multiple model predictions';
COMMENT ON COLUMN calculation_nodes.anomaly_detection_method IS 'Method for anomaly detection (ISOLATION_FOREST, AUTOENCODER, STATISTICAL)';

COMMENT ON TABLE ml_model_versions IS 'Stores version information for ML models with performance metrics and deployment status';
COMMENT ON TABLE ml_inference_results IS 'Stores results from ML model inference with full prediction tracking';
COMMENT ON TABLE feature_extraction_pipelines IS 'Stores reusable feature extraction pipeline configurations';

-- Create a view for deployed models
CREATE OR REPLACE VIEW deployed_models AS
SELECT 
    organization_id,
    model_id,
    model_name,
    model_type,
    model_version,
    accuracy,
    "precision",
    recall,
    f1_score,
    deployment_date,
    is_default
FROM ml_model_versions
WHERE is_deployed = TRUE
ORDER BY deployment_date DESC;

COMMENT ON VIEW deployed_models IS 'Lists all currently deployed ML models with their performance metrics';

-- Create a view for ML inference summary
CREATE OR REPLACE VIEW ml_inference_summary AS
SELECT 
    calculation_node_id,
    organization_id,
    model_id,
    model_type,
    COUNT(*) as inference_count,
    AVG(inference_time_ms) as avg_inference_time_ms,
    AVG(prediction_score::DECIMAL) as avg_prediction_score,
    SUM(CASE WHEN is_anomaly = TRUE THEN 1 ELSE 0 END) as anomaly_count,
    MAX(executed_at) as last_inference_at
FROM ml_inference_results
GROUP BY calculation_node_id, organization_id, model_id, model_type;

COMMENT ON VIEW ml_inference_summary IS 'Provides summary statistics for ML model inferences';

-- Create a function to get model performance metrics
CREATE OR REPLACE FUNCTION get_model_performance_metrics(model_id_param TEXT, organization_id_param INTEGER)
RETURNS TABLE (
    model_version TEXT,
    accuracy DECIMAL(5, 4),
    "precision" DECIMAL(5, 4),
    recall DECIMAL(5, 4),
    f1_score DECIMAL(5, 4),
    mse DECIMAL(20, 10),
    is_deployed BOOLEAN,
    deployment_date TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        model_version,
        accuracy,
        "precision",
        recall,
        f1_score,
        mse,
        is_deployed,
        deployment_date
    FROM ml_model_versions
    WHERE model_id = model_id_param
    AND organization_id = organization_id_param
    ORDER BY deployment_date DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_model_performance_metrics IS 'Returns performance metrics for all versions of a model';

-- Create a function to deploy a model version
CREATE OR REPLACE FUNCTION deploy_model_version(model_id_param TEXT, model_version_param TEXT, organization_id_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    deployment_count INTEGER;
BEGIN
    -- Undeploy other versions of the same model
    UPDATE ml_model_versions
    SET is_deployed = FALSE, deployment_date = NULL
    WHERE model_id = model_id_param
    AND organization_id = organization_id_param;
    
    -- Deploy the specified version
    UPDATE ml_model_versions
    SET is_deployed = TRUE, deployment_date = NOW()
    WHERE model_id = model_id_param
    AND model_version = model_version_param
    AND organization_id = organization_id_param;
    
    GET DIAGNOSTICS deployment_count = ROW_COUNT;
    
    RETURN deployment_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deploy_model_version IS 'Deploys a specific model version and undeploys other versions';

-- Create a function to calculate feature hash for deduplication
CREATE OR REPLACE FUNCTION calculate_feature_hash(features JSONB)
RETURNS TEXT AS $$
BEGIN
    RETURN md5(features::TEXT);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_feature_hash IS 'Calculates MD5 hash of feature JSON for deduplication';

-- Create a function to get recent anomalies
CREATE OR REPLACE FUNCTION get_recent_anomalies(
    organization_id_param INTEGER,
    hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
    calculation_node_id INTEGER,
    model_id TEXT,
    anomaly_score DECIMAL(20, 10),
    features JSONB,
    executed_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        calculation_node_id,
        model_id,
        anomaly_score,
        features,
        executed_at
    FROM ml_inference_results
    WHERE organization_id = organization_id_param
    AND is_anomaly = TRUE
    AND executed_at > NOW() - (hours_back || ' hours')::INTERVAL
    ORDER BY anomaly_score DESC, executed_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_recent_anomalies IS 'Returns recent anomaly detections for monitoring and alerting';

-- Create a function to clean up old ML inference results
CREATE OR REPLACE FUNCTION cleanup_old_ml_inference_results(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ml_inference_results
    WHERE executed_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_ml_inference_results IS 'Removes ML inference results older than the specified retention period';

-- Create a trigger to automatically calculate feature hash
CREATE OR REPLACE FUNCTION auto_calculate_feature_hash()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.features IS NOT NULL THEN
        NEW.feature_hash = calculate_feature_hash(NEW.features);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for feature hash calculation
DROP TRIGGER IF EXISTS auto_feature_hash_trigger ON ml_inference_results;
CREATE TRIGGER auto_feature_hash_trigger
BEFORE INSERT ON ml_inference_results
FOR EACH ROW
EXECUTE FUNCTION auto_calculate_feature_hash();

COMMENT ON FUNCTION auto_calculate_feature_hash IS 'Automatically calculates feature hash for deduplication';
