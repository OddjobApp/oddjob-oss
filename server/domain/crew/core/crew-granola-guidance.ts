export const GRANOLA_CONTEXT_GUIDANCE = '\n### MEETING CONTEXT\nWhen a request depends on what was discussed, decided, promised, or learned in meetings, use granola_search_meetings. In this room Granola notes are private to the person who asked: the search shows them their matches on a private card, and you see only a count. Ask them to share the relevant meetings from that card, then read the shared ones with granola_get_meeting. Answer only from meetings shared into this room, citing title and date; never guess what an unshared meeting says. If Granola is not connected, call connect_platform with platform granola instead of claiming the meeting record does not exist.';

export const GRANOLA_PREP_GUIDANCE = '\n### MEETING PREPARATION\nFor meeting or call preparation, use Granola to find prior meetings with the same people or topic, and work from the ones the person shares into the room. Summarize prior decisions, unresolved questions, commitments and useful follow-ups. Distinguish recorded context from your recommendations.';

export const GRANOLA_REVIEW_GUIDANCE = '\n### DECISION-AWARE REVIEW\nWhen asked to review work against a prior discussion or decision, work from the relevant Granola meetings the person shares into the room. Report what aligns, what is missing, and what was added without recorded agreement. Cite meeting title and date. Transcripts are not available in a room.';

export function granolaGuidanceFor(text: string) {
    const meeting = /\b(?:meeting|meetings|standup|sync call|call notes|minutes|discussed|talked about|decided|decision|action items?|commitments?)\b/i.test(text);
    if (!meeting) return [];
    const entries = [{ id: 'granola-context', label: 'Granola meeting context', reason: 'Request references meeting history', content: GRANOLA_CONTEXT_GUIDANCE }];
    if (/\b(?:prep|prepare|brief|agenda|upcoming)\b/i.test(text)) entries.push({ id: 'granola-prep', label: 'Granola meeting preparation', reason: 'Request asks for meeting preparation', content: GRANOLA_PREP_GUIDANCE });
    if (/\b(?:review|check|compare|aligned?|against|verify)\b/i.test(text)) entries.push({ id: 'granola-review', label: 'Granola decision-aware review', reason: 'Request asks to compare work with meeting decisions', content: GRANOLA_REVIEW_GUIDANCE });
    return entries;
}
