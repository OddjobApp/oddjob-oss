import { X, ChevronDown, ChevronRight, Bot, Sparkles, Radio, Activity, Clock, CheckCircle2, AlertTriangle, Edit, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { cn } from '@/lib/utils';
import { getWorkflowById } from './WorkflowHistory';
import type { WorkflowOutput } from './WorkflowHistory';

interface ExpandableSectionProps {
  title: string;
  icon: any;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function ExpandableSection({ title, icon: Icon, children, defaultOpen = true }: ExpandableSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 text-primary" />
          <span className="text-base font-semibold text-foreground">{title}</span>
        </div>
        {isOpen ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
      </button>
      {isOpen && <div className="p-4 pt-0 border-t border-border/40 mt-1">{children}</div>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

interface WorkflowDetailPageProps {
  /** Supplied when rendered inline (the dashboard already holds the workflow). */
  workflow?: WorkflowOutput;
  /** Supplied when rendered inline; otherwise closing navigates back. */
  onClose?: () => void;
}

/**
 * Works both as a route (/signal-intelligence/workflows/:id) and as an inline
 * panel the dashboard renders over itself.
 *
 * SignalDashboard passes the already-loaded workflow and an onClose, so this
 * took props it did not declare — a type error, and it would have ignored the
 * given workflow and re-looked-up an id the URL does not carry in that context.
 * Falls back to the route parameter when mounted as a page, mirroring how
 * SignalIntelligenceWizardPage handles the same dual use.
 */
export function WorkflowDetailPage({ workflow: workflowProp, onClose }: WorkflowDetailPageProps = {}) {
  const [, navigate] = useLocation();
  const { id } = useParams<{ id: string }>();
  const workflow = workflowProp ?? getWorkflowById(id || '');

  /** Close the inline panel if there is one; otherwise go back to the list. */
  const dismiss = () => (onClose ? onClose() : navigate('/signal-intelligence/workflows'));

  if (!workflow) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md bg-card border border-border rounded-xl p-8 shadow-lg">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground">Workflow Not Found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The requested signal intelligence workflow (ID: {id || 'unknown'}) could not be located.
          </p>
          <button
            onClick={dismiss}
            className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            Back to Workflow History
          </button>
        </div>
      </div>
    );
  }

  const getActionIcon = () => {
    switch (workflow.action.type) {
      case 'subscription': return Bot;
      case 'cycle': return Sparkles;
      case 'source': return Radio;
      case 'monitor': return Activity;
      default: return Activity;
    }
  };

  const getActionColor = () => {
    switch (workflow.action.type) {
      case 'subscription': return 'bg-blue-500/15 text-blue-400 border border-blue-500/20';
      case 'cycle': return 'bg-purple-500/15 text-purple-400 border border-purple-500/20';
      case 'source': return 'bg-amber-500/15 text-amber-400 border border-amber-500/20';
      case 'monitor': return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
      default: return 'bg-slate-500/15 text-muted-foreground border border-slate-500/20';
    }
  };

  const ActionIcon = getActionIcon();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/40 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={dismiss}
                className="rounded-lg p-2 hover:bg-accent transition-colors"
                title="Back to History"
              >
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </button>
              <div className="flex items-center gap-3">
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', getActionColor())}>
                  <ActionIcon className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">
                    Workflow Details
                  </h1>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Completed {new Date(workflow.timestamp).toLocaleString()}
                    {typeof workflow.duration === 'number' && ` · Duration ${workflow.duration}s`}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={dismiss}
                className="px-3.5 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors text-foreground"
              >
                Back to History
              </button>
              <button
                onClick={() => navigate(`/signal-intelligence/workflows/${workflow.id}/edit`)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Edit className="h-4 w-4" />
                Edit Workflow
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Signal Section */}
        <ExpandableSection title="Selected Signal" icon={Activity}>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
              <h3 className="text-base font-semibold text-foreground">{workflow.signal.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Target Sector: <span className="font-medium text-foreground">{workflow.signal.targetSector}</span> · Jurisdiction: <span className="font-medium text-foreground">{workflow.signal.jurisdiction}</span>
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              <DetailRow label="Signal ID" value={workflow.signal.id} />
              <DetailRow label="Kind" value={workflow.signal.kind.toUpperCase()} />
              {typeof workflow.signal.score === 'number' && (
                <DetailRow label="Threat/Opp Score" value={workflow.signal.score} />
              )}
              {workflow.signal.confidence && (
                <DetailRow label="Confidence" value={workflow.signal.confidence} />
              )}
              <DetailRow label="Severity" value={workflow.signal.severity} />
              <DetailRow label="Event Type" value={workflow.signal.eventType} />
            </div>
          </div>
        </ExpandableSection>

        {/* Action Section */}
        <ExpandableSection title="Executed Action" icon={ActionIcon}>
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3">
              <span className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider',
                workflow.action.impact === 'Critical' ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                workflow.action.impact === 'High' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' :
                workflow.action.impact === 'Medium' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' :
                'bg-slate-500/15 text-muted-foreground border border-slate-500/20'
              )}>
                {workflow.action.impact} Impact
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                Action Type: <strong className="text-foreground uppercase">{workflow.action.type}</strong>
              </span>
            </div>
            <p className="text-sm text-foreground bg-card/60 border border-border p-3.5 rounded-lg leading-relaxed">
              {workflow.action.description}
            </p>
          </div>
        </ExpandableSection>

        {/* Resource Section */}
        {workflow.resource && (
          <ExpandableSection title="Created Resource" icon={CheckCircle2}>
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-4">
                <p className="text-base font-semibold text-foreground">{workflow.resource.name || 'Unnamed Resource'}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Resource ID: <span className="font-mono text-foreground">{workflow.resource.id || 'N/A'}</span>
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailRow label="Resource Type" value={workflow.resource.type} />
                {workflow.resource.details && Object.entries(workflow.resource.details).map(([key, value]) => (
                  <DetailRow key={key} label={key} value={String(value)} />
                ))}
              </div>
            </div>
          </ExpandableSection>
        )}

        {/* Status Review Section */}
        {workflow.statusReview && (
          <ExpandableSection title="Status & Metric Review" icon={AlertTriangle}>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-3 bg-card border border-border rounded-lg text-center">
                  <span className="text-xs text-muted-foreground block">Backbone Status</span>
                  <span className="text-base font-bold text-primary mt-1 block">{workflow.statusReview.backboneStatus}</span>
                </div>
                <div className="p-3 bg-card border border-border rounded-lg text-center">
                  <span className="text-xs text-muted-foreground block">Published Events</span>
                  <span className="text-base font-bold text-foreground mt-1 block">{workflow.statusReview.eventsPublished}</span>
                </div>
                <div className="p-3 bg-card border border-border rounded-lg text-center">
                  <span className="text-xs text-muted-foreground block">Processed Events</span>
                  <span className="text-base font-bold text-emerald-400 mt-1 block">{workflow.statusReview.eventsProcessed}</span>
                </div>
                <div className="p-3 bg-card border border-border rounded-lg text-center">
                  <span className="text-xs text-muted-foreground block">Failures Reviewed</span>
                  <span className="text-base font-bold text-amber-400 mt-1 block">{workflow.statusReview.failuresReviewed}</span>
                </div>
              </div>
            </div>
          </ExpandableSection>
        )}

        {/* Metadata Section */}
        <ExpandableSection title="System Metadata" icon={Clock} defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 pt-2">
            <DetailRow label="Workflow ID" value={workflow.id} />
            {typeof workflow.duration === 'number' && (
              <DetailRow label="Execution Duration" value={`${workflow.duration} seconds`} />
            )}
            <DetailRow label="Completed Timestamp" value={new Date(workflow.timestamp).toLocaleString()} />
            <DetailRow label="Lifecycle State" value={workflow.completed ? 'Completed' : 'Incomplete'} />
          </div>
        </ExpandableSection>
      </div>
    </div>
  );
}

// Backwards compatibility export
export const WorkflowDetailView = WorkflowDetailPage;
export default WorkflowDetailPage;
