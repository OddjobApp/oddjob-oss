import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { 
  Blocks, Database, Bot, Workflow, Folder, 
  CheckCircle2, XCircle, Activity, AlertCircle,
  Target, Terminal
} from 'lucide-react';
import type { AppDeployment } from "@shared/schema/apps";

interface AppIntegrationsTabProps {
  appId: number;
  deployment: AppDeployment | null;
}

interface PlatformHealth {
  datasets: 'ok' | 'error' | 'unknown';
  agents: 'ok' | 'error' | 'unknown';
  missions: 'ok' | 'error' | 'unknown';
  pipelines: 'ok' | 'error' | 'unknown';
}

interface PlatformBlockUsage {
  datasetTableCount: number;
  agentChatCount: number;
  missionBlockCount: number;
  missionLogBlockCount: number;
  pipelineBlockCount: number;
}

interface AppReadinessCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  severity: 'blocker' | 'warning' | 'info';
  message: string;
}

interface AppReadinessReport {
  ready: boolean;
  runtimeUrl?: string;
  checkedAt: string;
  summary: { pass: number; fail: number; warn: number; skip: number };
  checks: AppReadinessCheck[];
}

function StatCard({ title, value, icon: Icon, linked, color }: { 
  title: string; 
  value: number; 
  icon: React.ElementType; 
  linked: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-foreground/5 border border-foreground/10">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-5 h-5 text-foreground" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-foreground/40 uppercase tracking-wider">{title}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
      {linked ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
      ) : (
        <XCircle className="w-5 h-5 text-foreground/20" />
      )}
    </div>
  );
}

