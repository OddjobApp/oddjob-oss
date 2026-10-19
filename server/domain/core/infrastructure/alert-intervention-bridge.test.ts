import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertInterventionBridge } from './alert-intervention-bridge.js';
import { eventStream } from './event-stream.service.js';

vi.mock('./event-stream.service.js', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EventEmitter } = require('events');
    class MockEventStream extends EventEmitter {
        publish = vi.fn().mockResolvedValue('mock-event-id');
    }
    return {
        eventStream: new MockEventStream()
    };
});

describe('AlertInterventionBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Since initialize() registers the listener once, we make sure it is initialized
        AlertInterventionBridge.initialize();
    });

    it('should bridge critical severity system alerts to critical interventions', async () => {
        const mockAlertEvent = {
            eventType: 'system.alert_created',
            payload: {
                alertId: 42,
                severity: 'critical',
                category: 'database_error',
                message: 'Connection timeout on replication slot',
                details: { host: 'db-primary', latencyMs: 5000 },
                jobRunId: 101,
                organizationId: 9
            }
        };

        // Emit the event to simulate alerting service trigger
        eventStream.emit('system.alert_created', mockAlertEvent);

        // Allow microtasks to run (since the listener is async)
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(eventStream.publish).toHaveBeenCalledTimes(1);
        expect(eventStream.publish).toHaveBeenCalledWith(
            'intervention.triggered',
            expect.objectContaining({
                vector: 'S',
                priority: 'critical',
                title: 'System Alert: database error',
                description: 'Connection timeout on replication slot',
                confidence: 1.0,
                context: expect.objectContaining({
                    alertId: 42,
                    severity: 'critical',
                    category: 'database_error'
                })
            }),
            expect.objectContaining({
                organizationId: 9
            }),
            'alert-intervention-bridge'
        );
    });

    it('should bridge error severity system alerts to high priority interventions', async () => {
        const mockAlertEvent = {
            eventType: 'system.alert_created',
            payload: {
                alertId: 43,
                severity: 'error',
                category: 'pipeline_failure',
                message: 'Step "Transform" failed with exit code 1',
                pipelineRunId: 202,
                organizationId: 9
            }
        };

        eventStream.emit('system.alert_created', mockAlertEvent);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(eventStream.publish).toHaveBeenCalledTimes(1);
        expect(eventStream.publish).toHaveBeenCalledWith(
            'intervention.triggered',
            expect.objectContaining({
                vector: 'S',
                priority: 'high',
                title: 'System Alert: pipeline failure',
                description: 'Step "Transform" failed with exit code 1',
                context: expect.objectContaining({
                    alertId: 43,
                    severity: 'error',
                    category: 'pipeline_failure'
                })
            }),
            expect.objectContaining({
                organizationId: 9
            }),
            'alert-intervention-bridge'
        );
    });

    it('should ignore low severity system alerts', async () => {
        const mockAlertEvent = {
            eventType: 'system.alert_created',
            payload: {
                alertId: 44,
                severity: 'info',
                category: 'job_success',
                message: 'Backup job completed successfully',
                organizationId: 9
            }
        };

        eventStream.emit('system.alert_created', mockAlertEvent);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(eventStream.publish).not.toHaveBeenCalled();
    });
});
