import { describe, it, expect } from "vitest";
import { toSubscriptionFilters } from "./RuleTemplates.js";

/**
 * `triggerCondition` was rendered on the confirmation screen and then dropped
 * on submit, so a template described as "escalate when critical events occur"
 * was created with no severity filter and matched Low-severity events. These
 * pin the translation onto the filters the matcher actually evaluates.
 */
const template = (config: Record<string, unknown>) =>
    ({ config: { eventSource: 'x', actionType: 'notify', ...config } }) as any;

describe("toSubscriptionFilters", () => {
    it("applies a severity floor for critical_high", () => {
        const filters = toSubscriptionFilters(
            template({ triggerCondition: 'critical_high', filters: { eventTypes: ['a'] } }),
        );
        expect(filters.minimumSeverity).toBe('High');
    });

    it("applies no severity floor for an immediate trigger", () => {
        const filters = toSubscriptionFilters(
            template({ triggerCondition: 'immediate', filters: { eventTypes: ['a'] } }),
        );
        expect(filters.minimumSeverity).toBeUndefined();
    });

    it("preserves the template's own filters", () => {
        const filters = toSubscriptionFilters(
            template({
                triggerCondition: 'critical_high',
                filters: { eventTypes: ['gate_failed'], minimumConfidence: 0.5 },
            }),
        );
        expect(filters.eventTypes).toEqual(['gate_failed']);
        expect(filters.minimumConfidence).toBe(0.5);
        expect(filters.minimumSeverity).toBe('High');
    });

    it("does not mutate the template", () => {
        const t = template({ triggerCondition: 'critical_high', filters: { eventTypes: ['a'] } });
        toSubscriptionFilters(t);
        // Templates are module-level constants; mutating one would leak the
        // severity floor into every later use of it.
        expect(t.config.filters.minimumSeverity).toBeUndefined();
    });

    it("tolerates a template with no filters", () => {
        expect(() => toSubscriptionFilters(template({ triggerCondition: 'immediate' }))).not.toThrow();
    });

    it("does not invent a source filter — the matcher has none", () => {
        const filters = toSubscriptionFilters(
            template({ triggerCondition: 'immediate', eventSource: 'external_rss', filters: {} }),
        );
        expect(filters.eventSource).toBeUndefined();
        expect(filters.sources).toBeUndefined();
    });
});
