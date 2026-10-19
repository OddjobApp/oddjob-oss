import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RealTimeCollaborationService");

/**
 * User presence
 */
export interface UserPresence {
    userId: string;
    userName: string;
    workbench: string;
    resource: string;
    cursor?: {
        x: number;
        y: number;
        selection?: {
            start: number;
            end: number;
        };
    };
    lastSeen: Date;
    status: "active" | "idle" | "away";
}

/**
 * Real-time comment
 */
export interface RealTimeComment {
    id: string;
    userId: string;
    userName: string;
    resource: string;
    content: string;
    timestamp: Date;
    resolved: boolean;
    replies: RealTimeComment[];
}

/**
 * Shared whiteboard state
 */
export interface WhiteboardState {
    id: string;
    name: string;
    elements: any[];
    collaborators: string[];
    lastModified: Date;
}

/**
 * Voice/video session
 */
export interface CollaborationSession {
    id: string;
    type: "voice" | "video" | "screen_share";
    participants: string[];
    startedAt: Date;
    resource: string;
}

/**
 * Real-Time Collaboration Service
 * Enables synchronous collaboration across distributed teams
 */
export class RealTimeCollaborationService extends EventEmitter {
    private static instance: RealTimeCollaborationService;
    private presence: Map<string, UserPresence> = new Map(); // userId -> presence
    private comments: Map<string, RealTimeComment[]> = new Map(); // resource -> comments
    private whiteboards: Map<string, WhiteboardState> = new Map();
    private sessions: Map<string, CollaborationSession> = new Map();
    private presenceTimeoutMs = 5 * 60 * 1000; // 5 minutes

    private constructor() {
        super();
        this.setMaxListeners(100);
        this.startPresenceCleanup();
    }

    static getInstance(): RealTimeCollaborationService {
        if (!RealTimeCollaborationService.instance) {
            RealTimeCollaborationService.instance = new RealTimeCollaborationService();
        }
        return RealTimeCollaborationService.instance;
    }

    /**
     * Update user presence
     */
    async updatePresence(presence: Omit<UserPresence, "lastSeen">): Promise<void> {
        const fullPresence: UserPresence = {
            ...presence,
            lastSeen: new Date(),
        };

        this.presence.set(presence.userId, fullPresence);

        // Emit presence update
        this.emit("presence_updated", fullPresence);

        logger.info(`[Collaboration] Presence updated for ${presence.userName} in ${presence.workbench}`);
    }

    /**
     * Get presence for a resource
     */
    getPresenceForResource(resource: string): UserPresence[] {
        const allPresence = Array.from(this.presence.values());
        return allPresence.filter(p => p.resource === resource && 
            Date.now() - p.lastSeen.getTime() < this.presenceTimeoutMs);
    }

    /**
     * Get all active users in a workbench
     */
    getActiveUsers(workbench: string): UserPresence[] {
        const allPresence = Array.from(this.presence.values());
        return allPresence.filter(p => p.workbench === workbench &&
            Date.now() - p.lastSeen.getTime() < this.presenceTimeoutMs);
    }

    /**
     * Add comment to resource
     */
    async addComment(comment: Omit<RealTimeComment, "id" | "timestamp" | "replies">): Promise<string> {
        const fullComment: RealTimeComment = {
            ...comment,
            id: this.generateCommentId(),
            timestamp: new Date(),
            replies: [],
        };

        const comments = this.comments.get(comment.resource) || [];
        comments.push(fullComment);
        this.comments.set(comment.resource, comments);

        // Emit comment added event
        this.emit("comment_added", fullComment);

        logger.info(`[Collaboration] Comment added to ${comment.resource} by ${comment.userName}`);
        return fullComment.id;
    }

    /**
     * Get comments for resource
     */
    getComments(resource: string): RealTimeComment[] {
        return this.comments.get(resource) || [];
    }

    /**
     * Resolve comment
     */
    async resolveComment(resource: string, commentId: string): Promise<void> {
        const comments = this.comments.get(resource) || [];
        const comment = comments.find(c => c.id === commentId);

        if (comment) {
            comment.resolved = true;
            this.emit("comment_resolved", comment);
            logger.info(`[Collaboration] Comment ${commentId} resolved`);
        }
    }

    /**
     * Reply to comment
     */
    async replyToComment(resource: string, parentCommentId: string, reply: Omit<RealTimeComment, "id" | "timestamp" | "replies">): Promise<string> {
        const comments = this.comments.get(resource) || [];
        const parentComment = comments.find(c => c.id === parentCommentId);

        if (!parentComment) {
            throw new Error("Parent comment not found");
        }

        const fullReply: RealTimeComment = {
            ...reply,
            id: this.generateCommentId(),
            timestamp: new Date(),
            replies: [],
        };

        parentComment.replies.push(fullReply);

        this.emit("comment_replied", { parent: parentComment, reply: fullReply });

        logger.info(`[Collaboration] Reply added to comment ${parentCommentId}`);
        return fullReply.id;
    }

