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
import { useAuth } from '@domain-ui/auth/ui/modules/auth';

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

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

const BACKOFF_INITIAL_MS = 3_000;
const BACKOFF_MAX_MS     = 30_000;

export function useInterventionEngine() {
    const { user } = useAuth();

    const [queue, setQueue] = useState<ActiveIntervention[]>([]);
    const [active, setActive] = useState<ActiveIntervention | null>(null);
    const [assistantInbox, setAssistantInbox] = useState<AssistantInboxItem[]>(() => readInbox());
    const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const esRef       = useRef<EventSource | null>(null);
    const backoffRef  = useRef<number>(BACKOFF_INITIAL_MS);
    const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, []);

    // ── report outcome to backend ──
    function reportOutcome(interventionId: string, outcome: OutcomeValue, receivedAt?: number) {
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
    }

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

    // ── SSE subscription with exponential back-off reconnect ──
    useEffect(() => {
        if (!user) return;

        let cancelled = false;

        function connect() {
            if (cancelled) return;

            if (reconnectRef.current) {
                clearTimeout(reconnectRef.current);
                reconnectRef.current = null;
            }

            const es = new EventSource('/api/events/stream', { withCredentials: true });
            esRef.current = es;

            es.onmessage = (event) => {
                // Reset back-off on any successful message
                backoffRef.current = BACKOFF_INITIAL_MS;

                try {
                    const { eventType, payload } = JSON.parse(event.data);

                    if (eventType === 'INTENT_STABILIZED') {
                        if (!user || String(payload.user_id) !== String(user.id)) return;
                        const item = fromIntentStabilized(payload);
                        if (item) enqueue(item);
                    }

                    if (eventType === 'intervention.triggered') {
                        const item = fromInterventionTriggered(payload);
                        if (item) enqueue(item);
                    }
                } catch { /* parse errors are noise */ }
            };

            es.onerror = () => {
                es.close();
                esRef.current = null;
                if (cancelled) return;

                const delay = backoffRef.current;
                backoffRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
                reconnectRef.current = setTimeout(connect, delay);
            };
        }

        backoffRef.current = BACKOFF_INITIAL_MS;
        connect();

        return () => {
            cancelled = true;
            if (reconnectRef.current) clearTimeout(reconnectRef.current);
            esRef.current?.close();
            esRef.current = null;
        };
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

        window.dispatchEvent(new CustomEvent('agent-assist-request', {
            detail: {
                prompt: item.aiPrompt,
                context: { ...item.context, mode: 'plan' },
                userSummary: item.description,
            },
        }));
    }, [active, advance]);

    const clearQueue = useCallback(() => {
        if (active) markDismissed(active.id);
        queue.forEach(i => markDismissed(i.id));
        setActive(null);
        setQueue([]);
    }, [active, queue]);

    const clearAssistantInbox = useCallback(() => {
        setAssistantInbox([]);
        writeInbox([]);
    }, []);

    const acceptInboxItem = useCallback((item: AssistantInboxItem) => {
        setAssistantInbox(prev => {
            const next = updateInboxOutcome(prev, item.id, 'accepted');
            writeInbox(next);
            return next;
        });

        window.dispatchEvent(new CustomEvent('agent-assist-request', {
            detail: {
                prompt: item.aiPrompt,
                context: { ...item.context, mode: 'plan' },
                userSummary: item.description,
            },
        }));
    }, []);

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
