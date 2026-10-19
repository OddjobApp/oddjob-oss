/**
 * useInterventionEngine
 *
 * Manages the real-time intervention queue for the Oddjob Assistant.
 * Consumes SSE events from the event stream and exposes the active
 * intervention plus queue metadata for CopilotIntervention to render.
 *
 * Handles two event types:
 *  - INTENT_STABILIZED  — legacy psychologist engine
 *  - intervention.triggered — new scoring runner (with agent evaluation)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@domain-ui/auth/ui/modules/auth';
import { subscribeEvents } from '../services/event-bus';

export interface ActiveIntervention {
    id: string;
    memoryId?: number;
    thresholdId?: number;
    /** Primary SCORE vector that triggered this: S | C | O | R | E */
    vector: string;
    title: string;
    description: string;
    /** Pre-filled prompt to send to AgentChatSheet on accept */
    aiPrompt?: string;
    actionLabel?: string;
    /** Human-readable explanation written by the agent */
    rationale?: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    sessionId?: string;
    source: 'INTENT_STABILIZED' | 'intervention.triggered';
    receivedAt: number;
    context?: Record<string, any>;
    /** Confidence 0-1 from scoring engine */
    confidence?: number;
}

type OutcomeValue = 'accepted' | 'dismissed' | 'expired' | 'ignored';
export type AssistantInboxOutcome = OutcomeValue | 'unread';
export interface AssistantInboxItem extends ActiveIntervention {
    outcome: AssistantInboxOutcome;
    updatedAt: number;
}

const AUTO_DISMISS_MS = 12_000;
const MAX_QUEUE_SIZE = 5;
const SESSION_KEY = 'oddjob_dismissed_suggestions';
const INBOX_KEY = 'oddjob_assistant_inbox';
const MAX_INBOX_SIZE = 30;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function isDismissed(id: string): boolean {
    try {
        const list = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]');
        return list.includes(id);
    } catch {
        return false;
    }
}

function markDismissed(id: string) {
    try {
        const list = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]');
        if (!list.includes(id)) {
            list.push(id);
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(list));
        }
    } catch { /* ignore */ }
}

function readInbox(): AssistantInboxItem[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(INBOX_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.slice(0, MAX_INBOX_SIZE) : [];
    } catch {
        return [];
    }
}

function writeInbox(items: AssistantInboxItem[]) {
    try {
        localStorage.setItem(INBOX_KEY, JSON.stringify(items.slice(0, MAX_INBOX_SIZE)));
    } catch { /* ignore */ }
}

function upsertInboxItem(items: AssistantInboxItem[], item: ActiveIntervention, outcome: AssistantInboxOutcome = 'unread') {
    const nextItem: AssistantInboxItem = {
        ...item,
        outcome,
        updatedAt: Date.now(),
    };
    return [nextItem, ...items.filter(existing => existing.id !== item.id)].slice(0, MAX_INBOX_SIZE);
}

function updateInboxOutcome(items: AssistantInboxItem[], id: string, outcome: AssistantInboxOutcome) {
    return items.map(item => item.id === id ? { ...item, outcome, updatedAt: Date.now() } : item);
}

function priorityOrder(p: ActiveIntervention['priority']): number {
    return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 2;
}

// ────────────────────────────────────────────────────────────
// Normalizers — map raw SSE payloads → ActiveIntervention
// ────────────────────────────────────────────────────────────

function fromIntentStabilized(payload: any): ActiveIntervention | null {
    const id = payload.suggestion?.id || `intent-${payload.state}-${Date.now()}`;
    if (isDismissed(id)) return null;
    return {
        id,
        vector: payload.state || 'C',
        title: payload.suggestion?.strategy || 'Oddjob Assistant',
        description: payload.suggestion?.user_text || 'I can help with that.',
        aiPrompt: payload.suggestion?.agent_prompt,
        actionLabel: payload.suggestion?.user_cta || 'Get help',
        priority: payload.confidence >= 0.85 ? 'high' : 'medium',
        source: 'INTENT_STABILIZED',
        receivedAt: Date.now(),
        confidence: payload.confidence,
        context: payload.suggestion?.context,
    };
}

