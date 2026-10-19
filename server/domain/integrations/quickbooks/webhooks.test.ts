import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const mocks = vi.hoisted(() => ({ byRealm: vi.fn(), refresh: vi.fn(), publish: vi.fn() }));
vi.mock('./service.js', () => ({ findConnectorsByRealmId: mocks.byRealm }));
vi.mock('./sync.js', () => ({ refreshQuickBooksRecord: mocks.refresh }));
vi.mock('../../core/infrastructure/event-stream.service.js', () => ({ eventStream: { publish: mocks.publish } }));

import { verifyQuickBooksSignature, parseQuickBooksNotifications, handleQuickBooksWebhook } from './webhooks.js';

const VERIFIER = 'test-verifier-token';
const sign = (body: string) => createHmac('sha256', VERIFIER).update(Buffer.from(body)).digest('base64');

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN', VERIFIER);
    mocks.byRealm.mockResolvedValue([{ id: 7, orgId: 342, status: 'connected' }]);
    mocks.refresh.mockResolvedValue('applied');
    mocks.publish.mockResolvedValue('event-id');
});

describe('QuickBooks webhook signature', () => {
    it('accepts a base64 HMAC-SHA256 over the raw body', () => {
        const body = Buffer.from('{"eventNotifications":[]}');
        expect(verifyQuickBooksSignature(body, sign(body.toString()))).toBe(true);
    });
    it('rejects tampered bodies, wrong signatures and missing verifier config', () => {
        const body = Buffer.from('{"eventNotifications":[]}');
        expect(verifyQuickBooksSignature(body, sign('{"other":true}'))).toBe(false);
        expect(verifyQuickBooksSignature(body, undefined)).toBe(false);
        expect(verifyQuickBooksSignature(undefined, sign(body.toString()))).toBe(false);
        vi.stubEnv('QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN', '');
        expect(verifyQuickBooksSignature(body, sign(body.toString()))).toBe(false);
    });
});

describe('QuickBooks webhook payload parsing', () => {
    it('parses the legacy eventNotifications envelope', () => {
        const parsed = parseQuickBooksNotifications({ eventNotifications: [{ realmId: '4620816365441358120',
            dataChangeEvent: { entities: [{ name: 'Invoice', id: '123', operation: 'Create' }, { name: 'Customer', id: '9', operation: 'Update' }] } }] });
        expect(parsed).toEqual([
            { realmId: '4620816365441358120', entity: 'Invoice', id: '123', operation: 'create' },
            { realmId: '4620816365441358120', entity: 'Customer', id: '9', operation: 'update' },
        ]);
    });
    it('parses CloudEvents deliveries', () => {
        const parsed = parseQuickBooksNotifications([
            { type: 'qbo.invoice.created.v1', intuitaccountid: '4620816365441358120', intuitentityid: '123' },
            { type: 'qbo.payment.deleted.v1', intuitaccountid: '4620816365441358120', intuitentityid: '77' },
        ]);
        expect(parsed).toEqual([
            { realmId: '4620816365441358120', entity: 'Invoice', id: '123', operation: 'created' },
            { realmId: '4620816365441358120', entity: 'Payment', id: '77', operation: 'deleted' },
        ]);
    });
    it('drops malformed entries instead of trusting them', () => {
        expect(parseQuickBooksNotifications({ eventNotifications: [{ realmId: 'abc', dataChangeEvent: { entities: [{ name: 'Invoice', id: '1' }] } }] })).toEqual([]);
        expect(parseQuickBooksNotifications({ eventNotifications: [{ realmId: '123', dataChangeEvent: { entities: [{ name: 'DROP TABLE', id: '1' }] } }] })).toEqual([]);
        expect(parseQuickBooksNotifications([{ type: 'qbo.invoice.created.v1' }])).toEqual([]);
        expect(parseQuickBooksNotifications(null)).toEqual([]);
    });
});

describe('QuickBooks webhook dispatch', () => {
    it('fans out a shared company to each independently authorized tenant', async () => {
        mocks.byRealm.mockResolvedValue([{ id: 7, orgId: 342, status: 'connected' }, { id: 8, orgId: 473, status: 'connected' }]);
        const result = await handleQuickBooksWebhook([{ realmId: '999', entity: 'Invoice', id: '1', operation: 'updated' }]);
        expect(result.processed).toBe(2);
        expect(mocks.refresh.mock.calls.map(call => call[3].organizationId)).toEqual([342, 473]);
        expect(mocks.publish.mock.calls.map(call => call[2].organizationId)).toEqual([342, 473]);
    });
    it('never refreshes or publishes to a disconnected tenant', async () => {
        mocks.byRealm.mockResolvedValue([{ id: 7, orgId: 342, status: 'disconnected' }, { id: 8, orgId: 473, status: 'connected' }]);
        await handleQuickBooksWebhook([{ realmId: '999', entity: 'Invoice', id: '1', operation: 'updated' }]);
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(mocks.refresh.mock.calls[0][3].organizationId).toBe(473);
    });
    it('refreshes each changed entity once and publishes workflow events', async () => {
        const result = await handleQuickBooksWebhook([
            { realmId: '999', entity: 'Invoice', id: '1', operation: 'updated' },
            { realmId: '999', entity: 'Invoice', id: '1', operation: 'updated' },
            { realmId: '999', entity: 'Payment', id: '2', operation: 'created' },
        ]);
        expect(mocks.byRealm).toHaveBeenCalledWith('999');
        expect(mocks.refresh).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ processed: 2, skipped: 0 });
        expect(mocks.publish).toHaveBeenCalledWith('quickbooks.invoice_updated', expect.objectContaining({ remoteId: '1' }),
            expect.objectContaining({ organizationId: 342 }), 'quickbooks-webhook');
    });
    it('acks deliveries for realms nobody connected', async () => {
        mocks.byRealm.mockResolvedValue([]);
        const result = await handleQuickBooksWebhook([{ realmId: '555', entity: 'Invoice', id: '1', operation: 'updated' }]);
        expect(result).toEqual({ processed: 0, skipped: 1 });
        expect(mocks.refresh).not.toHaveBeenCalled();
    });
    it('keeps processing other entities when one refresh fails', async () => {
        mocks.refresh.mockRejectedValueOnce(new Error('boom'));
        const result = await handleQuickBooksWebhook([
            { realmId: '999', entity: 'Invoice', id: '1', operation: 'updated' },
            { realmId: '999', entity: 'Customer', id: '2', operation: 'updated' },
        ]);
        expect(result.processed).toBe(1);
    });
});
