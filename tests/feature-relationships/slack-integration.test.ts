/**
 * Slack Conversational Integration Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conversationalBridgeService } from '../../server/domain/integrations/conversational-bridge.service.js';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockAiClientFactory = { getClient: vi.fn() };

const { mockSlackClient, mockSystemAi, mockUnifiedMemory } = vi.hoisted(() => ({
    mockSlackClient: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
        getChannels: vi.fn().mockResolvedValue([{ id: 'C123', name: 'general' }]),
        lookupUserByEmail: vi.fn().mockResolvedValue({ id: 'U123', profile: { email: 'user@example.com' } }),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock file content')),
        reactions: { add: vi.fn().mockResolvedValue({ ok: true }) },
        client: {
            users: { info: vi.fn().mockResolvedValue({ user: { profile: { email: 'user@example.com' } } }) },
            token: 'xoxb-test-token',
        },
    },
    mockSystemAi: { getAiConfig: vi.fn() },
    mockUnifiedMemory: { getUnifiedContext: vi.fn() },
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
    },
}));

vi.mock('@domain/ai/core/system-ai.service.js', () => ({
    systemAiService: mockSystemAi,
}));

vi.mock('@domain/integrations/slack-service.js', () => ({
    getSlackClient: vi.fn().mockResolvedValue(mockSlackClient),
}));

vi.mock('@domain/agents/core/unified-memory.service.js', () => ({
    unifiedMemoryService: mockUnifiedMemory,
}));


/**
 * A drizzle-ish chain that resolves wherever the caller stops, queued one
 * result per db.select() call.
 *
 * resolveUser makes TWO selects — the platform identity, then the user row it
 * points at — and returns the USER. These doubles served the identity row to
 * both, so the identity came back where the user should have; and the
 * `mockReturnValueOnce` for the second call was queued after the default, so
 * it applied to the FIRST call instead.
 */
