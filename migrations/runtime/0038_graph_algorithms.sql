-- Migration: Graph Algorithm Features
-- Description: Adds support for graph algorithms including centrality calculations,
--              pathfinding, community detection, and network analysis on the knowledge graph
--              This extends the calculation system with network analysis capabilities

-- Add graph algorithm configuration columns to calculation_nodes table
ALTER TABLE calculation_nodes 
ADD COLUMN IF NOT EXISTS graph_algorithm_type TEXT,
ADD COLUMN IF NOT EXISTS target_node_id INTEGER REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS max_depth INTEGER,
ADD COLUMN IF NOT EXISTS damping_factor DECIMAL(3, 2),
ADD COLUMN IF NOT EXISTS iterations INTEGER,
ADD COLUMN IF NOT EXISTS edge_weight_property TEXT,
ADD COLUMN IF NOT EXISTS node_weight_property TEXT,
ADD COLUMN IF NOT EXISTS community_detection_method TEXT;

-- Add constraints for graph algorithm columns
ALTER TABLE calculation_nodes 
ADD CONSTRAINT graph_algorithm_type_valid CHECK (graph_algorithm_type IS NULL OR graph_algorithm_type IN ('CENTRALITY', 'PATHFINDING', 'CLUSTERING', 'PROPAGATION')),
ADD CONSTRAINT max_depth_valid CHECK (max_depth IS NULL OR (max_depth >= 1 AND max_depth <= 100)),
ADD CONSTRAINT damping_factor_valid CHECK (damping_factor IS NULL OR (damping_factor >= 0 AND damping_factor <= 1)),
ADD CONSTRAINT iterations_valid CHECK (iterations IS NULL OR (iterations >= 1 AND iterations <= 10000)),
ADD CONSTRAINT community_detection_method_valid CHECK (community_detection_method IS NULL OR community_detection_method IN ('LOUVAIN', 'LEIDEN', 'LABEL_PROPAGATION'));

