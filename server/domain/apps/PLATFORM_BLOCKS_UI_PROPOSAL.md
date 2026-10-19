# Platform Blocks UI Integration Proposal
## App Arsenal & App Configure Screens

**Date:** April 27, 2026  
**Status:** Proposed  
**Related:** MACH4_PLATFORM_BLOCKS_PROPOSAL.md (Phase 1 completed)

---

## Executive Summary

Platform Blocks are now built and the AI forge can use them. However, **human users cannot add them via the Interactive Builder** because:
1. The component palette doesn't list them
2. No configuration UI exists for their props (collection, agentId, etc.)
3. No way to pre-configure platform resource access

This proposal adds full Platform Block support to the App Arsenal/App Configure UI, enabling both AI and human-driven assembly.

---

## Current State Analysis

### What Exists Now

| Component | Location | Purpose |
|-----------|----------|---------|
| `AppMarketplace.tsx` | `apps/pages/` | Browse and install apps (Arsenal) |
| `AppDetail.tsx` | `apps/pages/` | App overview with tabs |
| `AppInteractiveBuilderTab.tsx` | `apps/components/tabs/` | Visual builder for editing apps |
| `AppHookupsTab.tsx` | `apps/components/tabs/` | Configure deployment settings |
| `COMPONENT_CONFIGS` | `AppInteractiveBuilderTab.tsx:113` | UI configurator registry |
| `UI_COMPONENT_GROUPS` | `AppInteractiveBuilderTab.tsx:75` | Component palette categories |

### The Gap

```
Current Flow:
User opens Interactive Builder → sees raw UI components (Card, Table, DataTable)
                         ↓
User wants CRUD table → has to manually configure DataTable + write fetch code
                         ↓
Result: Block assembly not available to humans

Target Flow:
User opens Interactive Builder → sees "Platform Blocks (Self-Wiring)" category
                         ↓
User drags PlatformDatasetTableBlock → config panel opens for collection/columns
                         ↓
Result: Zero-code platform integration
```

---

## Detailed Implementation Plan

### Phase 1: Component Palette Integration
**File:** `server/domain/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab.tsx`

#### 1.1 Add Platform Blocks Category

```typescript
// After line 84 (UI_COMPONENT_GROUPS)
const PLATFORM_BLOCK_GROUPS = [
  { 
    label: 'Platform Blocks (Self-Wiring)', 
    components: [
      'PlatformDatasetTableBlock', 
      'PlatformAgentChatBlock', 
      'PlatformMissionsBlock', 
      'PlatformMissionLogBlock', 
      'PlatformPipelineTriggerBlock'
    ],
    description: 'Pre-built components with automatic Oddjob platform integration'
  }
];
```

#### 1.2 Add Component Configurators

Each block needs a `COMPONENT_CONFIGS` entry defining:
- Configuration fields (inputs, toggles, selects)
- Validation rules
- Prompt builder function

**PlatformDatasetTableBlock Configurator:**

