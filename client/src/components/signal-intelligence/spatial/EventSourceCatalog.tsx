import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Workflow,
  Target,
  Package,
  Bot,
  CheckCircle2,
  Plus,
  Search,
  Filter,
  ChevronRight,
  Info,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventSourceCatalogProps {
  organizationId?: number;
  onSubscribe?: (eventType: string, sourceType: string) => void;
}

interface InternalEventSource {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  events: InternalEventType[];
  activeSubscriptions: number;
}

interface InternalEventType {
  id: string;
  name: string;
  description: string;
  subscribed: boolean;
  subscriptionCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERNAL_SOURCES: InternalEventSource[] = [
  {
    id: 'cycle_events',
    name: 'Cycle Events',
    description: 'Track cycle lifecycle events including gate completions, step progress, and status changes',
    icon: Workflow,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    events: [
      { id: 'gate_completed', name: 'Gate Completion', description: 'When a cycle completes a gate', subscribed: false },
      { id: 'step_completed', name: 'Step Completion', description: 'When a cycle completes a step', subscribed: false },
      { id: 'cycle_started', name: 'Cycle Started', description: 'When a cycle begins execution', subscribed: false },
      { id: 'cycle_completed', name: 'Cycle Completed', description: 'When a cycle finishes successfully', subscribed: false },
      { id: 'cycle_failed', name: 'Cycle Failed', description: 'When a cycle encounters an error', subscribed: false },
      { id: 'cycle_paused', name: 'Cycle Paused', description: 'When a cycle is paused', subscribed: false },
    ],
    activeSubscriptions: 0,
  },
  {
    id: 'mission_events',
    name: 'Mission Events',
    description: 'Monitor mission outcomes including success, failure, and milestone achievements',
    icon: Target,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    events: [
      { id: 'mission_succeeded', name: 'Mission Succeeded', description: 'When a mission completes successfully', subscribed: false },
      { id: 'mission_failed', name: 'Mission Failed', description: 'When a mission fails', subscribed: false },
      { id: 'milestone_reached', name: 'Milestone Reached', description: 'When a mission milestone is achieved', subscribed: false },
      { id: 'mission_started', name: 'Mission Started', description: 'When a mission begins', subscribed: false },
    ],
    activeSubscriptions: 0,
  },
  {
    id: 'deliverable_events',
    name: 'Deliverable Events',
    description: 'Track deliverable lifecycle including completion, approval, and rejection',
    icon: Package,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    events: [
      { id: 'deliverable_completed', name: 'Deliverable Completed', description: 'When a deliverable is marked complete', subscribed: false },
      { id: 'deliverable_approved', name: 'Deliverable Approved', description: 'When a deliverable is approved', subscribed: false },
      { id: 'deliverable_rejected', name: 'Deliverable Rejected', description: 'When a deliverable is rejected', subscribed: false },
    ],
    activeSubscriptions: 0,
  },
  {
    id: 'agent_events',
    name: 'Agent Events',
    description: 'Monitor AI agent task execution including completions, failures, and retries',
    icon: Bot,
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/30',
    events: [
      { id: 'task_completed', name: 'Task Completed', description: 'When an agent completes a task', subscribed: false },
      { id: 'task_failed', name: 'Task Failed', description: 'When an agent task fails', subscribed: false },
      { id: 'agent_retry', name: 'Agent Retry', description: 'When an agent retries a task', subscribed: false },
    ],
    activeSubscriptions: 0,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventSourceCatalog({ organizationId, onSubscribe }: EventSourceCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'subscribed' | 'unsubscribed'>('all');

  // Fetch subscription status for internal event sources
  const { data: subscriptionStatus, isLoading } = useQuery({
    queryKey: ['/api/internal-event-sources/status', organizationId],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/internal-event-sources/status');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Update sources with subscription status
  const sourcesWithStatus = INTERNAL_SOURCES.map(source => {
    const status = subscriptionStatus?.[source.id] || {};
    const eventsWithStatus = source.events.map(event => ({
      ...event,
      subscribed: status[event.id]?.subscribed || false,
      subscriptionCount: status[event.id]?.count || 0,
    }));
    
    const activeSubs = eventsWithStatus.filter(e => e.subscribed).length;
    
    return {
      ...source,
      events: eventsWithStatus,
      activeSubscriptions: activeSubs,
    };
  });

  // Filter sources based on search and filter
  const filteredSources = sourcesWithStatus.filter(source => {
    const matchesSearch = 
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.events.some(e => 
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.description.toLowerCase().includes(searchQuery.toLowerCase())
      );

    if (selectedFilter === 'subscribed') {
      return matchesSearch && source.activeSubscriptions > 0;
    } else if (selectedFilter === 'unsubscribed') {
      return matchesSearch && source.activeSubscriptions < source.events.length;
    }
    
    return matchesSearch;
  });

  const handleSubscribe = (eventType: string, sourceType: string) => {
    onSubscribe?.(eventType, sourceType);
  };

  const handleExpand = (sourceId: string) => {
    setExpandedSource(expandedSource === sourceId ? null : sourceId);
  };

  const totalSubscriptions = sourcesWithStatus.reduce((sum, source) => sum + source.activeSubscriptions, 0);
  const totalAvailable = sourcesWithStatus.reduce((sum, source) => sum + source.events.length, 0);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card" data-testid="event-source-catalog">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Internal Event Source Catalog</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Browse and subscribe to internal Oddjob events for intelligence monitoring
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-sm font-semibold">{totalSubscriptions}/{totalAvailable}</p>
              <p className="text-[10px] text-muted-foreground">Active Subscriptions</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search event types..."
              className="h-10 w-full rounded-lg border border-border bg-background/60 pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
          </div>
          
          <div className="flex gap-1">
            {(['all', 'subscribed', 'unsubscribed'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSelectedFilter(filter)}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors',
                  selectedFilter === filter
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background/60 text-muted-foreground hover:bg-accent'
                )}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading event source catalog...
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Filter className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">No event sources found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Try adjusting your search or filter to find available event sources.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSources.map((source) => {
              const Icon = source.icon;
              const isExpanded = expandedSource === source.id;
              
              return (
                <div
                  key={source.id}
                  className={cn(
                    'rounded-xl border transition-all',
                    isExpanded ? `${source.borderColor} ${source.bgColor} border-2` : 'border-border bg-background/50'
                  )}
                >
                  {/* Source Header */}
                  <button
                    type="button"
                    onClick={() => handleExpand(source.id)}
                    className="w-full p-4 flex items-start justify-between text-left"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center', source.bgColor)}>
                        <Icon className={cn('h-5 w-5', source.color)} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-semibold text-foreground">{source.name}</h3>
                          {source.activeSubscriptions > 0 && (
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', source.bgColor, source.color)}>
                              {source.activeSubscriptions} Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{source.description}</p>
                      </div>
                    </div>
                    <ChevronRight className={cn(
                      'h-5 w-5 text-muted-foreground transition-transform shrink-0 mt-1',
                      isExpanded && 'rotate-90'
                    )} />
                  </button>

                  {/* Expanded Event List */}
                  {isExpanded && (
                    <div className="border-t border-border/60 px-4 pb-4 pt-3">
                      <div className="space-y-2">
                        {source.events.map((event) => (
                          <div
                            key={event.id}
                            className={cn(
                              'rounded-lg border p-3 flex items-center justify-between transition-colors',
                              event.subscribed
                                ? 'border-emerald-500/30 bg-emerald-500/5'
                                : 'border-border bg-background/50'
                            )}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{event.name}</span>
                                {event.subscribed && (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                              {event.subscriptionCount && event.subscriptionCount > 0 && (
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {event.subscriptionCount} subscription{event.subscriptionCount > 1 ? 's' : ''} active
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={event.subscribed ? 'outline' : 'default'}
                              onClick={() => handleSubscribe(event.id, source.id)}
                              className="gap-1.5"
                            >
                              {event.subscribed ? (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Subscribed
                                </>
                              ) : (
                                <>
                                  <Plus className="h-3.5 w-3.5" />
                                  Subscribe
                                </>
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>

                      {/* Source-level info */}
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
                        <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                        <p className="text-muted-foreground">
                          Subscribing to these events will automatically route matching occurrences into your Decision Intelligence dashboard for monitoring and action.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-6 py-3 bg-background/30">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {filteredSources.length} event source{filteredSources.length !== 1 ? 's' : ''} available
          </span>
          <span className="text-muted-foreground">
            {totalSubscriptions} active subscription{totalSubscriptions !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export default EventSourceCatalog;
