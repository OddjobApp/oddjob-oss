import { describe, expect, it } from 'vitest';
import { approvalArgFields, approvalReviewFields, isApprovalEnvelope } from './approval-args.js';

describe('approval review fields', () => {
    it('unwraps a google_workspace_action envelope into readable fields', () => {
        const fields = approvalReviewFields({
            type: 'approval_request',
            kind: 'google_workspace_action',
            actionName: 'gdocs_create_document',
            args: { title: 'CREW Demo — review only', text: 'A demonstration document.' },
            title: 'gdocs create document: CREW Demo — review only',
            reason: 'Review the exact Google Workspace change before applying it.',
            status: 'pending',
            projectId: 44,
            sessionKey: 'crew-9',
        });
        expect(fields).toEqual([
            { label: 'Planned action', value: 'gdocs create document: CREW Demo — review only' },
            { label: 'Reasoning', value: 'Review the exact Google Workspace change before applying it.' },
            { label: 'Title', value: 'CREW Demo — review only' },
            { label: 'Text', value: 'A demonstration document.' },
        ]);
    });

    it('renders calendar event args as fields rather than JSON', () => {
        const fields = approvalArgFields({
            calendar_id: 'primary',
            send_updates: 'all',
            event: {
                summary: 'Kickoff',
                start: { dateTime: '2026-10-08T15:00:00Z' },
                end: { dateTime: '2026-10-08T16:00:00Z' },
                attendees: [{ email: 'a@b.c' }, { email: 'd@e.f' }],
            },
        });
        const byLabel = Object.fromEntries(fields.map(f => [f.label, f.value]));
        expect(byLabel['Calendar id']).toBe('primary');
        expect(byLabel['Send updates']).toBe('all');
        expect(byLabel['Event']).toContain('Summary: Kickoff');
        expect(byLabel['Event']).toContain('Date time: 2026-10-08T15:00:00Z');
        expect(byLabel['Event']).toContain('Attendees: a@b.c, d@e.f');
        expect(JSON.stringify(fields)).not.toContain('"kind"');
    });

    it('reads outbound_message send fields off the envelope itself', () => {
        const fields = approvalReviewFields({
            type: 'approval_request',
            kind: 'outbound_message',
            channel: 'email',
            to: ['ada@example.com'],
            subject: 'Welcome',
            body: 'Glad to have you.',
            sessionKey: 'crew-1',
            status: 'pending',
        });
        const byLabel = Object.fromEntries((fields ?? []).map(f => [f.label, f.value]));
        expect(byLabel['To']).toBe('ada@example.com');
        expect(byLabel['Subject']).toBe('Welcome');
        expect(byLabel['Body']).toBe('Glad to have you.');
        expect(byLabel['Channel']).toBe('email');
    });

    it('collapses a reviewed draft snapshot to To/Subject/Body and drops raw MIME', () => {
        const fields = approvalArgFields({
            draft_id: 'd1',
            reviewed_raw: 'VG8...',
            reviewed_message: {
                payload: {
                    headers: [
                        { name: 'To', value: 'sam@example.com' },
                        { name: 'Subject', value: 'Follow up' },
                    ],
                    parts: [{ mimeType: 'text/plain', decodedText: 'Checking in.' }],
                },
            },
        });
        const byLabel = Object.fromEntries(fields.map(f => [f.label, f.value]));
        expect(byLabel['To']).toBe('sam@example.com');
        expect(byLabel['Subject']).toBe('Follow up');
        expect(byLabel['Body']).toBe('Checking in.');
        expect(byLabel['Draft id']).toBe('d1');
        expect(JSON.stringify(fields)).not.toContain('VG8');
    });

    it('leaves non-envelope values alone', () => {
        expect(approvalReviewFields({ code: 'rm -rf /tmp' })).toBeNull();
        expect(isApprovalEnvelope({ code: 'rm -rf /tmp' })).toBe(false);
        expect(isApprovalEnvelope(null)).toBe(false);
    });
});
