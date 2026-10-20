import { afterEach, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
// approval.service reaches the BullMQ queues, which connect to Redis when loaded.
// Unmocked, their connection errors were still being logged after the file ended,
// and those teardown errors failed CI's verify run wherever Redis was not running.
vi.mock('@domain/queue/queue.service.js', () => ({ queueService: { addJob: vi.fn().mockResolvedValue({ id: 'job-1' }) }, JobPriority: { LOW: 10, NORMAL: 5, HIGH: 1, CRITICAL: 0 } }));
vi.mock('@domain/core/infrastructure/queue/queue-service.js', () => ({ queueService: { addJob: vi.fn(), addJobWithTrace: vi.fn() } }));
vi.mock('@domain/tools/v1/capabilities/google-calendar.js', () => ({ GOOGLE_CALENDAR_TOOLS: { gcal_get_event: { execute: read } } }));
import { approvalService } from './approval.service.js';
afterEach(() => vi.restoreAllMocks());
const request = { organizationId: 342, status: 'approved', toolArgs: { kind: 'calendar_action', actionName: 'gcal_create_event', args: { calendar_id: 'primary' }, projectId: 3 }, modifiedOutput: { outcome: { success: true, result: { id: 'event1' } } } };
it('verifies only the stored event through a scoped read', async () => {
  vi.spyOn(approvalService, 'getById').mockResolvedValue(request as any);
  read.mockResolvedValue(JSON.stringify({ id: 'event1', status: 'confirmed' }));
  const result = await approvalService.verifyCalendarEvent(42, 'user', 'user@example.com', 342);
  expect(result.found).toBe(true);
  expect(read).toHaveBeenCalledWith({ calendar_id: 'primary', event_id: 'event1' }, { organizationId: 342, projectId: 3 });
});
it('cannot bypass approval visibility authorization', async () => {
  read.mockClear();
  vi.spyOn(approvalService, 'getById').mockRejectedValue(new Error('Forbidden'));
  await expect(approvalService.verifyCalendarEvent(42, 'foreign-user', 'foreign@example.com', 473)).rejects.toThrow('Forbidden');
  expect(read).not.toHaveBeenCalled();
});
it('does not verify an unapproved operation', async () => {
  read.mockClear();
  vi.spyOn(approvalService, 'getById').mockResolvedValue({ ...request, status: 'pending' } as any);
  await expect(approvalService.verifyCalendarEvent(42, 'user', 'user@example.com', 342)).rejects.toThrow('no confirmed');
  expect(read).not.toHaveBeenCalled();
});
