import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { gamificationService } from "@server/domain/org/core/gamification.service.js";

describe("GamificationService", () => {
    beforeEach(() => {
        gamificationService.clearAll();
    });

    afterEach(() => {
        gamificationService.clearAll();
    });

    it("should unlock achievement for user", async () => {
        await gamificationService.unlockAchievement("user1", "first_pr");
        const achievements = gamificationService.getUserAchievements("user1");
        expect(achievements).toHaveLength(1);
        expect(achievements[0].id).toBe("first_pr");
    });

    it("should not unlock same achievement twice", async () => {
        await gamificationService.unlockAchievement("user1", "first_pr");
        await gamificationService.unlockAchievement("user1", "first_pr");
        const achievements = gamificationService.getUserAchievements("user1");
        expect(achievements).toHaveLength(1);
    });

    it("should get user achievements", () => {
        const achievements = gamificationService.getUserAchievements("user1");
        expect(achievements).toBeInstanceOf(Array);
    });

    it("should update achievement progress", async () => {
        await gamificationService.updateAchievementProgress("user1", "test_badge", 50);
        // Progress tracking is internal, just ensure it doesn't throw
    });

    it("should get leaderboard", () => {
        const leaderboard = gamificationService.getLeaderboard("test_category");
        expect(leaderboard).toBeInstanceOf(Array);
    });

    it("should update leaderboard", async () => {
        await gamificationService.updateLeaderboard("test_category", "user1", "User One", 100);
        const leaderboard = gamificationService.getLeaderboard("test_category");
        expect(leaderboard).toHaveLength(1);
        expect(leaderboard[0].userId).toBe("user1");
        expect(leaderboard[0].score).toBe(100);
    });

    it("should send recognition", async () => {
        const recognitionId = await gamificationService.sendRecognition(
            "user1",
            "User One",
            "user2",
            "User Two",
            "Great work!"
        );
        expect(recognitionId).toBeDefined();
        expect(recognitionId).toMatch(/^rec_/);
    });

    it("should get recognitions for user", () => {
        const recognitions = gamificationService.getRecognitionsForUser("user1");
        expect(recognitions).toBeInstanceOf(Array);
    });

    it("should update streak", async () => {
        await gamificationService.updateStreak("user1", "contributions");
        const streak = gamificationService.getStreak("user1", "contributions");
        expect(streak).toBeDefined();
        expect(streak?.currentStreak).toBe(1);
    });

    it("should get all achievements", () => {
        const achievements = gamificationService.getAllAchievements();
        expect(achievements).toBeInstanceOf(Array);
        expect(achievements.length).toBeGreaterThan(0);
    });

    it("should get achievement by ID", () => {
        const badge = gamificationService.getAchievement("first_pr");
        expect(badge).toBeDefined();
        expect(badge?.id).toBe("first_pr");
    });

    it("should generate gamification report", () => {
        const report = gamificationService.generateGamificationReport("user1");
        expect(report.achievements).toBeInstanceOf(Array);
        expect(report.leaderboardRanks).toBeDefined();
        expect(report.recognitionsReceived).toBeGreaterThanOrEqual(0);
        expect(report.recognitionsGiven).toBeGreaterThanOrEqual(0);
        expect(report.streaks).toBeInstanceOf(Array);
        expect(report.totalScore).toBeGreaterThanOrEqual(0);
    });
});