```typescript
PlatformDatasetTableBlock: {
  fields: [
    { 
      key: 'collection', 
      label: 'Dataset Collection', 
      type: 'text', 
      placeholder: 'e.g. contacts, orders, inventory',
      required: true,
      helpText: 'The Oddjob dataset collection name this table will manage'
    },
    { 
      key: 'title', 
      label: 'Table Title', 
      type: 'text', 
      placeholder: 'e.g. Customer Records',
      required: false
    },
    { 
      key: 'columnsJson', 
      label: 'Column Definitions (JSON)', 
      type: 'textarea', 
      placeholder: '[\n  {"key":"name","label":"Name","type":"text"},\n  {"key":"status","label":"Status","type":"badge"}\n]',
      required: true,
      helpText: 'Array of {key, label, type} objects. Types: text, badge, currency, date, number',
      rows: 6
    },
    { 
      key: 'allowCreate', 
      label: 'Allow Create', 
      type: 'toggle', 
      default: true,
      helpText: 'Show "New" button and create modal'
    },
    { 
      key: 'allowEdit', 
      label: 'Allow Edit', 
      type: 'toggle', 
      default: true,
      helpText: 'Show edit action on each row'
    },
    { 
      key: 'allowDelete', 
      label: 'Allow Delete', 
      type: 'toggle', 
      default: true,
      helpText: 'Show delete action on each row'
    },
    { 
      key: 'pageSize', 
      label: 'Page Size', 
      type: 'select',
      options: ['5', '10', '25', '50', '100'],
      default: '10'
    }
  ],
  buildPrompt: (cfg, file) => {
    const ctx = file ? `[Editing ${file}]\n\n` : '';
    const columns = cfg.columnsJson || '[{key:"id",label:"ID",type:"text"}]';
    const props = [
      `collection="${cfg.collection}"`,
      `columns={${columns}}`,
      cfg.title && `title="${cfg.title}"`,
      cfg.allowCreate !== 'false' && 'allowCreate={true}',
      cfg.allowEdit !== 'false' && 'allowEdit={true}',
      cfg.allowDelete !== 'false' && 'allowDelete={true}',
      cfg.pageSize && cfg.pageSize !== '10' && `pageSize={${cfg.pageSize}}`
    ].filter(Boolean).join(' ');
    
    return `${ctx}Add a PlatformDatasetTableBlock (${props}). This is a self-wiring CRUD table connected to the Oddjob platform. Import from "@domain-ui/packaged/PlatformDatasetTableBlock".`;
  }
}
```

**PlatformAgentChatBlock Configurator:**

```typescript
PlatformAgentChatBlock: {
  fields: [
    { 
      key: 'agentId', 
      label: 'Agent ID', 
      type: 'select', 
      required: true,
      optionsSource: 'agents', // Dynamic fetch from /api/agents
      helpText: 'The Oddjob agent to connect this chat to'
    },
    { 
      key: 'personaName', 
      label: 'Persona Name', 
      type: 'text', 
      placeholder: 'e.g. Support Assistant',
      default: 'AI Assistant'
    },
    { 
      key: 'suggestedPrompts', 
      label: 'Suggested Prompts', 
      type: 'textarea',
      placeholder: 'What are your hours?\nHow do I reset my password?',
      rows: 3,
      helpText: 'One per line - shown as quick-action buttons'
    },
    { 
      key: 'collectionName', 
      label: 'Message Persistence Dataset', 
      type: 'text',
      placeholder: 'e.g. chat_history',
      helpText: 'Optional - saves conversation history to this dataset'
    },
    { 
      key: 'height', 
      label: 'Height', 
      type: 'select',
      options: ['400px', '600px', '800px', '100%'],
      default: '600px'
    }
  ],
  buildPrompt: (cfg, file) => {
    const prompts = cfg.suggestedPrompts?.split('\n').filter(Boolean) || [];
    const props = [
      `agentId={${cfg.agentId}}`,
      cfg.personaName && `personaName="${cfg.personaName}"`,
      prompts.length > 0 && `suggestedPrompts={[${prompts.map(p => `"${p}"`).join(', ')}]}`,
      cfg.collectionName && `collectionName="${cfg.collectionName}"`,
      cfg.height && cfg.height !== '600px' && `height="${cfg.height}"`
    ].filter(Boolean).join(' ');
    
    return `${file ? `[Editing ${file}]\n\n` : ''}Add a PlatformAgentChatBlock (${props}). This is a self-wiring chat interface with SSE streaming. Import from "@domain-ui/packaged/PlatformAgentChatBlock".`;
  }
}
```

**PlatformMissionsBlock Configurator:**

