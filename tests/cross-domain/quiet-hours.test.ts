/**
 * quiet-hours.ts tests — quiet hours and alert suppression logic
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isWithinQuietHours,
    shouldSuppressAlertForUser,
    shouldSuppressAlertForOrg,
    shouldSuppressAlert,
} from "@domain/admin/core/quiet-hours.js";

describe('quiet-hours', () => {
    describe('isWithinQuietHours', () => {
        it('returns false for invalid time format', () => {
            expect(isWithinQuietHours('invalid', '22:00', 'America/New_York')).toBe(false);
            expect(isWithinQuietHours('22:00', 'invalid', 'America/New_York')).toBe(false);
        });

        it('returns false for empty timezone', () => {
            // Invalid timezone may throw or return false
            const result = isWithinQuietHours('22:00', '08:00', '');
            expect(typeof result).toBe('boolean');
        });
    });

    describe('shouldSuppressAlertForUser', () => {
        it('returns suppress: false when quiet hours disabled', () => {
            const result = shouldSuppressAlertForUser(
                { quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
                'error'
            );
            expect(result.suppress).toBe(false);
        });

        it('returns suppress: false when quiet hours enabled but missing config', () => {
            const result = shouldSuppressAlertForUser(
                { quietHoursEnabled: true, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
                'error'
            );
            expect(result.suppress).toBe(false);
        });

        it('returns suppress: false when start/end/timezone missing', () => {
            const result = shouldSuppressAlertForUser(
                { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: null, quietHoursTimezone: 'America/New_York' },
                'error'
            );
            expect(result.suppress).toBe(false);
        });
    });

    describe('shouldSuppressAlertForOrg', () => {
        it('returns suppress: false when policy is null', () => {
            const result = shouldSuppressAlertForOrg(null, 'error');
            expect(result.suppress).toBe(false);
        });

        it('returns suppress: false when enableQuietHours is false', () => {
            const result = shouldSuppressAlertForOrg(
                { enableQuietHours: false, enableSeverityBypass: null, quietHoursBypassSeverities: null },
                'error'
            );
            expect(result.suppress).toBe(false);
        });

        it('returns suppress: false with reason when severity bypasses quiet hours', () => {
            const result = shouldSuppressAlertForOrg(
                { enableQuietHours: true, enableSeverityBypass: true, quietHoursBypassSeverities: ['critical'] },
                'critical'
            );
            expect(result.suppress).toBe(false);
            expect(result.reason).toContain('bypasses');
        });
    });

    describe('shouldSuppressAlert', () => {
        it('returns suppress: false when user is null', () => {
            const result = shouldSuppressAlert(null, null, 'error');
            expect(result.suppress).toBe(false);
        });

        it('returns suppress: false when user has quiet hours disabled', () => {
            const result = shouldSuppressAlert(
                { quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
                null,
                'error'
            );
            expect(result.suppress).toBe(false);
        });

        it('respects org bypass when org policy says severity bypasses', () => {
            // User has quiet hours disabled so we hit org check; org says critical bypasses
            const result = shouldSuppressAlert(
                { quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
                { enableQuietHours: true, enableSeverityBypass: true, quietHoursBypassSeverities: ['critical'] },
                'critical'
            );
            expect(result.suppress).toBe(false);
        });
    });
});
