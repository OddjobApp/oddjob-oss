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
        mutationFn: async (id: number) => {
            await apiRequest('PUT', `/api/forms/${id}/viewed`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/forms/notifications'] });
        },
    });

    const unviewedCount = notifications?.length || 0;

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
                className="w-[380px] rounded-[2rem] p-0 overflow-hidden border-none backdrop-blur-2xl bg-slate-950/90 shadow-2xl animate-in zoom-in-95 duration-200 dark border border-white/10"
            >
                <div className="p-6 pb-4 flex items-center justify-between bg-gradient-to-br from-primary/20 to-orange-950/20">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-xl">
                            <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <h3 className="font-black text-lg text-white tracking-tight">Oddjob Inbox</h3>
                    </div>
                    {unviewedCount > 0 && (
                        <Badge className="bg-red-500 text-white border-none font-bold scale-90">
                            {unviewedCount} New
                        </Badge>
                    )}
                </div>

                <div className="max-h-[450px] overflow-y-auto px-2 py-1 scrollbar-hide">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                            <Loader2 className="h-8 w-8 animate-spin opacity-50" />
                            <span className="text-xs font-bold uppercase tracking-widest animate-pulse">Scanning Flux...</span>
                        </div>
                    ) : unviewedCount === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
                            <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center">
                                <Check className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-400 dark:text-slate-500 text-sm">Clear Horizons</h4>
                                <p className="text-xs text-slate-400/70 mt-1">No pending agent interventions at this time.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {notifications?.map((notif) => (
                                <div 
                                    key={notif.id}
                                    className="group relative p-4 rounded-[1.5rem] transition-all hover:bg-slate-50 dark:hover:bg-white/5 border border-transparent hover:border-slate-100 dark:hover:border-white/10"
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
                                                <span className="text-[10px] font-bold text-slate-500">
                                                    {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-bold text-slate-200 truncate pr-6">
                                                {notif.name || (notif.type === 'approval' ? 'Approval Required' : 'HIL Intervention')}
                                            </h4>
                                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                                {notif.description || 'An agent in your mission is waiting for critical parameters to continue execution.'}
                                            </p>
                                            
                                            <div className="flex items-center gap-2 mt-3">
                                                <WouterLink href={notif.type === 'approval' ? '/control/decisions' : `/hil-form/${notif.stepExecutionId}`}>
                                                    <Button 
                                                        size="sm" 
                                                        className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-zinc-950 text-[10px] font-bold px-4 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                                                        onClick={() => {
                                                            if (notif.type !== 'approval') {
                                                                markAsViewed.mutate(notif.id);
                                                            }
                                                            setIsOpen(false);
                                                        }}
                                                    >
                                                        Review & Resolve
                                                    </Button>
                                                </WouterLink>
                                                <Button 
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 w-8 p-0 rounded-lg hover:bg-white/10 hover:text-red-400"
                                                    onClick={() => markAsViewed.mutate(notif.id)}
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

                <div className="p-4 bg-slate-50/50 dark:bg-black/20 text-center">
                    <WouterLink href="/control/decisions" onClick={() => setIsOpen(false)}>
                        <button className="text-[10px] font-black text-slate-400 hover:text-primary dark:hover:text-white transition-colors flex items-center justify-center gap-1 mx-auto uppercase tracking-[0.2em] group">
                            Full Decision Inbox
                            <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </button>
                    </WouterLink>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
