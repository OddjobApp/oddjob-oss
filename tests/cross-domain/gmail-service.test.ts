/**
 * Gmail Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Use vi.hoisted to make variables available to vi.mock
const { mockGmailInstance, mockOAuth2Methods } = vi.hoisted(() => {
    return {
        mockOAuth2Methods: {
            generateAuthUrl: vi.fn(),
            getToken: vi.fn(),
            setCredentials: vi.fn(),
            on: vi.fn(),
        },
        mockGmailInstance: {
            users: {
                getProfile: vi.fn(),
                messages: {
                    send: vi.fn(),
                },
            },
        }
    };
});

// Mock database
vi.mock("../../server/database_service.js", () => {
    const createMockQuery = (result: any = []) => ({
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
    });

    return {
        db: {
            select: vi.fn(() => createMockQuery([])),
            insert: vi.fn(() => createMockQuery([])),
            update: vi.fn(() => createMockQuery([])),
        },
    };
});

// Mock googleapis
vi.mock("googleapis", () => {
    class MockOAuth2 {
        constructor() {
            return mockOAuth2Methods;
        }
    }

    return {
        __esModule: true,
        google: {
            auth: {
                OAuth2: MockOAuth2,
            },
            gmail: vi.fn().mockImplementation(() => mockGmailInstance),
        },
    };
});

vi.mock("../../server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { GmailService } from "../../server/domain/integrations/gmail-service.js";
import { db } from "../../server/database_service.js";

describe("GmailService", () => {
    let service: GmailService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GMAIL_CLIENT_ID = "client-id";
        process.env.GMAIL_CLIENT_SECRET = "client-secret";

        // Re-set mock implementations because we might have used resetAllMocks before or just to be safe
        mockOAuth2Methods.generateAuthUrl.mockReturnValue("http://auth.url");
        mockOAuth2Methods.getToken.mockResolvedValue({ tokens: { access_token: "abc", refresh_token: "def" } });
        mockGmailInstance.users.getProfile.mockResolvedValue({ data: { emailAddress: "test@gmail.com" } });
        mockGmailInstance.users.messages.send.mockResolvedValue({ data: { id: "msg-123" } });

        service = new GmailService();
    });

    it("should generate auth URL", () => {
        const url = service.getAuthUrl();
        expect(url).toBe("http://auth.url");
    });

    it("should handle OAuth callback", async () => {
        const createMockQuery = (result: any = []) => ({
            returning: vi.fn().mockResolvedValue(result),
            then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
            limit: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
        });

        (db.select as Mock).mockReturnValue(createMockQuery([]));
        (db.insert as Mock).mockReturnValue(createMockQuery([{ id: 1 }]));

        await service.handleOAuthCallback("code123", 1, "user-1");

        expect(db.insert).toHaveBeenCalled();
        expect(mockGmailInstance.users.getProfile).toHaveBeenCalled();
    });

    it("should load credentials from database", async () => {
        const mockCred = {
            id: 1,
            metadata: {
                accessToken: "abc",
                refreshToken: "def",
                tokenExpiry: new Date().toISOString()
            }
        };
        const createMockQuery = (result: any = []) => ({
            returning: vi.fn().mockResolvedValue(result),
            then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
            limit: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
        });
        (db.select as Mock).mockReturnValue(createMockQuery([mockCred]));

        const result = await service.loadCredentials(1);
        expect(result).toBe(true);
        expect(mockOAuth2Methods.setCredentials).toHaveBeenCalled();
    });

    it("should send HIL notification", async () => {
        const context = {
            pipelineName: "Test Pipeline",
            stepName: "Approval Step"
        };

        // Sends authorize per call from the org's own credential (no shared client state).
        (db.select as Mock).mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([{ id: 1, organizationId: null, metadata: { accessToken: "abc", refreshToken: "def", tokenExpiry: "" } }]),
        });
        const result = await service.sendHilNotification(null, "user@test.com", "http://hil.link", context);

        expect(result.success).toBe(true);
        expect(result.messageId).toBe("msg-123");
        expect(mockGmailInstance.users.messages.send).toHaveBeenCalled();
    });
});