function AppReadinessGate({ appId }: { appId: number }) {
  const { data, isLoading } = useQuery<AppReadinessReport>({
    queryKey: [`/api/apps/${appId}/readiness`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/apps/${appId}/readiness`);
      if (!res.ok) throw new Error(`Failed to load readiness (${res.status})`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <Skeleton className="h-28 bg-foreground/5" />;
  }

  const visibleChecks = (data?.checks || []).filter(check => check.status === 'fail' || check.status === 'warn').slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {data?.ready ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          )}
          <div>
            <p className="text-sm font-medium">{data?.ready ? 'Ready' : 'Needs Attention'}</p>
            <p className="text-xs text-foreground/40">
              {data?.runtimeUrl || 'No runtime URL recorded'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge variant={data?.ready ? 'default' : 'destructive'} className="text-xs">
            {data?.summary.fail || 0} failed
          </Badge>
          <Badge variant="outline" className="text-xs">
            {data?.summary.warn || 0} warnings
          </Badge>
        </div>
      </div>

      {visibleChecks.length > 0 ? (
        <div className="space-y-2">
          {visibleChecks.map(check => (
            <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg bg-foreground/5 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{check.label}</p>
                <p className="text-xs text-foreground/50">{check.message}</p>
              </div>
              <Badge variant={check.status === 'fail' ? 'destructive' : 'outline'} className="text-xs">
                {check.status}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground/50">All readiness checks are passing or informational.</p>
      )}
    </div>
  );
}

function PlatformHealthCheck({ appId, deployment }: { appId: number; deployment: AppDeployment | null }) {
  const { data: health, isLoading } = useQuery<PlatformHealth>({
    queryKey: [`/api/apps/${appId}/platform-health`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/apps/${appId}/platform-health`);
      if (!res.ok) return { datasets: 'unknown', agents: 'unknown', missions: 'unknown', pipelines: 'unknown' };
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: usage } = useQuery<PlatformBlockUsage>({
    queryKey: [`/api/apps/${appId}/platform-usage`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/apps/${appId}/platform-usage`);
      if (!res.ok) return { datasetTableCount: 0, agentChatCount: 0, missionBlockCount: 0, missionLogBlockCount: 0, pipelineBlockCount: 0 };
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 bg-foreground/5" />)}
      </div>
    );
  }

  const checks = [
    { 
      name: 'Dataset API', 
      status: health?.datasets || 'unknown', 
      icon: Database, 
      description: 'PlatformDatasetTableBlock connectivity',
      count: usage?.datasetTableCount || 0,
    },
    { 
      name: 'Agent API', 
      status: health?.agents || 'unknown', 
      icon: Bot, 
      description: 'PlatformAgentChatBlock connectivity',
      count: usage?.agentChatCount || 0,
    },
    { 
      name: 'Mission API', 
      status: health?.missions || 'unknown', 
      icon: Target, 
      description: 'PlatformMissionsBlock & MissionLogBlock connectivity',
      count: (usage?.missionBlockCount || 0) + (usage?.missionLogBlockCount || 0),
    },
    { 
      name: 'Pipeline API', 
      status: health?.pipelines || 'unknown', 
      icon: Workflow, 
      description: 'PlatformPipelineTriggerBlock connectivity',
      count: usage?.pipelineBlockCount || 0,
    },
  ];

  return (
    <div className="space-y-2">
      {checks.map(check => (
        <div key={check.name} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-foreground/5 transition-colors">
          <div className="flex items-center gap-3">
            <check.icon className={`w-4 h-4 ${
              check.status === 'ok' ? 'text-emerald-400' : 
              check.status === 'error' ? 'text-rose-400' : 'text-foreground/30'
            }`} />
            <div>
              <span className="text-sm font-medium">{check.name}</span>
              <p className="text-xs text-foreground/40">{check.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {check.count > 0 && (
              <Badge variant="secondary" className="text-xs">
                {check.count} block{check.count !== 1 ? 's' : ''}
              </Badge>
            )}
            <Badge 
              variant={check.status === 'ok' ? 'default' : check.status === 'error' ? 'destructive' : 'outline'}
              className="text-xs"
            >
              {check.status === 'ok' ? 'Connected' : check.status === 'error' ? 'Error' : 'Unknown'}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AppIntegrationsTab({ appId, deployment }: AppIntegrationsTabProps) {
  const { data: usage, isLoading: isLoadingUsage } = useQuery<PlatformBlockUsage>({
    queryKey: [`/api/apps/${appId}/platform-usage`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/apps/${appId}/platform-usage`);
      if (!res.ok) return { datasetTableCount: 0, agentChatCount: 0, missionBlockCount: 0, missionLogBlockCount: 0, pipelineBlockCount: 0 };
      return res.json();
    },
  });

  const hasDatasets = (deployment as any)?.allowedDatasetIds?.length > 0;
  const hasAgents = (deployment as any)?.allowedAgentIds?.length > 0;
  const hasPipelines = (deployment as any)?.allowedPipelineIds?.length > 0;
  const hasCollections = (deployment as any)?.defaultCollections?.length > 0;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Blocks className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Platform Block Usage</CardTitle>
              <CardDescription>
                Active platform integrations and their connection status
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingUsage ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 bg-foreground/5" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard 
                title="Dataset Tables" 
                value={usage?.datasetTableCount || 0} 
                icon={Database}
                linked={hasDatasets}
                color="bg-blue-500/20"
              />
              <StatCard 
                title="Agent Chats" 
                value={usage?.agentChatCount || 0} 
                icon={Bot}
                linked={hasAgents}
                color="bg-amber-500/20"
              />
              <StatCard 
                title="Mission Blocks" 
                value={(usage?.missionBlockCount || 0) + (usage?.missionLogBlockCount || 0)} 
                icon={Target}
                linked={true} // Always available
                color="bg-indigo-500/20"
              />
              <StatCard 
                title="Pipeline Triggers" 
                value={usage?.pipelineBlockCount || 0} 
                icon={Workflow}
                linked={hasPipelines}
                color="bg-emerald-500/20"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected Resources */}
      <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Connected Resources
          </CardTitle>
          <CardDescription>
            Platform resources configured for this app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Datasets */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" /> Allowed Datasets
            </h4>
            {(deployment as any)?.allowedDatasetIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(deployment as any).allowedDatasetIds.map((id: number) => (
                  <Badge key={id} variant="secondary" className="gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    Dataset #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground/40">No datasets configured. Go to Configure → Hookups to add.</p>
            )}
          </div>

          <Separator className="bg-foreground/5" />

          {/* Agents */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-amber-400" /> Available Agents
            </h4>
            {(deployment as any)?.allowedAgentIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(deployment as any).allowedAgentIds.map((id: number) => (
                  <Badge key={id} variant="secondary" className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    Agent #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground/40">No agents configured. Go to Configure → Hookups to add.</p>
            )}
          </div>

          <Separator className="bg-foreground/5" />

          {/* Pipelines */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Workflow className="w-4 h-4 text-emerald-400" /> Pipelines This App Can Trigger
            </h4>
            {(deployment as any)?.allowedPipelineIds?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(deployment as any).allowedPipelineIds.map((id: number) => (
                  <Badge key={id} variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    Pipeline #{id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground/40">No pipelines configured. Go to Configure → Hookups to add.</p>
            )}
          </div>

          <Separator className="bg-foreground/5" />

          {/* Default Collections */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Folder className="w-4 h-4 text-purple-400" /> Default Collections
            </h4>
            {(deployment as any)?.defaultCollections?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(deployment as any).defaultCollections.map((name: string) => (
                  <Badge key={name} variant="outline" className="gap-1 border-purple-500/20 text-purple-700 dark:text-purple-300">
                    <Folder className="w-3 h-3" />
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground/40">No default collections. Go to Configure → Hookups to add.</p>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Readiness Gate */}
      <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Forge Readiness
          </CardTitle>
          <CardDescription>
            Registry, deployment, workspace, runtime, and token checks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AppReadinessGate appId={appId} />
        </CardContent>
      </Card>

      {/* Health Check */}
      <Card className="bg-card/40 border-foreground/10 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Connection Health
          </CardTitle>
          <CardDescription>
            Real-time status of platform API connectivity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformHealthCheck appId={appId} deployment={deployment} />
        </CardContent>
      </Card>

      {/* Usage Tips */}
      {!hasDatasets && !hasAgents && !hasPipelines && !hasCollections && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              Getting Started with Platform Blocks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-foreground/60">
            <p>
              Platform Blocks are self-wiring components that connect directly to Oddjob services. 
              No manual fetch() code required.
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Configure resources above or in the <strong>Configure → Hookups</strong> tab</li>
              <li>Open <strong>Interactive Builder</strong> and select "🔶 Platform Blocks" from the palette</li>
              <li>Drag PlatformDatasetTableBlock, PlatformAgentChatBlock, etc.</li>
              <li>Set props (collection name, agent ID, etc.) via the configurator</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
