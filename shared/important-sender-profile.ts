export interface ImportantSenderProfile {
  email: string;
  displayName?: string;
  importanceReason: string;
  recentMessages: { id: string; subject: string; date?: string; preview: string }[];
  intentions: { hypothesis: string; status: 'tentative'; evidence: string; messageId: string }[];
  unknowns: string[];
}

/** Bounded observations, not a personality assessment. No model calls or full-body retention. */
export function observeImportantSender(previous: ImportantSenderProfile | undefined, email: string, message: { id: string; subject: string; from: string; date?: string; preview?: string; body?: string }): ImportantSenderProfile {
  const address = (message.from.match(/<([^<>]+)>/)?.[1] ?? message.from).trim().toLowerCase();
  if (address !== email.toLowerCase()) throw new Error('Sender profile source does not match the monitored sender.');
  const base = previous?.email === address ? previous : undefined;
  const name = message.from.includes('<') ? message.from.slice(0, message.from.indexOf('<')).trim().replace(/^"|"$/g, '') : undefined;
  const recentMessages = [{ id: message.id, subject: message.subject, date: message.date, preview: (message.preview ?? '').slice(0, 250) }, ...(base?.recentMessages ?? []).filter(item => item.id !== message.id)].slice(0, 20);
  const request = message.body?.split(/(?<=[.!?])\s+|\n+/).find(line => /\b(?:please|could you|can you|let me know)\b/i.test(line));
  const intentions = [...(base?.intentions ?? []).filter(item => item.messageId !== message.id)];
  if (request) intentions.unshift({ hypothesis: 'The sender may be seeking action or a reply to this request.', status: 'tentative', evidence: request.trim().slice(0, 350), messageId: message.id });
  return { email: address, displayName: name || base?.displayName, importanceReason: 'You asked to be notified when this sender emails you.', recentMessages, intentions: intentions.slice(0, 10), unknowns: ['Relationship and priorities have not been confirmed.', 'Intentions are hypotheses based on quoted email content.'] };
}
