import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Inbox, ExternalLink, Check, Trash2, Loader2, Sparkles, X } from 'lucide-react';
import { Link as WouterLink } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';

export const NotificationInbox: React.FC = () => {
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);

    const { data: notifications, isLoading } = useQuery<any[]>({
        queryKey: ['/api/forms/notifications'],
        refetchInterval: 5000,
    });

    const markAsViewed = useMutation({
        mutationFn: async (notification: any) => {
            if (notification.type === 'xray_operation') {
                await apiRequest('PUT', `/api/xray/operations/notifications/${notification.xrayNotificationId}/acknowledge`);
                return;
            }
            await apiRequest('PUT', `/api/forms/${notification.id}/viewed`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/forms/notifications'] });
        },
    });

    const unviewedCount = notifications?.length || 0;
    const openAssistantApprovals = (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setIsOpen(false);
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('agent-assist-request', {
                detail: {
                    context: { assistantView: 'approvals', source: 'notification-inbox' },
                },
            }));
        }, 50);
    };
    const openXrayNotification = (notification: any, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        markAsViewed.mutate(notification);
        setIsOpen(false);
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('agent-assist-request', {
                detail: {
                    prompt: `Explain this X-Ray operational notification and recommend the next safe action: ${notification.name}`,
                    context: {
                        source: 'xray-operational-notification',
                        scope: notification.scope,
                        severity: notification.severity,
                        notification: notification.payload,
                    },
                },
            }));
        }, 50);
    };

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    className={cn(
                        "relative flex items-center justify-center min-w-[3rem] w-12 h-12 rounded-2xl glass-card transition-all text-primary dark:text-primary shadow-lg",
                        "bg-white/20 dark:bg-white/5 hover:scale-110 active:scale-90",
                        unviewedCount > 0 ? "text-primary animate-pulse-slow" : ""
                    )}
                    title="Action Inbox"
                >
                    <Inbox className="h-6 w-6" />
                    {unviewedCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center bg-red-500 text-white text-[10px] font-black rounded-full shadow-lg ring-2 ring-white dark:ring-slate-900 border-2 border-white/20">
                            {unviewedCount}
                        </span>
                    )}
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent 
                align="end" 
                className="w-[380px] rounded-[2rem] p-0 overflow-hidden border-none backdrop-blur-2xl bg-background/90 shadow-2xl animate-in zoom-in-95 duration-200 dark border border-white/10"
                onCloseAutoFocus={(e) => {
                    e.preventDefault();
                }}
            >
                <div className="p-6 pb-4 flex items-center justify-between bg-gradient-to-br from-primary/20 to-orange-950/20">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-xl">
                            <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <h3 className="font-black text-lg text-foreground tracking-tight">Oddjob Inbox</h3>
                    </div>
                    {unviewedCount > 0 && (
                        <Badge className="bg-red-500 text-foreground border-none font-bold scale-90">
                            {unviewedCount} New
                        </Badge>
                    )}
                </div>

                <div className="max-h-[450px] overflow-y-auto px-2 py-1 scrollbar-hide">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin opacity-50" />
                            <span className="text-xs font-bold uppercase tracking-widest animate-pulse">Scanning Flux...</span>
                        </div>
                    ) : unviewedCount === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
                            <div className="w-16 h-16 rounded-3xl bg-muted dark:bg-muted/50 flex items-center justify-center">
                                <Check className="h-8 w-8 text-foreground/70 dark:text-muted-foreground" />
                            </div>
                            <div>
                                <h4 className="font-bold text-muted-foreground dark:text-muted-foreground text-sm">Clear Horizons</h4>
                                <p className="text-xs text-muted-foreground/70 mt-1">No pending agent interventions at this time.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {/* AI Executive Shift Briefing Card */}
                            <div className="mx-2 mb-3 p-3.5 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-background shadow-xs space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                        <Sparkles className="h-3 w-3" />
                                        Executive Shift Briefing
                                    </span>
                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary font-mono">
                                        AI-Triaged
                                    </Badge>
                                </div>
                                <p className="text-xs text-foreground/90 leading-snug">
                                    {notifications?.some(n => n.type === 'approval')
                                        ? `${notifications.filter(n => n.type === 'approval').length} approval request${notifications.filter(n => n.type === 'approval').length > 1 ? 's' : ''} awaiting review in Assistant. Routine workflows are operating within SLA.`
                                        : `${unviewedCount} active notification${unviewedCount > 1 ? 's' : ''} logged. No critical blocking approvals detected.`}
                                </p>
                                <div className="flex items-center gap-2 pt-1">
                                    {notifications?.some(n => n.type === 'approval') && (
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs px-3 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 rounded-lg shadow-xs"
                                            onClick={openAssistantApprovals}
                                        >
                                            Review Approvals
                                        </Button>
                                    )}
                                    {notifications?.some(n => n.type === 'xray_operation') && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs px-2.5 text-muted-foreground hover:text-foreground rounded-lg"
                                            onClick={async () => {
                                                const xrayItems = notifications.filter(n => n.type === 'xray_operation');
                                                for (const item of xrayItems) {
                                                    await markAsViewed.mutateAsync(item);
                                                }
                                            }}
                                        >
                                            Acknowledge Routine ({notifications.filter(n => n.type === 'xray_operation').length})
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {notifications?.map((notif) => (
                                <div 
                                    key={notif.id}
                                    className="group relative p-4 rounded-[1.5rem] transition-all hover:bg-muted dark:hover:bg-white/5 border border-transparent hover:border-slate-100 dark:hover:border-white/10"
                                >
                                    <div className="flex gap-4">
                                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/10 to-orange-500/10 flex items-center justify-center shrink-0 border border-primary/10">
                                            <Bell className="h-5 w-5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <span className="text-[10px] font-black text-primary uppercase tracking-widest">
                                                    Action Required
                                                </span>
                                                <span className="text-[10px] font-bold text-muted-foreground">
                                                    {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-bold text-foreground/85 truncate pr-6">
                                                {notif.name || (notif.type === 'approval' ? 'Approval Required' : 'HIL Intervention')}
                                            </h4>
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                                {notif.description || 'An agent in your mission is waiting for critical parameters to continue execution.'}
                                            </p>
                                            
                                            <div className="flex items-center gap-2 mt-3">
                                                {notif.type === 'approval' ? (
                                                    <Button
                                                        size="sm"
                                                        className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold px-4 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                                                        onClick={openAssistantApprovals}
                                                    >
                                                        Review in Assistant
                                                    </Button>
                                                ) : notif.type === 'xray_operation' && notif.payload?.actionUrl ? (
                                                    /* An advisory notification that names where to go is a link, not a
                                                       question for the assistant. Every one of these used to open the same
                                                       "explain this X-Ray alert" prompt, so a notification carrying an
                                                       actionUrl had nothing that would follow it. */
                                                    <div className="flex flex-wrap items-center gap-2">
                                                    {notif.payload.platform === 'gmail' && typeof notif.payload.gmailUrl === 'string' && /^https:\/\/mail\.google\.com\//.test(notif.payload.gmailUrl) && <Button variant="outline" size="sm" onClick={() => window.open(notif.payload.gmailUrl, '_blank', 'popup=yes,width=1100,height=850,noopener,noreferrer')}>Open in Gmail</Button>}
                                                    <WouterLink href={String(notif.payload.actionUrl)}>
                                                        <Button
                                                            size="sm"
                                                            className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold px-4 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                                                            onClick={() => { markAsViewed.mutate(notif); setIsOpen(false); }}
                                                        >
                                                            {String(notif.payload.actionLabel ?? 'Open')}
                                                        </Button>
                                                    </WouterLink>
                                                    </div>
                                                ) : notif.type === 'xray_operation' ? (
                                                    <Button
                                                        size="sm"
                                                        className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold px-4 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                                                        onClick={(e) => openXrayNotification(notif, e)}
                                                    >
                                                        Review X-Ray Alert
                                                    </Button>
                                                ) : (
                                                    <WouterLink href={`/hil-form/${notif.stepExecutionId}`}>
                                                        <Button 
                                                            size="sm" 
                                                            className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold px-4 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                                                            onClick={() => {
                                                                markAsViewed.mutate(notif);
                                                                setIsOpen(false);
                                                            }}
                                                        >
                                                            Review & Resolve
                                                        </Button>
                                                    </WouterLink>
                                                )}
                                                <Button 
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-foreground/10 hover:text-red-400"
                                                    onClick={() => markAsViewed.mutate(notif)}
                                                    title="Dismiss"
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-muted/50 dark:bg-black/20 text-center">
                    <button
                        type="button"
                        onClick={openAssistantApprovals}
                        className="text-[10px] font-black text-muted-foreground hover:text-primary dark:hover:text-white transition-colors flex items-center justify-center gap-1 mx-auto uppercase tracking-[0.2em] group"
                    >
                        Review approvals in Assistant
                        <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