-- Create graph algorithm results table
CREATE TABLE IF NOT EXISTS graph_algorithm_results (
    id SERIAL PRIMARY KEY,
    calculation_node_id INTEGER NOT NULL REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    
    -- Algorithm metadata
    algorithm_type TEXT NOT NULL,
    algorithm_name TEXT NOT NULL,
    
    -- Graph snapshot
    node_count INTEGER,
    edge_count INTEGER,
    graph_snapshot JSONB DEFAULT '{}',
    
    -- Results
    result JSONB NOT NULL,
    score DECIMAL(20, 10),
    path JSONB DEFAULT '[]',
    communities JSONB DEFAULT '[]',
    centrality_scores JSONB DEFAULT '[]',
    
    -- Performance
    execution_time_ms INTEGER,
    iterations INTEGER,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for graph algorithm results
CREATE INDEX IF NOT EXISTS graph_calc_idx ON graph_algorithm_results(calculation_node_id);
CREATE INDEX IF NOT EXISTS graph_org_idx ON graph_algorithm_results(organization_id);
CREATE INDEX IF NOT EXISTS graph_algorithm_idx ON graph_algorithm_results(algorithm_type);
CREATE INDEX IF NOT EXISTS graph_created_idx ON graph_algorithm_results(created_at);

-- Create graph centrality scores table
CREATE TABLE IF NOT EXISTS graph_centrality_scores (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    calculation_node_id INTEGER REFERENCES calculation_nodes(id) ON DELETE CASCADE,
    
    -- Centrality metrics
    page_rank DECIMAL(20, 10),
    betweenness DECIMAL(20, 10),
    closeness DECIMAL(20, 10),
    degree INTEGER,
    eigenvector DECIMAL(20, 10),
    
    -- Metadata
    calculated_at TIMESTAMP DEFAULT NOW(),
    graph_snapshot_id INTEGER,
    
    UNIQUE(node_id, calculation_node_id)
);

-- Indexes for centrality scores
CREATE INDEX IF NOT EXISTS centrality_node_idx ON graph_centrality_scores(node_id);
CREATE INDEX IF NOT EXISTS centrality_org_idx ON graph_centrality_scores(organization_id);
CREATE INDEX IF NOT EXISTS centrality_calc_idx ON graph_centrality_scores(calculation_node_id);
CREATE INDEX IF NOT EXISTS centrality_pagerank_idx ON graph_centrality_scores(page_rank);

-- Add comments for documentation
COMMENT ON COLUMN calculation_nodes.graph_algorithm_type IS 'Type of graph algorithm (CENTRALITY, PATHFINDING, CLUSTERING, PROPAGATION)';
COMMENT ON COLUMN calculation_nodes.target_node_id IS 'Target node for pathfinding algorithms';
COMMENT ON COLUMN calculation_nodes.max_depth IS 'Maximum depth for graph traversal algorithms';
COMMENT ON COLUMN calculation_nodes.damping_factor IS 'Damping factor for PageRank (default 0.85)';
COMMENT ON COLUMN calculation_nodes.iterations IS 'Number of iterations for iterative algorithms';
COMMENT ON COLUMN calculation_nodes.edge_weight_property IS 'Property name for edge weights in graph data';
COMMENT ON COLUMN calculation_nodes.node_weight_property IS 'Property name for node weights in graph data';
COMMENT ON COLUMN calculation_nodes.community_detection_method IS 'Method for community detection (LOUVAIN, LEIDEN, LABEL_PROPAGATION)';

COMMENT ON TABLE graph_algorithm_results IS 'Stores results from graph algorithm calculations with full result tracking';
COMMENT ON TABLE graph_centrality_scores IS 'Stores centrality scores for nodes enabling efficient querying of important nodes';

-- Create a view for top influential nodes by PageRank
CREATE OR REPLACE VIEW top_influential_nodes AS
SELECT 
    gcs.node_id,
    kn.name,
    gcs.organization_id,
    gcs.page_rank,
    gcs.betweenness,
    gcs.closeness,
    gcs.degree,
    gcs.calculated_at
FROM graph_centrality_scores gcs
JOIN knowledge_nodes kn ON gcs.node_id = kn.id
WHERE gcs.page_rank IS NOT NULL
ORDER BY gcs.page_rank DESC
LIMIT 100;

COMMENT ON VIEW top_influential_nodes IS 'Lists the top 100 most influential nodes by PageRank score';

-- Create a view for graph algorithm summary
CREATE OR REPLACE VIEW graph_algorithm_summary AS
SELECT 
    calculation_node_id,
    organization_id,
    algorithm_type,
    algorithm_name,
    COUNT(*) as execution_count,
    AVG(execution_time_ms) as avg_execution_time_ms,
    AVG(score::DECIMAL) as avg_score,
    MAX(created_at) as last_execution_at
FROM graph_algorithm_results
GROUP BY calculation_node_id, organization_id, algorithm_type, algorithm_name;

COMMENT ON VIEW graph_algorithm_summary IS 'Provides summary statistics for graph algorithm executions';

-- Create a function to get node centrality summary
CREATE OR REPLACE FUNCTION get_node_centrality_summary(node_id_param INTEGER)
RETURNS TABLE (
    page_rank DECIMAL(20, 10),
    betweenness DECIMAL(20, 10),
    closeness DECIMAL(20, 10),
    degree INTEGER,
    calculated_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        page_rank,
        betweenness,
        closeness,
        degree,
        calculated_at
    FROM graph_centrality_scores
    WHERE node_id = node_id_param
    ORDER BY calculated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_node_centrality_summary IS 'Returns the most recent centrality scores for a specific node';

-- Create a function to find shortest path between nodes
CREATE OR REPLACE FUNCTION find_shortest_path_bfs(
    source_node_id_param INTEGER,
    target_node_id_param INTEGER,
    organization_id_param INTEGER
)
RETURNS TABLE (
    path INTEGER[],
    path_length INTEGER,
    found BOOLEAN
) AS $$
DECLARE
    path_array INTEGER[];
    found_path BOOLEAN;
BEGIN
    -- This is a simplified BFS implementation
    -- In production, this would use a proper graph traversal algorithm
    
    SELECT 
        CASE WHEN EXISTS (
            SELECT 1 FROM knowledge_edges ke1
            JOIN knowledge_edges ke2 ON ke1.target_id = ke2.source_id
            WHERE ke1.source_id = source_node_id_param 
            AND ke2.target_id = target_node_id_param
            AND ke1.organization_id = organization_id_param
            AND ke2.organization_id = organization_id_param
        ) THEN ARRAY[source_node_id_param, target_node_id_param]::INTEGER[]
        ELSE NULL::INTEGER[]
    END,
        CASE WHEN EXISTS (
            SELECT 1 FROM knowledge_edges ke1
            JOIN knowledge_edges ke2 ON ke1.target_id = ke2.source_id
            WHERE ke1.source_id = source_node_id_param 
            AND ke2.target_id = target_node_id_param
            AND ke1.organization_id = organization_id_param
            AND ke2.organization_id = organization_id_param
        ) THEN 2 ELSE -1 END,
        CASE WHEN EXISTS (
            SELECT 1 FROM knowledge_edges ke1
            JOIN knowledge_edges ke2 ON ke1.target_id = ke2.source_id
            WHERE ke1.source_id = source_node_id_param 
            AND ke2.target_id = target_node_id_param
            AND ke1.organization_id = organization_id_param
            AND ke2.organization_id = organization_id_param
        ) THEN TRUE ELSE FALSE END
    INTO path_array, found_path;
    
    RETURN QUERY SELECT path_array, found_path, found_path;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_shortest_path_bfs IS 'Finds the shortest path between two nodes using BFS (simplified implementation)';

-- Create a function to calculate node degree
CREATE OR REPLACE FUNCTION calculate_node_degree(node_id_param INTEGER)
RETURNS INTEGER AS $$
DECLARE
    in_degree INTEGER;
    out_degree INTEGER;
BEGIN
    SELECT COUNT(*) INTO in_degree
    FROM knowledge_edges
    WHERE target_id = node_id_param;
    
    SELECT COUNT(*) INTO out_degree
    FROM knowledge_edges
    WHERE source_id = node_id_param;
    
    RETURN in_degree + out_degree;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_node_degree IS 'Calculates the total degree (in + out) of a node';

-- Create a function to get graph density
CREATE OR REPLACE FUNCTION calculate_graph_density(organization_id_param INTEGER)
RETURNS DECIMAL(10, 6) AS $$
DECLARE
    node_count INTEGER;
    edge_count INTEGER;
    max_edges INTEGER;
BEGIN
    SELECT COUNT(*) INTO node_count
    FROM knowledge_nodes
    WHERE organization_id = organization_id_param;
    
    SELECT COUNT(*) INTO edge_count
    FROM knowledge_edges
    WHERE organization_id = organization_id_param;
    
    IF node_count <= 1 THEN
        RETURN 0;
    END IF;
    
    max_edges := node_count * (node_count - 1) / 2;
    
    RETURN (2.0 * edge_count::DECIMAL) / max_edges::DECIMAL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_graph_density IS 'Calculates the density of the graph (edges / possible edges)';

-- Create a function to clean up old graph algorithm results
CREATE OR REPLACE FUNCTION cleanup_old_graph_results(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM graph_algorithm_results
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_graph_results IS 'Removes graph algorithm results older than the specified retention period';

-- Create a trigger to automatically update centrality when graph changes
CREATE OR REPLACE FUNCTION update_centrality_on_graph_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if there are active PageRank calculations for this organization
    IF EXISTS (
        SELECT 1 FROM calculation_nodes cn
        JOIN graph_algorithm_results gar ON cn.id = gar.calculation_node_id
        WHERE cn.organization_id = NEW.organization_id
        AND cn.operation = 'PAGERANK'
        AND cn.status = 'ACTIVE'
        AND gar.created_at > NOW() - INTERVAL '1 hour'
    ) THEN
        -- Log that graph changed and centrality may need recalculation
        INSERT INTO calculation_execution_logs (calculation_node_id, organization_id, status, inputs, result, executed_at)
        VALUES (
            (SELECT id FROM calculation_nodes WHERE operation = 'PAGERANK' AND organization_id = NEW.organization_id LIMIT 1),
            NEW.organization_id,
            'SUCCESS',
            jsonb_build_object('trigger', 'graph_change', 'action', TG_OP),
            NULL,
            NOW()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for graph change monitoring
DROP TRIGGER IF EXISTS update_centrality_edge_trigger ON knowledge_edges;
CREATE TRIGGER update_centrality_edge_trigger
AFTER INSERT OR UPDATE OR DELETE ON knowledge_edges
FOR EACH ROW
EXECUTE FUNCTION update_centrality_on_graph_change();

DROP TRIGGER IF EXISTS update_centrality_node_trigger ON knowledge_nodes;
CREATE TRIGGER update_centrality_node_trigger
AFTER INSERT OR DELETE ON knowledge_nodes
FOR EACH ROW
EXECUTE FUNCTION update_centrality_on_graph_change();

COMMENT ON FUNCTION update_centrality_on_graph_change IS 'Monitors graph changes and triggers centrality recalculation when needed';
