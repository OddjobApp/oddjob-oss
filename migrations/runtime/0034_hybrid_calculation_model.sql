-- Migration: Hybrid Calculation Model (Option #3)
-- Description: Extends the calculation system to support edge-based inputs and variable nodes
--              This builds on Option #1 by adding computational edge relations while maintaining
--              backward compatibility with the existing calculation_dependencies table

-- Note: PostgreSQL enums are immutable, so we can't directly add to knowledgeEdgeRelationEnum.
-- The application layer already supports the new relation types, so this migration focuses on
-- ensuring the database can handle the hybrid model without breaking existing functionality.

-- Add comments to document the new computational edge relations
-- These relations are already supported in the application layer (knowledgeEdgeRelationEnum)
COMMENT ON COLUMN knowledge_edges.relation IS '
Standardized relationship types including:
- Hierarchical: PART_OF, MEMBER_OF, CONTAINED_IN
- Functional: RELIES_ON, PROVIDED_BY, TRIGGERS
- Causal: CAUSES, ENABLES, PRECEDED_BY
- Behavioral: INTRODUCED, IMPLEMENTS, SUPPORTS, DOCUMENTS, VERIFIES
- Association: ABOUT, OWNED_BY, ASSIGNED_TO, MENTIONS, MENTIONS_ISSUE
- Semantic: SAME_AS, IS_A, REPORTS_TO
- Computational (Hybrid Model): COMPUTES, AGGREGATES, TRANSFORMS, WEIGHTS_BY, INPUT_TO
- Legacy: RELATED_TO
';

-- Create an index for INPUT_TO edges to support efficient hybrid model queries
-- This improves performance when finding calculations that depend on specific nodes
CREATE INDEX IF NOT EXISTS edge_input_to_target_idx ON knowledge_edges(target_id, relation)
WHERE relation = 'INPUT_TO';

CREATE INDEX IF NOT EXISTS edge_input_to_source_idx ON knowledge_edges(source_id, relation)
WHERE relation = 'INPUT_TO';

-- Create indexes for other computational edge relations
CREATE INDEX IF NOT EXISTS edge_computes_target_idx ON knowledge_edges(target_id, relation)
WHERE relation = 'COMPUTES';

CREATE INDEX IF NOT EXISTS edge_aggregates_target_idx ON knowledge_edges(target_id, relation)
WHERE relation = 'AGGREGATES';

CREATE INDEX IF NOT EXISTS edge_transforms_target_idx ON knowledge_edges(target_id, relation)
WHERE relation = 'TRANSFORMS';

-- Add a check constraint to ensure computational edges are used correctly
-- This is optional but helps maintain data integrity for the hybrid model
ALTER TABLE knowledge_edges 
ADD CONSTRAINT computational_edge_valid_check 
CHECK (
    relation NOT IN ('INPUT_TO', 'COMPUTES', 'AGGREGATES', 'TRANSFORMS', 'WEIGHTS_BY') 
    OR (
        -- INPUT_TO: Variable/Input -> Calculation
        (relation = 'INPUT_TO' AND source_id != target_id) OR
        -- COMPUTES: Calculation -> Result
        (relation = 'COMPUTES' AND source_id != target_id) OR
        -- AGGREGATES: Collection -> Summary
        (relation = 'AGGREGATES' AND source_id != target_id) OR
        -- TRANSFORMS: Value -> Converted value
        (relation = 'TRANSFORMS' AND source_id != target_id) OR
        -- WEIGHTS_BY: Node -> Factor
        (relation = 'WEIGHTS_BY' AND source_id != target_id)
    )
);

-- Create a view to help visualize calculation dependencies in the hybrid model
-- This view combines legacy calculation_dependencies with edge-based INPUT_TO relations
CREATE OR REPLACE VIEW calculation_dependencies_view AS
SELECT 
    cd.id as dependency_id,
    cd.calculation_node_id,
    cd.depends_on_node_id as input_node_id,
    cd.variable_name,
    cd.required as is_required,
    cd.created_at,
    'legacy' as source_type
FROM calculation_dependencies cd

UNION ALL

SELECT 
    ke.id as dependency_id,
    cn.id as calculation_node_id,
    ke.source_id as input_node_id,
    (ke.data->>'variableName') as variable_name,
    true as is_required, -- Edge-based inputs are always required
    ke.created_at,
    'edge' as source_type
FROM knowledge_edges ke
JOIN calculation_nodes cn ON cn.node_id = ke.target_id
WHERE ke.relation = 'INPUT_TO';

COMMENT ON VIEW calculation_dependencies_view IS '
Unified view of calculation dependencies combining both legacy calculation_dependencies table
and edge-based INPUT_TO relations. This supports the hybrid model where calculations can use
either approach for defining their inputs.
';

-- Add a function to help migrate legacy calculations to the edge-based model
-- This is optional and provides a migration path for users who want to adopt the hybrid model
CREATE OR REPLACE FUNCTION migrate_calculation_to_edges(calculation_id_param INTEGER)
RETURNS TABLE(edge_id INTEGER, input_node_id INTEGER, variable_name TEXT) AS $$
DECLARE
    calc_record RECORD;
    dep_record RECORD;
    new_edge_id INTEGER;
BEGIN
    -- Get the calculation record
    SELECT * INTO calc_record 
    FROM calculation_nodes 
    WHERE id = calculation_id_param;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Calculation % not found', calculation_id_param;
    END IF;
    
    -- For each legacy dependency, create an INPUT_TO edge
    FOR dep_record IN 
        SELECT depends_on_node_id, variable_name 
        FROM calculation_dependencies 
        WHERE calculation_node_id = calculation_id_param
    LOOP
        -- Check if edge already exists
        SELECT id INTO new_edge_id
        FROM knowledge_edges
        WHERE source_id = dep_record.depends_on_node_id 
        AND target_id = calc_record.node_id 
        AND relation = 'INPUT_TO';
        
        IF new_edge_id IS NULL THEN
            -- Create the edge
            INSERT INTO knowledge_edges (source_id, target_id, relation, organization_id, data, created_at)
            VALUES (
                dep_record.depends_on_node_id,
                calc_record.node_id,
                'INPUT_TO',
                calc_record.organization_id,
                jsonb_build_object('variableName', dep_record.variable_name),
                NOW()
            )
            RETURNING id INTO new_edge_id;
        END IF;
        
        RETURN QUERY SELECT new_edge_id, dep_record.depends_on_node_id, dep_record.variable_name;
    END LOOP;
    
    -- Optionally delete the legacy dependencies after successful migration
    -- DELETE FROM calculation_dependencies WHERE calculation_node_id = calculation_id_param;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION migrate_calculation_to_edges IS '
Migrates a calculation from the legacy inputReferences approach to the edge-based INPUT_TO approach.
This function creates INPUT_TO edges for each existing dependency while preserving the original data.
After verification, users can optionally delete the legacy calculation_dependencies records.
';

-- Create a function to validate calculation integrity in the hybrid model
CREATE OR REPLACE FUNCTION validate_calculation_integrity(calculation_id_param INTEGER)
RETURNS TABLE(
    has_inputs BOOLEAN,
    input_count INTEGER,
    legacy_count INTEGER,
    edge_count INTEGER,
    is_valid BOOLEAN,
    validation_message TEXT
) AS $$
DECLARE
    calc_record RECORD;
    legacy_count INTEGER;
    edge_count INTEGER;
    total_inputs INTEGER;
BEGIN
    -- Get the calculation record
    SELECT * INTO calc_record 
    FROM calculation_nodes 
    WHERE id = calculation_id_param;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0, 0, 0, false, 'Calculation not found'::TEXT;
        RETURN;
    END IF;
    
    -- Count legacy dependencies
    SELECT COUNT(*) INTO legacy_count
    FROM calculation_dependencies
    WHERE calculation_node_id = calculation_id_param;
    
    -- Count edge-based inputs
    SELECT COUNT(*) INTO edge_count
    FROM knowledge_edges
    WHERE target_id = calc_record.node_id 
    AND relation = 'INPUT_TO';
    
    total_inputs := legacy_count + edge_count;
    
    -- Validate
    IF total_inputs = 0 THEN
        RETURN QUERY SELECT false, 0, legacy_count, edge_count, false, 
            'Calculation has no inputs defined'::TEXT;
    ELSIF legacy_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT true, total_inputs, legacy_count, edge_count, true, 
            'Calculation uses both legacy and edge-based inputs (hybrid mode)'::TEXT;
    ELSIF edge_count > 0 THEN
        RETURN QUERY SELECT true, total_inputs, legacy_count, edge_count, true, 
            'Calculation uses edge-based inputs (Option #3)'::TEXT;
    ELSE
        RETURN QUERY SELECT true, total_inputs, legacy_count, edge_count, true, 
            'Calculation uses legacy inputs (Option #1)'::TEXT;
    END IF;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_calculation_integrity IS '
Validates the integrity of a calculation in the hybrid model, checking for inputs
and reporting whether it uses legacy dependencies, edge-based inputs, or both.
This helps users understand which calculation model their calculations are using.
';
