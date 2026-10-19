/**
 * GovernanceDashboard
 *
 * Real-time policy violation monitoring panel for the Oddjob admin UI.
 *
 * Features:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │ Summary stats (24h total · 24h blocked · unresolved)    │
 *  ├─────────────────────────────────────────────────────────┤
 *  │ Filter bar (blocked | unresolved | check type | since)  │
 *  ├─────────────────────────────────────────────────────────┤
 *  │ Violations table with resolve action                    │
 *  │   id · type · value · role · enforcement · context      │
 *  │   occurred_at · blocked badge · resolved status         │
 *  └─────────────────────────────────────────────────────────┘
 *
 * Polls every 30s; manual refresh via the Refresh button.
 */

import React, { useEffect, useRef } from 'react';
import {
    ShieldAlert, ShieldOff, ShieldCheck,
    RefreshCw, CheckCircle, Filter,
} from 'lucide-react';
import { useGovernanceDashboard, type PolicyViolation, type ViolationFilter } from '../../hooks/useGovernanceDashboard.js';

// ---------------------------------------------------------------------------
// Tiny design-system shims — mirrors the host app's Tailwind classes.
// Replace with @/components/ui/* imports once this moves into the client tree.
// ---------------------------------------------------------------------------

function cn(...classes: (string | undefined | false)[]) {
    return classes.filter(Boolean).join(' ');
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'destructive' | 'warning' | 'success' | 'outline' }) {
    const map: Record<string, string> = {
        default:     'bg-primary/10 text-primary border-primary/20',
        destructive: 'bg-red-50 text-red-700 border-red-200',
        warning:     'bg-yellow-50 text-yellow-700 border-yellow-200',
        success:     'bg-emerald-50 text-emerald-700 border-emerald-200',
        outline:     'bg-transparent text-muted-foreground border-border',
    };
    return (
        <span className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
            map[variant] ?? map.default
        )}>
            {children}
        </span>
    );
}

