import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MoreHorizontal, Sparkles, Sun, Moon, User, Settings } from 'lucide-react';
import { NotificationInbox } from './NotificationInbox.js';
import { HeaderMissionTicker } from './HeaderMissionTicker.js';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { SidebarTrigger } from '@domain-ui/core/ui/components/ui/sidebar';
import { LIGHT_MODE_ENABLED } from '@domain-ui/core/ui/components/theme-provider';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { Link, useLocation, useSearch } from 'wouter';
import { useDecisionStore } from '../../stores/decision.store';
import { formatBadgeCount } from './DecisionIndicator.js';

export interface BreadcrumbItem {
    label: string;
    href?: string;
}

interface HeaderProps {
    title: string;
    breadcrumbs: (string | BreadcrumbItem)[];
    isDarkMode?: boolean;
    onToggleDarkMode?: () => void;
    username?: string;
    role?: string;
    orgSelector?: React.ReactNode;
    /** Project Space switcher — sets the session scope the copilot inherits (§6.4). */
    projectSelector?: React.ReactNode;
    className?: string;
    isAssistantOpen?: boolean;
    onToggleAssistant?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
    title,
    breadcrumbs,
    isDarkMode = false,
    onToggleDarkMode = () => { },
    username = "admin",
    role = "Superuser",
    orgSelector,
    projectSelector,
    className,
    isAssistantOpen = false,
    onToggleAssistant,
}) => {
    const [location, setLocation] = useLocation();
    const searchString = useSearch();
    const pendingDecisionCount = useDecisionStore((state) => state.pendingCount);
    const pendingDecisionBadge = formatBadgeCount(pendingDecisionCount);
    const [searchValue, setSearchValue] = useState(() => {
        const params = new URLSearchParams(searchString);
        return params.get('q') || '';
    });

    // Update local state if URL changes externally
    useEffect(() => {
        const params = new URLSearchParams(searchString);
        const q = params.get('q') || '';
        if (q !== searchValue) {
            setSearchValue(q);
        }
    }, [searchString]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = (val: string) => {
        setSearchValue(val);
        const params = new URLSearchParams(searchString);
        if (val) {
            params.set('q', val);
        } else {
            params.delete('q');
        }
        const newSearch = params.toString();
        const currentPath = window.location.pathname;
        setLocation(`${currentPath}${newSearch ? `?${newSearch}` : ''}`, { replace: true } as any);
    };

    // Fix #9: derive initials locally — no external avatar service
    const initials = username ? username.substring(0, 2).toUpperCase() : "??";

    return (
        <header
          data-testid="global-app-header"
          className={cn(
            "min-h-[60px] rounded-none flex items-center justify-between gap-3 px-4 py-2 transition-all duration-300 relative w-full sm:h-[68px] sm:px-6 sm:py-0",
            "backdrop-blur-xl border-b border-border/80 bg-background/95 dark:bg-background/90 shadow-sm",
            className
          )}
        >
            <div className="flex min-w-[100px] max-w-[35%] shrink items-center gap-3 sm:gap-6 overflow-hidden">
                <SidebarTrigger className="h-9 w-9 shrink-0 rounded-xl border border-white/20 bg-white/10 text-primary shadow-lg dark:border-white/10 dark:bg-white/5 dark:text-white md:hidden" />
                <div className="flex min-w-0 flex-col justify-center">
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs uppercase tracking-[0.15em] font-extrabold text-muted-foreground dark:text-muted-foreground">
                        {breadcrumbs.map((crumb, idx) => {
                            const isLast = idx === breadcrumbs.length - 1;
                            const label = typeof crumb === 'string' ? crumb : crumb.label;
                            const href = typeof crumb === 'string' ? undefined : crumb.href;

                            return (
                                <React.Fragment key={href || label + idx}>
                                    {isLast || !href ? (
                                        <span className={cn(isLast ? "text-primary dark:text-white font-black text-sm truncate" : "hidden shrink-0 sm:inline")}>
                                            {label}
                                        </span>
                                    ) : (
                                        <Link
                                            href={href}
                                            className="hidden shrink-0 sm:inline text-muted-foreground hover:text-primary dark:hover:text-white transition-colors cursor-pointer underline-offset-4 hover:underline"
                                        >
                                            {label}
                                        </Link>
                                    )}
                                    {!isLast && <span className="hidden opacity-40 sm:inline">/</span>}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            <HeaderMissionTicker className="mx-2 shrink min-w-0 hidden lg:flex" />

            <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5 lg:gap-3">
                {/* Fix #7: use design-system Input instead of raw <input> */}
                <div className="relative group hidden md:block">
                    <Input
                        className="pl-10 pr-14 py-2 bg-white/20 dark:bg-black/40 border-white/20 dark:border-white/10 rounded-xl text-xs h-9 w-44 lg:w-56 xl:w-72 focus-visible:ring-4 focus-visible:ring-primary/10 focus-visible:border-primary/50 placeholder:text-muted-foreground transition-all"
                        placeholder="Search resources…"
                        type="text"
                        value={searchValue}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                        </svg>
                    </div>
                    {/* ⌘K discoverability hint → opens the command palette (wired in Layout). */}
                    <kbd
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded border border-white/15 bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground lg:flex"
                        title="Open command palette"
                    >
                        {typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘" : "Ctrl"} K
                    </kbd>
                </div>

                {orgSelector && (
                    <div className="max-w-[10rem] overflow-hidden sm:max-w-none">
                        {orgSelector}
                    </div>
                )}

                {projectSelector && (
                    <div className="hidden max-w-[10rem] overflow-hidden sm:block sm:max-w-none">
                        {projectSelector}
                    </div>
                )}

                <div className="hidden sm:block">
                    <NotificationInbox />
                </div>

                {LIGHT_MODE_ENABLED && (
                    <button
                        onClick={onToggleDarkMode}
                        className="hidden items-center justify-center min-w-[2.5rem] w-10 h-10 rounded-xl glass-card bg-white/10 dark:bg-white/5 hover:scale-105 active:scale-95 transition-all text-primary dark:text-amber-400 shadow-md sm:flex"
                        title={isDarkMode ? "Switch to Atmospheric Mode" : "Switch to Orbital Mode"}
                    >
                        {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                        <span className="sr-only">{isDarkMode ? "Switch to light mode" : "Switch to dark mode"}</span>
                    </button>
                )}

                {/* Assistant is the single approval entry point; pending decisions pulse here. */}
                <button
                    type="button"
                    data-testid="copilot-header-button"
                    aria-expanded={isAssistantOpen}
                    aria-controls="copilot-chat-sheet"
                    onClick={() => {
                        if (onToggleAssistant) {
                            onToggleAssistant();
                        } else {
                            window.dispatchEvent(new CustomEvent('agent-assist-request', {
                                detail: {
                                    toggle: true,
                                    context: pendingDecisionCount > 0
                                        ? { assistantView: 'approvals', source: 'assistant-header-button' }
                                        : undefined,
                                },
                            }));
                        }
                    }}
                    className={cn(
                        "hidden items-center justify-center min-w-[2.5rem] w-10 h-10 rounded-xl glass-card transition-all shadow-md sm:flex",
                        "relative group",
                        isAssistantOpen
                            ? "bg-primary/20 dark:bg-primary/30 border border-primary/40 ring-2 ring-primary/40 text-primary dark:text-primary"
                            : "bg-white/20 dark:bg-white/5 hover:scale-105 active:scale-95 text-primary dark:text-indigo-400",
                        pendingDecisionCount > 0 && "animate-pulse-slow ring-2 ring-amber-400/40"
                    )}
                    title={isAssistantOpen
                        ? "Close Oddjob Assistant"
                        : pendingDecisionCount > 0
                            ? "Review pending decisions in Oddjob Assistant"
                            : "Open Oddjob Assistant"}
                >
                    <Sparkles className="h-5 w-5" />
                    <span className="sr-only">{isAssistantOpen ? "Close Oddjob Assistant" : "Open Oddjob Assistant"}</span>
                    {pendingDecisionBadge && (
                        <span className="absolute -top-1 -right-1 flex h-4 min-w-[1.1rem] items-center justify-center rounded-full border-2 border-white/20 bg-destructive px-1 text-[9px] font-black text-destructive-foreground shadow-lg ring-2 ring-white dark:ring-slate-900">
                            {pendingDecisionBadge}
                        </span>
                    )}
                </button>

                <div className="hidden w-[1px] h-8 bg-white/20 dark:bg-white/5 mx-2 sm:block"></div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-primary shadow-lg transition active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-white sm:hidden"
                            title="Open account actions"
                        >
                            <MoreHorizontal className="h-5 w-5" />
                            <span className="sr-only">Open account actions</span>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                            onClick={() => {
                                if (onToggleAssistant) {
                                    onToggleAssistant();
                                } else {
                                    window.dispatchEvent(new CustomEvent('agent-assist-request', {
                                        detail: {
                                            toggle: true,
                                            context: pendingDecisionCount > 0
                                                ? { assistantView: 'approvals', source: 'assistant-header-menu' }
                                                : undefined,
                                        },
                                    }));
                                }
                            }}
                        >
                            <Sparkles className="mr-2 h-4 w-4 text-primary" />
                            {isAssistantOpen ? "Close Assistant" : "Copilot Assistant"}
                        </DropdownMenuItem>
                        {LIGHT_MODE_ENABLED && (
                            <DropdownMenuItem onClick={onToggleDarkMode}>
                                {isDarkMode ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                                {isDarkMode ? "Light mode" : "Dark mode"}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setLocation('/profile')}>
                            <User className="mr-2 h-4 w-4" />
                            Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLocation('/settings')}>
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Fix #9: initials avatar — no external service */}
                <div className="flex items-center gap-2 pl-1 sm:gap-3 sm:pl-2">
                    <div className="relative">
                        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-accent-tan dark:from-primary dark:to-bronze-muted p-[2px] shadow-lg sm:h-11 sm:w-11">
                            <div className="w-full h-full rounded-[14px] bg-white dark:bg-black flex items-center justify-center overflow-hidden">
                                <span className="text-sm font-black text-primary dark:text-white select-none">
                                    {initials}
                                </span>
                            </div>
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-black rounded-full"></div>
                    </div>
                    <div className="hidden lg:flex flex-col">
                        <span className="text-sm font-black text-primary dark:text-white leading-none truncate max-w-[100px]">{username}</span>
                        <span className="text-[10px] font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-tighter">{role}</span>
                    </div>
                </div>
            </div>
        </header>
    );
};