function fromInterventionTriggered(payload: any): ActiveIntervention | null {
    const id = payload.interventionId || payload.id || `iv-${Date.now()}`;
    if (isDismissed(id)) return null;
    return {
        id,
        memoryId: payload.memoryId,
        thresholdId: payload.thresholdId,
        vector: payload.vector || 'C',
        title: payload.title || 'Assistant Insight',
        description: payload.description || payload.userMessage || '',
        aiPrompt: payload.aiPrompt,
        actionLabel: payload.actionLabel || 'Get help',
        rationale: payload.rationale,
        priority: payload.priority || 'medium',
        sessionId: payload.sessionId,
        source: 'intervention.triggered',
        receivedAt: Date.now(),
        confidence: payload.confidence,
        context: payload.context,
    };
}

function fromDeliberationStarted(payload: any): ActiveIntervention | null {
    const approvalId = payload.approvalId || payload.id;
    const id = `deliberation-${approvalId}`;
    if (isDismissed(id)) return null;

    return {
        id,
        vector: 'S', // Struggle / High-Risk Guardrail
        title: `⚔️ Agora Deliberation: ${payload.pipelineName || 'Mission Decision'}`,
        description: payload.description || `${payload.stepName || 'High-Impact Step'} paused for human quorum. Guardian & Optimizer are deliberating trade-offs.`,
        aiPrompt: `Open Agora deliberation room for Decision #${approvalId}`,
        actionLabel: 'Join Deliberation Room',
        rationale: 'Autonomous safety gate paused execution because sensitive workspace entities or blast radius thresholds were breached.',
        priority: 'critical',
        source: 'intervention.triggered',
        receivedAt: Date.now(),
        confidence: 0.95,
        context: {
            approvalId,
            deliberationRoom: `/workspace/chat/deliberation-${approvalId}`,
        },
    };
}

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