```typescript
PlatformMissionsBlock: {
  fields: [
    { 
      key: 'title', 
      label: 'Title', 
      type: 'text', 
      default: 'Missions'
    },
    { 
      key: 'allowLaunch', 
      label: 'Allow Launch', 
      type: 'toggle', 
      default: false,
      helpText: 'Show "Launch Mission" button (requires mission:create permission)'
    },
    { 
      key: 'allowAbort', 
      label: 'Allow Abort', 
      type: 'toggle', 
      default: true,
      helpText: 'Show abort action on active missions'
    },
    { 
      key: 'pollingIntervalMs', 
      label: 'Poll Interval (ms)', 
      type: 'select',
      options: ['2000', '5000', '10000', '30000'],
      default: '5000',
      helpText: 'How often to refresh mission status'
    },
    { 
      key: 'enableLogLink', 
      label: 'Link to Log Viewer', 
      type: 'toggle', 
      default: true,
      helpText: 'Clicking a mission opens PlatformMissionLogBlock'
    }
  ],
  buildPrompt: (cfg, file) => {
    const ctx = file ? `[Editing ${file}]\n\n` : '';
    const props = [
      cfg.title && cfg.title !== 'Missions' && `title="${cfg.title}"`,
      cfg.allowLaunch === 'true' && 'allowLaunch={true}',
      cfg.allowAbort === 'false' && 'allowAbort={false}',
      cfg.pollingIntervalMs && cfg.pollingIntervalMs !== '5000' && `pollingIntervalMs={${cfg.pollingIntervalMs}}`,
      cfg.enableLogLink !== 'false' && 'onSelect={(id) => setActiveMissionId(id)}'
    ].filter(Boolean).join(' ');
    
    let code = `${ctx}Add a PlatformMissionsBlock${props ? ` (${props})` : ''}. `;
    if (cfg.enableLogLink !== 'false') {
      code += `Also add state: const [activeMissionId, setActiveMissionId] = useState<number|null>(null); and conditionally render PlatformMissionLogBlock when activeMissionId is set. `;
    }
    code += `Import from "@domain-ui/packaged/PlatformMissionsBlock".`;
    return code;
  }
}
```

**PlatformMissionLogBlock Configurator:**

```typescript
PlatformMissionLogBlock: {
  fields: [
    { 
      key: 'missionIdSource', 
      label: 'Mission ID Source', 
      type: 'select',
      options: ['From parent state', 'Fixed ID', 'From URL param'],
      default: 'From parent state',
      required: true
    },
    { 
      key: 'missionId', 
      label: 'Fixed Mission ID', 
      type: 'text',
      placeholder: 'e.g. 42',
      conditional: { field: 'missionIdSource', value: 'Fixed ID' }
    },
    { 
      key: 'title', 
      label: 'Title', 
      type: 'text', 
      default: 'Mission Log'
    },
    { 
      key: 'maxLines', 
      label: 'Max Lines', 
      type: 'select',
      options: ['100', '300', '500', '1000'],
      default: '300'
    },
    { 
      key: 'height', 
      label: 'Height', 
      type: 'select',
      options: ['300px', '400px', '600px', '100%'],
      default: '400px'
    }
  ],
  buildPrompt: (cfg, file) => {
    const ctx = file ? `[Editing ${file}]\n\n` : '';
    const missionId = cfg.missionIdSource === 'Fixed ID' 
      ? cfg.missionId 
      : cfg.missionIdSource === 'From URL param'
      ? 'Number(router.query.missionId)'
      : 'missionId';
    
    const props = [
      `missionId={${missionId}}`,
      cfg.title && cfg.title !== 'Mission Log' && `title="${cfg.title}"`,
      cfg.maxLines && cfg.maxLines !== '300' && `maxLines={${cfg.maxLines}}`,
      cfg.height && cfg.height !== '400px' && `height="${cfg.height}"`
    ].filter(Boolean).join(' ');
    
    return `${ctx}Add a PlatformMissionLogBlock (${props}). This displays live streaming logs from a mission run. Import from "@domain-ui/packaged/PlatformMissionLogBlock".`;
  }
}
```

**PlatformPipelineTriggerBlock Configurator:**

