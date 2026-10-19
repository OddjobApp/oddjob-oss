import { db } from "@server/database_service.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { users, missions, missionRuns } from "@shared/schema/index.js";

const logger = createLogger("GamificationService");

/**
 * Achievement badge
 */
export interface AchievementBadge {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: "milestone" | "quality" | "collaboration" | "learning";
    rarity: "common" | "rare" | "epic" | "legendary";
    unlockedAt?: Date;
}

/**
 * User achievement
 */
export interface UserAchievement {
    userId: string;
    badgeId: string;
    unlockedAt: Date;
    progress: number;
    target: number;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
    userId: string;
    userName: string;
    score: number;
    rank: number;
    change: number;
}

/**
 * Team health score
 */
export interface TeamHealthScore {
    teamId: string;
    teamName: string;
    overallScore: number;
    dimensions: {
        velocity: number;
        quality: number;
        collaboration: number;
        learning: number;
    };
    improvementSuggestions: string[];
}

/**
 * Recognition entry
 */
export interface Recognition {
    id: string;
    fromUserId: string;
    fromUserName: string;
    toUserId: string;
    toUserName: string;
    reason: string;
    badge?: string;
    timestamp: Date;
}

/**
 * Learning path
 */
export interface LearningPath {
    id: string;
    name: string;
    description: string;
    skills: string[];
    levels: Array<{
        level: number;
        name: string;
        requirements: string[];
        rewards: string[];
    }>;
    userProgress: {
        currentLevel: number;
        xp: number;
        xpToNext: number;
    };
}

/**
 * Streak tracking
 */
export interface Streak {
    type: "contributions" | "reviews" | "deployments";
    currentStreak: number;
    longestStreak: number;
    lastActivity: Date;
}

/**
 * Gamification & Engagement Service
 * Improves team motivation and adoption through gamification
 */
export class GamificationService {
    private static instance: GamificationService;
    private achievements: Map<string, AchievementBadge> = new Map();
    private userAchievements: Map<string, UserAchievement[]> = new Map(); // userId -> achievements
    private leaderboards: Map<string, LeaderboardEntry[]> = new Map(); // category -> entries
    private recognitions: Recognition[] = [];
    private streaks: Map<string, Streak> = new Map(); // userId -> streak

    private constructor() {
        this.initializeAchievements();
        this.initializeLeaderboards();
    }

    static getInstance(): GamificationService {
        if (!GamificationService.instance) {
            GamificationService.instance = new GamificationService();
        }
        return GamificationService.instance;
    }

    /**
     * Initialize achievement badges
     */
    private initializeAchievements(): void {
        const badges: AchievementBadge[] = [
            // Milestone badges
            {
                id: "first_pr",
                name: "First PR",
                description: "Created your first pull request",
                icon: "🚀",
                category: "milestone",
                rarity: "common",
            },
            {
                id: "hundred_coverage",
                name: "Coverage King",
                description: "Achieved 100% test coverage",
                icon: "👑",
                category: "quality",
                rarity: "epic",
            },
            {
                id: "bug_slayer",
                name: "Bug Slayer",
                description: "Resolved 50 bugs",
                icon: "⚔️",
                category: "quality",
                rarity: "rare",
            },
            // Collaboration badges
            {
                id: "helpful_hero",
                name: "Helpful Hero",
                description: "Helped 10 team members",
                icon: "🦸",
                category: "collaboration",
                rarity: "common",
            },
            {
                id: "code_review_master",
                name: "Review Master",
                description: "Completed 100 code reviews",
                icon: "👁️",
                category: "collaboration",
                rarity: "rare",
            },
            // Learning badges
            {
                id: "quick_learner",
                name: "Quick Learner",
                description: "Completed 5 learning paths",
                icon: "📚",
                category: "learning",
                rarity: "common",
            },
            {
                id: "knowledge_sharer",
                name: "Knowledge Sharer",
                description: "Created 10 documentation pages",
                icon: "📝",
                category: "learning",
                rarity: "rare",
            },
        ];

        for (const badge of badges) {
            this.achievements.set(badge.id, badge);
        }

        logger.info(`[Gamification] Initialized ${badges.length} achievement badges`);
    }

