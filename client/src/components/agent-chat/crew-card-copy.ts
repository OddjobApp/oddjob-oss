/** Human-readable card content, excluding controls and internal JSON. */
export function crewCardCopyText(payload: Record<string, any>): string {
  if (payload.type === 'gmail_directive') return [
    'Gmail sender alert', `Status: ${String(payload.status).replaceAll('_', ' ')}`,
    `From: ${payload.sender}`, payload.mailbox ? `Connected mailbox: ${payload.mailbox}` : '',
    `Checks every ${payload.intervalSeconds} seconds · No recurring AI calls · Notifications enabled when active`,
    `Browser push: ${payload.browserPushReady ? 'Ready' : 'Needs setup'}`,
  ].filter(Boolean).join('\n');
  if (payload.type === 'gmail_directive_list') return ['Your Gmail directives', ...(payload.items ?? []).map((item: any) => [`From: ${item.sender}`, `Status: ${String(item.status).replaceAll('_', ' ')}`, item.mailbox ? `Connected mailbox: ${item.mailbox}` : '', `Last checked: ${item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString() : 'Not yet'}`, item.error ?? ''].filter(Boolean).join('\n'))].join('\n\n');
  if (payload.type === 'google_workspace_results') return [payload.title, ...(payload.items ?? []).map((item: any) => [item.title, item.brand ? `Brand: ${item.brand}` : '', item.kind === 'flight' && item.airlineName ? `Airline: ${item.airlineName}` : '', item.kind === 'flight' && item.departAt ? `Departs: ${item.departAt}` : '', item.kind === 'flight' && item.arriveAt ? `Arrives: ${item.arriveAt}` : '', item.kind === 'flight' && item.durationDisplay ? `Duration: ${item.durationDisplay}` : '', item.kind === 'flight' && item.stopsDisplay ? `Stops: ${item.stopsDisplay}` : '', item.priceDisplay ? `Price: ${item.priceDisplay}` : '', item.listPriceDisplay && item.listPriceDisplay !== item.priceDisplay ? `List price: ${item.listPriceDisplay}` : '', item.rating != null ? `Rating: ${item.rating} (${item.reviewCount ?? 0} reviews)` : '', item.availability ? `Availability: ${item.availability}` : '', item.isPrime ? 'Prime eligible' : '', item.sender ? `From: ${item.sender}` : '', item.recipient ? `To: ${item.recipient}` : '', item.start ? `Starts: ${item.start}` : item.date ?? '', item.end ? `Ends: ${item.end}` : '', item.location ?? '', item.body || item.preview || '', item.url ?? ''].filter(Boolean).join('\n'))].join('\n\n');
  return '';
}
