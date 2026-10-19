/**
 * DependencyContextPanel Component
 * 
 * Show dependency relationships and impact analysis
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, GitBranch, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { Blueprint, Dependency } from './types';

interface DependencyContextPanelProps {
  app: Blueprint;
  allApps: Blueprint[];
  onAppClick?: (appName: string) => void;
  showCriticalPath?: boolean;
}

export function DependencyContextPanel({ 
  app, 
  allApps, 
  onAppClick, 
  showCriticalPath = true 
}: DependencyContextPanelProps) {
  const dependencies = app.dependencies || [];
  
  // Find upstream dependencies (apps that must complete before this one)
  const upstreamApps = dependencies.map(dep => {
    const depApp = allApps.find(a => a.name === dep.blueprintName);
    return { ...dep, app: depApp };
  }).filter(d => d.app);
  
  // Find downstream dependents (apps waiting on this one)
  const downstreamApps = allApps.filter(otherApp => {
    const otherDeps = otherApp.dependencies || [];
    return otherDeps.some(dep => dep.blueprintName === app.name);
  });
  
  // Critical-path status from the orchestrator's CPM pass (computed at launch).
  // Falls back to the connectivity heuristic only when the plan hasn't run yet.
  const hasCpm = typeof app.onCriticalPath === 'boolean';
  const isOnCriticalPath = showCriticalPath && (
    hasCpm ? app.onCriticalPath! : (downstreamApps.length > 0 || upstreamApps.length > 0)
  );
  const waveLabel = app.waveIndex != null ? `Wave ${app.waveIndex}` : null;

  return (
    <Card className="bg-black/40 border-white/10 shadow-xl backdrop-blur-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Dependency Context
        </CardTitle>
        <CardDescription className="text-[10px] flex items-center gap-2">
          <span>{isOnCriticalPath ? 'This app is on the critical execution path' : 'Has scheduling slack — not on the critical path'}</span>
          {waveLabel && (
            <Badge variant="outline" className="text-[8px] border-white/15 text-muted-foreground">{waveLabel}</Badge>
          )}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Upstream Dependencies */}
        {upstreamApps.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <ArrowUp className="w-3 h-3" />
              Upstream Dependencies
            </div>
            <div className="space-y-2">
              {upstreamApps.map((dep, index) => {
                const depApp = dep.app!;
                const status = depApp.status || 'pending';
                const statusColor = 
                  status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                  status === 'failed' || status === 'blocked' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                  status === 'active' || status === 'running' ? 'bg-primary/15 text-primary border-primary/20' :
                  'bg-gray-500/15 text-muted-foreground border-gray-500/20';
                
                return (
                  <div
                    key={dep.blueprintName}
                    className={`p-3 rounded-lg border transition-all ${
                      onAppClick ? 'cursor-pointer hover:border-primary/50' : ''
                    } border-white/10 bg-foreground/5`}
                    onClick={() => onAppClick?.(dep.blueprintName)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{dep.blueprintName}</span>
                      <Badge variant="outline" className={`text-[9px] ${statusColor}`}>
                        {status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>Type: {dep.type}</span>
                      {dep.offset && (
                        <span>Offset: {dep.offset.value} {dep.offset.unit}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Downstream Dependents */}
        {downstreamApps.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <ArrowDown className="w-3 h-3" />
              Downstream Dependents
            </div>
            <div className="space-y-2">
              {downstreamApps.map((dependentApp, index) => {
                const status = dependentApp.status || 'pending';
                const statusColor = 
                  status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                  status === 'failed' || status === 'blocked' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                  status === 'active' || status === 'running' ? 'bg-primary/15 text-primary border-primary/20' :
                  'bg-gray-500/15 text-muted-foreground border-gray-500/20';
                
                return (
                  <div
                    key={dependentApp.name}
                    className={`p-3 rounded-lg border transition-all ${
                      onAppClick ? 'cursor-pointer hover:border-primary/50' : ''
                    } border-white/10 bg-foreground/5`}
                    onClick={() => onAppClick?.(dependentApp.name)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{dependentApp.name}</span>
                      <Badge variant="outline" className={`text-[9px] ${statusColor}`}>
                        {status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {dependentApp.objective}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* No Dependencies */}
        {upstreamApps.length === 0 && downstreamApps.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No dependencies or dependents</p>
            <p className="text-[10px] mt-1">This app can run independently</p>
          </div>
        )}
        
        {/* Critical Path Indicator */}
        {isOnCriticalPath && (
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
            <div className="flex items-center gap-2 text-primary text-sm font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              Critical Path
            </div>
            <p className="text-[10px] text-primary/80">
              This app is on the critical execution path. Delays here will impact the overall cycle timeline.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
