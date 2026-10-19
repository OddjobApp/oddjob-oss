-- Update App ID 43's slug to match the blueprint folder name on disk: 'rescue-dispatch'
UPDATE apps SET slug = 'rescue-dispatch', blueprint = 'rescue-dispatch' WHERE id = 43;

-- Ensure deployment #6 uses app_id 43 with public_slug 'rescue-dispatch'
UPDATE app_deployments 
SET app_id = 43, 
    public_slug = 'rescue-dispatch',
    status = 'active',
    is_published = true,
    allowed_pipeline_ids = ARRAY[19, 20, 21, 22, 23, 24]
WHERE id = 6 AND organization_id = 291;

-- Also publish the Rescue Dispatch Agent with access to the dispatch pipelines (19..24)
INSERT INTO agent_deployments (
  job_id,
  organization_id,
  slug,
  title,
  description,
  welcome_message,
  is_active,
  access_policy,
  allowed_pipeline_ids,
  allowed_tools,
  created_by,
  created_at,
  updated_at
) VALUES (
  22,
  291,
  'rescue-dispatcher',
  'Rescue Dispatch AI Coordinator',
  'Autonomous AI agent with direct access to execute, monitor, and manage the Rescue & Service Dispatch Pipelines.',
  'Welcome to Rescue Dispatch AI. I am ready to process emergency intake, match nearest field service providers, and execute the Service Dispatch Pipeline.',
  true,
  'public',
  ARRAY[19, 20, 21, 22, 23, 24],
  ARRAY['trigger_pipeline', 'get_pipeline_status', 'resolve_intent_to_pipeline', 'list_pipelines', 'list_jobs', 'search_unified_knowledge'],
  'system',
  NOW(),
  NOW()
) ON CONFLICT (job_id) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  welcome_message = EXCLUDED.welcome_message,
  allowed_pipeline_ids = EXCLUDED.allowed_pipeline_ids,
  allowed_tools = EXCLUDED.allowed_tools,
  is_active = true,
  access_policy = 'public',
  organization_id = 291,
  updated_at = NOW();

-- Activate the installed TECHHEAD7 cycle and keep the agent isolated to the
-- six Service Dispatch pipelines (unrelated QR flows must not enter routing).
UPDATE operational_cycles
SET status = 'active', updated_at = NOW()
WHERE id = 46 AND organization_id = 291 AND name = 'Service Dispatch Pipeline';

UPDATE agent_deployments
SET allowed_pipeline_ids = ARRAY[19, 20, 21, 22, 23, 24],
    allowed_tools = ARRAY['trigger_pipeline', 'get_pipeline_status', 'resolve_intent_to_pipeline', 'list_pipelines', 'show_pipeline_input_form', 'search_unified_knowledge'],
    is_active = true,
    access_policy = 'public',
    updated_at = NOW()
WHERE slug = 'rescue-dispatcher' AND organization_id = 291;

UPDATE pipelines
SET is_active = true,
    trigger_type = CASE id
      WHEN 19 THEN 'webhook'
      WHEN 23 THEN 'event'
      ELSE 'event'
    END
WHERE organization_id = 291 AND id = ANY(ARRAY[19, 20, 21, 22, 23, 24]);

-- Run the installed mission steps as deterministic rescue actions. This makes
-- pipeline execution fast, idempotent, and auditable instead of repeating a
-- generic AI-agent prompt for every step.
UPDATE pipeline_steps
SET module_type = 'tool',
    tool_name = 'rescue_dispatch_action',
    updated_at = NOW()
WHERE pipeline_id = ANY(ARRAY[19, 20, 21, 22, 23, 24]);
