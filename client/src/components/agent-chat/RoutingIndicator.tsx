import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface ClassificationResult {
  topic: string;
  topicConfidence: number;
  intent: string;
  intentConfidence: number;
  combinedConfidence: number;
  selectedAgentCardId: number;
  selectedAgentCardName: string;
  resolvedModelProviderId: number;
  resolvedModelId: number;
  latencyMs: number;
}

interface AgentCard {
  id: number;
  name: string;
  description: string;
  personaType: string;
  capabilities: string[];
  topicAffinities: string[];
  intentAffinities: string[];
  modelBindingProviderId: number;
  modelBindingModelId: number;
  enabled: boolean;
}

export interface RoutingIndicatorProps {
  classification: ClassificationResult;
  messageContent: string;
  onOverride: (agentCardId: number) => void;
  enabledAgents: AgentCard[];
  isOverridden?: boolean;
  overriddenAgentName?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ============================================================================
// ROUTING INDICATOR COMPONENT
// ============================================================================

/**
 * Routing Decision Indicator — displays the classification result for a
 * routed message. Compact view shows Topic, Intent, and Agent name as a
 * clickable pill. Expanded view shows confidence scores and allows override.
 *
 * Requirements:
 * - 12.1: Display routing indicator showing Topic, Intent, Agent Card name
 * - 12.2: On click, show full ClassificationResult with confidence scores
 * - 12.3: On click, present override list of enabled Agent Cards
 * - 12.4: On override selection, resubmit message to new agent
 * - 12.5: Persist routing indicator in conversation history
 */
export function RoutingIndicator({
  classification,
  messageContent,
  onOverride,
  enabledAgents,
  isOverridden = false,
  overriddenAgentName,
}: RoutingIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isExpanded) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isExpanded]);

  const handleOverrideSelect = (agentCardId: number) => {
    setIsExpanded(false);
    onOverride(agentCardId);
  };

  // Filter out the currently selected agent from the override list
  const overrideAgents = enabledAgents.filter(
    (a) => a.id !== classification.selectedAgentCardId
  );

  return (
    <div ref={containerRef} className="relative inline-block" data-testid="routing-indicator">
      {/* Compact View — Pill/Badge */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
          'hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOverridden
            ? 'border-amber-300/60 bg-amber-50/80 text-amber-700'
            : 'border-border/60 bg-muted/40 text-muted-foreground'
        )}
        aria-expanded={isExpanded}
        aria-label={`Routing decision: ${classification.topic}, ${classification.intent}, ${classification.selectedAgentCardName}. Click to expand.`}
        data-testid="routing-indicator-pill"
      >
        <span className="rounded bg-background/60 px-1 py-0.5" data-testid="routing-topic">
          {classification.topic}
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="rounded bg-background/60 px-1 py-0.5" data-testid="routing-intent">
          {classification.intent}
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="font-semibold" data-testid="routing-agent-name">
          {isOverridden ? overriddenAgentName : classification.selectedAgentCardName}
        </span>
        {isOverridden && (
          <span className="text-amber-600" title="Routing was overridden">
            ⟳
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')}
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Expanded View — Full Classification Details + Override List */}
      {isExpanded && (
        <div
          className={cn(
            'absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border bg-popover p-3 shadow-lg',
            'animate-in fade-in-0 zoom-in-95'
          )}
          role="dialog"
          aria-label="Routing decision details"
          data-testid="routing-indicator-expanded"
        >
          {/* Confidence Scores Section */}
          <div className="mb-3">
            <h4 className="mb-2 text-xs font-semibold text-foreground">Classification Details</h4>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                <div className="text-muted-foreground">Topic</div>
                <div className="font-medium text-foreground">{classification.topic}</div>
                <div className="text-muted-foreground">
                  {formatConfidence(classification.topicConfidence)} confidence
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                <div className="text-muted-foreground">Intent</div>
                <div className="font-medium text-foreground">{classification.intent}</div>
                <div className="text-muted-foreground">
                  {formatConfidence(classification.intentConfidence)} confidence
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                <div className="text-muted-foreground">Combined</div>
                <div className="font-medium text-foreground">
                  {formatConfidence(classification.combinedConfidence)}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                <div className="text-muted-foreground">Latency</div>
                <div className="font-medium text-foreground">{classification.latencyMs}ms</div>
              </div>
            </div>
            <div className="mt-2 rounded-lg bg-primary/5 px-2 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Selected Agent: </span>
              <span className="font-medium text-primary">{classification.selectedAgentCardName}</span>
            </div>
          </div>

          {/* Override Section */}
          {overrideAgents.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-foreground">Override Routing</h4>
              <p className="mb-2 text-[10px] text-muted-foreground">
                Select a different agent to re-route this message:
              </p>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto" data-testid="override-agent-list">
                {overrideAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleOverrideSelect(agent.id)}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                      'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                    )}
                    data-testid={`override-agent-${agent.id}`}
                  >
                    <div>
                      <div className="font-medium text-foreground">{agent.name}</div>
                      <div className="text-muted-foreground">{agent.personaType}</div>
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3.5 w-3.5 text-muted-foreground"
                    >
                      <path
                        fillRule="evenodd"
                        d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RoutingIndicator;