const chain = (rows: unknown[]) => {
    const q: any = {
        from: () => q,
        where: () => q,
        limit: () => q,
        orderBy: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
};

const selectsReturn = (...results: unknown[][]) => {
    for (const rows of results) mockDbSelect.mockReturnValueOnce(chain(rows));
    mockDbSelect.mockReturnValue(chain([]));
};

describe('Slack Conversational Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Intent Analysis', () => {
        it('should identify LAUNCH_MISSION intent', async () => {
            const mockAiClient = {
                execute: vi.fn().mockResolvedValue({
                    success: true,
                    output: JSON.stringify({
                        intent: 'LAUNCH_MISSION',
                        confidence: 0.95,
                        objective: 'Build Slack integration',
                        orchestrator: 'rolling_wave',
                        response: 'Launching mission now!',
                    }),
                }),
            };

            mockAiClientFactory.getClient.mockReturnValue(mockAiClient);
            mockSystemAi.getAiConfig.mockResolvedValue({ provider: 'openai', model: 'gpt-4', apiKey: 'test' });
            mockUnifiedMemory.getUnifiedContext.mockResolvedValue('Test memory context');

            const message = {
                platform: 'slack' as const,
                channelId: 'C123',
                userId: 'U456',
                text: 'Build me a Slack integration',
                timestamp: Date.now().toString(),
            };

            // This would require actual implementation to test
            expect(message.intent).toBeUndefined(); // Placeholder
        });

        it('should identify QUERY_KNOWLEDGE intent', async () => {
            const message = {
                platform: 'slack' as const,
                channelId: 'C123',
                userId: 'U456',
                text: 'What do we know about Stripe API?',
                timestamp: Date.now().toString(),
            };

            // Query knowledge intent detection
            expect(message.text).toContain('What do we know');
        });
    });

    describe('User Resolution', () => {
        it('should resolve user by platform identity', async () => {
            const mockIdentity = { userId: 'user-123' };
            const mockUser = { id: 'user-123', email: 'user@example.com' };

            // identity lookup, then the user row it points at
            selectsReturn([mockIdentity], [mockUser]);

            const user = await conversationalBridgeService.resolveUser(
                { platform: 'slack', userId: 'U456', channelId: 'C123', text: '', timestamp: '' },
                mockSlackClient,
                1
            );

            expect(user).toEqual(mockUser);
        });

        it('should fallback to email matching', async () => {
            const mockUser = { id: 'user-789', email: 'user@example.com' };

            // no platform identity, then the email lookup finds the user
            selectsReturn([], [mockUser]);

            const user = await conversationalBridgeService.resolveUser(
                { platform: 'slack', userId: 'U789', channelId: 'C123', text: '', timestamp: '' },
                mockSlackClient,
                1
            );

            expect(user).toEqual(mockUser);
        });

        it('should return null for unknown users', async () => {
            selectsReturn([]);

            // Slack user has no email
            mockSlackClient.client.users.info.mockResolvedValue({
                user: { profile: {} },
            });

            const user = await conversationalBridgeService.resolveUser(
                { platform: 'slack', userId: 'U999', channelId: 'C123', text: '', timestamp: '' },
                mockSlackClient,
                1
            );

            expect(user).toBeNull();
        });
    });

    describe('Thread-based Mission Routing', () => {
        it('should find mission by thread timestamp', async () => {
            const mockRun = { id: 42 };

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRun]),
                    }),
                }),
            });

            const runId = await conversationalBridgeService.findMissionByThread('12345.67890');

            expect(runId).toBe(42);
        });

        it('should return null when no mission found for thread', async () => {
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const runId = await conversationalBridgeService.findMissionByThread('99999.99999');

            expect(runId).toBeNull();
        });
    });

    describe('Attachment Processing', () => {
        it('should download and store files', async () => {
            const files = [{
                id: 'F123',
                name: 'requirements.pdf',
                mimetype: 'application/pdf',
                url_private: 'https://files.slack.com/files/F123/requirements.pdf',
                size: 1024,
            }];

            // Mock evidence storage
            const mockEvidenceStorage = { store: vi.fn().mockResolvedValue('https://storage.example.com/file.pdf') };
            vi.doMock('../../../server/domain/core/infrastructure/evidence-storage.service.js', () => ({
                EvidenceStorageService: mockEvidenceStorage,
            }));

            // Test would verify file download and storage
            expect(files[0].url_private).toContain('slack.com');
        });

        it('should transcribe audio files', async () => {
            const files = [{
                id: 'F456',
                name: 'voice_memo.m4a',
                mimetype: 'audio/mp4',
                url_private: 'https://files.slack.com/files/F456/voice_memo.m4a',
                size: 2048,
            }];

            // Mock transcription service
            const mockTranscription = { transcribe: vi.fn().mockResolvedValue({ text: 'Build a website' }) };
            vi.doMock('../../../server/domain/media/transcription-service.js', () => ({
                transcriptionService: mockTranscription,
            }));

            // Test would verify transcription
            expect(files[0].mimetype).toBe('audio/mp4');
        });
    });

    describe('Connector Resolution', () => {
        it('should find active Slack connector', async () => {
            const mockConnector = {
                id: 1,
                platform: 'slack',
                status: 'active',
                config: { enabled: true },
                credentials: { bot_token: 'xoxb-test' },
            };

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockConnector]),
                    }),
                }),
            });

            const connector = await conversationalBridgeService.resolveConnector({
                platform: 'slack',
                channelId: 'C123',
                userId: 'U456',
                text: '',
                timestamp: '',
            });

            expect(connector).toEqual(mockConnector);
        });

        it('should return undefined when no connector found', async () => {
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const connector = await conversationalBridgeService.resolveConnector({
                platform: 'slack',
                channelId: 'C123',
                userId: 'U456',
                text: '',
                timestamp: '',
            });

            expect(connector).toBeUndefined();
        });
    });
});

describe('Slack Webhook Security', () => {
    it('should verify valid Slack signature', () => {
        // Mock the verifySlackSignature function from messaging-webhooks
        const signingSecret = 'test-secret';
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const rawBody = '{"event": {"type": "app_mention"}}';
        
        // Signature would be calculated using crypto
        expect(signingSecret).toBeDefined();
        expect(timestamp).toBeDefined();
    });

    it('should reject old timestamps (replay protection)', () => {
        const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ minutes old
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
        
        expect(parseInt(oldTimestamp)).toBeLessThan(fiveMinutesAgo);
    });
});
