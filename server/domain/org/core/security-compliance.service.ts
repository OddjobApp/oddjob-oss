import { db } from "@server/database_service.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { users, orgSettings, credentials } from "@shared/schema/index.js";

const logger = createLogger("SecurityComplianceService");

/**
 * Audit log entry
 */
export interface AuditLogEntry {
    id: string;
    organizationId: number;
    userId: string;
    action: string;
    resource: string;
    resourceId: string;
    details: any;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    severity: "info" | "warning" | "error" | "critical";
}

/**
 * Compliance report
 */
export interface ComplianceReport {
    organizationId: number;
    reportDate: Date;
    framework: "SOC2" | "GDPR" | "HIPAA" | "ISO27001";
    status: "compliant" | "non_compliant" | "partial";
    findings: ComplianceFinding[];
    overallScore: number;
}

/**
 * Compliance finding
 */
export interface ComplianceFinding {
    category: string;
    severity: "high" | "medium" | "low";
    description: string;
    recommendation: string;
    status: "open" | "in_progress" | "resolved";
}

/**
 * Security & Compliance Service
 * Handles advanced security features and compliance reporting
 */
export class SecurityComplianceService {
    private static instance: SecurityComplianceService;
    private auditLog: Map<number, AuditLogEntry[]> = new Map();
    private maxLogSize: number = 10000;

    private constructor() {
        this.initializeAuditLogging();
    }

    static getInstance(): SecurityComplianceService {
        if (!SecurityComplianceService.instance) {
            SecurityComplianceService.instance = new SecurityComplianceService();
        }
        return SecurityComplianceService.instance;
    }

    /**
     * Initialize audit logging
     */
    private initializeAuditLogging(): void {
        logger.info("[SecurityCompliance] Audit logging initialized");
    }

