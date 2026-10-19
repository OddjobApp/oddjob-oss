/**
 * useGovernanceDashboard
 *
 * Fetches and caches policy violation data from the Governor API.
 * Exposes:
 *   - summary  (24h widget stats)
 *   - violations (paginated list)
 *   - resolve(id)  — marks a violation resolved and refreshes
 *   - filter / setFilter
 *   - refresh() — manual trigger
 */

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types (mirrors PolicyViolationRecord from server schema)
// ---------------------------------------------------------------------------

export interface PolicyViolation {
    id: number;
    organizationId: number;
    userId?: number;
    agentId?: string;
    role: string;
    checkType: 'tool' | 'filePath' | 'network' | 'model' | string;
    checkValue: string;
    enforcement: 'strict' | 'warn' | 'log' | string;
    missionId?: number;
    pipelineId?: number;
    jobId?: number;
    blocked: boolean;
    resolved: boolean;
    occurredAt: string;
}

export interface ViolationSummary {
    totalLast24h: number;
    blockedLast24h: number;
    unresolvedTotal: number;
}

export interface ViolationFilter {
    blockedOnly?: boolean;
    unresolvedOnly?: boolean;
    checkType?: string;
    since?: string;
    limit?: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGovernanceDashboard(initialFilter: ViolationFilter = {}) {
    const [summary, setSummary]         = useState<ViolationSummary | null>(null);
    const [violations, setViolations]   = useState<PolicyViolation[]>([]);
    const [filter, setFilter]           = useState<ViolationFilter>(initialFilter);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);
    const [refreshKey, setRefreshKey]   = useState(0);

    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    // Fetch summary
    useEffect(() => {
        fetch('/api/governor/capability-policy/violations/summary')
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
            .then(setSummary)
            .catch(err => setError(err.message));
    }, [refreshKey]);

    // Fetch violations with filter
    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams();
        if (filter.blockedOnly)    params.set('blockedOnly',    'true');
        if (filter.unresolvedOnly) params.set('unresolvedOnly', 'true');
        if (filter.checkType)      params.set('checkType',      filter.checkType);
        if (filter.since)          params.set('since',          filter.since);
        if (filter.limit)          params.set('limit',          String(filter.limit));

        fetch(`/api/governor/capability-policy/violations?${params}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
            .then(data => {
                setViolations(data.violations ?? []);
                setError(null);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [filter, refreshKey]);

    // Resolve a violation
    const resolve = useCallback(async (id: number) => {
        const res = await fetch(`/api/governor/capability-policy/violations/${id}/resolve`, { method: 'POST' });
        if (!res.ok) throw new Error(`Failed to resolve violation ${id}`);
        refresh();
    }, [refresh]);

    return { summary, violations, filter, setFilter, loading, error, refresh, resolve };
}
