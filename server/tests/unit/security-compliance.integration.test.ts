import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { securityComplianceService } from "@server/domain/org/core/security-compliance.service.js";

describe("SecurityComplianceService", () => {
    beforeEach(() => {
        securityComplianceService.clearAuditLog(1);
    });

    afterEach(() => {
        securityComplianceService.clearAuditLog(1);
    });

    it("should log audit event", async () => {
        const auditId = await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user1",
            action: "test_action",
            resource: "test_resource",
            resourceId: "test_id",
            details: {},
            severity: "info",
        });
        expect(auditId).toBeDefined();
        expect(auditId).toMatch(/^audit_/);
    });

    it("should get audit log for organization", () => {
        const log = securityComplianceService.getAuditLog(1);
        expect(log).toBeInstanceOf(Array);
    });

    it("should filter audit log by user ID", async () => {
        await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user1",
            action: "action1",
            resource: "resource1",
            resourceId: "id1",
            details: {},
            severity: "info",
        });

        await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user2",
            action: "action2",
            resource: "resource2",
            resourceId: "id2",
            details: {},
            severity: "info",
        });

        const user1Log = securityComplianceService.getAuditLog(1, { userId: "user1" });
        expect(user1Log).toHaveLength(1);
        expect(user1Log[0].userId).toBe("user1");
    });

    it("should filter audit log by action", async () => {
        await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user1",
            action: "login",
            resource: "auth",
            resourceId: "session1",
            details: {},
            severity: "info",
        });

        await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user1",
            action: "logout",
            resource: "auth",
            resourceId: "session1",
            details: {},
            severity: "info",
        });

        const loginLog = securityComplianceService.getAuditLog(1, { action: "login" });
        expect(loginLog).toHaveLength(1);
        expect(loginLog[0].action).toBe("login");
    });

    it("should clear audit log", async () => {
        await securityComplianceService.logAuditEvent({
            organizationId: 1,
            userId: "user1",
            action: "test",
            resource: "test",
            resourceId: "test",
            details: {},
            severity: "info",
        });

        securityComplianceService.clearAuditLog(1);
        const log = securityComplianceService.getAuditLog(1);
        expect(log).toHaveLength(0);
    });

    it("should generate SOC2 report", async () => {
        const report = await securityComplianceService.generateSOC2Report(1);
        expect(report.organizationId).toBe(1);
        expect(report.framework).toBe("SOC2");
        expect(report.findings).toBeInstanceOf(Array);
        expect(report.overallScore).toBeGreaterThanOrEqual(0);
        expect(report.overallScore).toBeLessThanOrEqual(100);
    });

    it("should generate GDPR report", async () => {
        const report = await securityComplianceService.generateGDPRReport(1);
        expect(report.organizationId).toBe(1);
        expect(report.framework).toBe("GDPR");
        expect(report.findings).toBeInstanceOf(Array);
    });

    it("should generate HIPAA report", async () => {
        const report = await securityComplianceService.generateHIPAAReport(1);
        expect(report.organizationId).toBe(1);
        expect(report.framework).toBe("HIPAA");
        expect(report.findings).toBeInstanceOf(Array);
    });

    it("should generate ISO27001 report", async () => {
        const report = await securityComplianceService.generateISO27001Report(1);
        expect(report.organizationId).toBe(1);
        expect(report.framework).toBe("ISO27001");
        expect(report.findings).toBeInstanceOf(Array);
    });

    it("should enable security features", async () => {
        await securityComplianceService.enableSecurityFeatures(1, {
            auditLogging: true,
            encryptionEnabled: true,
        });
        // Should not throw
    });
});
