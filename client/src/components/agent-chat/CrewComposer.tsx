import { useState, useRef, useEffect, useMemo } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Send,
  X,
  Terminal,
  Sparkles,
  Bot,
  MonitorPlay,
  Presentation,
  Layers,
  FileText,
  Network,
  MessageSquareCode,
  ShieldCheck,
  ChevronDown,
  MapPin,
  ImagePlus,
  Hash,
} from 'lucide-react';
import { accentFor } from './crew-style-helpers';
import { CrewAgentHat } from './CrewAgentHat';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  extractOutputIntentFromMessage,
  OUTPUT_INTENT_DESCRIPTORS,
  type CrewOutputIntent,
} from '@shared/crew-output-intent';
import type { AgentCard } from './AgentChatPanel';
import { type AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import {
  SelectedWorkstreamContextHUD,
  assemblyScopePrefix,
  ASSEMBLY_ACCENT,
  DEFAULT_ACCENT,
} from './SelectedWorkstreamContextHUD';

export const SLASH_COMMANDS = [
  { command: '/present', name: 'Presentation Deck', description: 'Generate an interactive multi-slide executive deck or deliverable', example: '/present Incident review', icon: Presentation },
  { command: '/deck', name: 'Slide Deck', description: 'Compile discussion into a visual presentation deck deliverable', example: '/deck Product roadmap', icon: Presentation },
  { command: '/app', name: 'Build Instant App', description: 'Build and render a live app, calculator, or widget on the fly', example: '/app weather app', icon: Layers },
  { command: '/map', name: 'Interactive Map', description: 'Display an interactive geographic map with markers and live GPS locating', example: '/map Branch offices in Seattle', icon: MapPin },
  { command: '/doc', name: 'Author Document', description: 'Open Scribe Studio to draft or revise a PRD or document', example: '/doc Technical RFC', icon: FileText },
  { command: '/diagram', name: 'Workflow Diagram / X-Ray', description: 'Render an interactive Mermaid workflow diagram or system X-Ray', example: '/diagram Payment pipeline', icon: Network },
  { command: '/image', name: 'Generate AI Image', description: 'Generate an image from a text prompt and render it inline', example: '/image Neon-lit city skyline at dusk', icon: ImagePlus },
  { command: '/deliberate', name: 'Deliberate & Discuss', description: 'Focus multi-agent debate on trade-offs without mounting builder surfaces', example: '/deliberate Architecture options', icon: MessageSquareCode },
  { command: '/audit', name: 'Audit & Governance', description: 'Review governance compliance, policies, and HIL attestation gates', example: '/audit Release readiness', icon: ShieldCheck },
  { command: '/teach', name: 'Teach a Task', description: 'Demonstrate a browser task on the live desktop to create a repeatable skill', example: '/teach Download monthly invoice', icon: MonitorPlay },
  { command: '/studio', name: 'Mount Studio', description: 'Mount an operations studio (computer, forge, form, scribe, flow)', example: '/studio computer', icon: Terminal },
  { command: '/plan', name: 'Workstream Plan', description: 'Direct agents to generate an operational blueprint and plan', example: '/plan Automate invoice ingestion', icon: Sparkles },
];

export interface CrewComposerProps {
  attachmentControlRef?: (element: HTMLDivElement | null) => void;
  allowQueue?: boolean;
  onSend: (v: string, options?: { outputIntent?: CrewOutputIntent }) => void;
  disabled: boolean;
  memberCount: number;
  /** Provided only while a round is in flight; swaps Send for Cancel. */
  onCancel?: () => void;
  initialValue?: string;
  draftValue?: string;
  /** Assembly layer the message will be applied to, if one is selected. */
  assemblyUnit?: AssemblyUnitSelection | null;
  onClearAssemblyUnit?: () => void;
  agents: AgentCard[];
  /** Explicit indicator that agents are actively deliberating / responding. */
  isBusy?: boolean;
  /** Topic labels already declared in this room — surfaced first in # lookup. */
  recentTopics?: string[];
}

export function CrewComposer({
  attachmentControlRef,
  allowQueue = false,
  onSend,
  disabled,
  memberCount,
  onCancel,
  initialValue = '',
  draftValue,
  assemblyUnit = null,
  onClearAssemblyUnit,
  agents,
  isBusy: isBusyProp,
  recentTopics = [],
}: CrewComposerProps) {
  const isBusy = isBusyProp ?? (disabled && Boolean(onCancel));
  const [value, setValue] = useState(draftValue || initialValue);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [topic, setTopic] = useState<{ query: string; start: number; bracketed: boolean } | null>(null);
  const [highlightedMention, setHighlightedMention] = useState(0);
  const [highlightedTopic, setHighlightedTopic] = useState(0);
  const [highlightedSlash, setHighlightedSlash] = useState(0);
  const [selectedIntent, setSelectedIntent] = useState<CrewOutputIntent>('auto');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, Math.max(44, input.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (draftValue !== undefined && draftValue !== '') {
      setValue(draftValue);
    }
  }, [draftValue]);

  const slashMatches = useMemo(() => {
    if (!value.startsWith('/')) return [];
    const match = value.match(/^\/([a-zA-Z0-9_-]*)$/);
    if (!match) return [];
    const q = match[1].toLowerCase();
    return SLASH_COMMANDS.filter((cmd) => cmd.command.slice(1).startsWith(q));
  }, [value]);

  // Knowledge topics for the #[topic] lookup — the same endpoint the
  // Knowledge store page reads, fetched lazily the first time the trigger
  // opens rather than eagerly on every composer mount.
  const [knowledgeTopics, setKnowledgeTopics] = useState<Array<{ id: number; name: string; documentCount?: number }>>([]);
  const topicsFetchedRef = useRef(false);
  useEffect(() => {
    if (!topic || topicsFetchedRef.current) return;
    topicsFetchedRef.current = true;
    let cancelled = false;
    apiRequest('GET', '/api/knowledge/topics')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setKnowledgeTopics(data?.topics ?? []);
      })
      .catch(() => {
        topicsFetchedRef.current = false; // a failed fetch may retry next trigger
      });
    return () => { cancelled = true; };
  }, [topic]);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase().trim();
    if (!q) return agents.slice(0, 8);
    const matches = agents.filter((a) => {
      const nameMatch = a.name.toLowerCase().includes(q);
      const archetypeMatch = a.soulArchetype?.toLowerCase().includes(q);
      const personaMatch = a.personaType?.toLowerCase().includes(q);
      const capabilityMatch = a.capabilities?.some((c) => c.toLowerCase().includes(q));
      return nameMatch || archetypeMatch || personaMatch || capabilityMatch;
    });

    return matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    }).slice(0, 8);
  }, [mention, agents]);

  /**
   * Topic suggestions for the # trigger. Room-recent labels lead, then the
   * org/project knowledge_topics vocabulary; a trailing "create" row previews
   * the freeform topic that sending the tag will mint.
   */
  const topicMatches = useMemo(() => {
    if (!topic) return [];
    const q = topic.query.toLowerCase().trim();
    const seen = new Set<string>();
    const results: Array<{ id: number | null; name: string; recent?: boolean; documentCount?: number }> = [];

    const push = (name: string, entry: { id: number | null; documentCount?: number; recent?: boolean }) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      if (q && !key.includes(q)) return;
      seen.add(key);
      results.push({ id: entry.id, name, recent: entry.recent, documentCount: entry.documentCount });
    };

    for (const name of recentTopics) push(name, { id: null, recent: true });
    for (const t of knowledgeTopics) push(t.name, { id: t.id, documentCount: t.documentCount });

    return results.slice(0, 8);
  }, [topic, knowledgeTopics, recentTopics]);

  const showTopicCreate = useMemo(() => {
    if (!topic) return false;
    const q = topic.query.trim();
    if (q.length < 2) return false;
    return !topicMatches.some((t) => t.name.toLowerCase() === q.toLowerCase());
  }, [topic, topicMatches]);

  const topicOptionCount = topicMatches.length + (showTopicCreate ? 1 : 0);

  /**
   * Agents whose role or learned topic affinities match the topic query —
   * the "ask @agent about #tag" handoff, closing the routing loop from a
   * declared topic back to the agents who have tagged it before.
   */
  const topicAgents = useMemo(() => {
    if (!topic) return [];
    const q = topic.query.toLowerCase().trim();
    if (q.length < 2) return [];
    return agents.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.personaType?.toLowerCase().includes(q) ||
      a.soulArchetype?.toLowerCase().includes(q) ||
      a.capabilities?.some((c) => c.toLowerCase().includes(q)) ||
      a.topicAffinities?.some((t) => t.toLowerCase().includes(q)) ||
      a.topicLabelAffinities?.some((l) => l.label.toLowerCase().includes(q))
    ).slice(0, 3);
  }, [topic, agents]);

  /** Compose "@Agent #tag" — direct the tagged question at a known expert. */
  const askAgentAboutTopic = (agent: AgentCard) => {
    if (!topic) return;
    const beforeHash = value.slice(0, topic.start);
    const consumed = 1 + (topic.bracketed ? 1 : 0) + topic.query.length;
    const afterQuery = value.slice(topic.start + consumed);
    const label = topic.query.trim();
    const tag = label.includes(' ') ? `#[${label}]` : `#${label.toLowerCase().replace(/\s+/g, '-')}`;
    const newValue = `${beforeHash}@${agent.name} ${tag} ${afterQuery ? afterQuery.trimStart() : ''}`;
    setValue(newValue);
    setTopic(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const insertTopic = (name: string) => {
    if (!topic) return;
    const beforeHash = value.slice(0, topic.start);
    const consumed = 1 + (topic.bracketed ? 1 : 0) + topic.query.length;
    const afterQuery = value.slice(topic.start + consumed);
    // Multi-word labels need the bracketed spelling to parse server-side.
    const inserted = name.includes(' ') ? `#[${name}] ` : `#${name.toLowerCase().replace(/\s+/g, '-')} `;
    const newValue = `${beforeHash}${inserted}${afterQuery ? afterQuery.trimStart() : ''}`;
    setValue(newValue);
    setTopic(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  /**
   * The # trigger: a # at a word boundary followed by at least 2 query
   * characters. `#[` opens the bracketed form, where the query may contain
   * spaces until `]` closes it (or the cursor runs past).
   */
  const updateTopicFromInput = (input: HTMLTextAreaElement) => {
    const cursor = input.selectionStart;
    const before = input.value.slice(0, cursor);
    const lastHashIndex = before.lastIndexOf('#');
    if (lastHashIndex === -1) {
      setTopic(null);
      return;
    }
    if (lastHashIndex > 0 && /[a-zA-Z0-9_]/.test(before[lastHashIndex - 1])) {
      setTopic(null);
      return;
    }
    const candidate = before.slice(lastHashIndex + 1);
    const bracketed = candidate.startsWith('[');
    const query = bracketed ? candidate.slice(1) : candidate;
    if (query.includes(']')) {
      setTopic(null);
      return;
    }
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_ -]*$/.test(query) || query.length < 2) {
      setTopic(null);
      return;
    }
    setTopic({ query, start: lastHashIndex, bracketed });
    setHighlightedTopic(0);
  };

  const insertMention = (agent: AgentCard) => {
    if (!mention) return;
    const beforeAt = value.slice(0, mention.start);
    const afterQuery = value.slice(mention.start + 1 + mention.query.length);
    const newValue = `${beforeAt}@${agent.name} ${afterQuery ? afterQuery.trimStart() : ''}`;
    setValue(newValue);
    setMention(null);
    // Return focus to the textarea after a state update so the caret can be set
    // on the next tick if the caller needs it.
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const updateMentionFromInput = (input: HTMLTextAreaElement) => {
    const cursor = input.selectionStart;
    const before = input.value.slice(0, cursor);
    const lastAtIndex = before.lastIndexOf('@');
    if (lastAtIndex !== -1 && (lastAtIndex === 0 || /\s/.test(before[lastAtIndex - 1]))) {
      const candidate = before.slice(lastAtIndex + 1);
      // Require at least 3 letters as per requirement
      if (candidate.length >= 3 && /^[a-zA-Z0-9_ -]+$/.test(candidate)) {
        const q = candidate.toLowerCase();
        const hasMatchingAgent = agents.some((a) =>
          a.name.toLowerCase().includes(q) ||
          (a.soulArchetype && a.soulArchetype.toLowerCase().includes(q)) ||
          (a.personaType && a.personaType.toLowerCase().includes(q)) ||
          (a.capabilities && a.capabilities.some((c) => c.toLowerCase().includes(q)))
        );
        if (hasMatchingAgent) {
          setMention({ query: candidate, start: lastAtIndex });
          setHighlightedMention(0);
          return;
        }
      }
    }
    setMention(null);
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    // Check for /teach slash command
    const teachMatch = trimmed.match(/^\/teach(?:\s+(.*))?$/i);
    if (teachMatch) {
      const goal = teachMatch[1]?.trim() || '';
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search);
        sp.set('studio', 'computer');
        sp.set('teach', '1');
        if (goal) sp.set('goal', goal);
        const newUrl = `${window.location.pathname}?${sp.toString()}`;
        window.history.pushState({}, '', newUrl);
        window.dispatchEvent(new CustomEvent('oddjob:open-teach-task', { detail: { goal } }));
      }
      onSend(`[Task Demonstration Initiated] ${goal ? `Demonstrating workflow: "${goal}"` : 'Opening live desktop in Teach Mode to demonstrate workflow.'}`);
      setValue('');
      onClearAssemblyUnit?.();
      return;
    }

    // Check for /studio slash command
    const studioMatch = trimmed.match(/^\/studio(?:\s+([a-zA-Z0-9_-]+))?$/i);
    if (studioMatch) {
      const studioName = studioMatch[1]?.trim().toLowerCase() || 'computer';
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search);
        sp.set('studio', studioName);
        const newUrl = `${window.location.pathname}?${sp.toString()}`;
        window.history.pushState({}, '', newUrl);
        window.dispatchEvent(new CustomEvent('oddjob:mount-studio', { detail: { studio: studioName } }));
      }
      onSend(`Mounting ${studioName} studio.`);
      setValue('');
      onClearAssemblyUnit?.();
      return;
    }

    // The selected layer has to travel with the message. Showing "Applies to
    // Pipeline DAG" while sending the bare text meant the room received the
    // identical request either way, and the chip promised a scoping that
    // nothing downstream could act on.
    const extracted = extractOutputIntentFromMessage(trimmed);
    const effectiveIntent = extracted.outputIntent || (selectedIntent !== 'auto' ? selectedIntent : undefined);
    const messageToSend = extracted.outputIntent ? (extracted.cleanMessage || trimmed) : trimmed;

    onSend(
      assemblyUnit ? `${assemblyScopePrefix(assemblyUnit)} ${messageToSend}` : messageToSend,
      effectiveIntent ? { outputIntent: effectiveIntent } : undefined,
    );
    setValue('');
    if (selectedIntent !== 'auto') {
      setSelectedIntent('auto');
    }
    // One message, one target: a stale chip would silently re-scope every
    // later message to a layer the user selected minutes ago.
    onClearAssemblyUnit?.();
  };

  return (
    <div className="border-t border-border/60 px-4 py-3 relative">
      {selectedIntent !== 'auto' && (
        <div data-testid="crew-active-intent-pill" className="flex items-center gap-1.5 px-2 py-0.5 mb-1.5 rounded border border-primary/30 bg-primary/10 text-xs text-primary w-fit">
          <span className="font-semibold text-[11px]">Output Mode:</span>
          <span className="text-[11px]">{OUTPUT_INTENT_DESCRIPTORS[selectedIntent].label}</span>
          <button
            type="button"
            onClick={() => setSelectedIntent('auto')}
            className="ml-1 text-primary/70 hover:text-primary transition-colors"
            title="Reset to Auto"
            data-testid="crew-clear-output-intent"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {assemblyUnit && (
        <SelectedWorkstreamContextHUD
          assemblyUnit={assemblyUnit}
          onClear={onClearAssemblyUnit}
          // The editor's change request goes straight to the room, bypassing the
          // textarea: it is already a complete, scoped instruction.
          onSend={(message) => {
            onSend(message);
            onClearAssemblyUnit?.();
          }}
        />
      )}
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-card/60 p-2 shadow-soft backdrop-blur-md relative overflow-hidden transition-all duration-200',
          isBusy
            ? 'border-primary/50 bg-primary/[0.04] ring-1 ring-primary/20'
            : assemblyUnit
            ? (ASSEMBLY_ACCENT[assemblyUnit.type]?.border || DEFAULT_ACCENT.border)
            : 'border-border/60 focus-within:border-primary/40',
        )}
      >
        {isBusy && (
          <div
            className="absolute top-0 left-0 right-0 h-0.5 bg-primary/20 overflow-hidden"
            data-testid="crew-composer-busy-progress"
          >
            <div className="h-full w-full bg-primary/70 animate-pulse" />
          </div>
        )}
        {attachmentControlRef && <div ref={attachmentControlRef} className="shrink-0" data-testid="crew-composer-attachment-control" />}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateMentionFromInput(e.target);
            updateTopicFromInput(e.target);
          }}
          onKeyDown={(e) => {
            if (slashMatches.length > 0 && !mention) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedSlash((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedSlash((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                setValue(`${slashMatches[highlightedSlash].command} `);
                setTimeout(() => textareaRef.current?.focus(), 0);
                return;
              }
              if (e.key === 'Escape') {
                setValue('');
                return;
              }
            }
            if (topic && topicOptionCount > 0 && !mention) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedTopic((h) => (h + 1) % topicOptionCount);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedTopic((h) => (h - 1 + topicOptionCount) % topicOptionCount);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const hit = topicMatches[highlightedTopic];
                insertTopic(hit ? hit.name : topic.query.trim());
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setTopic(null);
                return;
              }
            }
            if (mention && mentionMatches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedMention((i) => (i + 1) % mentionMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedMention((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(mentionMatches[highlightedMention]);
                return;
              }
              if (e.key === 'Escape') {
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={
            isBusy && !allowQueue
              ? 'Agents are responding…'
              : memberCount === 0
              ? 'Add at least one agent to the meeting to begin…'
              : 'Type /present, /app, /doc, or ask a question…'
          }
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="crew-composer"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1 border border-border/40 bg-card/40"
                title="Select Deliverable Output Mode (Optional)"
                data-testid="crew-output-intent-trigger"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline font-medium">
                  {selectedIntent === 'auto' ? 'Mode: Auto' : OUTPUT_INTENT_DESCRIPTORS[selectedIntent].label}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-card border border-border/60 shadow-soft">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Output Intent Mode</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.values(OUTPUT_INTENT_DESCRIPTORS).map((desc) => (
                <DropdownMenuItem
                  key={desc.id}
                  onClick={() => setSelectedIntent(desc.id)}
                  className={cn(
                    "text-xs flex items-center justify-between cursor-pointer",
                    selectedIntent === desc.id && "bg-primary/10 text-primary font-medium"
                  )}
                  data-testid={`crew-intent-option-${desc.id}`}
                >
                  <span>{desc.label}</span>
                  {desc.slashCommand && (
                    <span className="font-mono text-[10px] text-muted-foreground">{desc.slashCommand}</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {onCancel && (
            <Button
              onClick={onCancel}
              size="sm"
              variant="outline"
              className="gap-1.5"
              data-testid="crew-cancel"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {(!onCancel || allowQueue) && (
            <Button
              onClick={submit}
              disabled={disabled || !value.trim()}
              size="sm"
              className="gap-1.5"
              data-testid="crew-send"
            >
              <Send className="h-3.5 w-3.5" />
              {isBusy && allowQueue ? 'Queue' : 'Send'}
            </Button>
          )}
        </div>
      </div>
      {slashMatches.length > 0 && !mention && (
        <div
          className="absolute left-4 right-4 bottom-full mb-1 rounded-md border border-border/60 bg-card/95 p-1 shadow-soft backdrop-blur-md z-50"
          data-testid="crew-slash-command-popover"
        >
          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1 tracking-wider">
            Available Slash Commands
          </div>
          <div className="max-h-48 overflow-auto space-y-0.5">
            {slashMatches.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.command}
                  type="button"
                  onClick={() => {
                    setValue(`${cmd.command} `);
                    setTimeout(() => textareaRef.current?.focus(), 0);
                  }}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded text-sm flex items-center justify-between transition-colors',
                    i === highlightedSlash
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted/60 text-foreground'
                  )}
                  data-testid={`crew-slash-option-${cmd.command.slice(1)}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <span className="font-mono font-semibold">{cmd.command}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 font-mono hidden sm:inline">{cmd.example}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {mention && mentionMatches.length > 0 && (
        <div
          className="absolute left-4 right-4 bottom-full mb-1 rounded-xl border border-border/70 bg-card/95 p-1.5 shadow-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
          data-testid="crew-mention-popover"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-primary">
              <Bot className="h-3.5 w-3.5" />
              Squad Agent Pills
            </span>
            <span className="text-[9px] font-normal normal-case opacity-75 hidden sm:inline text-muted-foreground">
              ↑↓ to navigate · ↵ or Tab to select · Esc to cancel
            </span>
          </div>
          <div className="max-h-56 overflow-auto py-1 space-y-1" role="listbox" aria-label="Agent pill suggestions">
            {mentionMatches.map((agent, i) => {
              const accent = accentFor(agent.name);
              const archetypeOrPersona = agent.soulArchetype ?? agent.personaType;
              const isHighlighted = i === highlightedMention;

              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => insertMention(agent)}
                  className={cn(
                    'w-full text-left p-2 rounded-lg transition-all duration-150 flex items-center justify-between gap-3 group',
                    isHighlighted
                      ? 'bg-primary/10 border border-primary/30 shadow-xs'
                      : 'hover:bg-muted/60 border border-transparent'
                  )}
                  data-testid={`crew-mention-option-${agent.id}`}
                  role="option"
                  aria-selected={isHighlighted}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md transition-transform group-hover:scale-105', accent.tile)}>
                      <CrewAgentHat name={agent.name} personaType={agent.personaType} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-xs text-foreground truncate">
                          @{agent.name}
                        </span>
                        {archetypeOrPersona && (
                          <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.2 text-[9px] font-mono font-medium text-primary">
                            {archetypeOrPersona}
                          </span>
                        )}
                        {agent.enabled && (
                          <span className="hidden sm:inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Squad
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate max-w-sm">
                        {agent.legend || agent.description || 'Autonomous agent'}
                        {agent.capabilities?.length ? ` · ${agent.capabilities.slice(0, 3).join(', ')}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono">
                    {isHighlighted && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] border border-border/50 text-foreground">
                        ↵ select
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {topic && topicOptionCount > 0 && !mention && (
        <div
          className="absolute left-4 right-4 bottom-full mb-1 rounded-xl border border-border/70 bg-card/95 p-1.5 shadow-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
          data-testid="crew-topic-popover"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-primary">
              <Hash className="h-3.5 w-3.5" />
              Topics
            </span>
            <span className="text-[9px] font-normal normal-case opacity-75 hidden sm:inline text-muted-foreground">
              ↑↓ to navigate · ↵ or Tab to select · Esc to cancel
            </span>
          </div>
          <div className="max-h-56 overflow-auto py-1 space-y-1" role="listbox" aria-label="Topic suggestions">
            {topicMatches.map((t, i) => {
              const isHighlighted = i === highlightedTopic;
              return (
                <button
                  key={t.id ?? `recent-${t.name}`}
                  type="button"
                  onClick={() => insertTopic(t.name)}
                  className={cn(
                    'w-full text-left p-2 rounded-lg transition-all duration-150 flex items-center justify-between gap-3',
                    isHighlighted
                      ? 'bg-primary/10 border border-primary/30 shadow-xs'
                      : 'hover:bg-muted/60 border border-transparent'
                  )}
                  data-testid={`crew-topic-option-${t.id ?? t.name}`}
                  role="option"
                  aria-selected={isHighlighted}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Hash className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-foreground truncate">#{t.name}</span>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {t.recent ? 'Used in this room' : t.documentCount ? `${t.documentCount} document${t.documentCount === 1 ? '' : 's'}` : 'Knowledge topic'}
                      </p>
                    </div>
                  </div>
                  {isHighlighted && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] border border-border/50 text-foreground shrink-0">
                      ↵ select
                    </span>
                  )}
                </button>
              );
            })}
            {showTopicCreate && (
              <button
                type="button"
                onClick={() => insertTopic(topic.query.trim())}
                className={cn(
                  'w-full text-left p-2 rounded-lg transition-all duration-150 flex items-center gap-2.5',
                  highlightedTopic === topicMatches.length
                    ? 'bg-primary/10 border border-primary/30 shadow-xs'
                    : 'hover:bg-muted/60 border border-transparent'
                )}
                data-testid="crew-topic-create"
                role="option"
                aria-selected={highlightedTopic === topicMatches.length}
              >
                <span className="grid h-5 w-5 place-items-center rounded border border-dashed border-primary/50 text-primary text-xs leading-none">+</span>
                <span className="text-xs text-foreground truncate">
                  Create <span className="font-semibold">#{topic.query.trim()}</span> as a new topic
                </span>
              </button>
            )}
          </div>
          {topicAgents.length > 0 && (
            <div className="border-t border-border/40 py-1" aria-label="Agents on this topic">
              <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Agents on this topic
              </p>
              {topicAgents.map((a) => (
                <button
                  key={`topic-agent-${a.id}`}
                  type="button"
                  onClick={() => askAgentAboutTopic(a)}
                  className="w-full text-left p-2 rounded-lg transition-all duration-150 flex items-center gap-2.5 hover:bg-muted/60 border border-transparent"
                  data-testid={`crew-topic-agent-${a.id}`}
                >
                  <Bot className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <span className="font-semibold text-xs text-foreground truncate">Ask @{a.name}</span>
                    <p className="text-[11px] text-muted-foreground truncate">about #{topic.query.trim()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { CrewComposer as Composer };
