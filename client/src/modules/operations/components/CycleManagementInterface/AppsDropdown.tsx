/**
 * AppsDropdown — per-mission-row "🛠 Apps ▾" control.
 *
 * Renders a popover listing every app bound to the mission with three
 * actions per app:
 *   - Open  — opens the WorkbenchModal in-place (default for openModeDefault='modal')
 *   - Page  — opens /app/{slug} in a new tab (default for openModeDefault='page')
 *   - Build — opens /builder/apps/{appId} in a new tab (gated to org admins)
 *
 * The Open action is disabled when the app's health badge is anything but
 * 'running', with a tooltip explaining why. Page works regardless of health
 * (the user will see the proxy's "App is hydrating..." page if it's stopped).
 *
 * Empty state: when a mission has no bindings, the button is hidden entirely.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Wrench, ChevronDown, ExternalLink, Hammer, PlaySquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AppBindingHealth = 'running' | 'errored' | 'stopped' | 'unknown';
export type AppBindingRole = 'primary' | 'reference' | 'oversight';
export type AppBindingOpenMode = 'modal' | 'page';

export interface MissionAppBinding {
    id: number;
    appId: number;
    appSlug: string;
    appName: string;
    role: AppBindingRole;
    label: string | null;
    openModeDefault: AppBindingOpenMode;
    sortOrder: number;
    source: 'blueprint' | 'manual';
    publicSlug: string | null;
    /** Module route within a shared-server app (e.g. "/ingestion-hub"); null for single-page apps. */
    route?: string | null;
    health: AppBindingHealth;
}

export interface AppsDropdownProps {
    missionId: number;
    bindings: MissionAppBinding[];
    onOpenModal: (binding: MissionAppBinding) => void;
    canEditBuilder?: boolean;
    className?: string;
}

const HEALTH_DOT_CLASSES: Record<AppBindingHealth, string> = {
    running: 'bg-emerald-500',
    errored: 'bg-rose-500',
    stopped: 'bg-amber-500',
    unknown: 'bg-muted',
};

const HEALTH_LABEL: Record<AppBindingHealth, string> = {
    running: 'Running',
    errored: 'Errored — restart via Builder',
    stopped: 'Stopped — Open via Builder to start',
    unknown: 'Status unknown',
};

const ROLE_BADGE_CLASSES: Record<AppBindingRole, string> = {
    primary: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    reference: 'bg-muted/15 text-foreground/70 border-slate-500/30',
    oversight: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
};

export function AppsDropdown({
    missionId,
    bindings,
    onOpenModal,
    canEditBuilder = false,
    className,
}: AppsDropdownProps) {
    // Hide entirely when there are no bindings — Cycle Manager rows stay clean
    if (!bindings || bindings.length === 0) return null;

    const handlePage = (binding: MissionAppBinding) => {
        const slug = binding.publicSlug || binding.appSlug;
        window.open(`/app/${slug}${binding.route ?? ''}`, '_blank', 'noopener,noreferrer');
    };

    const handleBuilder = (binding: MissionAppBinding) => {
        window.open(`/builder/apps/${binding.appId}`, '_blank', 'noopener,noreferrer');
    };

    return (
        <TooltipProvider>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn('h-8 gap-1.5 text-xs text-foreground/70 hover:text-foreground', className)}
                        data-testid={`apps-dropdown-${missionId}`}
                    >
                        <Wrench className="w-3.5 h-3.5" />
                        Apps
                        <span className="text-[10px] text-muted-foreground font-mono">{bindings.length}</span>
                        <ChevronDown className="w-3 h-3" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-80 p-0 bg-background border-white/10"
                    align="end"
                    sideOffset={4}
                >
                    <div className="px-3 py-2 border-b border-white/5">
                        <div className="text-xs text-muted-foreground">Mission apps</div>
                    </div>
                    <div className="max-h-96 overflow-y-auto divide-y divide-white/5">
                        {bindings.map(binding => {
                            const openDisabled = binding.health !== 'running';
                            const displayLabel = binding.label || binding.appName;
                            return (
                                <div key={binding.id} className="p-3 hover:bg-foreground/[0.02]">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span
                                                            className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', HEALTH_DOT_CLASSES[binding.health])}
                                                            aria-label={HEALTH_LABEL[binding.health]}
                                                        />
                                                    </TooltipTrigger>
                                                    <TooltipContent>{HEALTH_LABEL[binding.health]}</TooltipContent>
                                                </Tooltip>
                                                <span className="text-sm font-medium text-foreground truncate" title={displayLabel}>
                                                    {displayLabel}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5 ml-4">
                                                <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase border', ROLE_BADGE_CLASSES[binding.role])}>
                                                    {binding.role}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-mono">{binding.appSlug}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 ml-4">
                                        {openDisabled ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span tabIndex={0}>
                                                        <Button size="sm" variant="secondary" disabled className="h-7 text-xs gap-1">
                                                            <PlaySquare className="w-3 h-3" />
                                                            Open
                                                        </Button>
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>{HEALTH_LABEL[binding.health]}</TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7 text-xs gap-1"
                                                onClick={() => onOpenModal(binding)}
                                                data-testid={`apps-open-${binding.id}`}
                                            >
                                                <PlaySquare className="w-3 h-3" />
                                                Open
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs gap-1 text-foreground/70 hover:text-foreground"
                                            onClick={() => handlePage(binding)}
                                            data-testid={`apps-page-${binding.id}`}
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                            Page
                                        </Button>
                                        {canEditBuilder && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                                onClick={() => handleBuilder(binding)}
                                                data-testid={`apps-builder-${binding.id}`}
                                            >
                                                <Hammer className="w-3 h-3" />
                                                Build
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        </TooltipProvider>
    );
}
