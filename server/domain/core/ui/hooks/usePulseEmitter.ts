
import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useScoringActionExecutor } from './useScoringActionExecutor.js';

const INGESTOR_URL = '/api/pulse'; // Integrated Ingestor URL
const THROTTLE_MS = 1000; // Throttle to prevent congestion

// Generate a quasi-unique fingerprint if one doesn't exist
const getFingerprint = () => {
    try {
        let fp = localStorage.getItem('oj_fingerprint');
        if (!fp) {
            fp = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('oj_fingerprint', fp);
        }
        return fp;
    } catch (e) {
        return 'temp_fp_' + Math.random().toString(36).substring(2, 10);
    }
};

// Generate a session ID (per browser session)
const getSessionId = () => {
    try {
        let sessionId = sessionStorage.getItem('oj_session_id');
        if (!sessionId) {
            sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
            sessionStorage.setItem('oj_session_id', sessionId);
        }
        return sessionId;
    } catch (e) {
        return `sess_temp_${Date.now()}`;
    }
};

/**
 * Extract rich UI context from an element for enhanced intent detection.
 * This helps the concierge understand what specific component the user is interacting with.
 */
const extractElementContext = (element: HTMLElement): Record<string, any> => {
    const context: Record<string, any> = {};

    // 1. Screen Section Detection
    const section = element.closest('[data-section], aside, header, main, nav, .modal, .drawer, [role="dialog"]');
    if (section) {
        context.section = section.getAttribute('data-section')
            || section.getAttribute('role')
            || section.tagName.toLowerCase();
    }

    // 2. Card Type Detection
    const card = element.closest('[data-card-type], .card, [data-testid*="card"]');
    if (card) {
        context.card_type = card.getAttribute('data-card-type')
            || card.getAttribute('data-testid')
            || 'generic-card';

        // Try to get card title/label
        const cardTitle = card.querySelector('h1, h2, h3, h4, [data-card-title], .card-title');
        if (cardTitle) {
            context.card_label = cardTitle.textContent?.trim().slice(0, 50);
        }
    }

    // 3. Button/Link Context
    const button = element.closest('button, a, [role="button"]');
    if (button) {
        // Get button text or aria-label
        context.element_label = button.getAttribute('aria-label')
            || button.textContent?.trim().slice(0, 50)
            || button.getAttribute('title');

        // Classify button type from classes or data attributes
        const btnClasses = (typeof button.className === 'string' ? button.className : (button.className as any).baseVal || '') || '';
        if (btnClasses.includes('destructive') || btnClasses.includes('danger')) {
            context.button_intent = 'destructive';
        } else if (btnClasses.includes('primary') || btnClasses.includes('default')) {
            context.button_intent = 'primary-action';
        } else if (btnClasses.includes('ghost') || btnClasses.includes('secondary')) {
            context.button_intent = 'secondary-action';
        }
    }

    // 4. Form Context
    const form = element.closest('form, [data-form-type]');
    if (form) {
        context.form_type = form.getAttribute('data-form-type')
            || form.getAttribute('name')
            || 'form';
    }

    // 5. Input Context
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
        context.input_name = element.getAttribute('name') || element.getAttribute('placeholder')?.slice(0, 30);
        context.input_type = element.getAttribute('type') || element.tagName.toLowerCase();
    }

    // 6. Tab/Panel Context
    const tab = element.closest('[role="tabpanel"], [data-tab]');
    if (tab) {
        context.tab_name = tab.getAttribute('data-tab')
            || tab.getAttribute('aria-label')
            || tab.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();
    }

    // 7. Data Context (job IDs, pipeline IDs, etc.)
    const dataElement = element.closest('[data-job-id], [data-pipeline-id], [data-alert-id], [data-entity-id]');
    if (dataElement) {
        const jobId = dataElement.getAttribute('data-job-id');
        const pipelineId = dataElement.getAttribute('data-pipeline-id');
        const alertId = dataElement.getAttribute('data-alert-id');
        const entityId = dataElement.getAttribute('data-entity-id');

        if (jobId) context.job_id = jobId;
        if (pipelineId) context.pipeline_id = pipelineId;
        if (alertId) context.alert_id = alertId;
        if (entityId) context.entity_id = entityId;
    }

    // 8. Modal/Drawer Context
    const modal = element.closest('[role="dialog"], .modal, .drawer');
    if (modal) {
        context.modal_title = modal.querySelector('[role="heading"], h1, h2, .modal-title, .sheet-title')?.textContent?.trim().slice(0, 50);
        context.is_modal = true;
    }

    return context;
};

/**
 * Get a human-readable description of the current screen location.
 */
