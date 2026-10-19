/**
 * CopilotIntervention
 *
 * Rich toast-card rendered at the bottom-right of every authenticated page.
 * Driven by `useInterventionEngine`, which unifies:
 *   - INTENT_STABILIZED events (psychologist / ephemeral engine)
 *   - intervention.triggered events (scoring runner + agent)
 *
 * Features
 * ─────────
 * • Animated entry / exit
 * • Auto-dismiss progress bar (12 s)
 * • SCORE vector color coding with label
 * • Priority ring indicator
 * • Collapsible "Why am I seeing this?" rationale
 * • Queue badge showing pending count
 * • Accept → opens AgentChatSheet with pre-filled prompt
 * • Minimize to floating orb
 */
import { useEffect, useRef, useState } from 'react';
import {
    Sparkles, ArrowRight, X, ChevronDown, ChevronUp,
    AlertTriangle, Lightbulb, Target, Zap, Activity,
    Layers, Inbox,
} from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { cn } from '@/lib/utils';
import { useInterventionEngine, type ActiveIntervention, type AssistantInboxItem } from '@domain-ui/core/ui/hooks/use-intervention-engine.js';

// ────────────────────────────────────────────────────────────
// SCORE vector → visual metadata
// ────────────────────────────────────────────────────────────

interface VectorMeta {
    label: string;
    icon: React.ElementType;
    card: string;       // border + bg + text classes
    badge: string;      // badge bg classes
    bar: string;        // progress bar color
}

const VECTOR_META: Record<string, VectorMeta> = {
    S: {
        label: 'Struggle detected',
        icon: AlertTriangle,
        card: 'border-red-400/60 dark:border-red-700/60 bg-red-50/95 dark:bg-red-950/30 text-red-900 dark:text-red-200',
        badge: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-400/30',
        bar: 'bg-red-500',
    },
    C: {
        label: 'Clarity gap',
        icon: Lightbulb,
        card: 'border-amber-400/60 dark:border-amber-700/60 bg-amber-50/95 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30',
        bar: 'bg-amber-500',
    },
    O: {
        label: 'Outcome opportunity',
        icon: Target,
        card: 'border-blue-400/60 dark:border-blue-700/60 bg-blue-50/95 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200',
        badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30',
        bar: 'bg-blue-500',
    },
    R: {
        label: 'Readiness signal',
        icon: Zap,
        card: 'border-purple-400/60 dark:border-purple-700/60 bg-purple-50/95 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200',
        badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-400/30',
        bar: 'bg-purple-500',
    },
    E: {
        label: 'Engagement peak',
        icon: Activity,
        card: 'border-emerald-400/60 dark:border-emerald-700/60 bg-emerald-50/95 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30',
        bar: 'bg-emerald-500',
    },
};

const DEFAULT_META: VectorMeta = {
    label: 'Assistant insight',
    icon: Sparkles,
    card: 'border-border bg-card text-foreground',
    badge: 'bg-primary/10 text-primary border-primary/20',
    bar: 'bg-primary',
};

function getVectorMeta(vector: string): VectorMeta {
    return VECTOR_META[vector?.toUpperCase()] ?? DEFAULT_META;
}

// ────────────────────────────────────────────────────────────
// Priority → ring style
// ────────────────────────────────────────────────────────────

const PRIORITY_RING: Record<ActiveIntervention['priority'], string> = {
    critical: 'ring-2 ring-red-500/60 shadow-[0_0_16px_rgba(239,68,68,0.25)]',
    high:     'ring-2 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.20)]',
    medium:   'ring-1 ring-border/60',
    low:      '',
};

// ────────────────────────────────────────────────────────────
// ProgressBar — rAF-driven, resets when active.id changes
// ────────────────────────────────────────────────────────────

