import React, { useEffect, useState } from 'react';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';
import type { FinancialSnapshotComparison, FinancialSnapshotView } from '@shared/financial-snapshots';
import { formatCrewMoney } from '@shared/crew-money';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { formatPercent, formatWhen, sourceToolLabel } from './financial-card-format';

/**
 * A financial snapshot: values frozen from one tool result so they can be
 * compared later. A draft is saved only by the Save click, and the card says
 * "saved" only once the server confirms it.
 */
export function FinancialSnapshotItemView({ item }: { item: WorkspaceResultItem }) {
    return (
        <section aria-label="Financial snapshot" className="space-y-3">
            {item.snapshot && <Snapshot snapshot={item.snapshot} />}
            {item.snapshotComparison && <Comparison comparison={item.snapshotComparison} />}
        </section>
    );
}

function snapshotUrl(snapshot: FinancialSnapshotView, suffix = '') {
    return `/api/crew/${encodeURIComponent(snapshot.sessionKey)}/financial-snapshots/${snapshot.id}${suffix}?orgId=${snapshot.organizationId}`;
}

function Snapshot({ snapshot }: { snapshot: FinancialSnapshotView }) {
    const [saved, setSaved] = useState(snapshot.status === 'saved');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [statusUnknown, setStatusUnknown] = useState(false);

    // The card can outlive the turn it came from: re-read whether it was saved since.
    useEffect(() => {
        let active = true;
        apiRequest('GET', snapshotUrl(snapshot))
            .then(response => response.json())
            .then(current => { if (active && current.status === 'saved') setSaved(true); })
            .catch(() => { if (active) setStatusUnknown(true); });
        return () => { active = false; };
    }, [snapshot.id, snapshot.sessionKey, snapshot.organizationId]);

    async function save() {
        setBusy(true);
        setError('');
        try {
            const response = await apiRequest('POST', snapshotUrl(snapshot, '/save'), {});
            if ((await response.json()).status !== 'saved') throw new Error('The save was not confirmed. Try again.');
            setSaved(true);
            setStatusUnknown(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the snapshot.');
        } finally {
            setBusy(false);
        }
    }

    const period = snapshot.periodStart || snapshot.periodEnd
        ? `${formatWhen(snapshot.periodStart)} – ${formatWhen(snapshot.periodEnd)}`
        : null;

    return (
        <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{snapshot.name}</h3>
                <span className="text-xs text-muted-foreground">{saved ? 'Saved snapshot' : 'Draft — review before saving'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
                Source as of {formatWhen(snapshot.sourceAsOf)} · Captured {formatWhen(snapshot.capturedAt)}
                {period && ` · Period ${period}`}
            </p>

            {snapshot.coverage?.length ? <p className="text-sm text-muted-foreground">Partial forecast coverage · exclusions retained with this snapshot.</p> : null}
            {snapshot.predictionAssessments?.map((assessment, i) => <p key={i} className="text-sm text-muted-foreground">
                {assessment.currency}: {assessment.predicted_label === 'shortfall' ? 'Shortfall expected' : assessment.predicted_label === 'no_shortfall' ? 'No shortfall expected' : assessment.predicted_label}
                {' · '}{(assessment.confidence * 100).toFixed(0)}% confidence (heuristic, uncalibrated)
            </p>)}

            <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                    <tbody>
                        {snapshot.metrics.map(metric => (
                            <tr key={metric.key} className="border-t border-border/50">
                                <td className="py-1.5">{metric.label}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCrewMoney(metric.value, metric.currency)}</td>
                                <td className="w-12 py-1.5 pl-2 text-right text-xs text-muted-foreground">{metric.currency}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <details open={!saved} className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Source and assumptions</summary>
                <div className="space-y-1 pt-1">
                    <p>From {sourceToolLabel(snapshot.sourceTool)} in turn #{snapshot.sourceTurnId}.</p>
                    {snapshot.assumptions.map((assumption, i) => <p key={i}>{assumption}</p>)}
                    {snapshot.exclusions.map((exclusion, i) => <p key={i}>Excluded: {exclusion}</p>)}
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        Snapshot ID <code className="break-all">{snapshot.id}</code> <CopyButton value={snapshot.id} />
                    </p>
                </div>
            </details>

            {saved
                ? <p className="text-sm text-muted-foreground">These values are frozen. Ask for this snapshot by name or ID to compare against it; new values need a new snapshot.</p>
                : <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save snapshot'}</Button>}
            {statusUnknown && !saved && <p className="text-xs text-muted-foreground">Could not check whether this snapshot was saved since it was drafted.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </>
    );
}

function Comparison({ comparison }: { comparison: FinancialSnapshotComparison }) {
    return (
        <>
            <h3 className="font-semibold">{comparison.baseline.name} → {comparison.current.name}</h3>
            <div className="overflow-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground">
                            <th className="py-1 text-left font-medium">Metric</th>
                            <th className="py-1 text-right font-medium">Baseline</th>
                            <th className="py-1 text-right font-medium">Current</th>
                            <th className="py-1 text-right font-medium">Change</th>
                            <th className="py-1 text-right font-medium">Change %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {comparison.rows.map((row, i) => (
                            <tr key={i} className="border-t border-border/50">
                                <td className="py-1.5">{row.label} <span className="text-xs text-muted-foreground">{row.currency}</span>
                                    {(row.baselinePeriod || row.currentPeriod) && <span className="block text-xs text-muted-foreground">Baseline: {row.baselinePeriod ?? 'Undated'} · Current: {row.currentPeriod ?? 'Undated'}</span>}
                                </td>
                                <td className="py-1.5 text-right tabular-nums">{formatCrewMoney(row.baseline, row.currency)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCrewMoney(row.current, row.currency)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCrewMoney(row.change, row.currency)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatPercent(row.percent, true)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {comparison.warnings.map((warning, i) => <p key={i} className="text-sm text-muted-foreground">{warning}</p>)}
        </>
    );
}
