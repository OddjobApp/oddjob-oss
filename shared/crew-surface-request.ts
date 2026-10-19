import { z } from 'zod';
const field = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/), label: z.string().min(1).max(200),
  type: z.enum(['text', 'number', 'select', 'checkbox', 'location']).default('text'), required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(100)).max(30).optional() }).strict();
export const surfaceRequestSchema = z.object({ source: z.literal('crew-surface-request'), version: z.literal(1),
  roomKey: z.string().min(1).max(150), requestId: z.string().min(1).max(150), kind: z.enum(['question', 'form', 'approval']),
  title: z.string().min(1).max(200), fields: z.array(field).max(20).optional(), approvalId: z.number().int().positive().optional(),
}).strict().superRefine((r, ctx) => {
  if (r.kind === 'approval' ? !r.approvalId || !!r.fields?.length : !r.fields?.length || !!r.approvalId)
    ctx.addIssue({ code: 'custom', message: 'Input requests need fields; approval requests need a persisted approval ID.' });
  if (new Set(r.fields?.map(f => f.key)).size !== (r.fields?.length ?? 0)) ctx.addIssue({ code: 'custom', message: 'Duplicate field keys' });
  if (r.fields?.some(f => f.type === 'select' && !f.options?.length)) ctx.addIssue({ code: 'custom', message: 'Select fields need options' });
});
export type SurfaceRequest = z.infer<typeof surfaceRequestSchema>;
export interface SurfaceLocationAnswer { address: string; lat: number; lng: number; resolvedAddress?: string; accuracy?: string }
export function toSurfaceLocationAnswer(value: unknown): SurfaceLocationAnswer | string | null {
  if (typeof value === 'string') return value.length <= 4000 ? value : null;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const lat = Number(v.lat), lng = Number(v.lng), address = String(v.address ?? '');
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !address || address.length > 4000) return null;
  const out: SurfaceLocationAnswer = { address, lat, lng };
  if (typeof v.resolvedAddress === 'string') out.resolvedAddress = v.resolvedAddress;
  if (typeof v.accuracy === 'string') out.accuracy = v.accuracy;
  return out;
}
export function validateSurfaceAnswers(request: SurfaceRequest, data: Record<string, unknown>) {
  const result: Record<string, string | number | boolean | SurfaceLocationAnswer> = {};
  for (const f of request.fields ?? []) {
    const value = data[f.key];
    if (value === undefined || value === '') { if (f.required) throw new Error(`${f.label} is required`); continue; }
    if (f.type === 'checkbox') { if (typeof value !== 'boolean' || (f.required && !value)) throw new Error(`${f.label} must be checked`); }
    else if (f.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${f.label} must be a number`); }
    else if (f.type === 'location') {
      const location = toSurfaceLocationAnswer(value);
      if (location === null || (typeof location === 'string' && f.required && !location.trim()) || (typeof location === 'object' && f.required && !location.address.trim())) throw new Error(`${f.label} has an invalid answer`);
      result[f.key] = location;
      continue;
    }
    else if (typeof value !== 'string' || value.length > 4000 || (f.required && !value.trim()) || (f.type === 'select' && !f.options?.includes(value))) throw new Error(`${f.label} has an invalid answer`);
    result[f.key] = value as string | number | boolean;
  }
  return result;
}