const getScreenDescription = (path: string): string => {
    const routeDescriptions: Record<string, string> = {
        '/dashboard': 'Dashboard overview',
        '/jobs': 'Jobs list',
        '/pipelines': 'Pipelines list',
        '/alerts': 'Alerts & notifications',
        '/monitoring': 'System monitoring',
        '/observability': 'Observability',
        '/events': 'Event stream',
        '/pulse': 'System pulse',
        '/health': 'Health and observability hub',
        '/health/observability': 'Observability',
        '/health/monitoring': 'System monitoring',
        '/health/alerts': 'Alerts and notifications',
        '/health/events': 'Event stream',
        '/health/pulse': 'System pulse',
        '/health/incidents': 'Incidents and diagnoses',
        '/health/infra-health': 'Infrastructure health',
        '/insights': 'Insights hub',
        '/insights/roi': 'ROI and value analytics',
        '/insights/costs': 'Cost center',
        '/insights/tools': 'Tool analytics',
        '/insights/agents': 'Agent analytics',
        '/insights/scoring': 'Behavioral scoring',
        '/insights/prediction': 'Advanced prediction intelligence',
        '/analytics': 'Analytics & cost center',
        '/account-admin': 'Account and admin hub',
        '/account-admin/organizations': 'Organizations administration',
        '/account-admin/users': 'Users administration',
        '/account-admin/billing': 'Billing administration',
        '/account-admin/licensing': 'Licensing administration',
        '/platform-maintenance': 'Platform maintenance hub',
        '/platform-maintenance/snapshots': 'Snapshot management',
        '/platform-maintenance/documentation': 'Documentation maintenance',
        '/platform-maintenance/software-audit': 'Software audit',
        '/platform-maintenance/evolution': 'System evolution',
        '/platform-maintenance/autoresearch': 'Autoresearch maintenance',
        '/platform-maintenance/system-graph': 'System graph',
        '/connections': 'Connections hub',
        '/connections/credentials': 'Credentials management',
        '/connections/credentials/new': 'New credential setup',
        '/connections/integrations': 'Integrations administration',
        '/connections/mcp-tokens': 'MCP token management',
        '/connections/saas': 'SaaS connectors',
        '/connections/saas/workflows': 'SaaS event workflows',
        '/connections/saas/sync-config': 'SaaS sync configuration',
        '/connections/saas/analytics': 'SaaS connector analytics',
        '/settings': 'System settings',
        '/knowledge': 'Knowledge management',
        '/knowledge/graph': 'Knowledge graph explorer',
        '/knowledge/garden': 'Knowledge garden',
        '/knowledge/datasets': 'Datasets management',
        '/datasets': 'Datasets management',
        '/credentials': 'Credentials management',
        '/schedules': 'Schedules management',
    };

    // Check for exact match
    if (routeDescriptions[path]) {
        return routeDescriptions[path];
    }

    // Check for dynamic routes
    if (path.match(/^\/jobs\/\d+/)) {
        const jobId = path.match(/\/jobs\/(\d+)/)?.[1];
        return `Job detail (Job #${jobId})`;
    }
    if (path.match(/^\/pipelines\/\d+/)) {
        const pipelineId = path.match(/\/pipelines\/(\d+)/)?.[1];
        return `Pipeline detail (Pipeline #${pipelineId})`;
    }

    return path;
};