function StatCard({ title, value, icon: Icon, color }: {
    title: string;
    value: number | undefined;
    icon: React.ElementType;
    color: string;
}) {
    return (
        <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex items-center gap-4">
            <div className={cn('rounded-lg p-2.5', color)}>
                <Icon className="h-5 w-5" />
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
                {value === undefined
                    ? <div className="mt-1 h-7 w-16 bg-muted animate-pulse rounded" />
                    : <p className="mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
                }
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkTypeBadge(type: string) {
    const map: Record<string, string> = {
        tool: 'bg-purple-50 text-purple-700 border-purple-200',
        filePath: 'bg-sky-50 text-sky-700 border-sky-200',
        network: 'bg-orange-50 text-orange-700 border-orange-200',
        model: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    };
    const cls = map[type] ?? 'bg-muted text-muted-foreground border-border';
    return (
        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide', cls)}>
            {type}
        </span>
    );
}

function relativeTime(iso: string) {
    const delta = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(delta / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GovernanceDashboardProps {
    /** Auto-refresh interval in ms. Default 30 000. Set to 0 to disable. */
    pollInterval?: number;
}

export default function GovernanceDashboard({ pollInterval = 30_000 }: GovernanceDashboardProps) {
    const {
        summary, violations, filter, setFilter,
        loading, error, refresh, resolve,
    } = useGovernanceDashboard({ limit: 100 });

    // Auto-poll
    const intervalRef = useRef<ReturnType<typeof setInterval>>();
    useEffect(() => {
        if (!pollInterval) return;
        intervalRef.current = setInterval(refresh, pollInterval);
        return () => clearInterval(intervalRef.current);
    }, [pollInterval, refresh]);

    // ---------------------------------------------------------------------------
    // Filter bar actions
    // ---------------------------------------------------------------------------
    const CHECK_TYPES = ['', 'tool', 'filePath', 'network', 'model'];

    // ---------------------------------------------------------------------------
    // Row resolve handler
    // ---------------------------------------------------------------------------
    const handleResolve = async (v: PolicyViolation) => {
        try {
            await resolve(v.id);
        } catch (e: any) {
            alert(`Could not resolve: ${e.message}`);
        }
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-primary" />
                        Capability Policy Violations
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Real-time enforcement log for agent capability policies
                    </p>
                </div>
                <button
                    onClick={refresh}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                    Refresh
                </button>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                    title="Total (24h)"
                    value={summary?.totalLast24h}
                    icon={ShieldAlert}
                    color="bg-primary/10 text-primary"
                />
                <StatCard
                    title="Blocked (24h)"
                    value={summary?.blockedLast24h}
                    icon={ShieldOff}
                    color="bg-red-100 text-red-600"
                />
                <StatCard
                    title="Unresolved"
                    value={summary?.unresolvedTotal}
                    icon={ShieldCheck}
                    color="bg-yellow-100 text-yellow-600"
                />
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-card px-4 py-3 shadow-sm">
                <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                {/* Blocked only */}
                <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={!!filter.blockedOnly}
                        onChange={e => setFilter((f: ViolationFilter) => ({ ...f, blockedOnly: e.target.checked || undefined }))}
                        className="rounded"
                    />
                    Blocked only
                </label>

                {/* Unresolved only */}
                <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={!!filter.unresolvedOnly}
                        onChange={e => setFilter((f: ViolationFilter) => ({ ...f, unresolvedOnly: e.target.checked || undefined }))}
                        className="rounded"
                    />
                    Unresolved only
                </label>

                {/* Check type */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Type:</span>
                    <select
                        value={filter.checkType ?? ''}
                        onChange={e => setFilter((f: ViolationFilter) => ({ ...f, checkType: e.target.value || undefined }))}
                        title="Check Type Filter"
                        aria-label="Check Type Filter"
                        className="text-sm border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {CHECK_TYPES.map(t => (
                            <option key={t} value={t}>{t || 'All types'}</option>
                        ))}
                    </select>
                </div>

                {/* Since */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Since:</span>
                    <input
                        type="date"
                        value={filter.since?.slice(0, 10) ?? ''}
                        onChange={e => setFilter((f: ViolationFilter) => ({ ...f, since: e.target.value ? `${e.target.value}T00:00:00Z` : undefined }))}
                        title="Start Date Filter"
                        placeholder="yyyy-mm-dd"
                        aria-label="Start Date Filter"
                        className="text-sm border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>
            </div>

            {/* Error state */}
            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    Failed to load violations: {error}
                </div>
            )}

            {/* Violations table */}
            <div className="rounded-xl border border-border/40 bg-card shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border/40 bg-muted/30">
                            <tr>
                                {['#', 'Type', 'Value', 'Role', 'Enforcement', 'Context', 'When', 'Status', ''].map(h => (
                                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && violations.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                        <RefreshCw className="inline h-4 w-4 animate-spin mr-2" />
                                        Loading violations…
                                    </td>
                                </tr>
                            )}
                            {!loading && violations.length === 0 && !error && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-12 text-center">
                                        <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400 mb-2" />
                                        <p className="font-medium text-emerald-700">No violations match your filters</p>
                                        <p className="text-xs text-muted-foreground mt-1">All clear — or try adjusting the filters above.</p>
                                    </td>
                                </tr>
                            )}
                            {violations.map((v: PolicyViolation) => (
                                <tr
                                    key={v.id}
                                    className={cn(
                                        'border-b border-border/20 transition-colors hover:bg-muted/20',
                                        v.resolved && 'opacity-50'
                                    )}
                                >
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.id}</td>
                                    <td className="px-4 py-3">{checkTypeBadge(v.checkType)}</td>
                                    <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate" title={v.checkValue}>
                                        {v.checkValue}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.role}</td>
                                    <td className="px-4 py-3">
                                        <Badge variant={
                                            v.enforcement === 'strict' ? 'destructive' :
                                            v.enforcement === 'warn'   ? 'warning'    : 'outline'
                                        }>
                                            {v.enforcement}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground">
                                        {v.missionId && <span>M:{v.missionId} </span>}
                                        {v.pipelineId && <span>P:{v.pipelineId} </span>}
                                        {v.jobId && <span>J:{v.jobId}</span>}
                                        {!v.missionId && !v.pipelineId && !v.jobId && <span className="opacity-40">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                        {relativeTime(v.occurredAt)}
                                    </td>
                                    <td className="px-4 py-3">
                                        {v.blocked
                                            ? <Badge variant="destructive">blocked</Badge>
                                            : <Badge variant="warning">warned</Badge>
                                        }
                                    </td>
                                    <td className="px-4 py-3">
                                        {!v.resolved ? (
                                            <button
                                                onClick={() => handleResolve(v)}
                                                className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                                                title="Mark as resolved"
                                            >
                                                <CheckCircle className="h-3.5 w-3.5" />
                                                Resolve
                                            </button>
                                        ) : (
                                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                                                Resolved
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {violations.length > 0 && (
                    <div className="border-t border-border/20 px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
                        <span>Showing {violations.length} violation{violations.length !== 1 ? 's' : ''}</span>
                        <span className="opacity-50">Auto-refreshes every {Math.round(pollInterval / 1000)}s</span>
                    </div>
                )}
            </div>
        </div>
    );
}
