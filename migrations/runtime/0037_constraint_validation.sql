-- Migration: Constraint & Rule Validation Features
-- Description: Adds support for rule validation, conditional logic gates, and policy enforcement
--              This extends the calculation system with business rule validation and compliance checking

-- Add constraint validation configuration columns to calculation_nodes table
ALTER TABLE calculation_nodes 
ADD COLUMN IF NOT EXISTS rule_definition JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS rule_type TEXT,
ADD COLUMN IF NOT EXISTS constraint_type TEXT,
ADD COLUMN IF NOT EXISTS constraint_parameters JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS enforcement_action TEXT,
ADD COLUMN IF NOT EXISTS gate_condition JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS compliance_threshold DECIMAL(3, 2);

-- Add constraints for validation columns
ALTER TABLE calculation_nodes 
ADD CONSTRAINT rule_type_valid CHECK (rule_type IS NULL OR rule_type IN ('VALIDATION', 'TRANSFORMATION', 'ENFORCEMENT', 'NOTIFICATION')),
ADD CONSTRAINT constraint_type_valid CHECK (constraint_type IS NULL OR constraint_type IN ('RANGE', 'EQUALITY', 'EXISTENCE', 'UNIQUE', 'CUSTOM')),
ADD CONSTRAINT enforcement_action_valid CHECK (enforcement_action IS NULL OR enforcement_action IN ('BLOCK', 'WARN', 'LOG', 'CORRECT')),
ADD CONSTRAINT compliance_threshold_valid CHECK (compliance_threshold IS NULL OR (compliance_threshold >= 0 AND compliance_threshold <= 1));

