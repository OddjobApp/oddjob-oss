/**
 * WorkbenchModal — embedded host for SDLC apps inside Cycle Manager.
 *
 * Opens an iframe to /app/{slug}?embed=1&missionId=X&bindingId=Y and
 * implements the parent side of the workbench-sdk message protocol:
 *
 *   child  → parent: 'ready'         → parent replies with 'context'
 *   child  → parent: 'saved'         → invalidate the mission row's query
 *   child  → parent: 'unsaved-change'→ gate the close confirm
 *   child  → parent: 'request-close' → close the modal
 *   child  → parent: 'navigate-out'  → open the URL in a new tab
 *
 * Origin verification: only accept messages from window.location.origin.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, X, ExternalLink, Play, Save, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { MissionAppBinding } from './AppsDropdown';
import { NativeWorkbench, hasNativeWorkbench } from '../../workbenches/NativeWorkbenchRegistry';

type OutboundType = 'ready' | 'saved' | 'unsaved-change' | 'request-close' | 'navigate-out' | 'trigger-cycle' | 'register-actions';

/** A single action registered by the embedded app to be rendered in the native action bar. */
interface RegisteredAction {
    id: string;
    label: string;
    /** 'primary' renders as a solid button; 'secondary' as ghost; 'danger' as destructive. */
    variant?: 'primary' | 'secondary' | 'danger';
    /** Message type the parent should post back to the child when the action is clicked. */
    ackType: string;
    /** Icon name from lucide-react (optional, used as hint). */
    icon?: string;
}
type InboundType = 'context' | 'force-close' | 'ack';

interface WorkbenchMessage<T = any> {
    source: 'workbench';
    version: 1;
    type: OutboundType;
    payload?: T;
    requestId?: string;
}

interface CycleManagerMessage<T = any> {
    source: 'cycle-manager';
    version: 1;
    type: InboundType;
    payload?: T;
    requestId?: string;
}

export interface WorkbenchModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    binding: MissionAppBinding | null;
    missionId: number;
    missionName: string;
    currentUserId?: string;
    organizationId?: number;
    /** Invalidated by mission_id after a 'saved' event so the cycle row reflects the change */
    cycleId?: number;
}

