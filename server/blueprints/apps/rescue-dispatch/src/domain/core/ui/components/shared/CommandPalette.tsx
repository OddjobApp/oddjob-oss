/**
 * CommandPalette Component
 * 
 * A command palette for quick navigation and actions (Cmd+K / Ctrl+K).
 * Provides fuzzy search across pages, jobs, pipelines, and common actions.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@domain-ui/core/ui/components/ui/command";
import {
    Briefcase,
    GitBranch,
    Calendar,
    Settings,
    Home,
    Inbox,
    Plus,
    Play,
    Search,
    Bot,
    Brain,
    Network,
    ClipboardList,
    Database,
    FlaskConical,
    Hammer,
    History,
    Shield,
    Activity,
    AlertTriangle,
    Bell,
    Zap,
    BarChart3,
    DollarSign,
    TrendingUp,
    Wrench,
    Key,
    PlugZap,
    Server,
    FileSearch,
    HeartPulse,
    Monitor,
    Radio,
    Camera,
    BookMarked,
    Users as UsersIcon
} from "lucide-react";

// Format keyboard shortcut for display
function formatShortcut(shortcut: { ctrl?: boolean; key: string }): string {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
    const parts: string[] = [];
    if (shortcut.ctrl) {
        parts.push(isMac ? '⌘' : 'Ctrl');
    }
    if (shortcut.key) {
        const keyDisplay = shortcut.key === 'Escape' ? 'Esc' : shortcut.key.toUpperCase();
        parts.push(keyDisplay);
    }
    return parts.join(isMac ? '' : '+');
}

interface CommandItem {
    id: string;
    name: string;
    category: string;
    icon: any;
    action: () => void;
    shortcut?: string;
    keywords?: string[];
}

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
    const [, navigate] = useLocation();
    const [search, setSearch] = useState("");

    // Fetch jobs and pipelines for quick access
    const { data: jobsData } = useQuery<{ items: any[], total: number }>({
        queryKey: ['/api/jobs'],
        queryFn: async () => {
            const res = await fetch('/api/jobs', { credentials: 'include' });
            if (!res.ok) return { items: [], total: 0 };
            return res.json();
        },
        enabled: open,
    });
    const jobs = jobsData?.items || [];

    const { data: pipelines } = useQuery<any[]>({
        queryKey: ['/api/pipelines'],
        queryFn: async () => {
            const res = await fetch('/api/pipelines', { credentials: 'include' });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: open,
    });

    // Run action and close palette
    const runAction = useCallback((action: () => void) => {
        action();
        onOpenChange(false);
        setSearch("");
    }, [onOpenChange]);

    // Navigation commands
    const navigationCommands: CommandItem[] = useMemo(() => [
        {
            id: 'nav-home',
            name: 'Go to Dashboard',
            category: 'Navigation',
            icon: Home,
            action: () => navigate('/'),
            shortcut: formatShortcut({ ctrl: true, key: 'h' }),
            keywords: ['home', 'dashboard', 'main']
        },
        {
            id: 'nav-operations',
            name: 'Go to Operations',
            category: 'Navigation',
            icon: Briefcase,
            action: () => navigate('/operations'),
            shortcut: formatShortcut({ ctrl: true, key: 'j' }),
            keywords: ['operations', 'missions', 'agents', 'workstreams', 'schedules']
        },
        {
            id: 'nav-pipelines',
            name: 'Go to Workstreams',
            category: 'Navigation',
            icon: GitBranch,
            action: () => navigate('/operations/workstreams'),
            shortcut: formatShortcut({ ctrl: true, key: 'p' }),
            keywords: ['pipelines', 'workstreams', 'workflow', 'automation']
        },
        {
            id: 'nav-schedules',
            name: 'Go to Schedules',
            category: 'Navigation',
            icon: Calendar,
            action: () => navigate('/operations/schedules'),
            keywords: ['schedules', 'cron', 'recurring']
        },
        {
            id: 'nav-control',
            name: 'Go to Control',
            category: 'Navigation',
            icon: Shield,
            action: () => navigate('/control'),
            keywords: ['control', 'governance', 'policies', 'approvals', 'decisions']
        },
        {
            id: 'nav-decisions',
            name: 'Go to Decision Inbox',
            category: 'Navigation',
            icon: Inbox,
            action: () => navigate('/control/decisions'),
            keywords: ['approvals', 'decisions', 'hil', 'review']
        },
        {
            id: 'nav-policies',
            name: 'Go to Policies',
            category: 'Navigation',
            icon: Shield,
            action: () => navigate('/control/policies'),
            keywords: ['governance', 'policies', 'rules', 'controls']
        },
        {
            id: 'nav-simulator',
            name: 'Go to Policy Simulator',
            category: 'Navigation',
            icon: Play,
            action: () => navigate('/control/simulator'),
            keywords: ['governance', 'simulation', 'policy', 'dry run']
        },
        {
            id: 'nav-knowledge',
            name: 'Go to Knowledge',
            category: 'Navigation',
            icon: Brain,
            action: () => navigate('/knowledge'),
            shortcut: formatShortcut({ ctrl: true, key: 'k' }),
            keywords: ['knowledge', 'graph', 'store', 'search', 'datasets', 'fine-tuning', 'schemas', 'documents', 'garden']
        },
        {
            id: 'nav-knowledge-graph',
            name: 'Explore Knowledge Graph',
            category: 'Navigation',
            icon: Network,
            action: () => navigate('/knowledge/graph'),
            keywords: ['knowledge', 'graph', 'explorer', 'entities', 'relationships']
        },
        {
            id: 'nav-knowledge-search',
            name: 'Search Knowledge',
            category: 'Navigation',
            icon: Search,
            action: () => navigate('/knowledge/search'),
            keywords: ['knowledge', 'search', 'store', 'rag', 'documents']
        },
        {
            id: 'nav-datasets',
            name: 'Go to Knowledge Datasets',
            category: 'Navigation',
            icon: Database,
            action: () => navigate('/knowledge/datasets'),
            keywords: ['datasets', 'data repository', 'records', 'collections']
        },
        {
            id: 'nav-fine-tuning',
            name: 'Go to Fine-Tuning',
            category: 'Navigation',
            icon: FlaskConical,
            action: () => navigate('/knowledge/fine-tuning'),
            keywords: ['fine-tuning', 'training', 'datasets', 'examples']
        },
        {
            id: 'nav-insights',
            name: 'Go to Insights',
            category: 'Navigation',
            icon: BarChart3,
            action: () => navigate('/insights'),
            keywords: ['insights', 'analytics', 'roi', 'costs', 'tools', 'agents', 'scoring', 'prediction']
        },
        {
            id: 'nav-roi',
            name: 'Go to ROI & Value',
            category: 'Navigation',
            icon: TrendingUp,
            action: () => navigate('/insights/roi'),
            keywords: ['insights', 'roi', 'value', 'savings', 'analytics']
        },
        {
            id: 'nav-costs',
            name: 'Go to Cost Center',
            category: 'Navigation',
            icon: DollarSign,
            action: () => navigate('/insights/costs'),
            keywords: ['insights', 'costs', 'spend', 'budget', 'fiscal']
        },
        {
            id: 'nav-tool-analytics',
            name: 'Go to Tool Analytics',
            category: 'Navigation',
            icon: Wrench,
            action: () => navigate('/insights/tools'),
            keywords: ['insights', 'tool analytics', 'tool usage', 'capabilities']
        },
        {
            id: 'nav-agent-analytics',
            name: 'Go to Agent Analytics',
            category: 'Navigation',
            icon: Bot,
            action: () => navigate('/insights/agents'),
            keywords: ['insights', 'agent analytics', 'agent telemetry', 'performance']
        },
        {
            id: 'nav-scoring',
            name: 'Go to Scoring',
            category: 'Navigation',
            icon: Activity,
            action: () => navigate('/insights/scoring'),
            keywords: ['insights', 'scoring', 'behavioral', 'models', 'live scores']
        },
        {
            id: 'nav-prediction-intelligence',
            name: 'Open Prediction Intelligence',
            category: 'Navigation',
            icon: FlaskConical,
            action: () => navigate('/insights/prediction'),
            keywords: ['insights', 'prediction', 'predictive', 'advanced', 'experimental']
        },
        {
            id: 'nav-apps-forge',
            name: 'Go to Apps & Forge',
            category: 'Navigation',
            icon: Hammer,
            action: () => navigate('/armory'),
            keywords: ['apps', 'forge', 'app arsenal', 'app forge', 'intelligence forge', 'org forge', 'forms', 'history', 'settings']
        },
        {
            id: 'nav-account-admin',
            name: 'Go to Account & Admin',
            category: 'Navigation',
            icon: Shield,
            action: () => navigate('/account-admin'),
            keywords: ['account', 'admin', 'tenant', 'organization', 'users', 'billing', 'licensing']
        },
        {
            id: 'nav-account-organizations',
            name: 'Go to Organizations',
            category: 'Navigation',
            icon: Briefcase,
            action: () => navigate('/account-admin/organizations'),
            keywords: ['account', 'admin', 'organizations', 'tenant']
        },
        {
            id: 'nav-account-users',
            name: 'Go to Users',
            category: 'Navigation',
            icon: UsersIcon,
            action: () => navigate('/account-admin/users'),
            keywords: ['account', 'admin', 'users', 'people', 'members']
        },
        {
            id: 'nav-account-billing',
            name: 'Go to Billing',
            category: 'Navigation',
            icon: DollarSign,
            action: () => navigate('/account-admin/billing'),
            keywords: ['account', 'admin', 'billing', 'subscription', 'plan']
        },
        {
            id: 'nav-account-licensing',
            name: 'Go to Licensing',
            category: 'Navigation',
            icon: Zap,
            action: () => navigate('/account-admin/licensing'),
            keywords: ['account', 'admin', 'licensing', 'license', 'entitlements']
        },
        {
            id: 'nav-platform-maintenance',
            name: 'Go to Platform Maintenance',
            category: 'Navigation',
            icon: Activity,
            action: () => navigate('/platform-maintenance'),
            keywords: ['platform', 'maintenance', 'snapshots', 'documentation', 'software audit', 'evolution', 'autoresearch', 'system graph']
        },
        {
            id: 'nav-maintenance-snapshots',
            name: 'Go to Snapshots',
            category: 'Navigation',
            icon: Camera,
            action: () => navigate('/platform-maintenance/snapshots'),
            keywords: ['platform', 'maintenance', 'snapshots', 'versions', 'recovery']
        },
        {
            id: 'nav-maintenance-documentation',
            name: 'Go to Documentation',
            category: 'Navigation',
            icon: BookMarked,
            action: () => navigate('/platform-maintenance/documentation'),
            keywords: ['platform', 'maintenance', 'documentation', 'docs', 'coverage']
        },
        {
            id: 'nav-maintenance-software-audit',
            name: 'Go to Software Audit',
            category: 'Navigation',
            icon: Shield,
            action: () => navigate('/platform-maintenance/software-audit'),
            keywords: ['platform', 'maintenance', 'software audit', 'dependencies', 'security']
        },
        {
            id: 'nav-maintenance-evolution',
            name: 'Go to System Evolution',
            category: 'Navigation',
            icon: Activity,
            action: () => navigate('/platform-maintenance/evolution'),
            keywords: ['platform', 'maintenance', 'system evolution', 'evolution', 'rollouts']
        },
        {
            id: 'nav-maintenance-autoresearch',
            name: 'Go to Autoresearch',
            category: 'Navigation',
            icon: TrendingUp,
            action: () => navigate('/platform-maintenance/autoresearch'),
            keywords: ['platform', 'maintenance', 'autoresearch', 'research', 'shadow experiments']
        },
        {
            id: 'nav-maintenance-system-graph',
            name: 'Go to System Graph',
            category: 'Navigation',
            icon: Network,
            action: () => navigate('/platform-maintenance/system-graph'),
            keywords: ['platform', 'maintenance', 'system graph', 'architecture', 'topology']
        },
        {
            id: 'nav-app-arsenal',
            name: 'Go to App Arsenal',
            category: 'Navigation',
            icon: Bot,
            action: () => navigate('/armory/apps'),
            keywords: ['apps', 'arsenal', 'marketplace', 'deployments']
        },
        {
            id: 'nav-forge-studio',
            name: 'Open Forge Studio',
            category: 'Navigation',
            icon: Hammer,
            action: () => navigate('/armory/forge'),
            keywords: ['forge', 'app forge', 'intelligence forge', 'builder']
        },
        {
            id: 'nav-org-forge',
            name: 'Go to Org Forge',
            category: 'Navigation',
            icon: Shield,
            action: () => navigate('/armory/org-forge'),
            keywords: ['org forge', 'organization', 'blueprint', 'soul']
        },
        {
            id: 'nav-forms',
            name: 'Go to Forms',
            category: 'Navigation',
            icon: ClipboardList,
            action: () => navigate('/armory/forms'),
            keywords: ['forms', 'hil', 'human input', 'approvals']
        },
        {
            id: 'nav-forge-history',
            name: 'Go to Forge History',
            category: 'Navigation',
            icon: History,
            action: () => navigate('/armory/forge/history'),
            keywords: ['forge', 'history', 'runs', 'jobs']
        },
        {
            id: 'nav-forge-settings',
            name: 'Go to Forge Settings',
            category: 'Navigation',
            icon: Settings,
            action: () => navigate('/armory/forge/settings'),
            keywords: ['forge', 'settings', 'configuration']
        },
        {
            id: 'nav-health',
            name: 'Go to Health',
            category: 'Navigation',
            icon: HeartPulse,
            action: () => navigate('/health'),
            keywords: ['health', 'observability', 'monitoring', 'alerts', 'events', 'pulse', 'incidents', 'infra']
        },
        {
            id: 'nav-observability',
            name: 'Go to Observability',
            category: 'Navigation',
            icon: Activity,
            action: () => navigate('/health/observability'),
            keywords: ['health', 'observability', 'telemetry', 'traces', 'status']
        },
        {
            id: 'nav-monitoring',
            name: 'Go to Monitoring',
            category: 'Navigation',
            icon: Monitor,
            action: () => navigate('/health/monitoring'),
            keywords: ['health', 'monitoring', 'executions', 'logs', 'metrics']
        },
        {
            id: 'nav-alerts',
            name: 'Go to Alerts',
            category: 'Navigation',
            icon: Bell,
            action: () => navigate('/health/alerts'),
            keywords: ['health', 'alerts', 'notifications', 'thresholds', 'attention']
        },
        {
            id: 'nav-events',
            name: 'Go to Events',
            category: 'Navigation',
            icon: FileSearch,
            action: () => navigate('/health/events'),
            keywords: ['health', 'events', 'event log', 'stream', 'diagnostics']
        },
        {
            id: 'nav-pulse',
            name: 'Go to Pulse',
            category: 'Navigation',
            icon: Radio,
            action: () => navigate('/health/pulse'),
            keywords: ['health', 'pulse', 'live activity', 'behavior', 'signals']
        },
        {
            id: 'nav-incidents',
            name: 'Go to Incidents',
            category: 'Navigation',
            icon: AlertTriangle,
            action: () => navigate('/health/incidents'),
            keywords: ['health', 'incidents', 'diagnoses', 'failures', 'broken']
        },
        {
            id: 'nav-infra-health',
            name: 'Go to Infra Health',
            category: 'Navigation',
            icon: Server,
            action: () => navigate('/health/infra-health'),
            keywords: ['health', 'infra health', 'infrastructure', 'services', 'availability']
        },
        {
            id: 'nav-connections',
            name: 'Go to Connections',
            category: 'Navigation',
            icon: Network,
            action: () => navigate('/connections'),
            keywords: ['connections', 'integrations', 'credentials', 'secrets', 'tokens', 'oauth', 'saas', 'mcp']
        },
        {
            id: 'nav-credentials',
            name: 'Go to Credentials',
            category: 'Navigation',
            icon: Key,
            action: () => navigate('/connections/credentials'),
            keywords: ['connections', 'credentials', 'api keys', 'secrets']
        },
        {
            id: 'nav-integrations',
            name: 'Go to Integrations',
            category: 'Navigation',
            icon: Wrench,
            action: () => navigate('/connections/integrations'),
            keywords: ['connections', 'integrations', 'oauth', 'external systems']
        },
        {
            id: 'nav-mcp-tokens',
            name: 'Go to MCP Tokens',
            category: 'Navigation',
            icon: Server,
            action: () => navigate('/connections/mcp-tokens'),
            keywords: ['connections', 'mcp', 'tokens', 'access']
        },
        {
            id: 'nav-saas-connectors',
            name: 'Go to SaaS Connectors',
            category: 'Navigation',
            icon: PlugZap,
            action: () => navigate('/connections/saas'),
            keywords: ['connections', 'saas', 'connectors', 'sync', 'jira', 'confluence', 'slack']
        },
        {
            id: 'nav-settings',
            name: 'Go to Settings',
            category: 'Navigation',
            icon: Settings,
            action: () => navigate('/profile'),
            keywords: ['settings', 'profile', 'preferences']
        },
    ], [navigate]);

    // Quick action commands
    const actionCommands: CommandItem[] = useMemo(() => [
        {
            id: 'action-new-job',
            name: 'Create New Agent',
            category: 'Actions',
            icon: Plus,
            action: () => navigate('/operations/agents/new'),
            shortcut: formatShortcut({ ctrl: true, key: 'n' }),
            keywords: ['new', 'create', 'agent', 'job', 'add']
        },
        {
            id: 'action-new-pipeline',
            name: 'Create New Workstream',
            category: 'Actions',
            icon: GitBranch,
            action: () => navigate('/operations/workstreams/new'),
            keywords: ['new', 'create', 'pipeline', 'workstream', 'workflow']
        },
        {
            id: 'action-new-credential',
            name: 'Add New Credential',
            category: 'Actions',
            icon: Key,
            action: () => navigate('/connections/credentials/new'),
            keywords: ['new', 'create', 'credential', 'api key', 'secret', 'connections']
        },
    ], [navigate]);

    // Dynamic job commands (top 10 jobs)
    const jobCommands: CommandItem[] = useMemo(() => {
        if (!jobs) return [];
        return jobs.slice(0, 10).map(job => ({
            id: `job-${job.id}`,
            name: job.name,
            category: 'Agents',
            icon: Zap,
            action: () => navigate(`/operations/agents/${job.id}`),
            keywords: [job.type, job.name.toLowerCase()]
        }));
    }, [jobs, navigate]);

    // Dynamic pipeline commands (top 10 pipelines)
    const pipelineCommands: CommandItem[] = useMemo(() => {
        if (!pipelines) return [];
        return pipelines.slice(0, 10).map(pipeline => ({
            id: `pipeline-${pipeline.id}`,
            name: pipeline.name,
            category: 'Workstreams',
            icon: GitBranch,
            action: () => navigate(`/operations/workstreams/${pipeline.id}`),
            keywords: [pipeline.name.toLowerCase(), pipeline.triggerType]
        }));
    }, [pipelines, navigate]);

    // Reset search when palette closes
    useEffect(() => {
        if (!open) {
            setSearch("");
        }
    }, [open]);

    return (
        <CommandDialog open={open} onOpenChange={onOpenChange}>
            <CommandInput
                placeholder="Search pages, apps, forge, knowledge, control, agents, or actions..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>

                {/* Actions Group */}
                <CommandGroup heading="Quick Actions">
                    {actionCommands.map((cmd) => (
                        <CommandItem
                            key={cmd.id}
                            value={`${cmd.name} ${cmd.keywords?.join(' ') || ''}`}
                            onSelect={() => runAction(cmd.action)}
                        >
                            <cmd.icon className="mr-2 h-4 w-4" />
                            <span>{cmd.name}</span>
                            {cmd.shortcut && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                    {cmd.shortcut}
                                </span>
                            )}
                        </CommandItem>
                    ))}
                </CommandGroup>

                <CommandSeparator />

                {/* Navigation Group */}
                <CommandGroup heading="Navigation">
                    {navigationCommands.map((cmd) => (
                        <CommandItem
                            key={cmd.id}
                            value={`${cmd.name} ${cmd.keywords?.join(' ') || ''}`}
                            onSelect={() => runAction(cmd.action)}
                        >
                            <cmd.icon className="mr-2 h-4 w-4" />
                            <span>{cmd.name}</span>
                            {cmd.shortcut && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                    {cmd.shortcut}
                                </span>
                            )}
                        </CommandItem>
                    ))}
                </CommandGroup>

                {/* Agents Group */}
                {jobCommands.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Recent Agents">
                            {jobCommands.map((cmd) => (
                                <CommandItem
                                    key={cmd.id}
                                    value={`${cmd.name} ${cmd.keywords?.join(' ') || ''}`}
                                    onSelect={() => runAction(cmd.action)}
                                >
                                    <cmd.icon className="mr-2 h-4 w-4" />
                                    <span>{cmd.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}

                {/* Workstreams Group */}
                {pipelineCommands.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Recent Workstreams">
                            {pipelineCommands.map((cmd) => (
                                <CommandItem
                                    key={cmd.id}
                                    value={`${cmd.name} ${cmd.keywords?.join(' ') || ''}`}
                                    onSelect={() => runAction(cmd.action)}
                                >
                                    <cmd.icon className="mr-2 h-4 w-4" />
                                    <span>{cmd.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </CommandDialog>
    );
}

export default CommandPalette;