function ProgressBar({
    durationMs,
    barClass,
    interventionId,
}: {
    durationMs: number;
    barClass: string;
    interventionId: string;
}) {
    const [pct, setPct] = useState(100);
    const rafRef = useRef<number>(0);
    const startRef = useRef<number>(0);

    useEffect(() => {
        startRef.current = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startRef.current;
            const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
            setPct(remaining);
            if (remaining > 0) rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [interventionId, durationMs]); // resets on new intervention

    return (
        <div className="h-0.5 w-full bg-black/5 dark:bg-white/5 overflow-hidden">
            <div
                className={cn('h-full transition-none', barClass)}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Minimized orb
// ────────────────────────────────────────────────────────────

function MinimizedOrb({
    queueLength,
    onClick,
}: {
    queueLength: number;
    onClick: () => void;
}) {
    return (
        <div className="fixed bottom-6 right-6 z-50">
            <button
                onClick={onClick}
                className="relative h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg flex items-center justify-center animate-pulse hover:animate-none hover:scale-110 transition-transform"
                title="Open assistant suggestion"
            >
                <Sparkles className="h-5 w-5 text-foreground" />
                {queueLength > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-foreground text-[10px] font-bold flex items-center justify-center shadow">
                        {queueLength}
                    </span>
                )}
            </button>
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

function AssistantInboxPanel({
    items,
    onAccept,
    onClear,
    onClose,
}: {
    items: AssistantInboxItem[];
    onAccept: (item: AssistantInboxItem) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    return (
        <div className="fixed bottom-8 right-8 z-50 w-[26rem] animate-in slide-in-from-bottom-6 fade-in duration-300">
            <Card className="overflow-hidden border border-border bg-card text-card-foreground shadow-2xl">
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Inbox className="h-4 w-4" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold">Assistant Inbox</h4>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {items.length} saved suggestion{items.length === 1 ? '' : 's'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {items.length > 0 && (
                            <button
                                onClick={onClear}
                                className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                            >
                                Clear
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Close inbox"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto p-3">
                    {items.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                            No assistant suggestions saved yet.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {items.map(item => {
                                const meta = getVectorMeta(item.vector);
                                const VectorIcon = meta.icon;
                                return (
                                    <div key={item.id} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                                                <VectorIcon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <Badge variant="outline" className="h-5 text-[9px] uppercase">
                                                        {item.outcome}
                                                    </Badge>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <h5 className="mt-1 text-sm font-bold leading-snug">{item.title}</h5>
                                                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                                    {renderTextWithLinks(item.description)}
                                                </p>
                                                <div className="mt-3 flex justify-end">
                                                    <Button
                                                        size="sm"
                                                        className="h-7 gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                                                        onClick={() => {
                                                            onAccept(item);
                                                            onClose();
                                                        }}
                                                    >
                                                        Open in Copilot
                                                        <ArrowRight className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}

function renderTextWithLinks(text: string) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+|\/health\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
        if (part.startsWith('http://') || part.startsWith('https://') || part.startsWith('/health/')) {
            const isRelative = part.startsWith('/');
            return (
                <a
                    key={index}
                    href={part}
                    target={isRelative ? undefined : "_blank"}
                    rel={isRelative ? undefined : "noopener noreferrer"}
                    className="text-primary hover:underline font-semibold underline decoration-2 decoration-current/30 cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isRelative) {
                            e.preventDefault();
                            window.history.pushState({}, '', part);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                        }
                    }}
                >
                    {part}
                </a>
            );
        }
        return part;
    });
}

export function CopilotIntervention() {
    const {
        active,
        queueLength,
        dismiss,
        accept,
        autoDismissMs,
        assistantInbox,
        acceptInboxItem,
        clearAssistantInbox,
    } = useInterventionEngine();
    const [minimized, setMinimized] = useState(false);
    const [rationaleOpen, setRationaleOpen] = useState(false);
    const [inboxOpen, setInboxOpen] = useState(false);
    const unreadCount = assistantInbox.filter(item => item.outcome === 'unread').length;

    // Reset rationale collapse whenever a new intervention arrives
    useEffect(() => {
        setRationaleOpen(false);
    }, [active?.id]);

    // ── Minimized state ──
    if (inboxOpen) {
        return (
            <AssistantInboxPanel
                items={assistantInbox}
                onAccept={acceptInboxItem}
                onClear={clearAssistantInbox}
                onClose={() => setInboxOpen(false)}
            />
        );
    }

    if (minimized) {
        if (!active) {
            if (assistantInbox.length === 0) return null;
            return (
                <MinimizedOrb
                    queueLength={unreadCount}
                    onClick={() => setInboxOpen(true)}
                />
            );
        }
        return (
            <MinimizedOrb
                queueLength={queueLength + unreadCount}
                onClick={() => setMinimized(false)}
            />
        );
    }

    // ── Nothing to show ──
    if (!active) {
        if (assistantInbox.length === 0) return null;
        return (
            <MinimizedOrb
                queueLength={unreadCount}
                onClick={() => setInboxOpen(true)}
            />
        );
    }

    const meta = getVectorMeta(active.vector);
    const VectorIcon = meta.icon;

    return (
        <div className="fixed bottom-8 right-8 z-50 w-96 animate-in slide-in-from-bottom-8 fade-in duration-400">
            <Card
                className={cn(
                    'overflow-hidden border backdrop-blur-xl shadow-2xl',
                    meta.card,
                    PRIORITY_RING[active.priority]
                )}
            >
                {/* Progress bar */}
                <ProgressBar
                    durationMs={autoDismissMs}
                    barClass={meta.bar}
                    interventionId={active.id}
                />

                <div className="p-4 space-y-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="shrink-0 w-8 h-8 rounded-lg bg-foreground/20 flex items-center justify-center">
                                <VectorIcon className="h-4 w-4" />
                            </div>

                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge
                                        variant="outline"
                                        className={cn('text-[10px] font-bold uppercase tracking-wider h-5 px-2 border', meta.badge)}
                                    >
                                        {meta.label}
                                    </Badge>

                                    {active.priority === 'critical' && (
                                        <Badge variant="destructive" className="text-[10px] h-5 px-2">
                                            URGENT
                                        </Badge>
                                    )}

                                    {queueLength > 0 && (
                                        <Badge variant="secondary" className="text-[10px] h-5 px-2 gap-1">
                                            <Layers className="h-2.5 w-2.5" />
                                            +{queueLength}
                                        </Badge>
                                    )}
                                    {assistantInbox.length > 0 && (
                                        <button
                                            onClick={() => setInboxOpen(true)}
                                            className="inline-flex h-5 items-center gap-1 rounded-md border border-current/20 px-2 text-[10px] font-bold uppercase tracking-wider opacity-70 transition-opacity hover:opacity-100"
                                        >
                                            <Inbox className="h-2.5 w-2.5" />
                                            {assistantInbox.length}
                                        </button>
                                    )}
                                </div>

                                <p className="text-[10px] opacity-50 uppercase tracking-widest mt-0.5 font-bold">
                                    Oddjob / {active.source === 'intervention.triggered' ? 'Scored' : 'Intent'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                onClick={() => setMinimized(true)}
                                className="p-1.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                                title="Minimize"
                            >
                                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                            </button>
                            <button
                                onClick={dismiss}
                                className="p-1.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                                title="Dismiss"
                            >
                                <X className="h-3.5 w-3.5 opacity-60" />
                            </button>
                        </div>
                    </div>

                    {/* Title + description */}
                    <div className="space-y-1">
                        <h4 className="text-sm font-bold leading-snug">{active.title}</h4>
                        <p className="text-sm leading-relaxed opacity-80">{renderTextWithLinks(active.description)}</p>
                    </div>

                    {/* Collapsible rationale */}
                    {active.rationale && (
                        <div className="rounded-lg bg-black/5 dark:bg-white/5 overflow-hidden">
                            <button
                                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100 transition-opacity"
                                onClick={() => setRationaleOpen(o => !o)}
                            >
                                Why am I seeing this?
                                {rationaleOpen
                                    ? <ChevronUp className="h-3 w-3" />
                                    : <ChevronDown className="h-3 w-3" />
                                }
                            </button>
                            {rationaleOpen && (
                                <p className="px-3 pb-3 text-xs opacity-70 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                                    {active.rationale}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Confidence indicator (subtle) */}
                    {active.confidence != null && active.confidence > 0 && (
                        <div className="flex items-center gap-2 text-[10px] opacity-50">
                            <div className="flex-1 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                                <div
                                    className={cn('h-full rounded-full', meta.bar)}
                                    style={{ width: `${Math.round(active.confidence * 100)}%`, opacity: 0.6 }}
                                />
                            </div>
                            <span>{Math.round(active.confidence * 100)}% confidence</span>
                        </div>
                    )}

                    {/* CTA buttons */}
                    <div className="flex items-center gap-2 pt-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 h-8 text-xs font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5"
                            onClick={dismiss}
                        >
                            Dismiss
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 h-8 text-xs font-bold uppercase tracking-wider gap-1.5 bg-white/30 hover:bg-white/50 dark:bg-white/10 dark:hover:bg-white/20 border border-current/20 shadow-sm"
                            onClick={accept}
                        >
                            {active.actionLabel || 'Get help'}
                            <ArrowRight className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
}
