import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { crewReviewSchema, summarizeCrewReview } from '@shared/crew-review';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader } from './CrewCard';

const GATE_STATUS = {
  pass: { label: 'Pass', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  fail: { label: 'Blocked', className: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  unknown: { label: 'Unverified', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
} as const;

export function CrewReviewCard({ payload }: { payload: unknown }) {
  const parsed = crewReviewSchema.safeParse(payload);
  if (!parsed.success) {
    return (
      <div role="alert" className="mt-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-card-foreground">
        Review unavailable: the supplied review data is invalid.
      </div>
    );
  }
  const review = parsed.data;
  const result = summarizeCrewReview(review);

  return (
    <CrewCard label={review.title}>
      <CrewCardHeader
        icon={<ClipboardCheck />}
        title={review.title}
        description={<>{review.period} · Methodology {review.methodologyVersion}</>}
        aside={<span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">{result.status}</span>}
      />

      <CrewCardBody className="space-y-4">
        <p className="text-sm leading-relaxed text-foreground">{review.summary}</p>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong className="text-lg font-semibold tabular-nums text-foreground">
            {result.score === null ? 'Score pending' : `${result.score.toFixed(1)} / 100`}
          </strong>
          <span className="text-muted-foreground">
            {result.assessed} of {review.criteria.length} dimensions assessed
          </span>
        </div>

        <ul className="space-y-2.5">
          {review.criteria.map((item, index) => (
            <li key={index}>
              <div className="mb-1 flex justify-between gap-3">
                <span className="text-foreground">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {item.score === null ? 'Not assessed' : `${item.score}/100`}
                </span>
              </div>
              {item.score !== null && (
                <div
                  role="meter"
                  aria-label={item.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.score}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${item.score}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>

        {review.gates.length > 0 && (
          <div>
            <h4 className="mb-1.5 font-medium text-foreground">Mandatory criteria</h4>
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {review.gates.map((gate, index) => {
                const status = GATE_STATUS[gate.status];
                return (
                  <li key={index} className="flex items-start gap-2.5 px-3 py-2">
                    <span className={cn('mt-px shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', status.className)}>
                      {status.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-foreground">{gate.label}</p>
                      <p className="text-muted-foreground">{gate.evidence}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {review.actions.length > 0 && (
          <div>
            <h4 className="mb-1.5 font-medium text-foreground">Recommended next steps</h4>
            <ul className="list-disc space-y-1.5 pl-4 marker:text-primary">
              {review.actions.map((action, index) => (
                <li key={index} className="pl-0.5 text-foreground">
                  {action.description}
                  {(action.owner || action.due) && (
                    <span className="block text-muted-foreground">
                      {[action.owner && `Owner: ${action.owner}`, action.due && `Due: ${action.due}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Evidence and scoring method
          </summary>
          <ul className="mt-2 space-y-2">
            {review.criteria.map((item, index) => (
              <li key={index}>
                <span className="font-medium text-foreground">{item.label}</span> · Relative weight {item.weight}
                <p>{item.evidence}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Weighted mean of assessed dimensions, published only when every dimension is assessed. Failed mandatory
            criteria override readiness.
          </p>
        </details>
      </CrewCardBody>

      <CrewCardFooter note="Recommendation only. Approval and execution are recorded separately." />
    </CrewCard>
  );
}
