import { type Page } from '@playwright/test';

/**
 * Operational-cycle helpers for E2E specs.
 *
 * Wraps the cycle API mounted at /api/cycles (server/routes/operational-cycles.ts).
 * The trigger endpoint takes a numeric cycle id, so `triggerCycle` also accepts a
 * cycle *name* and resolves it — specs read better referring to a cycle the way a
 * user would ("incident-response") than by a database id that varies per environment.
 */

export interface CycleSummary {
  id: number;
  name: string;
  status: string;
}

export interface TriggerCycleResult {
  cycleId: number;
  /** Parsed response body from the trigger endpoint. */
  body: any;
}

/** Normalize for comparison: "Incident Response" and "incident-response" should match. */
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Fetch cycles visible to the current session. */
export async function listCycles(page: Page): Promise<CycleSummary[]> {
  const res = await page.request.get('/api/cycles');
  if (!res.ok()) {
    throw new Error(`GET /api/cycles failed (${res.status()}): ${await res.text().catch(() => '')}`);
  }
  const body = await res.json();
  // The endpoint has returned both a bare array and a wrapped object over time.
  const rows: any[] = Array.isArray(body) ? body : (body?.cycles ?? body?.data ?? []);
  return rows.map(row => ({ id: Number(row.id), name: String(row.name ?? ''), status: String(row.status ?? '') }));
}

/**
 * Resolve a cycle reference to its numeric id. Numbers pass through untouched.
 *
 * Throws listing the available cycle names when a name does not match, since the
 * usual cause is that the environment was never seeded.
 */
export async function resolveCycleId(page: Page, cycle: number | string): Promise<number> {
  if (typeof cycle === 'number') return cycle;

  const asNumber = Number(cycle);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;

  const cycles = await listCycles(page);
  const target = normalizeName(cycle);
  const match = cycles.find(c => normalizeName(c.name) === target);

  if (!match) {
    const available = cycles.map(c => `"${c.name}" (id ${c.id}, ${c.status})`).join(', ') || '<none>';
    throw new Error(
      `No operational cycle named "${cycle}". Available cycles: ${available}. ` +
      `Seed the environment before running this spec.`,
    );
  }
  return match.id;
}

/**
 * Trigger a manual run of a cycle and return the parsed response.
 *
 * Surfaces the two rejections that are easy to misread as generic failures:
 * a non-active cycle (400) and unresolved integration credentials (422).
 */
export async function triggerCycle(
  page: Page,
  cycle: number | string,
  inputs: Record<string, unknown> = {},
): Promise<TriggerCycleResult> {
  const cycleId = await resolveCycleId(page, cycle);

  const res = await page.request.post(`/api/cycles/${cycleId}/trigger`, { data: inputs });
  const text = await res.text().catch(() => '');

  if (!res.ok()) {
    let hint = '';
    if (res.status() === 400 && text.includes('active')) {
      hint = ' — only cycles in status "active" can be triggered manually.';
    } else if (res.status() === 422 && text.includes('INTEGRATIONS_NOT_READY')) {
      hint = ' — the cycle has unresolved integration credentials.';
    } else if (res.status() === 409) {
      hint = ' — a run is already in flight for this cycle.';
    }
    throw new Error(`Failed to trigger cycle ${cycleId} (${res.status()}): ${text}${hint}`);
  }

  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { cycleId, body };
}
