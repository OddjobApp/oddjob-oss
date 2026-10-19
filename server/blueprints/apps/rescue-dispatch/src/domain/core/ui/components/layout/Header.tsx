import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Sparkles, Sun, Moon } from 'lucide-react';
import { NotificationInbox } from './NotificationInbox.js';
import { DecisionIndicator } from './DecisionIndicator.js';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { useLocation, useSearch } from 'wouter';

interface HeaderProps {
    title: string;
    breadcrumbs: string[];
    isDarkMode?: boolean;
    onToggleDarkMode?: () => void;
    username?: string;
    role?: string;
    orgSelector?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
    title,
    breadcrumbs,
    isDarkMode = false,
    onToggleDarkMode = () => { },
    username = "admin",
    role = "Superuser",
    orgSelector
}) => {
    const [location, setLocation] = useLocation();
    const searchString = useSearch();
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
        <header className={cn(
            "h-24 rounded-[2rem] flex items-center justify-between px-6 transition-all duration-500 sticky top-4 z-50 mx-2",
            "backdrop-blur-3xl border border-white/20 dark:border-white/5 bg-white/60 dark:bg-black/80 shadow-2xl",
            "shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
        )}>
            <div className="flex items-center gap-6">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground dark:text-slate-500 mb-1">
                        {breadcrumbs.map((crumb, idx) => (
                            <React.Fragment key={crumb}>
                                <span>{crumb}</span>
                                {idx < breadcrumbs.length - 1 && <span className="opacity-40">/</span>}
                            </React.Fragment>
                        ))}
                    </div>
                    <h2 className="text-2xl font-black text-primary dark:text-white tracking-tight leading-none">{title}</h2>
                </div>
            </div>

            <div className="flex items-center gap-4">
                {/* Fix #7: use design-system Input instead of raw <input> */}
                <div className="relative group hidden md:block">
                    <Input
                        className="pl-11 pr-6 py-3 bg-white/20 dark:bg-black/40 border-white/20 dark:border-white/10 rounded-2xl text-sm w-80 focus-visible:ring-4 focus-visible:ring-primary/10 focus-visible:border-primary/50 placeholder:text-slate-500"
                        placeholder="Search resources..."
                        type="text"
                        value={searchValue}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                        </svg>
                    </div>
                </div>

                {orgSelector}

                <DecisionIndicator />
                <NotificationInbox />

                <button
                    onClick={onToggleDarkMode}
                    className="flex items-center justify-center min-w-[3rem] w-12 h-12 rounded-2xl glass-card bg-white/10 dark:bg-white/5 hover:scale-110 active:scale-90 transition-all text-primary dark:text-amber-400 shadow-lg"
                    title={isDarkMode ? "Switch to Atmospheric Mode" : "Switch to Orbital Mode"}
                >
                    {isDarkMode ? <Sun className="h-6 w-6" /> : <Moon className="h-6 w-6" />}
                </button>

                {/* Fix #8: Copilot button no longer pulses based on unrelated forms notifications */}
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('agent-assist-request'))}
                    className={cn(
                        "flex items-center justify-center min-w-[3rem] w-12 h-12 rounded-2xl glass-card bg-white/20 dark:bg-white/5 hover:scale-110 active:scale-90 transition-all text-primary dark:text-indigo-400 shadow-lg",
                        "relative group"
                    )}
                    title="Open Oddjob Assistant"
                >
                    <Sparkles className="h-6 w-6" />
                </button>

                <div className="w-[1px] h-8 bg-white/20 dark:bg-white/5 mx-2"></div>

                {/* Fix #9: initials avatar — no external service */}
                <div className="flex items-center gap-3 pl-2">
                    <div className="relative">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-accent-tan dark:from-primary dark:to-bronze-muted p-[2px] shadow-lg">
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
                        <span className="text-[10px] font-bold text-muted-foreground dark:text-slate-500 uppercase tracking-tighter">{role}</span>
                    </div>
                </div>
            </div>
        </header>
    );
};
