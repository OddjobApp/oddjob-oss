import React from 'react';
import { formatCrewMoney } from '@shared/crew-money';
import { isFlightHubUrl } from '@shared/flighthub-links';

export interface FlightHubApprovalViewProps {
  payload: Record<string, any>;
  calendarOutcome: Record<string, any> | null;
}

export function FlightHubApprovalView({ payload, calendarOutcome }: FlightHubApprovalViewProps) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Review the FlightHub itinerary</p>
      <p className="text-foreground">{payload.args?.itinerary}</p>
      <p>{payload.args?.priceDisplay} {payload.args?.currency ?? '(currency unverified)'}</p>
      {payload.args?.max_total != null && (
        <p>Budget ceiling: {formatCrewMoney(payload.args.max_total, payload.args.currency || 'currency unverified')}</p>
      )}
      <p className="text-muted-foreground">Approval prepares a link. You verify the final itinerary, total and currency and complete the booking on FlightHub.</p>
      {calendarOutcome?.success === false && <p role="alert" className="text-red-700 dark:text-red-300">{calendarOutcome.error}</p>}
      {calendarOutcome?.success && isFlightHubUrl(calendarOutcome.result?.checkoutUrl) && (
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
          Open FlightHub to book
        </a>
      )}
    </div>
  );
}