```typescript
PlatformPipelineTriggerBlock: {
  fields: [
    { 
      key: 'allowedPipelineIds', 
      label: 'Allowed Pipeline IDs', 
      type: 'multiselect',
      optionsSource: 'pipelines',
      helpText: 'Leave empty to show all available pipelines'
    },
    { 
      key: 'title', 
      label: 'Title', 
      type: 'text', 
      default: 'Pipeline Trigger'
    },
    { 
      key: 'showExecutionHistory', 
      label: 'Show Step History', 
      type: 'toggle', 
      default: true
    },
    { 
      key: 'onCompleteAction', 
      label: 'On Complete Action', 
      type: 'select',
      options: ['None', 'Refresh data', 'Navigate to page', 'Show toast'],
      default: 'None'
    }
  ],
  buildPrompt: (cfg, file) => {
    const ctx = file ? `[Editing ${file}]\n\n` : '';
    const ids = cfg.allowedPipelineIds?.length > 0 
      ? `allowedPipelineIds={[${cfg.allowedPipelineIds.join(', ')}]}` 
      : '';
    const props = [
      ids,
      cfg.title && cfg.title !== 'Pipeline Trigger' && `title="${cfg.title}"`,
      cfg.showExecutionHistory === 'false' && 'showExecutionHistory={false}'
    ].filter(Boolean).join(' ');
    
    return `${ctx}Add a PlatformPipelineTriggerBlock${props ? ` (${props})` : ''}. This provides a pipeline selector, trigger button, and real-time execution status. Import from "@domain-ui/packaged/PlatformPipelineTriggerBlock".`;
  }
}
```

---

### Phase 2: Platform Resource Selectors
**File:** `server/domain/apps/ui/modules/apps/components/tabs/AppHookupsTab.tsx`

#### 2.1 Add Platform Context Configuration Section

New card section after "Soul Configuration" (around line 180):

```typescript
// New section: Platform Resource Access
<Card className="border-border/40">
  <CardHeader className="pb-4">
    <div className="flex items-center gap-2">
      <Blocks className="w-5 h-5 text-primary" />
      <CardTitle className="text-lg font-bold">Platform Resource Access</CardTitle>
    </div>
    <CardDescription>
      Configure which Oddjob platform resources this app can access. Used to populate platformContext during forge.
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-6">
    
    {/* Datasets */}
    <div className="space-y-3">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <Database className="w-4 h-4 text-blue-400" />
        Allowed Datasets
      </Label>
      <MultiSelectDatasetPicker
        selected={form.allowedDatasetIds || []}
        onChange={(ids) => setForm({ ...form, allowedDatasetIds: ids })}
        placeholder="Select datasets this app can read/write..."
      />
      <p className="text-xs text-muted-foreground">
        These populate platformContext.allowedDatasetIds for the AI
      </p>
    </div>

    {/* Agents */}
    <div className="space-y-3">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <Bot className="w-4 h-4 text-amber-400" />
        Available Agents
      </Label>
      <MultiSelectAgentPicker
        selected={form.allowedAgentIds || []}
        onChange={(ids) => setForm({ ...form, allowedAgentIds: ids })}
        placeholder="Select agents for chat blocks..."
      />
    </div>

    {/* Pipelines */}
    <div className="space-y-3">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <Workflow className="w-4 h-4 text-emerald-400" />
        Allowed Pipelines
      </Label>
      <MultiSelectPipelinePicker
        selected={form.allowedPipelineIds || []}
        onChange={(ids) => setForm({ ...form, allowedPipelineIds: ids })}
        placeholder="Select pipelines this app can trigger..."
      />
    </div>

    {/* Default Collections */}
    <div className="space-y-3">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <Folder className="w-4 h-4 text-purple-400" />
        Default Dataset Collections
      </Label>
      <TagInput
        value={form.defaultCollections || []}
        onChange={(tags) => setForm({ ...form, defaultCollections: tags })}
        placeholder="Type collection name and press Enter..."
        suggestionSource="datasets" // Fetch existing collection names
      />
      <p className="text-xs text-muted-foreground">
        These populate platformContext.defaultCollections for PlatformDatasetTableBlock
      </p>
    </div>

  </CardContent>
</Card>
```

#### 2.2 New Picker Components Needed

Create `server/domain/apps/ui/components/pickers/`:

**MultiSelectDatasetPicker.tsx:**
```typescript
interface MultiSelectDatasetPickerProps {
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}

// Uses useQuery to fetch /api/datasets
// Renders searchable multi-select with dataset names + descriptions
// Shows "Create new dataset" option if none exist
```

**MultiSelectAgentPicker.tsx:**
```typescript
interface MultiSelectAgentPickerProps {
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}

// Uses useQuery to fetch /api/agents
// Renders agent cards with persona names
```

**MultiSelectPipelinePicker.tsx:**
```typescript
interface MultiSelectPipelinePickerProps {
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}

// Uses useQuery to fetch /api/pipelines
// Renders pipeline names with step counts
```