-- Create constraint validation results table
CREATE TABLE IF NOT EXISTS constraint_validation_results (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Validation metadata
    rule_type TEXT NOT NULL,
    constraint_type TEXT NOT NULL,
    
    -- Validation results
    passed BOOLEAN NOT NULL,
    compliance_score DECIMAL(5, 2),
    violations JSONB DEFAULT '[]',
    
    -- Enforcement action taken
    enforcement_action TEXT,
    action_taken TEXT,
    action_result TEXT,
    
    -- Context
    evaluated_at TIMESTAMP DEFAULT NOW(),
    triggered_by TEXT,
    triggered_by_node_id INTEGER,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for constraint validation results
CREATE INDEX IF NOT EXISTS constraint_calc_idx ON constraint_validation_results(calculation_node_id);
CREATE INDEX IF NOT EXISTS constraint_org_idx ON constraint_validation_results(organization_id);
CREATE INDEX IF NOT EXISTS constraint_passed_idx ON constraint_validation_results(passed);
CREATE INDEX IF NOT EXISTS constraint_evaluated_idx ON constraint_validation_results(evaluated_at);

-- Create rule definitions table
CREATE TABLE IF NOT EXISTS rule_definitions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Rule definition
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL,
    constraint_type TEXT NOT NULL,
    rule_logic JSONB NOT NULL,
    constraint_parameters JSONB DEFAULT '{}',
    
    -- Enforcement configuration
    enforcement_action TEXT DEFAULT 'WARN',
    severity TEXT DEFAULT 'MEDIUM',
    
    -- Versioning
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    category TEXT,
    tags JSONB DEFAULT '[]',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for rule definitions
CREATE INDEX IF NOT EXISTS rule_org_idx ON rule_definitions(organization_id);
CREATE INDEX IF NOT EXISTS rule_type_idx ON rule_definitions(rule_type);
CREATE INDEX IF NOT EXISTS rule_category_idx ON rule_definitions(category);
CREATE INDEX IF NOT EXISTS rule_active_idx ON rule_definitions(is_active);

-- Add comments for documentation
COMMENT ON COLUMN calculation_nodes.rule_definition IS 'Rule conditions and actions for validation';
COMMENT ON COLUMN calculation_nodes.rule_type IS 'Type of rule (VALIDATION, TRANSFORMATION, ENFORCEMENT, NOTIFICATION)';
COMMENT ON COLUMN calculation_nodes.constraint_type IS 'Type of constraint (RANGE, EQUALITY, EXISTENCE, UNIQUE, CUSTOM)';
COMMENT ON COLUMN calculation_nodes.constraint_parameters IS 'Parameters for constraint validation (min, max, allowedValues, pattern)';
COMMENT ON COLUMN calculation_nodes.enforcement_action IS 'Action to take when constraint violated (BLOCK, WARN, LOG, CORRECT)';
COMMENT ON COLUMN calculation_nodes.gate_condition IS 'Condition for gate logic (if/then/else)';
COMMENT ON COLUMN calculation_nodes.compliance_threshold IS 'Compliance percentage threshold (0-1)';

COMMENT ON TABLE constraint_validation_results IS 'Stores results from rule validation and constraint checks with compliance tracking';
COMMENT ON TABLE rule_definitions IS 'Stores reusable rule definitions for centralized rule management and versioning';

-- Create a view for constraint validation summary
CREATE OR REPLACE VIEW constraint_validation_summary AS
SELECT 
    calculation_node_id,
    organization_id,
    COUNT(*) as validation_count,
    SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed_count,
    AVG(compliance_score::DECIMAL) as avg_compliance_score,
    MAX(evaluated_at) as last_validation_at,
    MIN(evaluated_at) as first_validation_at
FROM constraint_validation_results
GROUP BY calculation_node_id, organization_id;

COMMENT ON VIEW constraint_validation_summary IS 'Provides summary statistics for constraint validations across multiple runs';

-- Create a view for active rules by category
CREATE OR REPLACE VIEW active_rules_by_category AS
SELECT 
    organization_id,
    category,
    COUNT(*) as rule_count,
    COUNT(*) FILTER (WHERE is_active = TRUE) as active_count,
    STRING_AGG(name, ', ') as rule_names
FROM rule_definitions
GROUP BY organization_id, category;

COMMENT ON VIEW active_rules_by_category IS 'Lists active rules grouped by category for easy rule management';

-- Create a function to check if a value violates a constraint
CREATE OR REPLACE FUNCTION check_constraint_violation(
    constraint_type_param TEXT,
    value DECIMAL,
    constraint_parameters JSONB
)
RETURNS TABLE (
    violated BOOLEAN,
    violation_type TEXT,
    violation_details JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN constraint_type_param = 'RANGE' THEN 
                (value < (constraint_parameters->>'min')::DECIMAL OR value > (constraint_parameters->>'max')::DECIMAL)
            WHEN constraint_type_param = 'EQUALITY' THEN 
                value != (constraint_parameters->>'expectedValue')::DECIMAL
            ELSE FALSE
        END as violated,
        constraint_type_param as violation_type,
        constraint_parameters as violation_details;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_constraint_violation IS 'Checks if a value violates a given constraint type with specified parameters';

-- Create a function to calculate overall compliance score
CREATE OR REPLACE FUNCTION calculate_compliance_score(calculation_node_id_param INTEGER)
RETURNS DECIMAL(5, 2) AS $$
DECLARE
    score DECIMAL(5, 2);
BEGIN
    SELECT AVG(compliance_score::DECIMAL)
    INTO score
    FROM constraint_validation_results
    WHERE calculation_node_id = calculation_node_id_param
    AND evaluated_at > NOW() - INTERVAL '30 days';
    
    RETURN COALESCE(score, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_compliance_score IS 'Calculates the average compliance score for a calculation over the last 30 days';

-- Create a function to get recent violations
CREATE OR REPLACE FUNCTION get_recent_violations(
    organization_id_param INTEGER,
    days_back INTEGER DEFAULT 7
)
RETURNS TABLE (
    calculation_node_id INTEGER,
    rule_type TEXT,
    constraint_type TEXT,
    violation_count INTEGER,
    last_violation_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        calculation_node_id,
        rule_type,
        constraint_type,
        COUNT(*) as violation_count,
        MAX(evaluated_at) as last_violation_at
    FROM constraint_validation_results
    WHERE organization_id = organization_id_param
    AND passed = FALSE
    AND evaluated_at > NOW() - (days_back || ' days')::INTERVAL
    GROUP BY calculation_node_id, rule_type, constraint_type
    ORDER BY last_violation_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_recent_violations IS 'Returns recent constraint violations for monitoring and alerting';

-- Create a function to create a rule definition from a calculation
CREATE OR REPLACE FUNCTION promote_calculation_to_rule(calculation_node_id_param INTEGER)
RETURNS INTEGER AS $$
DECLARE
    rule_id INTEGER;
    calc_record RECORD;
BEGIN
    -- Get the calculation record
    SELECT * INTO calc_record
    FROM calculation_nodes
    WHERE id = calculation_node_id_param;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Calculation % not found', calculation_node_id_param;
    END IF;
    
    -- Create rule definition
    INSERT INTO rule_definitions (
        organization_id,
        name,
        description,
        rule_type,
        constraint_type,
        rule_logic,
        constraint_parameters,
        enforcement_action,
        created_by
    ) VALUES (
        calc_record.organization_id,
        calc_record.name || ' Rule',
        calc_record.description,
        calc_record.rule_type,
        calc_record.constraint_type,
        calc_record.rule_definition,
        calc_record.constraint_parameters,
        calc_record.enforcement_action,
        calc_record.created_by
    )
    RETURNING id INTO rule_id;
    
    RETURN rule_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION promote_calculation_to_rule IS 'Promotes a calculation node to a reusable rule definition';

-- Create a trigger to automatically log constraint violations
CREATE OR REPLACE FUNCTION log_constraint_violation()
RETURNS TRIGGER AS $$
BEGIN
    -- If validation failed and enforcement action is WARN or BLOCK, log it
    IF NEW.passed = FALSE AND NEW.enforcement_action IN ('WARN', 'BLOCK') THEN
        INSERT INTO calculation_execution_logs (calculation_node_id, organization_id, status, inputs, result, executed_at)
        VALUES (
            NEW.calculation_node_id,
            NEW.organization_id,
            'ERROR',
            jsonb_build_object('trigger', 'constraint_violation', 'violations', NEW.violations),
            NULL,
            NEW.evaluated_at
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for constraint violation logging
DROP TRIGGER IF EXISTS log_constraint_violation_trigger ON constraint_validation_results;
CREATE TRIGGER log_constraint_violation_trigger
AFTER INSERT ON constraint_validation_results
FOR EACH ROW
EXECUTE FUNCTION log_constraint_violation();

COMMENT ON FUNCTION log_constraint_violation IS 'Automatically logs constraint violations to execution logs for monitoring';