export function WorkbenchModal({
    open,
    onOpenChange,
    binding,
    missionId,
    missionName,
    currentUserId,
    organizationId,
    cycleId,
}: WorkbenchModalProps) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(false);
    const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
    const [lastSavedSummary, setLastSavedSummary] = useState<string | null>(null);
    const [registeredActions, setRegisteredActions] = useState<RegisteredAction[]>([]);
    const [actionPending, setActionPending] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Reset state when binding changes (different app being opened)
    useEffect(() => {
        if (open && binding) {
            setLoading(true);
            setDirty(false);
            setLastSavedSummary(null);
            setRegisteredActions([]);
        }
    }, [open, binding?.id]);

    const postToChild = useCallback((msg: Omit<CycleManagerMessage, 'source' | 'version'>) => {
        if (!iframeRef.current?.contentWindow) return;
        const full: CycleManagerMessage = { source: 'cycle-manager', version: 1, ...msg };
        try {
            iframeRef.current.contentWindow.postMessage(full, window.location.origin);
        } catch {
            // Origin mismatch (shouldn't happen in our setup) — drop silently
        }
    }, []);

    // Message listener (registered while modal open)
    useEffect(() => {
        if (!open || !binding) return;

        const handler = (event: MessageEvent) => {
            console.log("WorkbenchModal received message:", event.data, "origin:", event.origin, "expected:", window.location.origin);
            // Origin check FIRST — never trust messages from elsewhere
            if (event.origin !== window.location.origin) {
                console.log("Origin mismatch. Dropping.");
                return;
            }
            const msg = event.data as WorkbenchMessage | undefined;
            if (!msg || msg.source !== 'workbench' || msg.version !== 1) {
                console.log("Message dropped because of shape mismatch.", msg);
                return;
            }

            switch (msg.type) {
                case 'ready':
                    setLoading(false);
                    // Send context now that the child has signalled readiness
                    postToChild({
                        type: 'context',
                        payload: {
                            missionId,
                            bindingId: binding.id,
                            cycleId,
                            mission: { id: missionId, name: missionName, objective: null },
                            user: currentUserId ? { id: currentUserId } : undefined,
                            organizationId,
                        },
                    });
                    break;
                case 'saved': {
                    const summary = (msg.payload as any)?.summary ?? 'Saved';
                    const affected: string[] = (msg.payload as any)?.affectedMissionFields ?? [];
                    setDirty(false);
                    setLastSavedSummary(summary);
                    toast({ description: summary });
                    // Invalidate the mission's data so Cycle Manager re-fetches
                    queryClient.invalidateQueries({ queryKey: ['mission', missionId] });
                    if (cycleId != null) {
                        queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
                        queryClient.invalidateQueries({ queryKey: ['cycle-mission-bindings', cycleId] });
                    }
                    if (affected.length > 0) {
                        // Hook for specific row sub-panels to react (deliverables, blackboard, etc.)
                        queryClient.invalidateQueries({ queryKey: ['mission-deliverables', missionId] });
                    }
                    break;
                }
                case 'unsaved-change':
                    setDirty((msg.payload as any)?.dirty ?? true);
                    break;
                case 'request-close':
                    onOpenChange(false);
                    break;
                case 'navigate-out': {
                    const target = (msg.payload as any)?.targetUrl;
                    if (typeof target === 'string') {
                        window.open(target, '_blank', 'noopener,noreferrer');
                    }
                    break;
                }
                case 'register-actions': {
                    const actions = (msg.payload as any)?.actions;
                    if (Array.isArray(actions)) {
                        setRegisteredActions(actions as RegisteredAction[]);
                    }
                    break;
                }
                case 'trigger-cycle': {
                    if (cycleId == null) {
                        postToChild({
                            type: 'ack',
                            requestId: msg.requestId,
                            payload: { ok: false, error: 'No cycle is bound to this workbench.' },
                        });
                        toast({ title: 'Cycle Not Triggered', description: 'This workbench is not attached to a cycle.', variant: 'destructive' });
                        break;
                    }

                    apiRequest('POST', `/api/cycles/${cycleId}/trigger`, {
                        source: 'workbench',
                        bindingId: binding.id,
                        missionId,
                        reason: (msg.payload as any)?.reason,
                        payload: (msg.payload as any)?.payload,
                    })
                        .then(async (res) => {
                            const body = await res.json().catch(() => ({}));
                            postToChild({ type: 'ack', requestId: msg.requestId, payload: { ok: true, ...body } });
                            toast({ title: 'Cycle Triggered', description: body?.message || 'Cycle execution has started.' });
                            queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
                            queryClient.invalidateQueries({ queryKey: ['cycle-mission-bindings', cycleId] });
                        })
                        .catch((err: any) => {
                            postToChild({ type: 'ack', requestId: msg.requestId, payload: { ok: false, error: err?.message || 'Cycle trigger failed.' } });
                            toast({ title: 'Cycle Not Triggered', description: err?.message || 'Cycle trigger failed.', variant: 'destructive' });
                        });
                    break;
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [open, binding, missionId, missionName, currentUserId, organizationId, cycleId, postToChild, queryClient, toast, onOpenChange]);

    const handleAttemptClose = useCallback((nextOpen: boolean) => {
        if (!nextOpen && dirty) {
            setConfirmCloseOpen(true);
            return;
        }
        onOpenChange(nextOpen);
    }, [dirty, onOpenChange]);

    const handleConfirmedClose = useCallback(() => {
        postToChild({ type: 'force-close' });
        setConfirmCloseOpen(false);
        onOpenChange(false);
    }, [postToChild, onOpenChange]);

    const handleOpenInNewTab = useCallback(() => {
        if (!binding) return;
        const slug = binding.publicSlug || binding.appSlug;
        window.open(`/app/${slug}${binding.route ?? ''}`, '_blank', 'noopener,noreferrer');
    }, [binding]);

    const handleTriggerCycle = useCallback(async () => {
        if (cycleId == null || !binding) return;
        try {
            const res = await apiRequest('POST', `/api/cycles/${cycleId}/trigger`, {
                source: 'workbench-modal',
                bindingId: binding.id,
                missionId,
            });
            const body = await res.json().catch(() => ({}));
            toast({ title: 'Cycle Triggered', description: body?.message || 'Cycle execution has started.' });
            queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
            queryClient.invalidateQueries({ queryKey: ['cycle-mission-bindings', cycleId] });
        } catch (err: any) {
            toast({ title: 'Cycle Not Triggered', description: err?.message || 'Cycle trigger failed.', variant: 'destructive' });
        }
    }, [binding, cycleId, missionId, queryClient, toast]);

    /** Dispatch a registered action back to the child iframe. */
    const handleRegisteredAction = useCallback((action: RegisteredAction) => {
        if (!iframeRef.current?.contentWindow) return;
        setActionPending(action.id);
        postToChild({
            type: 'ack',
            payload: { ok: true, action: action.id, ackType: action.ackType },
        });
        // Clear pending state after short delay
        setTimeout(() => setActionPending(null), 1500);
    }, [postToChild]);

    if (!binding) return null;

    const slug = binding.publicSlug || binding.appSlug;
    const moduleRoute = binding.route ?? '';
    const iframeParams = new URLSearchParams({
        embed: '1',
        missionId: String(missionId),
        bindingId: String(binding.id),
    });
    if (cycleId != null) iframeParams.set('cycleId', String(cycleId));
    const iframeSrc = `/app/${slug}${moduleRoute}?${iframeParams.toString()}`;
    const displayLabel = binding.label || binding.appName;

    return (
        <>
            <TooltipProvider>
                <Dialog open={open} onOpenChange={handleAttemptClose}>
                    <DialogContent className="max-w-[90vw] w-[90vw] h-[90vh] p-0 flex flex-col bg-background border-white/10 overflow-hidden">
                        {/* ── Modal Header ──────────────────────────────────────────────────── */}
                        <DialogHeader className="px-4 py-3 border-b border-white/5 flex flex-row items-center justify-between gap-2 space-y-0 shrink-0">
                            <div className="min-w-0 flex-1 flex items-center gap-3">
                                <div className="min-w-0">
                                    <DialogTitle className="text-sm font-semibold text-foreground truncate">{displayLabel}</DialogTitle>
                                    <DialogDescription className="text-xs text-muted-foreground mt-0.5 truncate">
                                        {missionName}
                                    </DialogDescription>
                                </div>
                                {/* Save / Dirty State Pill */}
                                {dirty ? (
                                    <span className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                        <Save className="w-2.5 h-2.5" />
                                        Unsaved
                                    </span>
                                ) : lastSavedSummary ? (
                                    <span className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                        Saved
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                {cycleId != null && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs text-teal-700 dark:text-teal-300 hover:text-foreground hover:bg-teal-500/10 gap-1"
                                                onClick={handleTriggerCycle}
                                            >
                                                <Zap className="w-3 h-3" />
                                                Run cycle
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Trigger the owning cycle</TooltipContent>
                                    </Tooltip>
                                )}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                                            onClick={handleOpenInNewTab}
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                            Open in tab
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Open as a standalone page</TooltipContent>
                                </Tooltip>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => handleAttemptClose(false)}
                                    aria-label="Close"
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </DialogHeader>

                        {/* ── App iframe ────────────────────────────────────────────────────── */}
                        <div className="relative flex-1 bg-background min-h-0">
                            {loading && (
                                <div className="absolute inset-0 z-10 bg-background p-6 space-y-4">
                                    {/* Ghost skeleton layout matching a typical workbench app */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-2">
                                            <Skeleton className="h-6 w-48 bg-foreground/5" />
                                            <Skeleton className="h-3 w-72 bg-foreground/5" />
                                        </div>
                                        <div className="flex gap-2">
                                            <Skeleton className="h-8 w-24 bg-foreground/5 rounded-lg" />
                                            <Skeleton className="h-8 w-24 bg-foreground/5 rounded-lg" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-4">
                                        {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 bg-foreground/5 rounded-xl" />)}
                                    </div>
                                    <Skeleton className="h-48 w-full bg-foreground/5 rounded-xl" />
                                    <div className="grid grid-cols-3 gap-4">
                                        {[1,2,3].map(i => <Skeleton key={i} className="h-32 bg-foreground/5 rounded-xl" />)}
                                    </div>
                                </div>
                            )}
                            {hasNativeWorkbench(iframeSrc, slug, displayLabel) ? (
                                <div className="w-full h-full overflow-hidden">
                                    <NativeWorkbench
                                        publicPath={iframeSrc}
                                        slug={slug}
                                        name={displayLabel}
                                        missionId={missionId}
                                        cycleId={cycleId ?? undefined}
                                    />
                                </div>
                            ) : (
                                <iframe
                                    ref={iframeRef}
                                    src={iframeSrc}
                                    className="w-full h-full border-0"
                                    title={displayLabel}
                                    onLoad={() => setLoading(false)}
                                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                                />
                            )}
                        </div>

                        {/* ── Platform-Native Action Bar (populated by register-actions) ─── */}
                        {registeredActions.length > 0 && !loading && (
                            <div className="shrink-0 px-4 py-3 border-t border-white/5 bg-background flex items-center justify-end gap-2">
                                <span className="text-[10px] text-muted-foreground mr-auto font-mono uppercase tracking-wider">{displayLabel} actions</span>
                                {registeredActions.map((action) => {
                                    const isPending = actionPending === action.id;
                                    const variantClasses =
                                        action.variant === 'primary'
                                            ? 'bg-blue-600 hover:bg-blue-500 text-foreground shadow-lg shadow-blue-900/20'
                                            : action.variant === 'danger'
                                            ? 'bg-rose-700 hover:bg-rose-600 text-foreground shadow-lg shadow-rose-900/20'
                                            : 'bg-foreground/5 hover:bg-foreground/10 text-foreground/70 border border-white/10';
                                    return (
                                        <button
                                            key={action.id}
                                            disabled={isPending}
                                            onClick={() => handleRegisteredAction(action)}
                                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${variantClasses} disabled:opacity-60 disabled:cursor-not-allowed`}
                                        >
                                            {isPending ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : action.variant === 'primary' ? (
                                                <Zap className="w-3 h-3" />
                                            ) : action.variant === 'danger' ? (
                                                <AlertCircle className="w-3 h-3" />
                                            ) : null}
                                            {action.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </TooltipProvider>

            <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {displayLabel} reports unsaved changes. Closing now will discard them.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep editing</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmedClose}>Discard &amp; close</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