**TagInput.tsx:**
```typescript
interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestionSource?: 'datasets' | 'none';
}

// Freeform tag input with optional autocomplete from existing collections
// Used for defaultCollections (string names, not IDs)
```

---

### Phase 3: App Detail Integration
**File:** `server/domain/apps/ui/modules/apps/pages/AppDetail.tsx`

#### 3.1 Add "Platform Integrations" Tab

Add new tab between "analytics" and "intelligence" (around line 200):

```typescript
<TabsTrigger value="integrations" className="gap-2">
  <Blocks className="w-4 h-4" /> Platform
</TabsTrigger>
```

#### 3.2 Create AppIntegrationsTab Component

New file: `server/domain/apps/ui/modules/apps/components/tabs/AppIntegrationsTab.tsx`

```typescript
interface AppIntegrationsTabProps {
  appId: number;
  deployment: AppDeployment | null;
}

export function AppIntegrationsTab({ appId, deployment }: AppIntegrationsTabProps) {
  // Fetch app's platform block usage from deployment config
  const { data: config } = useQuery({
    queryKey: [`/api/apps/${appId}/platform-config`],
    queryFn: async () => {
      const res = await fetch(`/api/apps/${appId}/platform-config`);
      return res.json();
    }
  });

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Blocks className="w-5 h-5 text-primary" />
            Platform Block Usage
          </CardTitle>
          <CardDescription>
            Active platform integrations and their connection status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard 
              title="Dataset Tables" 
              value={config?.datasetTableCount || 0} 
              icon={Database}
              linked={config?.datasetStatus === 'connected'}
            />
            <StatCard 
              title="Agent Chats" 
              value={config?.agentChatCount || 0} 
              icon={Bot}
              linked={config?.agentStatus === 'connected'}
            />
            <StatCard 
              title="Mission Blocks" 
              value={config?.missionBlockCount || 0} 
              icon={Target}
              linked={config?.missionStatus === 'connected'}
            />
            <StatCard 
              title="Pipeline Triggers" 
              value={config?.pipelineBlockCount || 0} 
              icon={Workflow}
              linked={config?.pipelineStatus === 'connected'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Connections Detail */}
      <Card>
        <CardHeader>
          <CardTitle>Connected Resources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {/* Datasets */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" /> Datasets
            </h4>
            {deployment?.allowedDatasetIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {deployment.allowedDatasetIds.map(id => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    Dataset #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No datasets configured</p>
            )}
          </div>

          <Separator />

          {/* Agents */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-amber-400" /> Agents
            </h4>
            {deployment?.allowedAgentIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {deployment.allowedAgentIds.map(id => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    Agent #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No agents configured</p>
            )}
          </div>

          <Separator />

          {/* Pipelines */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Workflow className="w-4 h-4 text-emerald-400" /> Pipelines
            </h4>
            {deployment?.allowedPipelineIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {deployment.allowedPipelineIds.map(id => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    Pipeline #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No pipelines configured</p>
            )}
          </div>

          <Separator />

          {/* Default Collections */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Folder className="w-4 h-4 text-purple-400" /> Default Collections
            </h4>
            {deployment?.defaultCollections?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {deployment.defaultCollections.map(name => (
                  <Badge key={name} variant="outline" className="gap-1">
                    <Database className="w-3 h-3" />
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No default collections</p>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Health Check */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Connection Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformHealthCheck appId={appId} deployment={deployment} />
        </CardContent>
      </Card>
    </div>
  );
}
```

#### 3.3 Health Check Component

