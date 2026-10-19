/** Adapter dependencies declared from the workbench API clients or manifest, not its title. */
export interface CrewSelectedRecordHint {
  collection: string;
  recordId: string;
}

export interface CrewAppSurface {
  title: string;
  blueprint: string;
  path: string;
  selectedRecord?: CrewSelectedRecordHint | null;
}

export interface SurfaceManifestHint {
  integration_dependencies?: string[];
  workbench_modules?: Array<{
    id: string;
    integration_dependencies?: string[];
  }>;
}

const STANDALONE_BLUEPRINT_ADAPTERS: Record<string, string[] | Record<string, string[]>> = {
  'it-ticketing-portal': [],
  'support-agent-dashboard': {
    default: [],
    'kb-editor': ['confluence'],
  },
  'pm-workbench': ['jira', 'confluence'],
  'qa-workbench': [],
  'scrum-master-workbench': ['jira'],
  'stakeholder-workbench': ['confluence', 'slack'],
  'ai-workforce-dashboard': ['slack'],
  'devops-workbench': [],
  'ops-workbench': [],
  'agent-training-workbench': [],
  'codegen-pipeline-workbench': [],
  'compliance-sentinel': [],
  'mission-supervisor': [],
  'budgetmaster-workbench': [],
  'budgetmaster-advisor': [],
  'sales-opportunity-workbench': [],
  'location-search': [],
  'rescue-dispatch': [],
  'wayfare': [],
  'analytics-dashboard': [],
  'industrial-dashboard': [],
  'crud-app': [],
  'chat-assistant': [],
  'chat-assistant-v2': [],
  'vendor-management': ['confluence'],
  'procurement-management': ['slack'],
  'research-workbench': {
    default: [],
    'decision-gate': ['confluence'],
    'backlog-provisioner': ['jira'],
  },
  'product-launch-workbench': {
    default: [],
    'market-research-workbench': ['confluence'],
    'content-studio': ['confluence'],
    'sales-enablement-hub': ['confluence', 'slack'],
    'feedback-insights': ['jira', 'confluence'],
  },
};

const SDLC_ROUTE_CONTRACTS: Record<string, string[]> = {
  'pm-workbench': ['jira', 'confluence'],
  'qa-workbench': [],
  'scrum-master-workbench': ['jira'],
  'stakeholder-workbench': ['confluence', 'slack'],
  'ai-workforce-dashboard': ['slack'],
  'devops-workbench': [],
  'vsm-dashboard': [],
  'sprint-zero': [],
};

export function surfaceAdapters(surface: CrewAppSurface, manifest?: SurfaceManifestHint | null): string[] | null {
  const cleanPath = surface.path.split(/[?#]/)[0];
  const segments = cleanPath.split('/').filter(Boolean);
  const route = segments.at(-1) ?? '';

  if (manifest) {
    if (Array.isArray(manifest.workbench_modules) && route) {
      const mod = manifest.workbench_modules.find((m) => m.id === route);
      if (mod) return mod.integration_dependencies ?? [];
    }
    if (Array.isArray(manifest.integration_dependencies)) {
      return manifest.integration_dependencies;
    }
  }

  const bp = surface.blueprint.trim().toLowerCase().replace(/-org\d+$/, '');

  if (bp in STANDALONE_BLUEPRINT_ADAPTERS) {
    const entry = STANDALONE_BLUEPRINT_ADAPTERS[bp];
    if (Array.isArray(entry)) return entry;
    if (route && route in entry) return entry[route];
    return entry.default ?? [];
  }

  if (!/sdlc/i.test(bp)) return null;
  if (route && route in SDLC_ROUTE_CONTRACTS) return SDLC_ROUTE_CONTRACTS[route];
  // The SDLC landing page uses internal fleet, decision and event APIs.
  if (segments.length === 2) return [];
  return null;
}
