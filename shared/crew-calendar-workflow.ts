import { z } from 'zod';

/** Server-derived receipts. Email content never supplies authorization or state. */
export const calendarSourceReceiptSchema = z.object({
  provider: z.literal('gmail'), messageId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), retrievedAt: z.string().datetime(),
});
export const calendarWorkflowSchema = z.object({
  version: z.literal(1), recipe: z.literal('email_to_calendar'),
  organizationId: z.number().int().positive(), projectId: z.number().int().positive().nullable(),
  sessionKey: z.string().min(1), sources: z.array(calendarSourceReceiptSchema).min(1),
  calendarId: z.string().min(1), calendarTimeZone: z.string().min(1),
  approvedArgsHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['awaiting_approval', 'executing', 'succeeded', 'failed', 'outcome_unknown', 'cancelled']),
});
export type CalendarSourceReceipt = z.infer<typeof calendarSourceReceiptSchema>;
export type CalendarWorkflow = z.infer<typeof calendarWorkflowSchema>;
