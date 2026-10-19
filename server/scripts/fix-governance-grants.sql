-- 1. Insert explicit ALLOW permission grants for all dispatch tools & wildcards across all dispatch identities
INSERT INTO agent_permission_grants (
  organization_id,
  agent_identity_id,
  tool,
  action,
  resource,
  effect,
  requires_approval,
  created_by
)
SELECT 
  291,
  id,
  '*',
  '*',
  '*',
  'allow',
  false,
  'system-grant-fix'
FROM agent_identities
WHERE id IN (
  '2941af00-c2f4-4f70-be28-38263bae7d65',
  '5f572554-c967-4401-8c1a-052a0e43850f',
  '52f5f88c-ebdb-40d9-b372-08540c3ccc77',
  '424ed1bc-4db8-4388-87f1-556efa71aff7',
  '77ba41f1-c563-4800-a6ce-821ba98e80fc'
)
ON CONFLICT DO NOTHING;

-- 2. Also grant specific tool actions
INSERT INTO agent_permission_grants (organization_id, agent_identity_id, tool, action, resource, effect, requires_approval, created_by)
SELECT 291, '2941af00-c2f4-4f70-be28-38263bae7d65', t, '*', '*', 'allow', false, 'system-grant-fix'
FROM unnest(ARRAY['show_pipeline_input_form', 'show_hil_form', 'trigger_pipeline', 'get_pipeline_status', 'list_pipelines', 'list_jobs', 'resolve_intent_to_pipeline', 'search_unified_knowledge', 'dataset_query', 'dataset_write', 'geo_discovery', 'app_provision', 'sla_timer', 'slack_post_message']) AS t
ON CONFLICT DO NOTHING;

-- 3. Clear allowed_tools restriction on agent_deployments so it inherits full system toolset
UPDATE agent_deployments 
SET allowed_tools = NULL,
    updated_at = NOW()
WHERE slug = 'rescue-dispatcher';