    /**
     * Initialize leaderboards
     */
    private initializeLeaderboards(): void {
        logger.info("[Gamification] Leaderboards initialized");
    }

    /**
     * Unlock achievement for user
     */
    async unlockAchievement(userId: string, badgeId: string): Promise<void> {
        const badge = this.achievements.get(badgeId);

        if (!badge) {
            logger.warn(`[Gamification] Badge not found: ${badgeId}`);
            return;
        }

        const userAchievements = this.userAchievements.get(userId) || [];
        const existing = userAchievements.find(a => a.badgeId === badgeId);

        if (existing) {
            logger.info(`[Gamification] User ${userId} already has badge ${badgeId}`);
            return;
        }

        const achievement: UserAchievement = {
            userId,
            badgeId,
            unlockedAt: new Date(),
            progress: 100,
            target: 100,
        };

        userAchievements.push(achievement);
        this.userAchievements.set(userId, userAchievements);

        logger.info(`[Gamification] Unlocked badge ${badge.name} for user ${userId}`);
    }

    /**
     * Get user achievements
     */
    getUserAchievements(userId: string): AchievementBadge[] {
        const userAchievements = this.userAchievements.get(userId) || [];
        const badges: AchievementBadge[] = [];

        for (const achievement of userAchievements) {
            const badge = this.achievements.get(achievement.badgeId);
            if (badge) {
                badges.push({ ...badge, unlockedAt: achievement.unlockedAt });
            }
        }

        return badges;
    }

    /**
     * Update achievement progress
     */
    async updateAchievementProgress(userId: string, badgeId: string, progress: number): Promise<void> {
        const userAchievements = this.userAchievements.get(userId) || [];
        const achievement = userAchievements.find(a => a.badgeId === badgeId);

        if (achievement) {
            achievement.progress = progress;

            if (progress >= achievement.target) {
                await this.unlockAchievement(userId, badgeId);
            }
        }
    }

    /**
     * Get leaderboard
     */
    getLeaderboard(category: string): LeaderboardEntry[] {
        return this.leaderboards.get(category) || [];
    }

    /**
     * Update leaderboard
     */
    async updateLeaderboard(category: string, userId: string, userName: string, score: number): Promise<void> {
        const leaderboard = this.leaderboards.get(category) || [];
        const existing = leaderboard.find(e => e.userId === userId);

        if (existing) {
            existing.score = score;
            existing.change = existing.rank; // Will be recalculated
        } else {
            leaderboard.push({
                userId,
                userName,
                score,
                rank: 0,
                change: 0,
            });
        }

        // Sort by score
        leaderboard.sort((a, b) => b.score - a.score);

        // Update ranks
        leaderboard.forEach((entry, index) => {
            const oldRank = entry.rank;
            entry.rank = index + 1;
            entry.change = oldRank - entry.rank;
        });

        this.leaderboards.set(category, leaderboard);
    }

    /**
     * Calculate team health score
     */
    async calculateTeamHealthScore(teamId: string, teamName: string): Promise<TeamHealthScore> {
        logger.info(`[Gamification] Calculating team health for ${teamName}`);

        // This would query actual team data
        const score: TeamHealthScore = {
            teamId,
            teamName,
            overallScore: 75,
            dimensions: {
                velocity: 80,
                quality: 70,
                collaboration: 75,
                learning: 75,
            },
            improvementSuggestions: [
                "Increase test coverage to improve quality score",
                "Encourage more code reviews to improve collaboration",
                "Share knowledge through documentation to improve learning",
            ],
        };

        return score;
    }

