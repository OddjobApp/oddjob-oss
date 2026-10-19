import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWizard } from './WizardContext';
import type { IntelligenceSignal, SignalEvent } from './utils';
import { cn } from '@/lib/utils';
import { Radio, Plus, Wand2, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { SourcesView } from './SourcesView';

/*
  The shared SignalEvent, not a local copy.

  This file declared its own EventPrimitiveDto with `rawText?: string` while
  SignalEvent — the type IntelligenceSignal.event actually holds — declares
  `rawText: string | null`. Two shapes for one payload meant the mapped signals
  could not be assigned to IntelligenceSignal[] at all, and the divergence would
  have kept drifting.
*/
type EventPrimitiveDto = SignalEvent;

interface SignalDetectionPanelProps {
  onSignalSelect: (signal: IntelligenceSignal) => void;
}

export function SignalDetectionPanel({ onSignalSelect }: SignalDetectionPanelProps) {
  const { state, setSelectedAction, setCurrentStep } = useWizard();
  const [showSourceForm, setShowSourceForm] = useState(false);
  const { data: events = [], isLoading } = useQuery<EventPrimitiveDto[]>({ queryKey: ['/api/event-primitives?limit=100'] });

  const signals: IntelligenceSignal[] = (events || []).map((event) => {
    const threat = event.severity === 'Critical' || event.severity === 'High';
    const timestamp = new Date(event.extractionTimestamp);
    const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 60000));
    return {
      id: event.id,
      title: event.rawText?.trim().split(/[.!?]/)[0]?.slice(0, 110) || event.eventType.replaceAll('_', ' '),
      subtitle: `${event.targetSector} · ${event.jurisdiction}`,
      kind: threat ? 'threat' : 'opportunity',
      score: Math.round(event.confidenceScore * 100),
      age: elapsedMinutes < 60 ? `${elapsedMinutes}m ago` : `${Math.round(elapsedMinutes / 60)}h ago`,
      impact: `${event.severity} impact · ${event.targetSector}`,
      confidence: event.confidenceScore >= .8 ? 'High' : event.confidenceScore >= .5 ? 'Medium' : 'Low',
      event,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Select a Signal</h3>
          <p className="text-sm text-muted-foreground">
            Choose a signal from the feed or define a new signal source directly in this panel.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSourceForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors shadow-sm"
          >
            <Server className="h-3.5 w-3.5" />
            {showSourceForm ? 'Hide Source Form' : '+ Define Signal Source'}
            {showSourceForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {signals.length} signals available
          </span>
        </div>
      </div>

      {/* Inline Source Definition Form */}
      {(showSourceForm || signals.length === 0) && (
        <div className="rounded-xl border border-primary/30 bg-card/60 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Radio className="h-4 w-4 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Define Signal Source Feed In-Place</h4>
                <p className="text-xs text-muted-foreground">
                  Connect RSS feeds, API endpoints, or Webhooks directly in Step 1 to stream live signals into the panel.
                </p>
              </div>
            </div>
            {signals.length > 0 && (
              <button
                onClick={() => setShowSourceForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close Form
              </button>
            )}
          </div>

          <SourcesView wizardMode={false} />
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Loading signals...
        </div>
      ) : signals.length === 0 ? null : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {signals.map((signal) => (
            <button
              key={signal.id}
              onClick={() => onSignalSelect(signal)}
              className={cn(
                'w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50',
                state.selectedSignal?.id === signal.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      signal.kind === 'opportunity' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    )}>
                      {signal.kind}
                    </span>
                    <span className="text-xs text-muted-foreground">Score {signal.score}</span>
                  </div>
                  <h4 className="text-sm font-medium">{signal.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{signal.subtitle}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{signal.age}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{signal.confidence} confidence</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {state.selectedSignal ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-primary">
              ✓ Selected: {state.selectedSignal.title}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Ready to configure routing triage logic &amp; response rules
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedAction('subscription');
              setCurrentStep(3);
            }}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
          >
            Open Rule Builder →
          </button>
        </div>
      ) : (
        signals.length > 0 && (
          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                onSignalSelect(signals[0]);
                setSelectedAction('subscription');
                setCurrentStep(3);
              }}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
            >
              Open Rule Builder →
            </button>
          </div>
        )
      )}
    </div>
  );
}