```typescript
function PlatformHealthCheck({ appId, deployment }: { appId: number; deployment: AppDeployment | null }) {
  const { data: health, isLoading } = useQuery({
    queryKey: [`/api/apps/${appId}/platform-health`],
    queryFn: async () => {
      const res = await fetch(`/api/apps/${appId}/platform-health`);
      return res.json();
    },
    refetchInterval: 30000
  });

  if (isLoading) return <Skeleton className="h-20" />;

  const checks = [
    { name: 'Dataset API', status: health?.datasets, icon: Database },
    { name: 'Agent API', status: health?.agents, icon: Bot },
    { name: 'Mission API', status: health?.missions, icon: Target },
    { name: 'Pipeline API', status: health?.pipelines, icon: Workflow },
  ];

  return (
    <div className="space-y-2">
      {checks.map(check => (
        <div key={check.name} className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <check.icon className={`w-4 h-4 ${check.status === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`} />
            <span className="text-sm">{check.name}</span>
          </div>
          <Badge variant={check.status === 'ok' ? 'default' : 'destructive'}>
            {check.status === 'ok' ? 'Connected' : check.status || 'Error'}
          </Badge>
        </div>
      ))}
    </div>
  );
}
```

---

### Phase 4: Backend API Updates

#### 4.1 Extend AppDeployment Schema

Add to `AppDeployment` type in `@shared/schema/apps`:

```typescript
interface AppDeployment {
  // ... existing fields ...
  
  // Platform Block Configuration
  allowedDatasetIds?: number[];
  allowedAgentIds?: number[];
  allowedPipelineIds?: number[];
  defaultCollections?: string[];
  
  // Usage Tracking (populated by forge analysis)
  platformBlockUsage?: {
    datasetTableCount: number;
    agentChatCount: number;
    missionBlockCount: number;
    missionLogBlockCount: number;
    pipelineBlockCount: number;
  };
}
```

#### 4.2 New API Endpoints

Add to `server/routes/apps.ts`:

```typescript
// GET /api/apps/:id/platform-config
// Returns parsed platformContext from deployment + block usage analysis

// GET /api/apps/:id/platform-health
// Pings each platform API to verify connectivity
// Returns: { datasets: 'ok'|'error', agents: 'ok'|'error', ... }
```

---

### Phase 5: Forge Context Integration

#### 5.1 Extend forge-context.service.ts

Ensure `platformContext` passed to AI includes new fields:

```typescript
interface ForgePlatformContext {
  // ... existing ...
  allowedDatasetIds: number[];
  allowedAgentIds: number[];
  allowedPipelineIds: number[];
  defaultCollections: string[];
}
```

#### 5.2 UI Context Sync

When `AppHookupsTab` saves configuration, it should:
1. Save to `AppDeployment` table
2. Invalidate scaffold cache for this app's blueprint
3. Trigger warm container refresh if running

---

## UI/UX Design Principles

### Visual Hierarchy

```
Interactive Builder Component Palette:
├── Layout
├── Data & Tables
├── Media
├── Maps & Location
├── Interactive
├── Inputs
├── Feedback
├── Design & Hifi
└── 🔶 Platform Blocks (Self-Wiring)  ← NEW: Highlighted section
    ├── PlatformDatasetTableBlock
    ├── PlatformAgentChatBlock
    ├── PlatformMissionsBlock
    ├── PlatformMissionLogBlock
    └── PlatformPipelineTriggerBlock
```

### Component Card Design

Each platform block in the palette should show:
- **Icon**: Representative icon (Database, Bot, Target, Terminal, Workflow)
- **Name**: Block name
- **Badge**: "Self-Wiring" or "Zero Code"
- **Hover tooltip**: Brief description of what it auto-connects to

### Configuration Panel Design

When a platform block is selected:
1. **Left side**: Live preview/mock of the component
2. **Right side**: Configuration form
3. **Bottom**: Generated code preview (read-only)
4. **Test Connection** button for validating resources exist

---

## Testing Strategy

### Unit Tests

**Test files to create:**
- `AppInteractiveBuilderTab.platform-blocks.test.tsx`
- `AppIntegrationsTab.test.tsx`
- `MultiSelectDatasetPicker.test.tsx`

**Key test cases:**
1. Component palette renders Platform Blocks category
2. Clicking PlatformDatasetTableBlock opens correct configurator
3. Configurator validates required fields (collection, columns)
4. BuildPrompt generates correct import statement
5. MultiSelect pickers fetch and display options

### Integration Tests

**Test file:** `app-forge-blueprints.test.ts` (existing)

**Add test:**
```typescript
test('forged app with PlatformDatasetTableBlock has correct wiring', async () => {
  // Forge an app requesting a CRUD table
  // Verify generated code uses PlatformDatasetTableBlock
  // Verify no manual fetch() code present
});
```

### E2E Tests

**Test file:** `AppArsenalPlatformBlocks.spec.ts`

**Scenarios:**
1. User creates new app → adds PlatformDatasetTableBlock → configures collection → forges → verifies working table
2. User opens existing app → switches to Interactive Builder → adds PlatformAgentChatBlock → selects agent → saves

---

## Implementation Phases

### Phase 1A: Palette Integration (2-3 hours)
- [ ] Add `UI_COMPONENT_GROUPS` entry
- [ ] Add `COMPONENT_CONFIGS` for all 5 blocks
- [ ] Add icons and styling

### Phase 1B: Pickers (4-6 hours)
- [ ] Create `MultiSelectDatasetPicker`
- [ ] Create `MultiSelectAgentPicker`
- [ ] Create `MultiSelectPipelinePicker`
- [ ] Create `TagInput`

### Phase 2: Hookups Tab (3-4 hours)
- [ ] Add Platform Resource Access section
- [ ] Wire up save/load for new fields
- [ ] Add validation

### Phase 3: App Detail Tab (4-5 hours)
- [ ] Create `AppIntegrationsTab`
- [ ] Add health check component
- [ ] Add new API endpoints
- [ ] Wire up to main tabs

### Phase 4: Backend (2-3 hours)
- [ ] Extend schema
- [ ] Add API endpoints
- [ ] Update forge-context.service.ts

### Phase 5: Testing (4-6 hours)
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests

**Total estimated effort:** 16-27 hours

---

## Success Metrics

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| Time to add CRUD table | 15+ min (manual fetch + state) | <2 min (drag + configure) | User testing |
| Lines of AI-generated code for CRUD | ~400 lines | ~40 lines | Forge output analysis |
| Human users using platform blocks | 0% | >50% of new tables | Analytics on COMPONENT_CONFIGS usage |
| Platform API errors in forged apps | ~15% | <5% | Error telemetry |

---

## Files to Create/Modify

| File | Action | Lines (est.) |
|------|--------|--------------|
| `AppInteractiveBuilderTab.tsx` | Modify | +150 |
| `AppHookupsTab.tsx` | Modify | +120 |
| `AppDetail.tsx` | Modify | +30 |
| `AppIntegrationsTab.tsx` | Create | ~250 |
| `MultiSelectDatasetPicker.tsx` | Create | ~80 |
| `MultiSelectAgentPicker.tsx` | Create | ~80 |
| `MultiSelectPipelinePicker.tsx` | Create | ~80 |
| `TagInput.tsx` | Create | ~60 |
| `apps.ts` routes | Modify | +40 |
| `@shared/schema/apps.ts` | Modify | +15 |
| `forge-context.service.ts` | Modify | +10 |

**Total:** ~915 lines of code

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI still writes manual fetch despite blocks | High | Stronger prompt enforcement; WOW validator penalizes manual fetch when block available |
| Platform APIs change, blocks break | Medium | Version blocks; health check alerts; automated tests against staging |
| Users don't understand block concept | Medium | In-app tooltips; video tutorial; "Why use this?" helper text |
| Performance: too many picker options | Low | Virtualization in pickers; search filtering; lazy loading |

---

## Appendix: Component Configurator JSON Schema

For documentation purposes, the `COMPONENT_CONFIGS` entries follow this structure:

```typescript
interface ComponentConfig {
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'toggle' | 'multiselect';
    required?: boolean;
    placeholder?: string;
    default?: string | boolean;
    options?: string[];
    optionsSource?: 'datasets' | 'agents' | 'pipelines';
    conditional?: { field: string; value: string };
    helpText?: string;
    rows?: number; // for textarea
  }>;
  buildPrompt: (config: Record<string, any>, editingFile: string | null) => string;
}
```

---

## Next Steps

1. **Review proposal** with stakeholders
2. **Prioritize phases** (recommend Phase 1A + 1B as MVP)
3. **Create design mocks** for configuration panels
4. **Begin implementation** with Phase 1A

**Ready to proceed?** Confirm which phases to implement and I'll begin immediately.
