import { describe, expect, it } from 'vitest';
import { actionReceipt, toolReceipt, safeReceiptHref } from './copilot-action-receipt';

describe('Copilot action receipts', () => {
    it('does not infer completed changes from prose or a response without tool results', () => {
        expect(toolReceipt('update_form', 'All done!').status).toBe('unverified');
        expect(actionReceipt([]).status).toBe('unverified');
    });
    it('retains explicit successes, failures and partial outcomes', () => {
        const success = toolReceipt('update_form', '{"success":true,"href":"/armory/forms/builder/7"}');
        const failure = toolReceipt('publish_form', '{"success":false,"error":"Invalid form"}');
        expect(success).toMatchObject({ status: 'succeeded', verified: false, href: '/armory/forms/builder/7' });
        expect(failure.status).toBe('failed');
        expect(actionReceipt([success, failure]).status).toBe('partial');
        expect(actionReceipt([success], true).status).toBe('partial');
    });
    it('keeps simulation, blocked execution and failed verification distinct', () => {
        expect(toolReceipt('update_form', '[Simulation Mode] Action verified. NOT executed.', true).status).toBe('simulated');
        expect(toolReceipt('delete_form', 'Human denied execution').status).toBe('blocked');
        expect(toolReceipt('update_form', '{"success":true}', false).status).toBe('failed');
    });
    it.each(['https://outside.example', '//outside.example', '/\\outside.example', 'javascript:alert(1)', '/bad\npath'])('rejects unsafe result URL %s', href => {
        expect(safeReceiptHref(href)).toBeUndefined();
    });
});