    /**
     * Send recognition
     */
    async sendRecognition(fromUserId: string, fromUserName: string, toUserId: string, toUserName: string, reason: string, badge?: string): Promise<string> {
        const recognition: Recognition = {
            id: this.generateRecognitionId(),
            fromUserId,
            fromUserName,
            toUserId,
            toUserName,
            reason,
            badge,
            timestamp: new Date(),
        };

        this.recognitions.push(recognition);

        // Award badge if specified
        if (badge) {
            await this.unlockAchievement(toUserId, badge);
        }

        logger.info(`[Gamification] Recognition sent from ${fromUserName} to ${toUserName}`);
        return recognition.id;
    }

    /**
     * Get recognitions for user
     */
    getRecognitionsForUser(userId: string): Recognition[] {
        return this.recognitions.filter(r => r.toUserId === userId);
    }

    /**
     * Get learning path
     */
    getLearningPath(pathId: string): LearningPath | null {
        // This would return a learning path from database
        return null;
    }

    /**
     * Update learning progress
     */
    async updateLearningProgress(userId: string, pathId: string, xp: number): Promise<void> {
        logger.info(`[Gamification] Updated learning progress for ${userId} in ${pathId}: +${xp} XP`);
    }

    /**
     * Update streak
     */
    async updateStreak(userId: string, type: Streak["type"]): Promise<void> {
        const streak = this.streaks.get(userId) || {
            type,
            currentStreak: 0,
            longestStreak: 0,
            lastActivity: new Date(),
        };

        const now = new Date();
        const daysSinceLastActivity = Math.floor((now.getTime() - streak.lastActivity.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceLastActivity <= 1) {
            streak.currentStreak++;
            if (streak.currentStreak > streak.longestStreak) {
                streak.longestStreak = streak.currentStreak;
            }
        } else {
            streak.currentStreak = 1;
        }

        streak.lastActivity = now;
        this.streaks.set(userId, streak);

        logger.info(`[Gamification] Updated ${type} streak for ${userId}: ${streak.currentStreak}`);
    }

    /**
     * Get streak for user
     */
    getStreak(userId: string, type: Streak["type"]): Streak | null {
        const streak = this.streaks.get(userId);
        if (streak && streak.type === type) {
            return streak;
        }
        return null;
    }

    /**
     * Generate recognition ID
     */
    private generateRecognitionId(): string {
        return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get all achievements
     */
    getAllAchievements(): AchievementBadge[] {
        return Array.from(this.achievements.values());
    }

    /**
     * Get achievement by ID
     */
    getAchievement(badgeId: string): AchievementBadge | null {
        return this.achievements.get(badgeId) || null;
    }

    /**
     * Generate gamification report
     */
    generateGamificationReport(userId: string): {
        achievements: AchievementBadge[];
        leaderboardRanks: Record<string, number>;
        recognitionsReceived: number;
        recognitionsGiven: number;
        streaks: Streak[];
        totalScore: number;
    } {
        const achievements = this.getUserAchievements(userId);
        const recognitionsReceived = this.recognitions.filter(r => r.toUserId === userId).length;
        const recognitionsGiven = this.recognitions.filter(r => r.fromUserId === userId).length;
        const streaks = Array.from(this.streaks.values()).filter(s => s.type === "contributions");

        const leaderboardRanks: Record<string, number> = {};
        for (const [category, leaderboard] of this.leaderboards.entries()) {
            const entry = leaderboard.find(e => e.userId === userId);
            if (entry) {
                leaderboardRanks[category] = entry.rank;
            }
        }

        const totalScore = achievements.reduce((sum, badge) => {
            const rarityMultiplier = {
                common: 10,
                rare: 25,
                epic: 50,
                legendary: 100,
            };
            return sum + rarityMultiplier[badge.rarity];
        }, 0);

        return {
            achievements,
            leaderboardRanks,
            recognitionsReceived,
            recognitionsGiven,
            streaks,
            totalScore,
        };
    }

    /**
     * Clear all gamification data
     */
    clearAll(): void {
        this.userAchievements.clear();
        this.leaderboards.clear();
        this.recognitions = [];
        this.streaks.clear();
        logger.info("[Gamification] All gamification data cleared");
    }
}

export const gamificationService = GamificationService.getInstance();
