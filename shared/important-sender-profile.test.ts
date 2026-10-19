import { describe, expect, it } from 'vitest';
import { observeImportantSender } from './important-sender-profile.js';
describe('important sender observations', () => {
  it('grounds tentative intentions in a quote and deduplicates source messages', () => {
    const message = { id: 'm1', from: 'Jann <jann@example.com>', subject: 'Review', body: 'Please review the proposal today. Private unrelated body.' };
    const first = observeImportantSender(undefined, 'jann@example.com', message);
    const second = observeImportantSender(first, 'jann@example.com', message);
    expect(second.recentMessages).toHaveLength(1);
    expect(second.intentions).toEqual([{ hypothesis: 'The sender may be seeking action or a reply to this request.', status: 'tentative', evidence: 'Please review the proposal today.', messageId: 'm1' }]);
    expect(JSON.stringify(second)).not.toContain('Private unrelated body');
  });
  it('does not invent intentions from a snippet and rejects a mismatched source', () => {
    expect(observeImportantSender(undefined, 'jann@example.com', { id: 'm1', from: 'jann@example.com', subject: 'Hi', preview: 'Please...' }).intentions).toEqual([]);
    expect(() => observeImportantSender(undefined, 'jann@example.com', { id: 'm1', from: 'other@example.com', subject: 'Hi' })).toThrow('does not match');
  });
});