    /**
     * Log an audit event
     */
    async logAuditEvent(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<string> {
        const fullEntry: AuditLogEntry = {
            ...entry,
            id: this.generateAuditId(),
            timestamp: new Date(),
        };

        // Store in memory
        const logs = this.auditLog.get(entry.organizationId) || [];
        logs.push(fullEntry);
        
        // Enforce max log size
        if (logs.length > this.maxLogSize) {
            logs.shift();
        }
        
        this.auditLog.set(entry.organizationId, logs);

        // Log to system logger
        logger.info(`[Audit] ${entry.action} on ${entry.resource} by user ${entry.userId}`);

        return fullEntry.id;
    }

    /**
     * Get audit log for organization
     */
    getAuditLog(organizationId: number, filters?: {
        userId?: string;
        action?: string;
        resource?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): AuditLogEntry[] {
        let logs = this.auditLog.get(organizationId) || [];

        if (filters) {
            if (filters.userId) {
                logs = logs.filter(l => l.userId === filters.userId);
            }
            if (filters.action) {
                logs = logs.filter(l => l.action === filters.action);
            }
            if (filters.resource) {
                logs = logs.filter(l => l.resource === filters.resource);
            }
            if (filters.startDate) {
                logs = logs.filter(l => l.timestamp >= filters.startDate!);
            }
            if (filters.endDate) {
                logs = logs.filter(l => l.timestamp <= filters.endDate!);
            }
            if (filters.limit) {
                logs = logs.slice(-filters.limit);
            }
        }

        return logs;
    }

    /**
     * Generate SOC2 compliance report
     */
    async generateSOC2Report(organizationId: number): Promise<ComplianceReport> {
        logger.info(`[SecurityCompliance] Generating SOC2 report for org ${organizationId}`);

        const findings: ComplianceFinding[] = [];
        let score = 100;

        // Check audit logging
        const auditLogs = this.getAuditLog(organizationId, { limit: 100 });
        if (auditLogs.length < 10) {
            findings.push({
                category: "Audit Logging",
                severity: "high",
                description: "Insufficient audit log entries",
                recommendation: "Ensure all critical actions are logged",
                status: "open"
            });
            score -= 20;
        }

        // Check data encryption
        const [rawSettings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        const settings = rawSettings as any;

        if (!settings?.encryptionEnabled) {
            findings.push({
                category: "Data Encryption",
                severity: "high",
                description: "Data encryption not enabled",
                recommendation: "Enable encryption for data at rest and in transit",
                status: "open"
            });
            score -= 30;
        }

        // Check access controls
        const creds = await db.select()
            .from(credentials)
            .where(eq(credentials.organizationId, organizationId));

        if (creds.length === 0) {
            findings.push({
                category: "Access Control",
                severity: "medium",
                description: "No credentials configured",
                recommendation: "Configure proper access controls",
                status: "open"
            });
            score -= 10;
        }

        // Check session management
        if (!settings?.sessionTimeoutMinutes || settings.sessionTimeoutMinutes > 120) {
            findings.push({
                category: "Session Management",
                severity: "medium",
                description: "Session timeout too long",
                recommendation: "Set session timeout to 60 minutes or less",
                status: "open"
            });
            score -= 10;
        }

        return {
            organizationId,
            reportDate: new Date(),
            framework: "SOC2",
            status: score >= 80 ? "compliant" : score >= 60 ? "partial" : "non_compliant",
            findings,
            overallScore: Math.max(0, score),
        };
    }

    /**
     * Generate GDPR compliance report
     */
    async generateGDPRReport(organizationId: number): Promise<ComplianceReport> {
        logger.info(`[SecurityCompliance] Generating GDPR report for org ${organizationId}`);

        const findings: ComplianceFinding[] = [];
        let score = 100;

        const [rawSettings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        const settings = rawSettings as any;

        // Check data residency
        if (!settings?.dataResidencyEnabled) {
            findings.push({
                category: "Data Residency",
                severity: "high",
                description: "Data residency controls not enabled",
                recommendation: "Enable data residency controls for GDPR compliance",
                status: "open"
            });
            score -= 25;
        }

        // Check consent management
        if (!settings?.consentManagementEnabled) {
            findings.push({
                category: "Consent Management",
                severity: "high",
                description: "Consent management not enabled",
                recommendation: "Implement consent management for data processing",
                status: "open"
            });
            score -= 25;
        }

        // Check right to be forgotten
        if (!settings?.rightToBeForgottenEnabled) {
            findings.push({
                category: "Data Subject Rights",
                severity: "medium",
                description: "Right to be forgotten not implemented",
                recommendation: "Implement data deletion workflows",
                status: "open"
            });
            score -= 15;
        }

        // Check data breach notification
        if (!settings?.breachNotificationEnabled) {
            findings.push({
                category: "Breach Notification",
                severity: "high",
                description: "Data breach notification not configured",
                recommendation: "Configure automated breach notification",
                status: "open"
            });
            score -= 20;
        }

        return {
            organizationId,
            reportDate: new Date(),
            framework: "GDPR",
            status: score >= 80 ? "compliant" : score >= 60 ? "partial" : "non_compliant",
            findings,
            overallScore: Math.max(0, score),
        };
    }

    /**
     * Generate HIPAA compliance report
     */
    async generateHIPAAReport(organizationId: number): Promise<ComplianceReport> {
        logger.info(`[SecurityCompliance] Generating HIPAA report for org ${organizationId}`);

        const findings: ComplianceFinding[] = [];
        let score = 100;

        const [rawSettings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        const settings = rawSettings as any;

        // Check PHI encryption
        if (!settings?.phiEncryptionEnabled) {
            findings.push({
                category: "PHI Protection",
                severity: "high",
                description: "PHI encryption not enabled",
                recommendation: "Enable encryption for protected health information",
                status: "open"
            });
            score -= 30;
        }

        // Check access logging
        const auditLogs = this.getAuditLog(organizationId, { limit: 100 });
        if (auditLogs.length < 10) {
            findings.push({
                category: "Access Logging",
                severity: "high",
                description: "Insufficient access logging for PHI",
                recommendation: "Ensure all PHI access is logged",
                status: "open"
            });
            score -= 20;
        }

        // Check minimum necessary access
        if (!settings?.minimumNecessaryAccessEnabled) {
            findings.push({
                category: "Access Control",
                severity: "medium",
                description: "Minimum necessary access not enforced",
                recommendation: "Implement role-based access with least privilege",
                status: "open"
            });
            score -= 15;
        }

        return {
            organizationId,
            reportDate: new Date(),
            framework: "HIPAA",
            status: score >= 80 ? "compliant" : score >= 60 ? "partial" : "non_compliant",
            findings,
            overallScore: Math.max(0, score),
        };
    }

    /**
     * Generate ISO 27001 compliance report
     */
    async generateISO27001Report(organizationId: number): Promise<ComplianceReport> {
        logger.info(`[SecurityCompliance] Generating ISO 27001 report for org ${organizationId}`);

        const findings: ComplianceFinding[] = [];
        let score = 100;

        const [rawSettings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        const settings = rawSettings as any;

        // Check information security policy
        if (!settings?.securityPolicyEnabled) {
            findings.push({
                category: "Security Policy",
                severity: "high",
                description: "Information security policy not defined",
                recommendation: "Define and implement information security policy",
                status: "open"
            });
            score -= 20;
        }

        // Check risk management
        if (!settings?.riskManagementEnabled) {
            findings.push({
                category: "Risk Management",
                severity: "high",
                description: "Risk management process not implemented",
                recommendation: "Implement risk assessment and treatment process",
                status: "open"
            });
            score -= 20;
        }

        // Check asset management
        if (!settings?.assetManagementEnabled) {
            findings.push({
                category: "Asset Management",
                severity: "medium",
                description: "Asset management not implemented",
                recommendation: "Implement asset inventory and classification",
                status: "open"
            });
            score -= 15;
        }

        // Check access control
        if (!settings?.accessControlEnabled) {
            findings.push({
                category: "Access Control",
                severity: "high",
                description: "Access control not properly implemented",
                recommendation: "Implement proper access control mechanisms",
                status: "open"
            });
            score -= 20;
        }

        // Check business continuity
        if (!settings?.businessContinuityEnabled) {
            findings.push({
                category: "Business Continuity",
                severity: "medium",
                description: "Business continuity planning not implemented",
                recommendation: "Implement business continuity and disaster recovery plans",
                status: "open"
            });
            score -= 15;
        }

        return {
            organizationId,
            reportDate: new Date(),
            framework: "ISO27001",
            status: score >= 80 ? "compliant" : score >= 60 ? "partial" : "non_compliant",
            findings,
            overallScore: Math.max(0, score),
        };
    }

    /**
     * Enable security features for organization
     */
    async enableSecurityFeatures(organizationId: number, features: {
        auditLogging?: boolean;
        encryptionEnabled?: boolean;
        mfaRequired?: boolean;
        sessionTimeoutMinutes?: number;
        dataResidencyEnabled?: boolean;
        consentManagementEnabled?: boolean;
        rightToBeForgottenEnabled?: boolean;
        breachNotificationEnabled?: boolean;
        phiEncryptionEnabled?: boolean;
        minimumNecessaryAccessEnabled?: boolean;
        securityPolicyEnabled?: boolean;
        riskManagementEnabled?: boolean;
        assetManagementEnabled?: boolean;
        accessControlEnabled?: boolean;
        businessContinuityEnabled?: boolean;
    }): Promise<void> {
        logger.info(`[SecurityCompliance] Enabling security features for org ${organizationId}`);

        await db.update(orgSettings)
            .set({
                ...(features as any),
                updatedAt: new Date()
            })
            .where(eq(orgSettings.organizationId, organizationId));

        await this.logAuditEvent({
            organizationId,
            userId: "system",
            action: "security_features_enabled",
            resource: "org_settings",
            resourceId: organizationId.toString(),
            details: features,
            severity: "info",
        });
    }

    /**
     * Generate audit ID
     */
    private generateAuditId(): string {
        return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clear audit log for organization
     */
    clearAuditLog(organizationId: number): void {
        this.auditLog.delete(organizationId);
        logger.info(`[SecurityCompliance] Cleared audit log for org ${organizationId}`);
    }
}

export const securityComplianceService = SecurityComplianceService.getInstance();
