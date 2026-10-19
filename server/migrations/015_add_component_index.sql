-- Component Index for Self-Assembler
-- Stores indexed UI components, patterns, code snippets, and blueprints
-- that the SDLC Code Assembly Engine queries during dynamic code generation.

CREATE TABLE IF NOT EXISTS component_index (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Component Identity & Classification
  component_name VARCHAR(255) NOT NULL UNIQUE,
  component_category VARCHAR(100) NOT NULL,
  export_type VARCHAR(50) NOT NULL DEFAULT 'named',
  package_source VARCHAR(255) NOT NULL,
  import_path VARCHAR(500) NOT NULL,
  
  -- Interface & AST Specification
  prop_schema JSONB DEFAULT '{}',
  dependencies JSONB DEFAULT '[]',
  code_snippet TEXT NOT NULL,
  blueprint_template TEXT,
  
  -- Quality & Assembly Telemetry
  effectiveness_score DECIMAL(3, 2) DEFAULT 5.00,
  verification_success_rate DECIMAL(5, 2) DEFAULT 100.00,
  total_assemble_count INTEGER DEFAULT 0,
  is_approved_for_assembly BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_comp_idx_name ON component_index(component_name);
CREATE INDEX idx_comp_idx_category ON component_index(component_category);
CREATE INDEX idx_comp_idx_org ON component_index(organization_id);
CREATE INDEX idx_comp_idx_effectiveness ON component_index(effectiveness_score);

-- Assembly Manifests Table
-- Stores frozen execution states compiled from ephemeral agent sessions
-- into deterministic solid-state specifications (antigravity.assembly.yaml).

CREATE TABLE IF NOT EXISTS assembly_manifests (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  assembly_id VARCHAR(255) NOT NULL UNIQUE,
  intent TEXT NOT NULL,
  author_agent VARCHAR(255) NOT NULL DEFAULT 'antigravity-supervisor-v1',
  
  -- Frozen State & Manifest Payload
  manifest_yaml TEXT NOT NULL,
  spec_payload JSONB NOT NULL,
  artifact_hashes JSONB DEFAULT '{}',
  
  -- Build & Deployment Telemetry
  build_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  docker_image_tag VARCHAR(255),
  endpoint_url VARCHAR(500),
  latency_p95_ms DECIMAL(7, 2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for assembly manifests
CREATE INDEX idx_asm_manifest_org ON assembly_manifests(organization_id);
CREATE INDEX idx_asm_manifest_id ON assembly_manifests(assembly_id);
CREATE INDEX idx_asm_manifest_status ON assembly_manifests(build_status);

-- Seed initial components from design system
INSERT INTO component_index (component_name, component_category, export_type, package_source, import_path, prop_schema, dependencies, code_snippet, effectiveness_score, verification_success_rate) VALUES
  ('MetricSummaryCard', 'ui-data-viz', 'named', '@oddjob/design-system', '@oddjob/design-system', 
   '{"title": "string", "value": "string | number", "change": "number", "trend": "up | down | neutral", "icon": "LucideIcon", "description": "string", "variant": "default | success | warning | danger | info", "className": "string"}',
   '["lucide-react"]',
   'import { MetricSummaryCard } from "@oddjob/design-system";\n\n<MetricSummaryCard\n  title="Assembly Throughput"\n  value="2,480 ops/s"\n  change={18.4}\n  trend="up"\n  variant="success"\n/>',
   5.00, 100.00
  ),
  ('PlatformAgentChatBlock', 'ui-ai-workflow', 'named', 'domain-ui/core', '@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock',
   '{"agentId": "number", "personaName": "string"}',
   '[]',
   'import PlatformAgentChatBlock from "@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock";\n\n<PlatformAgentChatBlock agentId={1} personaName="Supervisor Copilot" />',
   4.80, 98.50
  ),
  ('TacticalMap', 'ui-layout', 'named', 'domain-ui/rescue', '@domain/rescue/ui/modules/rescue/components/TacticalMap',
   '{"squads": "array", "rescues": "array", "providers": "array"}',
   '[]',
   'import TacticalMap from "@domain/rescue/ui/modules/rescue/components/TacticalMap";\n\n<TacticalMap squads={[]} rescues={[]} providers={[]} />',
   4.50, 95.00
  );
