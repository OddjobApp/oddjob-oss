import React from 'react';
import { approvalArgFields } from '@shared/approval-args';
import { isAmazonUrl } from '@shared/amazon-links';

export interface AmazonApprovalViewProps {
  payload: Record<string, any>;
  calendarOutcome: Record<string, any> | null;
}

export function AmazonApprovalView({ payload, calendarOutcome }: AmazonApprovalViewProps) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Review the Amazon cart</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2">
        {approvalArgFields(payload.args).filter(field => field.label !== 'Cart url').map(field => (
          <React.Fragment key={field.label}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="break-words whitespace-pre-wrap">{field.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="text-muted-foreground">Approval prepares a cart link. Nothing is ordered; you review the final price and complete checkout on Amazon.</p>
      {calendarOutcome?.success === false && <p role="alert" className="text-red-700 dark:text-red-300">{calendarOutcome.error}</p>}
      {calendarOutcome?.success && !calendarOutcome.discarded && isAmazonUrl(calendarOutcome.result?.checkoutUrl) && (
        <a
          className="inline-flex font-medium text-primary underline-offset-2 hover:underline"
          href={calendarOutcome.result.checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={event => {
            event.preventDefault();
            window.open(event.currentTarget.href, '_blank', 'popup=yes,width=1100,height=850,noopener,noreferrer');
          }}
        >
          Open cart on Amazon
        </a>
      )}
    </div>
  );
}