export const usePulseEmitter = (options?: { 
    slug?: string; 
    sessionId?: string; 
    enabled?: boolean 
}) => {
    const [location] = useLocation();
    const lastPulseTime = useRef<number>(0);
    const fingerprintId = useRef<string>(getFingerprint()).current;
    const lastInteractedElement = useRef<HTMLElement | null>(null);
    const internalSessionId = useRef<string>(getSessionId()).current;
    const [isPulseActive, setIsPulseActive] = useState(options?.enabled ?? true);

    // Use passed sessionId or internal one
    const effectiveSessionId = options?.sessionId || internalSessionId;

    // Action executor for handling triggered actions
    const { executeTriggeredActions } = useScoringActionExecutor();

    // Fetch organization settings to check if Psychologist Agent is enabled
    // Only fetch if NOT on a public slug (already handled by enabled: !options?.slug)
    const { data: orgSettings } = useQuery({
        queryKey: ['/api/org-settings'],
        queryFn: async () => {
            const res = await fetch('/api/org-settings');
            if (!res.ok) {
                if (res.status === 401) return null;
                throw new Error('Failed to fetch org settings');
            }
            return res.json();
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!options?.enabled && !options?.slug, // Only fetch if enabled and not a public slug
        retry: false, // Don't retry on failure (e.g. 401)
    });

    const psychologistEnabled = orgSettings?.psychologistEnabled ?? true;
    const isActuallyEnabled = isPulseActive && (options?.slug ? true : psychologistEnabled);

    const emitPulse = useCallback(async (actionId?: string, somaticData: any = {}, elementContext: Record<string, any> = {}) => {
        if (!isActuallyEnabled) return;

        const payload = {
            f_id: fingerprintId,
            session_id: effectiveSessionId,
            agent_slug: options?.slug,
            r_path: location,
            r_desc: getScreenDescription(location),
            act_id: actionId || 'ambient_dwell',
            ts: Date.now(),
            ...somaticData,
            ctx: Object.keys(elementContext).length > 0 ? elementContext : undefined,
        };

        try {
            // Use fetch to get triggered actions response
            const response = await fetch(INGESTOR_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();

                // Execute any triggered actions from scoring rules/thresholds
                if (data.triggered_actions && data.triggered_actions.length > 0) {
                    console.log('[Pulse] Triggered actions:', data.triggered_actions);
                    executeTriggeredActions(data.triggered_actions);
                }
            }
        } catch (err) {
            // Fallback to sendBeacon for reliability
            if (navigator.sendBeacon) {
                navigator.sendBeacon(INGESTOR_URL, JSON.stringify(payload));
            }
        }
    }, [isActuallyEnabled, fingerprintId, effectiveSessionId, options?.slug, location, executeTriggeredActions]);

    const startPulse = useCallback(() => setIsPulseActive(true), []);
    const stopPulse = useCallback(() => setIsPulseActive(false), []);

    const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!isActuallyEnabled) return;

        const resetIdleTimer = () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            idleTimerRef.current = setTimeout(() => {
                console.log("[Pulse] User Idle (10s) -> Emitting Stalling Intent");

                // Include context of last interacted element for richer idle detection
                const lastContext = lastInteractedElement.current
                    ? extractElementContext(lastInteractedElement.current)
                    : {};

                emitPulse('user_idle_10s', { type: 'inactivity' }, {
                    ...lastContext,
                    idle_context: 'stalled_after_interaction',
                });
            }, 10000);
        };

        const handleMouseMove = (e: MouseEvent) => {
            const now = Date.now();
            if (now - lastPulseTime.current > THROTTLE_MS) {
                const vel = Math.sqrt(Math.pow(e.movementX, 2) + Math.pow(e.movementY, 2));
                emitPulse(undefined, { vel });
                lastPulseTime.current = now;
            }
            resetIdleTimer();
        };

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            lastInteractedElement.current = target; // Track for idle context

            // Traverse up to find a marked element
            const closestTarget = target.closest('[id], [data-intent-id]');
            const actionId = closestTarget?.id || closestTarget?.getAttribute('data-intent-id') || undefined;

            // Extract rich element context
            const elementContext = extractElementContext(target);

            if (actionId || Object.keys(elementContext).length > 0) {
                console.log(`[Pulse] Click detected: ${actionId || 'unlabeled'}`, elementContext);
                emitPulse(actionId, { type: 'click' }, elementContext);
            }

            resetIdleTimer();
        };

        const handleFocus = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                lastInteractedElement.current = target;
                const elementContext = extractElementContext(target);
                emitPulse('input_focus', { type: 'focus' }, elementContext);
            }
        };

        const handleHover = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Only care about interactables or cards
            const interactable = target.closest('button, a, [role="button"], input, .card, [data-card-type]');

            if (interactable && interactable !== lastInteractedElement.current) {
                // Throttle hover events to avoid spam
                if (Date.now() - lastPulseTime.current > 1000) {
                    const context = extractElementContext(interactable as HTMLElement);
                    const id = interactable.getAttribute('id') || interactable.getAttribute('data-intent-id');
                    console.log(`[Pulse] Hover:`, context);
                    emitPulse('hover', { type: 'hover' }, { ...context, hover_target_id: id });
                }
            }
        };

        const handleInteraction = () => resetIdleTimer();

        // Global listeners
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseover', handleHover);
        window.addEventListener('click', handleClick);
        window.addEventListener('focusin', handleFocus);
        window.addEventListener('keydown', handleInteraction);
        window.addEventListener('scroll', handleInteraction);

        // Emit route change pulse with screen description
        emitPulse('route_change', { type: 'navigation' }, { screen_desc: getScreenDescription(location) });
        resetIdleTimer();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseover', handleHover);
            window.removeEventListener('click', handleClick);
            window.removeEventListener('focusin', handleFocus);
            window.removeEventListener('keydown', handleInteraction);
            window.removeEventListener('scroll', handleInteraction);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, [location, isActuallyEnabled, emitPulse]);

    return { 
        startPulse, 
        stopPulse, 
        emitManualPulse: emitPulse 
    };
};