export function useInterventionEngine() {
    const { user } = useAuth();
    const [, setLocation] = useLocation();

    const [queue, setQueue] = useState<ActiveIntervention[]>([]);
    const [active, setActive] = useState<ActiveIntervention | null>(null);
    const [assistantInbox, setAssistantInbox] = useState<AssistantInboxItem[]>(() => readInbox());
    const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── report outcome to backend ──
    const reportOutcome = useCallback((interventionId: string, outcome: OutcomeValue, receivedAt?: number) => {
        setAssistantInbox(prev => {
            const next = updateInboxOutcome(prev, interventionId, outcome);
            writeInbox(next);
            return next;
        });

        fetch('/api/scoring/interventions/outcome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ interventionId, outcome, timestamp: receivedAt ?? Date.now() }),
        }).catch(() => { /* fire-and-forget */ });
    }, []);

    // ── advance queue: pop next or clear ──
    const advance = useCallback((reportId?: string, outcome?: OutcomeValue, receivedAt?: number) => {
        if (reportId && outcome) {
            reportOutcome(reportId, outcome, receivedAt);
        }

        setQueue(prev => {
            const [next, ...rest] = prev;
            setActive(next ?? null);
            return rest;
        });
    }, [reportOutcome]);

    // ── enqueue a new intervention ──
    const enqueue = useCallback((item: ActiveIntervention) => {
        setAssistantInbox(prev => {
            const next = upsertInboxItem(prev, item, 'unread');
            writeInbox(next);
            return next;
        });

        setActive(prev => {
            if (!prev) {
                // Nothing showing — display immediately
                return item;
            }
            // Something already showing — append to queue
            setQueue(q => {
                if (q.length >= MAX_QUEUE_SIZE) return q; // drop if full
                const next = [...q, item].sort(
                    (a, b) => priorityOrder(a.priority) - priorityOrder(b.priority)
                );
                return next;
            });
            return prev;
        });
    }, []);

    // ── auto-dismiss timer ──
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!active) return;

        const capturedAt = active.receivedAt;
        timerRef.current = setTimeout(() => {
            advance(active.id, 'expired', capturedAt);
        }, AUTO_DISMISS_MS);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Event subscription ──
    // Through the shared bus: this hook is mounted by both AgentChatSheet and
    // CopilotIntervention, and each used to hold its own stream open.
    useEffect(() => {
        if (!user) return;

        return subscribeEvents(
            { type: ['INTENT_STABILIZED', 'intervention.triggered', 'deliberation.started', 'approval.created'] },
            ({ eventType, payload }) => {
                if (eventType === 'INTENT_STABILIZED') {
                    if (String(payload.user_id) !== String(user.id)) return;
                    const item = fromIntentStabilized(payload);
                    if (item) enqueue(item);
                }

                if (eventType === 'intervention.triggered') {
                    const item = fromInterventionTriggered(payload);
                    if (item) enqueue(item);
                }

                if (eventType === 'deliberation.started' || eventType === 'approval.created') {
                    const item = fromDeliberationStarted(payload);
                    if (item) enqueue(item);
                }
            },
        );
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Public API ──

    const dismiss = useCallback(() => {
        if (!active) return;
        markDismissed(active.id);
        advance(active.id, 'dismissed', active.receivedAt);
    }, [active, advance]);

    const accept = useCallback(() => {
        if (!active) return;
        const item = active;
        advance(item.id, 'accepted', item.receivedAt);

        if (item.context?.deliberationRoom) {
            // Route, don't reload. window.location.href tore down the SPA and
            // re-fetched the whole bundle to reach a route this router already
            // owns, losing the session's client state on the way.
            setLocation(item.context.deliberationRoom);
            return;
        }

        window.dispatchEvent(new CustomEvent('agent-assist-request', {
            detail: {
                prompt: item.aiPrompt,
                context: { ...item.context, mode: 'plan', assistantView: 'chat' },
                userSummary: item.description,
            },
        }));
    }, [active, advance, setLocation]);

    const clearQueue = useCallback(() => {
        if (active) {
            markDismissed(active.id);
            reportOutcome(active.id, 'dismissed', active.receivedAt);
        }
        queue.forEach(i => {
            markDismissed(i.id);
            reportOutcome(i.id, 'dismissed', i.receivedAt);
        });
        setActive(null);
        setQueue([]);
    }, [active, queue, reportOutcome]);

    const clearAssistantInbox = useCallback(() => {
        assistantInbox.forEach(item => {
            if (item.outcome === 'unread') {
                reportOutcome(item.id, 'ignored', item.receivedAt);
            }
        });
        setAssistantInbox([]);
        writeInbox([]);
    }, [assistantInbox, reportOutcome]);

    const acceptInboxItem = useCallback((item: AssistantInboxItem) => {
        if (active?.id === item.id) {
            advance(item.id, 'accepted', item.receivedAt);
        } else {
            reportOutcome(item.id, 'accepted', item.receivedAt);
            setQueue(prev => prev.filter(queued => queued.id !== item.id));
        }

        // Persisted/expired cards must use the same destination as the live toast.
        if (item.context?.deliberationRoom) {
            setLocation(item.context.deliberationRoom);
            return;
        }

        window.dispatchEvent(new CustomEvent('agent-assist-request', {
            detail: {
                prompt: item.aiPrompt,
                context: { ...item.context, mode: 'plan', assistantView: 'chat' },
                userSummary: item.description,
            },
        }));
    }, [active, advance, reportOutcome, setLocation]);

    return {
        /** Currently displayed intervention (or null) */
        active,
        /** Number of interventions waiting in the queue */
        queueLength: queue.length,
        /** Dismiss the active intervention and advance the queue */
        dismiss,
        /** Accept the intervention — opens AgentChatSheet with pre-filled prompt */
        accept,
        /** Clear all pending interventions */
        clearQueue,
        /** Persistent local list of assistant suggestions and outcomes */
        assistantInbox,
        /** Accept an inbox item after the original toast has expired or been dismissed */
        acceptInboxItem,
        /** Clear persisted suggestions */
        clearAssistantInbox,
        /** Dismiss interval in ms — exposed for ProgressBar */
        autoDismissMs: AUTO_DISMISS_MS,
    };
}
