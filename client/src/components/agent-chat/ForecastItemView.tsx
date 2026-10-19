import React from 'react';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';
import { formatCrewMoney } from '@shared/crew-money';
import { FINANCIAL_SERIES_FIELDS } from '@shared/financial-workflow';
import {
    forecastMethodLabel, formatWhen, periodCount, periodLabel, predictionLabel, seriesColumnLabel,
} from './financial-card-format';

/**
 * A financial forecast as calculated: the projected series, any scenarios
 * beside it, and — on request — every column the model produced. It is a
 * projection of the inputs given, so the card says so and lists what the
 * source left out rather than hiding it.
 */
export function ForecastItemView({ item }: { item: WorkspaceResultItem }) {
    const forecast = item.forecast;
    if (!forecast) return null;
    const { currency, method, periodUnit, series, scenarios, assumptions, warnings } = forecast;
    const columns = ['period', ...FINANCIAL_SERIES_FIELDS.filter(field => series.some(row => row[field] !== undefined))];

    return (
        <section aria-label="Financial forecast" className="space-y-3">
            <div>
                <h3 className="font-semibold">{forecastMethodLabel(method)} forecast · {currency}</h3>
                <p className="text-sm text-muted-foreground">
                    Projection over {periodCount(series.length, periodUnit)}
                    {forecast.asOf && ` · As of ${formatWhen(forecast.asOf)}`}
                </p>
            </div>

            {forecast.coverage && <p className="text-sm text-muted-foreground">
                {forecast.coverage.kind === 'scheduled_commitments' ? 'Scheduled commitments only — partial coverage.' : 'Projection of supplied inputs — partial coverage.'}
            </p>}

            {forecast.predictionAssessment && (
                <p className="text-sm">
                    <span className="font-medium">{predictionLabel(forecast.predictionAssessment.predicted_label)}</span>
                    <span className="text-muted-foreground">
                        {' '}· {(forecast.predictionAssessment.confidence * 100).toFixed(0)}% confidence (heuristic, uncalibrated)
                    </span>
                </p>
            )}

            <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground">
                            <th className="py-1 text-left font-medium">Period</th>
                            <th className="py-1 text-right font-medium">{seriesColumnLabel('value', method)}</th>
                            {scenarios.map(scenario => <th key={scenario.name} className="py-1 text-right font-medium">{scenario.name}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {series.map((row, i) => (
                            <tr key={i} className="border-t border-border/50">
                                <td className="py-1.5">{periodLabel(row.period, periodUnit)}{row.periodStart && <span className="block text-xs text-muted-foreground">{formatWhen(String(row.periodStart))} – {formatWhen(String(row.periodEnd))}</span>}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCrewMoney(row.value, currency)}</td>
                                {scenarios.map(scenario => (
                                    <td key={scenario.name} className="py-1.5 text-right tabular-nums">{formatCrewMoney(scenario.series[i]?.value, currency)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show calculation and assumptions</summary>
                <div className="space-y-2 pt-2">
                    {assumptions.map((assumption, i) => <p key={i}>{assumption}</p>)}
                    <div className="overflow-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-muted-foreground">
                                    {columns.map(key => (
                                        <th key={key} className={key === 'period' ? 'px-2 py-1 text-left font-medium' : 'px-2 py-1 text-right font-medium'}>
                                            {seriesColumnLabel(key, method)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {series.map((row, i) => (
                                    <tr key={i} className="border-t border-border/40">
                                        {columns.map(key => key === 'period'
                                            ? <td key={key} className="px-2 py-1">{periodLabel(row.period, periodUnit)}</td>
                                            : <td key={key} className="px-2 py-1 text-right tabular-nums">{formatCrewMoney(row[key], currency)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>

            {warnings.length > 0 && (
                <details open className="text-sm">
                    <summary className="cursor-pointer">Excluded commitments ({warnings.length})</summary>
                    <ul className="list-disc pl-5 pt-1">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
                </details>
            )}
        </section>
    );
}
