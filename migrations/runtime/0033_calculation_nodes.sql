-- Migration: Calculation Nodes for Neuro-Symbolic Graph
-- Description: Adds support for mathematical calculations as nodes in the knowledge graph
--              This is a non-breaking addition that creates new tables without modifying existing ones

-- Calculation Nodes Table
-- Stores metadata for calculation nodes. The actual node data is stored in knowledge_nodes
-- with label matching one of the calculation node label types.
CREATE TABLE IF NOT EXISTS calculation_nodes (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
    
    -- Calculation definition
    operation TEXT NOT NULL, -- CalculationOperation (ADD, SUBTRACT, MULTIPLY, DIVIDE, SUM, AVERAGE, etc.)
    formula TEXT NOT NULL, -- Human-readable formula
    formula_compiled JSONB DEFAULT '{}', -- Parsed/compiled formula structure
    
    -- Input references
    input_references JSONB DEFAULT '[]', -- Array of { nodeId, variable, alias }
    
    -- Output configuration
    output_unit TEXT, -- Unit for the result (%, $, etc.)
    output_precision INTEGER DEFAULT 2, -- Decimal places
    
    -- Caching and performance
    cached_result DECIMAL(20, 10),
    last_calculated_at TIMESTAMP,
    cache_ttl_seconds INTEGER DEFAULT 300, -- 5 minutes default
    
    -- Status and validation
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, DISABLED, ERROR
    validation_error TEXT,
    
    -- Metadata
    description TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT calculation_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ERROR'))
);

-- Indexes for calculation_nodes
CREATE INDEX IF NOT EXISTS calc_node_node_idx ON calculation_nodes(node_id);
CREATE INDEX IF NOT EXISTS calc_node_org_idx ON calculation_nodes(organization_id);
CREATE INDEX IF NOT EXISTS calc_node_mission_idx ON calculation_nodes(mission_id);
CREATE INDEX IF NOT EXISTS calc_node_status_idx ON calculation_nodes(status);

-- Calculation Execution Logs Table
-- Tracks each calculation execution for debugging and auditing
CREATE TABLE IF NOT EXISTS calculation_execution_logs (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Execution details
    inputs JSONB NOT NULL DEFAULT '{}', -- Actual input values used
    result DECIMAL(20, 10),
    execution_time_ms INTEGER, -- Performance tracking
    
    -- Status
    status TEXT NOT NULL, -- SUCCESS, ERROR
    error_message TEXT,
    
    -- Context
    triggered_by TEXT, -- system, user, node_update
    triggered_by_node_id INTEGER,
    
    -- Timestamps
    executed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for calculation_execution_logs
CREATE INDEX IF NOT EXISTS calc_exec_calc_idx ON calculation_execution_logs(calculation_node_id);
CREATE INDEX IF NOT EXISTS calc_exec_org_idx ON calculation_execution_logs(organization_id);
CREATE INDEX IF NOT EXISTS calc_exec_status_idx ON calculation_execution_logs(status);
CREATE INDEX IF NOT EXISTS calc_exec_time_idx ON calculation_execution_logs(executed_at);

-- Calculation Dependencies Table
-- Tracks which calculations depend on which nodes for reactive updates
CREATE TABLE IF NOT EXISTS calculation_dependencies (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    depends_on_node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Dependency metadata
    variable_name TEXT NOT NULL, -- Variable name in formula
    required BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(calculation_node_id, depends_on_node_id)
);

-- Indexes for calculation_dependencies
CREATE INDEX IF NOT EXISTS calc_dep_calc_idx ON calculation_dependencies(calculation_node_id);
CREATE INDEX IF NOT EXISTS calc_dep_node_idx ON calculation_dependencies(depends_on_node_id);
CREATE INDEX IF NOT EXISTS calc_dep_org_idx ON calculation_dependencies(organization_id);

-- Add comments for documentation
COMMENT ON TABLE calculation_nodes IS 'Stores metadata for calculation nodes in the knowledge graph';
COMMENT ON TABLE calculation_execution_logs IS 'Tracks execution history of calculations for debugging and auditing';
COMMENT ON TABLE calculation_dependencies IS 'Tracks dependencies between calculations and knowledge nodes for reactive updates';

COMMENT ON COLUMN calculation_nodes.operation IS 'Type of mathematical operation (ADD, SUBTRACT, MULTIPLY, DIVIDE, SUM, AVERAGE, etc.)';
COMMENT ON COLUMN calculation_nodes.formula IS 'Human-readable mathematical formula';
COMMENT ON COLUMN calculation_nodes.cached_result IS 'Cached calculation result for performance';
COMMENT ON COLUMN calculation_nodes.cache_ttl_seconds IS 'Time-to-live for cached results in seconds';
COMMENT ON COLUMN calculation_dependencies.variable_name IS 'Variable name in the formula that this node provides';