    /**
     * Create shared whiteboard
     */
    async createWhiteboard(whiteboard: Omit<WhiteboardState, "id" | "lastModified">): Promise<string> {
        const fullWhiteboard: WhiteboardState = {
            ...whiteboard,
            id: this.generateWhiteboardId(),
            lastModified: new Date(),
        };

        this.whiteboards.set(fullWhiteboard.id, fullWhiteboard);

        this.emit("whiteboard_created", fullWhiteboard);

        logger.info(`[Collaboration] Whiteboard ${fullWhiteboard.id} created`);
        return fullWhiteboard.id;
    }

    /**
     * Update whiteboard
     */
    async updateWhiteboard(whiteboardId: string, updates: Partial<WhiteboardState>): Promise<void> {
        const whiteboard = this.whiteboards.get(whiteboardId);

        if (!whiteboard) {
            throw new Error("Whiteboard not found");
        }

        Object.assign(whiteboard, updates, { lastModified: new Date() });

        this.emit("whiteboard_updated", whiteboard);

        logger.info(`[Collaboration] Whiteboard ${whiteboardId} updated`);
    }

    /**
     * Get whiteboard
     */
    getWhiteboard(whiteboardId: string): WhiteboardState | null {
        return this.whiteboards.get(whiteboardId) || null;
    }

    /**
     * Start collaboration session
     */
    async startSession(session: Omit<CollaborationSession, "id" | "startedAt">): Promise<string> {
        const fullSession: CollaborationSession = {
            ...session,
            id: this.generateSessionId(),
            startedAt: new Date(),
        };

        this.sessions.set(fullSession.id, fullSession);

        this.emit("session_started", fullSession);

        logger.info(`[Collaboration] Session ${fullSession.id} started`);
        return fullSession.id;
    }

    /**
     * Join collaboration session
     */
    async joinSession(sessionId: string, userId: string): Promise<void> {
        const session = this.sessions.get(sessionId);

        if (!session) {
            throw new Error("Session not found");
        }

        if (!session.participants.includes(userId)) {
            session.participants.push(userId);
            this.emit("participant_joined", { sessionId, userId });
            logger.info(`[Collaboration] User ${userId} joined session ${sessionId}`);
        }
    }

    /**
     * Leave collaboration session
     */
    async leaveSession(sessionId: string, userId: string): Promise<void> {
        const session = this.sessions.get(sessionId);

        if (!session) {
            throw new Error("Session not found");
        }

        session.participants = session.participants.filter(p => p !== userId);
        this.emit("participant_left", { sessionId, userId });
        logger.info(`[Collaboration] User ${userId} left session ${sessionId}`);
    }

    /**
     * End collaboration session
     */
    async endSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);

        if (!session) {
            throw new Error("Session not found");
        }

        this.sessions.delete(sessionId);

        this.emit("session_ended", session);

        logger.info(`[Collaboration] Session ${sessionId} ended`);
    }

    /**
     * Broadcast cursor position
     */
    async broadcastCursor(userId: string, cursor: UserPresence["cursor"]): Promise<void> {
        const presence = this.presence.get(userId);

        if (presence) {
            presence.cursor = cursor;
            this.emit("cursor_updated", { userId, cursor });
        }
    }

    /**
     * Start presence cleanup interval
     */
    private startPresenceCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            const toRemove: string[] = [];

            for (const [userId, presence] of this.presence.entries()) {
                if (now - presence.lastSeen.getTime() > this.presenceTimeoutMs) {
                    toRemove.push(userId);
                }
            }

            for (const userId of toRemove) {
                const presence = this.presence.get(userId);
                this.presence.delete(userId);
                this.emit("presence_removed", presence);
                logger.info(`[Collaboration] Removed stale presence for ${userId}`);
            }
        }, 60000); // Check every minute
    }

    /**
     * Generate comment ID
     */
    private generateCommentId(): string {
        return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate whiteboard ID
     */
    private generateWhiteboardId(): string {
        return `wb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate session ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clear all collaboration data
     */
    clearAll(): void {
        this.presence.clear();
        this.comments.clear();
        this.whiteboards.clear();
        this.sessions.clear();
        logger.info("[Collaboration] All collaboration data cleared");
    }
}

export const realTimeCollaborationService = RealTimeCollaborationService.getInstance();
