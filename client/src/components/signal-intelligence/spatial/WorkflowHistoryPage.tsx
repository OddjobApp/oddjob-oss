import { useState } from 'react';
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { useLocation } from 'wouter';
import { ArrowLeft, History, Filter, Calendar, Search, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkflowSummaryCard } from './WorkflowSummaryCard';
import { WorkflowDetailView } from './WorkflowDetailView';
import { getWorkflowHistory, saveWorkflowOutput } from './WorkflowHistory';
import type { WorkflowOutput } from './WorkflowHistory';

function WorkflowHistoryPage() {
  const [, navigate] = useLocation();
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOutput | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'subscription' | 'cycle' | 'source' | 'monitor'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add Workflow Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const addPanelRef = useModalBehavior<HTMLDivElement>({
    isOpen: showAddModal,
    onClose: () => setShowAddModal(false),
  });
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<'threat' | 'opportunity'>('threat');
  const [newSeverity, setNewSeverity] = useState('HIGH');
  const [newSector, setNewSector] = useState('Logistics & Security');
  const [newActionType, setNewActionType] = useState<'subscription' | 'cycle' | 'source' | 'monitor'>('cycle');

  const workflows = getWorkflowHistory();
  
  const filteredWorkflows = workflows.filter(workflow => {
    const matchesType = filterType === 'all' || workflow.action.type === filterType;
    const matchesSearch = searchQuery === '' || 
      workflow.signal.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workflow.action.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleBack = () => {
    navigate('/signal-intelligence');
  };

  const handleCreateWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newWf: WorkflowOutput = {
      id: `wf-custom-${Date.now()}`,
      timestamp: new Date().toISOString(),
      signal: {
        id: `sig-${Date.now()}`,
        title: newTitle.trim(),
        kind: newKind,
        severity: newSeverity,
        targetSector: newSector.trim() || 'General Operations',
        jurisdiction: 'Global Mesh Network',
        eventType: `${newKind.toUpperCase()}_DISCOVERY`,
      },
      action: {
        type: newActionType,
        impact: newSeverity === 'CRITICAL' ? 'Critical' : newSeverity === 'HIGH' ? 'High' : 'Medium',
        description: `Executed ${newActionType} workflow: ${newTitle.trim()}`,
      },
      resource: {
        type: newActionType,
        id: `res-${Date.now()}`,
        name: `${newTitle.trim()} Resource`,
      },
      statusReview: {
        backboneStatus: 'ACTIVE',
        eventsPublished: 24,
        eventsProcessed: 24,
        failuresReviewed: 0,
      },
      completed: true,
    };

    saveWorkflowOutput(newWf);
    setShowAddModal(false);
    setNewTitle('');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="rounded-lg p-2 hover:bg-accent transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <History className="h-6 w-6" />
                  Signal Intelligence Workflow History
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  View and manage completed signal intelligence workflows
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {workflows.length} completed workflows
              </span>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Add Workflow
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="border-b border-border bg-card/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterType('all')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  filterType === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('subscription')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  filterType === 'subscription'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                Subscriptions
              </button>
              <button
                onClick={() => setFilterType('cycle')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  filterType === 'cycle'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                Cycles
              </button>
              <button
                onClick={() => setFilterType('source')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  filterType === 'source'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                Sources
              </button>
              <button
                onClick={() => setFilterType('monitor')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  filterType === 'monitor'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                Monitor
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <History className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No workflows found</h3>
            <p className="text-sm text-muted-foreground mt-2">
              {workflows.length === 0 
                ? 'Complete a wizard to see it here'
                : 'Try adjusting your filters or search query'}
            </p>
            {workflows.length === 0 && (
              <button
                onClick={handleBack}
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                Start New Wizard
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredWorkflows.map((workflow) => (
              <WorkflowSummaryCard
                key={workflow.id}
                workflow={workflow}
                onClick={() => navigate(`/signal-intelligence/workflows/${workflow.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Workflow Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            ref={addPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add a signal workflow"
            className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-xl relative animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                Add New Signal Workflow
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflow} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-foreground">Workflow Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Automated Perimeter Drone Response"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Signal Kind</label>
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as 'threat' | 'opportunity')}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="threat">Threat</option>
                    <option value="opportunity">Opportunity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Severity</label>
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Action Type</label>
                  <select
                    value={newActionType}
                    onChange={(e) => setNewActionType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="cycle">Cycle Launch</option>
                    <option value="subscription">Subscription Rule</option>
                    <option value="source">Source Configuration</option>
                    <option value="monitor">Status Review</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Target Sector</label>
                  <input
                    type="text"
                    placeholder="e.g. Defense & Logistics"
                    value={newSector}
                    onChange={(e) => setNewSector(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                >
                  Save Workflow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkflowHistoryPage;
