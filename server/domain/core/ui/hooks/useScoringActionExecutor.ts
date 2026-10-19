/**
 * Scoring Action Executor
 * Handles triggered actions from scoring rules and thresholds
 */

import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useCallback, useEffect, useRef } from "react";

export type ActionType =
    // UI Actions
    | 'toast' | 'tooltip' | 'modal' | 'inline_help'
    | 'highlight' | 'badge' | 'confetti' | 'progress' | 'tutorial'
    // Application Actions
    | 'concierge_prompt' | 'auto_expand' | 'prefill'
    | 'navigate' | 'log_event' | 'send_notification' | 'trigger_job';

export interface TriggeredAction {
    type: ActionType;
    config: Record<string, any>;
    cooldownMs?: number;
    maxPerSession?: number;
}

export interface ActionPayload {
    action: TriggeredAction;
    thresholdId?: number;
    thresholdName?: string;
    vector?: string;
    currentScore?: number;
    thresholdValue?: number;
}

// Track executed actions for cooldown
const executedActions = new Map<string, number>();

export const useScoringActionExecutor = () => {
    const { toast } = useToast();
    const highlightedElements = useRef<Set<string>>(new Set());

    /**
     * Execute a toast notification
     */
    const executeToast = useCallback((config: Record<string, any>) => {
        toast({
            title: config.title || config.message || "Notification",
            description: config.description || config.body,
            variant: config.variant || "default",
            duration: config.duration || 5000,
        });
    }, [toast]);

    /**
     * Execute a tooltip on a specific element
     */
    const executeTooltip = useCallback((config: Record<string, any>) => {
        const target = document.querySelector(config.target);
        if (!target) return;

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = 'scoring-tooltip';
        tooltip.style.cssText = `
            position: absolute;
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 9999;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: fadeIn 0.3s ease;
        `;
        tooltip.textContent = config.message || "Tip";

        // Position tooltip
        const rect = target.getBoundingClientRect();
        tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
        tooltip.style.left = `${rect.left + window.scrollX}px`;

        document.body.appendChild(tooltip);

        // Remove after duration
        setTimeout(() => {
            tooltip.remove();
        }, config.duration || 5000);
    }, []);

    /**
     * Execute element highlight (glow effect)
     */
    const executeHighlight = useCallback((config: Record<string, any>) => {
        const target = document.querySelector(config.target);
        if (!target) return;

        const key = config.target;
        if (highlightedElements.current.has(key)) return;
        highlightedElements.current.add(key);

        // Add highlight styles
        const originalStyles = (target as HTMLElement).style.cssText;
        const color = config.color || 'blue';
        const glowColor = color === 'blue' ? '59, 130, 246' :
            color === 'green' ? '34, 197, 94' :
                color === 'red' ? '239, 68, 68' : '147, 51, 234';

        (target as HTMLElement).style.cssText = originalStyles + `
            animation: pulseGlow 1.5s ease-in-out infinite;
            box-shadow: 0 0 0 3px rgba(${glowColor}, 0.4), 0 0 15px rgba(${glowColor}, 0.3);
            transition: box-shadow 0.3s ease;
        `;

        // Scroll into view
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove after duration
        setTimeout(() => {
            (target as HTMLElement).style.cssText = originalStyles;
            highlightedElements.current.delete(key);
        }, config.duration || 5000);
    }, []);

    /**
     * Execute confetti celebration
     */
    const executeConfetti = useCallback((config: Record<string, any>) => {
        // Create confetti container
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
            overflow: hidden;
        `;

        // Generate confetti pieces
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9'];
        for (let i = 0; i < 100; i++) {
            const piece = document.createElement('div');
            piece.style.cssText = `
                position: absolute;
                width: ${Math.random() * 10 + 5}px;
                height: ${Math.random() * 10 + 5}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                top: -20px;
                opacity: ${Math.random() * 0.5 + 0.5};
                animation: confettiFall ${Math.random() * 2 + 2}s linear forwards;
                transform: rotate(${Math.random() * 360}deg);
            `;
            container.appendChild(piece);
        }

        document.body.appendChild(container);

        // Remove after animation
        setTimeout(() => {
            container.remove();
        }, config.duration || 4000);
    }, []);

    /**
     * Execute modal dialog
     */
    const executeModal = useCallback((config: Record<string, any>) => {
        // For now, use toast as a simpler notification
        // Full modal would require dialog component integration
        toast({
            title: config.title || "Notice",
            description: config.body || config.message,
            variant: "default",
            duration: 10000, // Longer for modal-style
        });
    }, [toast]);

    /**
     * Execute navigation
     */
    const executeNavigate = useCallback((config: Record<string, any>) => {
        if (config.splitView) {
            // Open in new tab
            window.open(config.path, '_blank');
        } else {
            // Navigate in same window
            window.location.href = config.path;
        }
    }, []);

    /**
     * Execute concierge prompt injection
     */
    const executeConciergePrompt = useCallback((config: Record<string, any>) => {
        // Dispatch custom event for concierge to pick up
        const event = new CustomEvent('scoring:concierge-prompt', {
            detail: {
                hint: config.hint,
                context: config.context,
                suggestedMessage: config.suggestedMessage
            }
        });
        window.dispatchEvent(event);

        console.log('[Scoring] Concierge prompt injected:', config.hint);
    }, []);

    /**
     * Execute auto-expand of a section
     */
    const executeAutoExpand = useCallback((config: Record<string, any>) => {
        const target = document.querySelector(config.target);
        if (!target) return;

        // Try to find and click an expand button
        const expandBtn = target.querySelector('[data-expand], [aria-expanded="false"], .accordion-trigger');
        if (expandBtn) {
            (expandBtn as HTMLElement).click();
        }
    }, []);

    /**
     * Execute pre-fill suggestion
     */
    const executePrefill = useCallback((config: Record<string, any>) => {
        const field = document.querySelector(config.field) as HTMLInputElement | HTMLTextAreaElement;
        if (!field) return;

        // Set value and trigger change event
        field.value = config.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));

        // Highlight the field briefly
        executeHighlight({ target: config.field, color: 'green', duration: 2000 });
    }, [executeHighlight]);

    /**
     * Execute log event (analytics)
     */
    const executeLogEvent = useCallback((config: Record<string, any>) => {
        console.log('[Scoring Analytics]', {
            event: config.event,
            data: config.data,
            timestamp: Date.now()
        });

        // Could integrate with analytics service here
    }, []);

    /**
     * Send a desktop notification (falls back to toast if permission denied).
     * config: { title, body, icon?, tag?, silent? }
     */
    const executeSendNotification = useCallback((config: Record<string, any>) => {
        const title = config.title || config.message || "Notification";
        const body  = config.body  || config.description || "";

        if (typeof Notification === "undefined" || Notification.permission === "denied") {
            toast({ title, description: body, duration: config.duration || 6000 });
            return;
        }

        if (Notification.permission === "granted") {
            new Notification(title, {
                body,
                icon:   config.icon   || "/favicon.ico",
                tag:    config.tag    || `scoring-${Date.now()}`,
                silent: config.silent ?? false,
            });
        } else {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification(title, { body, icon: config.icon || "/favicon.ico" });
                } else {
                    toast({ title, description: body, duration: config.duration || 6000 });
                }
            });
        }
    }, [toast]);

    /**
     * Trigger a job run via API + broadcast a custom event.
     * config: { jobId, parameters?, onSuccess? }
     */
    const executeTriggerJob = useCallback((config: Record<string, any>) => {
        if (!config.jobId) {
            console.warn("[Scoring] trigger_job: jobId is required");
            return;
        }

        // Fire-and-forget POST to the run endpoint
        fetch(`/api/jobs/${config.jobId}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parameters: config.parameters || {} }),
            credentials: "include",
        })
        .then(res => res.json())
        .then(data => {
            console.log(`[Scoring] Job ${config.jobId} triggered:`, data);
            window.dispatchEvent(new CustomEvent("scoring:job-triggered", {
                detail: { jobId: config.jobId, result: data },
            }));
        })
        .catch(err => console.error(`[Scoring] trigger_job failed for job ${config.jobId}:`, err));
    }, []);

    /**
     * Trigger an interactive tutorial walkthrough on target elements
     */
    const executeTutorial = useCallback((config: Record<string, any>) => {
        const tutorialId = config.tutorialId || 'platform-score-tour';
        console.log(`[Scoring] Launching tutorial walkthrough: ${tutorialId}`);
        window.dispatchEvent(new CustomEvent('oddjob:start-tutorial', {
            detail: config.steps ? config : { id: tutorialId }
        }));
    }, []);

    /**
     * Main action executor
     */
    const executeAction = useCallback((payload: ActionPayload) => {
        const { action } = payload;
        if (!action || !action.type) return;

        // Check cooldown
        const actionKey = `${action.type}:${JSON.stringify(action.config)}`;
        const lastExecution = executedActions.get(actionKey);
        const cooldown = action.cooldownMs || 30000;

        if (lastExecution && Date.now() - lastExecution < cooldown) {
            console.log(`[Scoring] Action ${action.type} on cooldown`);
            return;
        }

        executedActions.set(actionKey, Date.now());

        console.log(`[Scoring] Executing action: ${action.type}`, action.config);

        switch (action.type) {
            case 'toast':
                executeToast(action.config);
                break;
            case 'tooltip':
                executeTooltip(action.config);
                break;
            case 'highlight':
                executeHighlight(action.config);
                break;
            case 'tutorial':
                executeTutorial(action.config);
                break;
            case 'modal':
                executeModal(action.config);
                break;
            case 'confetti':
                executeConfetti(action.config);
                break;
            case 'navigate':
                executeNavigate(action.config);
                break;
            case 'concierge_prompt':
                executeConciergePrompt(action.config);
                break;
            case 'auto_expand':
                executeAutoExpand(action.config);
                break;
            case 'prefill':
                executePrefill(action.config);
                break;
            case 'log_event':
                executeLogEvent(action.config);
                break;
            case 'send_notification':
                executeSendNotification(action.config);
                break;
            case 'trigger_job':
                executeTriggerJob(action.config);
                break;
            case 'inline_help':
            case 'badge':
            case 'progress':
                console.log(`[Scoring] Action ${action.type} noted (UI component integration pending)`);
                break;
            default:
                console.warn(`[Scoring] Unknown action type: ${action.type}`);
        }
    }, [executeToast, executeTooltip, executeHighlight, executeTutorial, executeModal, executeConfetti,
        executeNavigate, executeConciergePrompt, executeAutoExpand, executePrefill, executeLogEvent,
        executeSendNotification, executeTriggerJob]);

    /**
     * Execute multiple actions from ingestor response
     */
    const executeTriggeredActions = useCallback((actions: ActionPayload[]) => {
        if (!actions || actions.length === 0) return;

        actions.forEach((payload, index) => {
            // Stagger execution slightly to prevent UI overwhelm
            setTimeout(() => {
                executeAction(payload);
            }, index * 100);
        });
    }, [executeAction]);

    // Inject CSS for animations
    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulseGlow {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(-5px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes confettiFall {
                0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        return () => { style.remove(); };
    }, []);

    return {
        executeAction,
        executeTriggeredActions,
        executeToast,
        executeHighlight,
        executeConfetti,
        executeConciergePrompt
    };
};

