/**
 * ErrorAlertService Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { errorAlertService } from "@domain/diagnostics/core/error-alert.service.js";
import { db } from '@server/database_service.js';

// Mock DB
vi.mock('@server/database_service.js', () => ({
    db: {
        execute: vi.fn(),
    },
}));

// Mock Alerting utilities
vi.mock("@domain/core/infrastructure/alerting.service.js", () => ({
    getAlertConfig: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue(true),
}));

// Mock global fetch
global.fetch = vi.fn() as any;

describe('ErrorAlertService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({ ok: true });

        // Mock current time to be stable
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Database row format (snake_case)
    const mockConfigRow = {
        id: 1,
        organization_id: 10,
        name: 'Critical API Errors',
        enabled: true,
        error_categories: ['api_failure'],
        min_occurrences: 5,
        time_window_minutes: 60,
        pipeline_ids: [100],
        notify_via: ['slack', 'email'],
        slack_webhook_url: 'https://hooks.slack.com/xxx',
        email_recipients: ['admin@example.com'],
        cooldown_minutes: 30,
        last_triggered_at: null,
    };

    const mockDiagnosis = {
        context: { error: 'Connection timeout' },
        bestMatch: {
            pattern: {
                id: 'p1',
                category: 'api_failure',
                diagnosis: { summary: 'API is down' }
            },
            score: 0.9
        },
        recommendations: [],
        timestamp: new Date().toISOString()
    };

    describe('checkAlertConditions', () => {
        it('should skip if no configs are active', async () => {
            (db.execute as any).mockResolvedValueOnce({ rows: [] });

            await errorAlertService.checkAlertConditions(mockDiagnosis as any, 10);

            expect(db.execute).toHaveBeenCalledTimes(1);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should trigger alert when occurrences exceed threshold', async () => {
            // 1. getActiveConfigs
            (db.execute as any).mockResolvedValueOnce({ rows: [mockConfigRow] });
            // 2. countRecentErrors
            (db.execute as any).mockResolvedValueOnce({ rows: [{ count: '10' }] });
            // 3. getSampleErrors (inside triggerAlert)
            (db.execute as any).mockResolvedValueOnce({ rows: [{ error_message: 'timeout 1' }] });
            // 4. INSERT INTO error_alerts
            (db.execute as any).mockResolvedValueOnce({ rows: [] });
            // 5. UPDATE last_triggered_at
            (db.execute as any).mockResolvedValueOnce({ rows: [] });
            // 6. UPDATE notification status
            (db.execute as any).mockResolvedValueOnce({ rows: [] });

            await errorAlertService.checkAlertConditions(mockDiagnosis as any, 10, 100);

            expect(global.fetch).toHaveBeenCalled();
            // Verify all steps were executed: getConfigs -> count -> samples -> insert -> update -> update
            expect(db.execute).toHaveBeenCalledTimes(6);
            expect(vi.mocked(global.fetch)).toHaveBeenCalled();
        });

        it('should respect category filtering', async () => {
            (db.execute as any).mockResolvedValueOnce({ rows: [mockConfigRow] });

            const mismatchedDiagnosis = {
                ...mockDiagnosis,
                bestMatch: {
                    pattern: { category: 'ui_error' }
                }
            };

            await errorAlertService.checkAlertConditions(mismatchedDiagnosis as any, 10, 100);

            expect(db.execute).toHaveBeenCalledTimes(1); // Only getActiveConfigs
        });

        it('should respect pipeline filtering', async () => {
            (db.execute as any).mockResolvedValueOnce({ rows: [mockConfigRow] });

            await errorAlertService.checkAlertConditions(mockDiagnosis as any, 10, 200); // 200 != 100

            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it('should respect cooldown period', async () => {
            const configWithRecentTrigger = {
                ...mockConfigRow,
                last_triggered_at: new Date('2024-01-01T11:45:00Z') // 15 mins ago, cooldown is 30
            };
            (db.execute as any).mockResolvedValueOnce({ rows: [configWithRecentTrigger] });

            await errorAlertService.checkAlertConditions(mockDiagnosis as any, 10, 100);

            expect(db.execute).toHaveBeenCalledTimes(1);
        });
    });

    describe('sendSlackAlert', () => {
        const mockConfig = {
            id: 1,
            organizationId: 10,
            name: 'Critical API Errors',
            enabled: true,
            errorCategories: ['api_failure'],
            minOccurrences: 5,
            timeWindowMinutes: 60,
            pipelineIds: [100],
            notifyVia: ['slack', 'email'],
            slackWebhookUrl: 'https://hooks.slack.com/xxx',
            emailRecipients: ['admin@example.com'],
            cooldownMinutes: 30,
            lastTriggeredAt: null,
        };

        it('should format message correctly and send to webhook', async () => {
            const samples = ['Err 1', 'Err 2'];
            await errorAlertService.sendSlackAlert(mockConfig as any, 10, mockDiagnosis as any, samples);

            expect(global.fetch).toHaveBeenCalledWith(mockConfig.slackWebhookUrl, expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('Critical API Errors')
            }));

            const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
            expect(body.blocks[1].text.text).toContain('10 occurrences');
        });

        it('should throw error if Slack request fails', async () => {
            (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });

            await expect(errorAlertService.sendSlackAlert(mockConfig as any, 5, mockDiagnosis as any, []))
                .rejects.toThrow('Slack webhook failed: 500');
        });
    });

    describe('testSlackWebhook', () => {
        it('should return true on success', async () => {
            const result = await errorAlertService.testSlackWebhook('http://test');
            expect(result).toBe(true);
        });

        it('should return false on failure', async () => {
            (global.fetch as any).mockResolvedValueOnce({ ok: false });
            const result = await errorAlertService.testSlackWebhook('http://test');
            expect(result).toBe(false);
        });
    });
});
