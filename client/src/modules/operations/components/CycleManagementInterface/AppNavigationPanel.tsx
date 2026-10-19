/**
 * AppNavigationPanel Component
 * 
 * Navigate through apps in cycle using carousel or accordion
 */

import React, { useState, useMemo } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, ArrowUp, ArrowDown, GitBranch, AlertTriangle } from 'lucide-react';
import type { Blueprint, AppStatus } from './types';

interface AppNavigationPanelProps {
  apps: Blueprint[];
  activeIndex: number;
  onAppSelect: (index: number) => void;
  filterStatus?: AppStatus;
  onFilterChange?: (status?: AppStatus) => void;
  sortBy?: 'name' | 'status' | 'duration';
  onSortChange?: (sort: 'name' | 'status' | 'duration') => void;
}

const STATUS_OPTIONS: { value: AppStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: 'bg-primary' },
  { value: 'running', label: 'Running', color: 'bg-primary' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-500' },
  { value: 'failed', label: 'Failed', color: 'bg-red-500' },
  { value: 'pending', label: 'Pending', color: 'bg-gray-500' },
  { value: 'blocked', label: 'Blocked', color: 'bg-red-500' },
];

export function AppNavigationPanel({
  apps,
  activeIndex,
  onAppSelect,
  filterStatus,
  onFilterChange,
  sortBy,
  onSortChange,
}: AppNavigationPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter and sort apps
  const filteredApps = useMemo(() => {
    let result = [...apps];
    
    // Apply status filter
    if (filterStatus) {
      result = result.filter(app => app.status === filterStatus);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(app => 
        app.name.toLowerCase().includes(query) ||
        app.objective?.toLowerCase().includes(query)
      );
    }
    
    // Apply sort
    if (sortBy) {
      result.sort((a, b) => {
        switch (sortBy) {
          case 'name':
            return a.name.localeCompare(b.name);
          case 'status':
            return (a.status || '').localeCompare(b.status || '');
          case 'duration':
            return (a.executionMetadata?.duration || 0) - (b.executionMetadata?.duration || 0);
          default:
            return 0;
        }
      });
    }
    
    return result;
  }, [apps, filterStatus, searchQuery, sortBy]);
  
  const handleAppClick = (index: number) => {
    // Find the actual index in the original apps array
    const selectedApp = filteredApps[index];
    const originalIndex = apps.findIndex(app => app.name === selectedApp.name);
    if (originalIndex !== -1) {
      onAppSelect(originalIndex);
    }
  };
  
  const activeFilteredIndex = useMemo(() => {
    const activeApp = apps[activeIndex];
    return filteredApps.findIndex(app => app.name === activeApp?.name);
  }, [apps, activeIndex, filteredApps]);
  
  return (
    <div className="w-full space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-end gap-2">
        {onFilterChange && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => onFilterChange(undefined)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        )}
      </div>
      
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search apps..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-foreground/5 border-white/10"
        />
      </div>
      
      {/* Status Filter Pills */}
      {onFilterChange && (
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <Badge
              key={option.value}
              variant={filterStatus === option.value ? 'default' : 'outline'}
              className={`cursor-pointer text-[10px] px-2 py-0.5 ${
                filterStatus === option.value ? option.color : 'hover:bg-foreground/10'
              }`}
              onClick={() => onFilterChange(filterStatus === option.value ? undefined : option.value)}
            >
              {option.label}
            </Badge>
          ))}
        </div>
      )}
      
      {/* App List */}
      <Accordion
          type="single" 
          collapsible 
          value={`item-${activeFilteredIndex}`} 
          onValueChange={(val) => {
            if (val) {
              const index = parseInt(val.split('-')[1]);
              handleAppClick(index);
            }
          }} 
          className="w-full space-y-2"
        >
          {filteredApps.map((app, index) => {
            const isActive = index === activeFilteredIndex;
            
            // Calculate progress for active/running
            const currentStep = app.currentStep || 0;
            const totalSteps = app.totalSteps || (app.sequence?.length || 1);
            const stepProgress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
            
            // Compute dependencies
            const dependencies = app.dependencies || [];
            const upstreamApps = dependencies.map(dep => {
              const depApp = apps.find(a => a.name === dep.blueprintName);
              return { ...dep, app: depApp };
            }).filter(d => d.app);
            
            const downstreamApps = apps.filter(otherApp => {
              const otherDeps = otherApp.dependencies || [];
              return otherDeps.some(dep => dep.blueprintName === app.name);
            });
            
            const isOnCriticalPath = downstreamApps.length > 0 || upstreamApps.length > 0;
            
            return (
              <AccordionItem
                key={app.name}
                value={`item-${index}`}
                className={`rounded-lg border px-3 transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10 shadow-lg shadow-primary/5'
                    : 'border-white/10 bg-foreground/5 hover:bg-foreground/10'
                }`}
              >
                <AccordionTrigger className="hover:no-underline py-3 text-foreground">
                  <div className="flex items-center gap-3 text-left w-full pr-4 min-w-0">
                    <span className="text-lg shrink-0">{app.uiMetadata?.icon || '📋'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" title={app.name}>{app.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {app.objective}
                      </div>
                    </div>
                    {app.status && (
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-black tracking-wider shrink-0 ${
                          app.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                            : app.status === 'failed' || app.status === 'blocked'
                            ? 'bg-red-500/15 text-red-400 border-red-500/20'
                            : app.status === 'active' || app.status === 'running'
                            ? 'bg-primary/15 text-primary border-primary/20 animate-pulse'
                            : app.status === 'waiting'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                            : 'bg-gray-500/15 text-muted-foreground border-gray-500/20'
                        }`}
                      >
                        {app.status.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-xs space-y-3 text-muted-foreground">
                  <p className="text-[11px] text-foreground/80 leading-relaxed">
                    {app.objective || 'No objective specified.'}
                  </p>
                  
                  {/* Progress Bar (for active/running apps) */}
                  {(app.status === 'active' || app.status === 'running') && totalSteps > 1 && (
                    <div className="space-y-1 bg-black/20 p-2 rounded-lg border border-white/5">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Progress (Step {currentStep + 1}/{totalSteps})</span>
                        <span className="font-bold text-foreground">{Math.round(stepProgress)}%</span>
                      </div>
                      <Progress value={stepProgress} className="h-1" />
                    </div>
                  )}
                  
                  {/* Inline Dependency Context */}
                  <div className="space-y-3 pt-3 border-t border-white/5">
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-foreground">
                      <GitBranch className="w-3.5 h-3.5 text-primary" /> Dependency Context
                    </div>
                    
                    {/* Upstream Dependencies */}
                    {upstreamApps.length > 0 && (
                      <div className="space-y-1.5 pl-2 border-l border-white/10">
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          <ArrowUp className="w-2.5 h-2.5" /> Upstream Dependencies (Requires)
                        </div>
                        <div className="space-y-1.5">
                          {upstreamApps.map((dep) => {
                            const depApp = dep.app!;
                            const status = depApp.status || 'pending';
                            return (
                              <div key={dep.blueprintName} className="p-2 rounded-lg bg-black/35 border border-white/5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-foreground truncate">{dep.blueprintName}</span>
                                  <Badge variant="outline" className={`text-[8px] px-1 py-0.5 ${
                                    status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                                    status === 'failed' || status === 'blocked' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                                    status === 'active' || status === 'running' ? 'bg-primary/15 text-primary border-primary/20 animate-pulse' :
                                    'bg-gray-500/15 text-muted-foreground border-gray-500/20'
                                  }`}>
                                    {status.toUpperCase()}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground mt-1">
                                  <span>Type: <strong className="text-foreground/80">{dep.type}</strong></span>
                                  {dep.offset && (
                                    <span>Offset: <strong className="text-foreground/80">{dep.offset.value} {dep.offset.unit}</strong></span>
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
                      <div className="space-y-1.5 pl-2 border-l border-white/10">
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          <ArrowDown className="w-2.5 h-2.5" /> Downstream Dependents (Blocks)
                        </div>
                        <div className="space-y-1.5">
                          {downstreamApps.map((depApp) => {
                            const status = depApp.status || 'pending';
                            return (
                              <div key={depApp.name} className="p-2 rounded-lg bg-black/35 border border-white/5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-foreground truncate">{depApp.name}</span>
                                  <Badge variant="outline" className={`text-[8px] px-1 py-0.5 ${
                                    status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                                    status === 'failed' || status === 'blocked' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                                    status === 'active' || status === 'running' ? 'bg-primary/15 text-primary border-primary/20 animate-pulse' :
                                    'bg-gray-500/15 text-muted-foreground border-gray-500/20'
                                  }`}>
                                    {status.toUpperCase()}
                                  </Badge>
                                </div>
                                {depApp.objective && (
                                  <p className="text-[9px] text-muted-foreground mt-1 leading-normal line-clamp-2">
                                    {depApp.objective}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {/* Critical Path Alert */}
                    {isOnCriticalPath && (
                      <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-primary text-[10px] font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Critical Path
                        </div>
                        <p className="text-[9px] text-primary/80 leading-normal">
                          This app is on the critical execution path. Delays here will impact the overall cycle timeline.
                        </p>
                      </div>
                    )}
                    
                    {/* No Dependencies Info */}
                    {upstreamApps.length === 0 && downstreamApps.length === 0 && (
                      <div className="text-center py-3 bg-black/20 rounded-lg border border-white/5 text-muted-foreground text-[10px]">
                        <p>No active dependencies or dependents.</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Metadata strip */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] pt-1 border-t border-white/5">
                    {app.primary_agent && (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Agent: <strong className="text-foreground">{app.primary_agent.replace('ai-', '').replace('-', ' ')}</strong>
                      </span>
                    )}
                    {app.estimatedDays && (
                      <span>
                        Est. Duration: <strong className="text-foreground">{app.estimatedDays} days</strong>
                      </span>
                    )}
                    {isOnCriticalPath && (
                      <span className="text-amber-400 font-bold flex items-center gap-1">
                        ⚠️ Critical Path
                      </span>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
      </Accordion>
      
      {/* App Count */}
      <div className="text-[10px] text-muted-foreground text-center">
        Showing {filteredApps.length} of {apps.length} apps
      </div>
    </div>
  );
}
