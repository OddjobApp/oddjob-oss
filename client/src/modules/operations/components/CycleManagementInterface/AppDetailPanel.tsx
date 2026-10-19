/**
 * AppDetailPanel Component
 * 
 * Display detailed information about selected app
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Play, Pause, SkipForward, RefreshCcw, FileText, 
  Settings, Activity, Clock, DollarSign, CheckCircle2,
  XCircle, AlertTriangle, Zap, AppWindow, ExternalLink, Wrench,
  Maximize2, Minimize2
} from 'lucide-react';
import type { Blueprint, AppStatus, Step, WorkbenchAppLink } from './types';
import SessionDashboardPage from '@domain-ui/sdlc-pipeline/ui/modules/pages/SessionDashboardPage';
import QualityMetricsPage from '@domain-ui/sdlc-pipeline/ui/modules/pages/QualityMetricsPage';
import { NativeWorkbench, hasNativeWorkbench } from '../../workbenches/NativeWorkbenchRegistry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function CoreRouteWorkbench({ publicPath }: { publicPath: string }) {
  const pathname = new URL(publicPath, window.location.origin).pathname;

  if (pathname === '/pipeline/sessions') return <SessionDashboardPage />;
  if (pathname === '/pipeline/metrics') return <QualityMetricsPage />;
  return null;
}

function supportsNativeCoreRoute(publicPath: string): boolean {
  const pathname = new URL(publicPath, window.location.origin).pathname;
  return pathname === '/pipeline/sessions' || pathname === '/pipeline/metrics';
}

interface AppDetailPanelProps {
  app: Blueprint;
  cycleId: number;
  onViewLogs?: () => void;
  onConfigure?: () => void;
  onRetry?: () => void;
  onSkip?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onComplete?: () => void;
}

const STATUS_CONFIG: Record<AppStatus, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, label: 'PENDING', color: 'text-muted-foreground' },
  waiting: { icon: <Clock className="w-4 h-4" />, label: 'WAITING', color: 'text-amber-400' },
  waiting_on_app: { icon: <AppWindow className="w-4 h-4" />, label: 'WAITING ON APP', color: 'text-amber-400' },
  active: { icon: <Zap className="w-4 h-4 animate-pulse" />, label: 'ACTIVE', color: 'text-primary' },
  running: { icon: <Zap className="w-4 h-4 animate-pulse" />, label: 'RUNNING', color: 'text-primary' },
  completed: { icon: <CheckCircle2 className="w-4 h-4" />, label: 'COMPLETED', color: 'text-emerald-400' },
  failed: { icon: <XCircle className="w-4 h-4" />, label: 'FAILED', color: 'text-red-400' },
  blocked: { icon: <XCircle className="w-4 h-4" />, label: 'BLOCKED', color: 'text-red-400' },
  skipped: { icon: <SkipForward className="w-4 h-4" />, label: 'SKIPPED', color: 'text-muted-foreground' },
  paused: { icon: <Pause className="w-4 h-4" />, label: 'PAUSED', color: 'text-amber-400' },
};

export function AppDetailPanel({
  app,
  cycleId,
  onViewLogs,
  onConfigure,
  onRetry,
  onSkip,
  onPause,
  onResume,
  onComplete,
}: AppDetailPanelProps) {
  const hasWorkbench = app.workbenchApps && app.workbenchApps.length > 0;
  const [activeTab, setActiveTab] = useState<'overview' | 'steps' | 'config' | 'workbench'>(
    hasWorkbench ? 'workbench' : 'overview'
  );
  const [embeddedWorkbench, setEmbeddedWorkbench] = useState<WorkbenchAppLink | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { user } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const postToChild = useCallback((msg: any) => {
    if (!iframeRef.current?.contentWindow) return;
    const full = { source: 'cycle-manager', version: 1, ...msg };
    try {
      iframeRef.current.contentWindow.postMessage(full, window.location.origin);
    } catch {
      // Origin mismatch — drop silently
    }
  }, []);

  // PostMessage bridge for embedded workbench
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || msg.source !== 'workbench' || msg.version !== 1) return;

      if (msg.type === 'ready') {
        const primaryWorkbench = app.workbenchApps?.find(w => w.publicPath) || app.workbenchApps?.[0];
        // `dependentMissionIds` hangs off the WORKBENCH LINK, not the blueprint, and
        // Blueprint has no `id` at all — so `app.id || app.dependentMissionIds?.[0]`
        // was `undefined || undefined` and this always sent missionId 0. The
        // workbench has therefore never received a real mission id.
        const missionId = Number(primaryWorkbench?.dependentMissionIds?.[0]) || 0;
        postToChild({
          type: 'context',
          payload: {
            missionId,
            bindingId: primaryWorkbench?.deploymentId || 0,
            cycleId,
            mission: { id: missionId, name: app.name, objective: app.objective || null },
            user: user ? { id: user.id, username: user.username, email: user.email } : undefined,
            organizationId: user?.defaultOrgId,
          },
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [app, cycleId, user, postToChild]);

  // Auto-switch tab if app changes
  useEffect(() => {
    if (app.workbenchApps && app.workbenchApps.length > 0) {
      setActiveTab('workbench');
    } else {
      setActiveTab('overview');
    }
  }, [app.name, app.workbenchApps]);

  // Prevent body scrolling when in fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFullscreen]);
  
  const status = app.status || 'pending';
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  
  // Get UI metadata with fallbacks
  const uiMetadata = app.uiMetadata || {};
  const icon = uiMetadata.icon || '📋';
  const color = uiMetadata.color || '#3b82f6';
  const category = uiMetadata.category || 'general';
  
  // Calculate progress
  const currentStep = app.currentStep || 0;
  const totalSteps = app.totalSteps || (app.sequence?.length || 1);
  const stepProgress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  
  // Get execution metadata
  const executionMeta = app.executionMetadata;
  const duration = executionMeta?.duration;
  const cost = executionMeta?.cost;
  const tokensUsed = executionMeta?.tokensUsed;
  
  return (
    <>
    <Card className="bg-black/40 border-white/10 shadow-xl backdrop-blur-2xl overflow-hidden">
      <CardHeader className="pb-4 flex flex-row items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              {app.name}
              <Badge variant="outline" className={`text-[10px] font-black uppercase tracking-widest ${statusCfg.color} border-current/20`}>
                {statusCfg.label}
              </Badge>
            </CardTitle>
            <CardDescription className="text-[10px]">
              {app.objective}
            </CardDescription>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex gap-2">
          {status === 'waiting_on_app' && app.appStep?.launchHref && (
            <Button size="sm" variant="outline" onClick={() => window.open(app.appStep?.launchHref, '_blank')}>
              <AppWindow className="w-3 h-3 mr-1" /> Open App
            </Button>
          )}
          {status === 'waiting_on_app' && onComplete && (
            <Button size="sm" onClick={onComplete}>
              <CheckCircle2 className="w-3 h-3 mr-1" /> Complete Step
            </Button>
          )}
          {(status === 'active' || status === 'running') && onPause && (
            <Button size="sm" variant="outline" onClick={onPause}>
              <Pause className="w-3 h-3 mr-1" /> Pause
            </Button>
          )}
          {status === 'paused' && onResume && (
            <Button size="sm" onClick={onResume}>
              <Play className="w-3 h-3 mr-1" /> Resume
            </Button>
          )}
          {(status === 'failed' || status === 'blocked') && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCcw className="w-3 h-3 mr-1" /> Retry
            </Button>
          )}
          {status === 'pending' && onSkip && (
            <Button size="sm" variant="outline" onClick={onSkip}>
              <SkipForward className="w-3 h-3 mr-1" /> Skip
            </Button>
          )}
          {onConfigure && (
            <Button size="sm" variant="ghost" onClick={onConfigure}>
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="pb-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className={`grid w-full ${app.workbenchApps && app.workbenchApps.length > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {app.workbenchApps && app.workbenchApps.length > 0 && (
              <TabsTrigger value="workbench">Workbench</TabsTrigger>
            )}
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
          
          {/* Workbench Tab */}
          {app.workbenchApps && app.workbenchApps.length > 0 && (
            <TabsContent value="workbench" className="mt-4">
              {(() => {
                const primaryWorkbench = app.workbenchApps.find(w => w.publicPath) || app.workbenchApps[0];
                if (primaryWorkbench && primaryWorkbench.publicPath) {
                  return (
                    <div className={`relative w-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-modal bg-background p-6' : 'h-[85vh] min-h-[600px]'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <AppWindow className="w-5 h-5 text-primary" />
                          <div>
                            <span className="text-sm font-bold">{primaryWorkbench.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-2 uppercase tracking-wider">{primaryWorkbench.interactionModel}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => window.open(primaryWorkbench.publicPath || "", "_blank")}>
                            <ExternalLink className="w-4 h-4 mr-1.5" /> Pop-out
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 border-white/10" onClick={() => setIsFullscreen(!isFullscreen)}>
                            {isFullscreen ? <Minimize2 className="w-4 h-4 mr-1.5" /> : <Maximize2 className="w-4 h-4 mr-1.5" />}
                            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                          </Button>
                        </div>
                      </div>
                      {primaryWorkbench.interactionModel === 'core-route' && supportsNativeCoreRoute(primaryWorkbench.publicPath) ? (
                        <div
                          className="flex-1 w-full min-h-0 overflow-auto border border-white/10 rounded-xl shadow-inner bg-background"
                          data-testid="native-cycle-workbench"
                        >
                          <CoreRouteWorkbench publicPath={primaryWorkbench.publicPath} />
                        </div>
                      ) : hasNativeWorkbench(primaryWorkbench.publicPath, primaryWorkbench.sourceAppId, primaryWorkbench.name) ? (
                        <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
                          <NativeWorkbench
                            publicPath={primaryWorkbench.publicPath}
                            slug={primaryWorkbench.sourceAppId}
                            name={primaryWorkbench.name}
                            missionId={Number(primaryWorkbench.dependentMissionIds?.[0]) || 0}
                            cycleId={cycleId}
                          />
                        </div>
                      ) : (
                        <iframe
                          key={primaryWorkbench.publicPath}
                          ref={iframeRef}
                          src={primaryWorkbench.publicPath}
                          className="flex-1 w-full h-full min-h-0 border border-white/10 rounded-xl shadow-inner bg-black/40"
                          title={primaryWorkbench.name}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      )}
                    </div>
                  );
                }
                return (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground bg-black/20 rounded-xl border border-white/5">
                    No public path configured for this workbench.
                  </div>
                );
              })()}
            </TabsContent>
          )}
          
          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {app.workbenchApps && app.workbenchApps.length > 0 && (
              <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center gap-2">
                  <AppWindow className="w-4 h-4 text-primary" />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-primary">Cycle Workbench Apps</div>
                    <p className="text-[10px] text-muted-foreground">Open secure form workbenches in a modal or external page.</p>
                  </div>
                </div>
                <div className="grid gap-2">
                  {app.workbenchApps.map((workbench) => (
                    <div key={`${workbench.appId}-${workbench.sourceAppId}`} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {workbench.health === 'unhealthy' && (
                            <span
                              title="Unhealthy — the app process isn't responding. Restart it from the Builder."
                              className="inline-block w-2 h-2 flex-shrink-0 rounded-full bg-red-500 animate-pulse"
                            />
                          )}
                          <div className="truncate text-sm font-bold text-foreground">{workbench.name}</div>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {workbench.health === 'unhealthy'
                            ? <span className="text-red-400">Not responding</span>
                            : (workbench.interactionModel || "form-workbench")}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {workbench.publicPath && (
                          <Button size="sm" className="h-8 text-[10px] font-black uppercase" onClick={() => setEmbeddedWorkbench(workbench)}>
                            <AppWindow className="w-3.5 h-3.5 mr-1.5" /> Open Modal
                          </Button>
                        )}
                        {workbench.externalPath && (
                          <Button size="sm" variant="outline" className="h-8 text-[10px] font-black uppercase" onClick={() => window.open(workbench.externalPath || "", "_blank")}>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Page
                          </Button>
                        )}
                        {workbench.editPath && (
                          <Button size="sm" variant="ghost" className="h-8 text-[10px] font-black uppercase" onClick={() => window.open(workbench.editPath, "_blank")}>
                            <Wrench className="w-3.5 h-3.5 mr-1.5" /> Builder
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress Bar */}
            {totalSteps > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{Math.round(stepProgress)}%</span>
                </div>
                <Progress value={stepProgress} className="h-2" />
                <div className="text-[10px] text-muted-foreground">
                  Step {currentStep + 1} of {totalSteps}
                </div>
              </div>
            )}
            
            {/* Agent Assignment */}
            {app.primary_agent && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Assigned Agent
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-primary" />
                  </div>
                  <span className="font-medium">{app.primary_agent}</span>
                </div>
              </div>
            )}
            
            {/* Execution Metrics */}
            {executionMeta && (
              <div className="grid grid-cols-2 gap-4">
                {duration && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Duration
                    </div>
                    <div className="text-sm font-medium">
                      {Math.round(duration / 1000)}s
                    </div>
                  </div>
                )}
                {cost && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Cost
                    </div>
                    <div className="text-sm font-medium">
                      ${cost.toFixed(4)}
                    </div>
                  </div>
                )}
                {tokensUsed && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Tokens
                    </div>
                    <div className="text-sm font-medium">
                      {tokensUsed.toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Error Display */}
            {executionMeta?.error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-1">
                  <XCircle className="w-4 h-4" />
                  Error
                </div>
                <p className="text-xs text-red-700 dark:text-red-300">{executionMeta.error}</p>
              </div>
            )}
            
            {/* Resources */}
            {app.resources && app.resources.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Required Resources
                </div>
                <div className="space-y-1">
                  {app.resources.map((resource) => (
                    <div key={resource.id} className="flex items-center justify-between text-xs p-2 rounded bg-foreground/5">
                      <span>{resource.label}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {resource.required ? 'Required' : 'Optional'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Steps Tab */}
          <TabsContent value="steps" className="space-y-3 mt-4">
            {app.sequence && app.sequence.length > 0 ? (
              app.sequence.map((step, index) => {
                const stepStatus = index < currentStep ? 'completed' : index === currentStep ? 'active' : 'pending';
                const isCurrentStep = index === currentStep;
                
                return (
                  <div
                    key={step.stepCode || index}
                    className={`p-3 rounded-lg border ${
                      isCurrentStep 
                        ? 'border-primary bg-primary/10' 
                        : stepStatus === 'completed'
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-white/10 bg-foreground/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        stepStatus === 'completed' ? 'bg-emerald-500' : 
                        isCurrentStep ? 'bg-primary animate-pulse' : 'bg-gray-500'
                      }`}>
                        {stepStatus === 'completed' && <CheckCircle2 className="w-3 h-3 text-foreground" />}
                        {isCurrentStep && <Zap className="w-3 h-3 text-foreground" />}
                        {stepStatus === 'pending' && <Clock className="w-3 h-3 text-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{step.action}</span>
                          {step.ui_metadata?.display_name && (
                            <Badge variant="outline" className="text-[9px]">
                              {step.ui_metadata.display_name}
                            </Badge>
                          )}
                        </div>
                        {step.description && (
                          <p className="text-[10px] text-muted-foreground">{step.description}</p>
                        )}
                        {step.estimated_duration_minutes && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Est. {step.estimated_duration_minutes}m
                          </p>
                        )}
                        {step.agent && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Agent: {step.agent}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No steps defined for this app
              </div>
            )}
          </TabsContent>
          
          {/* Config Tab */}
          <TabsContent value="config" className="space-y-4 mt-4">
            {/* Basic Info */}
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                App Configuration
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <span className="ml-2 font-medium">{app.type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Environment:</span>
                  <span className="ml-2 font-medium">{app.environment || 'default'}</span>
                </div>
                {app.estimatedDays && (
                  <div>
                    <span className="text-muted-foreground">Est. Duration:</span>
                    <span className="ml-2 font-medium">{app.estimatedDays} days</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Dependencies */}
            {app.dependencies && app.dependencies.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Dependencies
                </div>
                <div className="space-y-1">
                  {app.dependencies.map((dep, index) => (
                    <div key={index} className="text-xs p-2 rounded bg-foreground/5">
                      <span className="text-muted-foreground">{dep.type}:</span>
                      <span className="ml-2 font-medium">{dep.blueprintName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Data Flow */}
            {(app.inputs?.length || app.outputs?.length) && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Data Flow
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {app.inputs && app.inputs.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">Inputs</div>
                      <div className="space-y-1">
                        {app.inputs.map((input, index) => (
                          <div key={index} className="text-xs p-1 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300">
                            {input}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {app.outputs && app.outputs.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">Outputs</div>
                      <div className="space-y-1">
                        {app.outputs.map((output, index) => (
                          <div key={index} className="text-xs p-1 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                            {output}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Trigger Info */}
            {app.trigger && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Trigger
                </div>
                <div className="text-xs p-2 rounded bg-foreground/5 font-mono">
                  {typeof app.trigger === 'string' ? app.trigger : JSON.stringify(app.trigger)}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
    <Dialog open={Boolean(embeddedWorkbench)} onOpenChange={(open) => !open && setEmbeddedWorkbench(null)}>
      <DialogContent className="h-[92vh] max-w-[min(1400px,96vw)] overflow-hidden border-white/10 bg-background p-0 text-foreground">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-black">
            <AppWindow className="h-5 w-5 text-primary" />
            {embeddedWorkbench?.name || "Cycle Workbench"}
          </DialogTitle>
          <DialogDescription>
            Embedded secure app for the selected cycle mission. Open externally for a full-page workflow.
          </DialogDescription>
        </DialogHeader>
        {embeddedWorkbench?.publicPath && (
          <iframe
            src={embeddedWorkbench.publicPath}
            title={embeddedWorkbench.name}
            className="h-[calc(92vh-89px)] w-full border-0 bg-black"
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
