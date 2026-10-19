/**
 * Compliance Pack Service
 * 
 * Manages pre-built compliance packs for:
 * - Financial (SOC2, PCI-DSS)
 * - Healthcare (HIPAA, HITECH)
 * - General (ISO27001, GDPR)
 * 
 * Provides automated audit capabilities and real-time scoring.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import {
  CompliancePack,
  ComplianceControl,
  ComplianceFramework,
  AuditResult,
  ComplianceAssessment,
  CertificationRecord,
  CreateCompliancePackRequest,
  RunAuditRequest
} from '../../../shared/schema/compliance.js';

const logger = createLogger('CompliancePackService');

interface AuditContext {
  organizationId: string;
  agentIds: string[];
  dataStores: string[];
  integrations: string[];
}

export class CompliancePackService {
  private frameworks: Map<string, ComplianceFramework> = new Map();
  private packs: Map<string, CompliancePack> = new Map();
  private controls: Map<string, ComplianceControl> = new Map();
  private assessments: Map<string, ComplianceAssessment> = new Map();
  private certifications: Map<string, CertificationRecord> = new Map();
  private auditHistory: Map<string, AuditResult[]> = new Map();

  constructor() {
    this.initializeDefaultFrameworks();
    this.initializeDefaultPacks();
  }

  /**
   * Initialize default compliance frameworks
   */
  private initializeDefaultFrameworks(): void {
    const frameworks: ComplianceFramework[] = [
      {
        id: 'soc2-type2',
        name: 'SOC 2 Type II',
        version: '2017',
        category: 'financial',
        description: 'Service Organization Control 2 - Trust Services Criteria',
        effectiveDate: '2017-01-01',
        requirements: [
          { id: 'cc6.1', category: 'Security', description: 'Logical access controls', controlType: 'technical', priority: 'critical' },
          { id: 'cc6.2', category: 'Security', description: 'Access removal', controlType: 'administrative', priority: 'high' },
          { id: 'cc6.3', category: 'Security', description: 'Access monitoring', controlType: 'technical', priority: 'high' },
          { id: 'cc7.1', category: 'Availability', description: 'System monitoring', controlType: 'technical', priority: 'critical' },
          { id: 'cc7.2', category: 'Availability', description: 'Backup procedures', controlType: 'technical', priority: 'high' },
          { id: 'cc8.1', category: 'Processing Integrity', description: 'Data validation', controlType: 'technical', priority: 'high' }
        ]
      },
      {
        id: 'pci-dss',
        name: 'PCI DSS',
        version: '4.0',
        category: 'financial',
        description: 'Payment Card Industry Data Security Standard',
        effectiveDate: '2022-03-31',
        requirements: [
          { id: 'req-1', category: 'Network Security', description: 'Firewall configuration', controlType: 'technical', priority: 'critical' },
          { id: 'req-2', category: 'System Security', description: 'Default passwords', controlType: 'technical', priority: 'critical' },
          { id: 'req-3', category: 'Data Protection', description: 'Cardholder data storage', controlType: 'technical', priority: 'critical' },
          { id: 'req-4', category: 'Encryption', description: 'Transmission encryption', controlType: 'technical', priority: 'critical' },
          { id: 'req-10', category: 'Monitoring', description: 'Network access logging', controlType: 'technical', priority: 'high' }
        ]
      },
      {
        id: 'hipaa',
        name: 'HIPAA',
        version: '2013',
        category: 'healthcare',
        description: 'Health Insurance Portability and Accountability Act',
        effectiveDate: '2013-09-23',
        requirements: [
          { id: '164.312-a', category: 'Access Control', description: 'Unique user identification', controlType: 'technical', priority: 'critical' },
          { id: '164.312-b', category: 'Audit Controls', description: 'Activity logging', controlType: 'technical', priority: 'critical' },
          { id: '164.312-c', category: 'Integrity', description: 'Data integrity controls', controlType: 'technical', priority: 'critical' },
          { id: '164.312-d', category: 'Authentication', description: 'Person/entity authentication', controlType: 'technical', priority: 'critical' },
          { id: '164.312-e', category: 'Transmission', description: 'Transmission security', controlType: 'technical', priority: 'critical' },
          { id: '164.308-a', category: 'Admin Safeguards', description: 'Security management', controlType: 'administrative', priority: 'high' }
        ]
      },
      {
        id: 'hitech',
        name: 'HITECH Act',
        version: '2009',
        category: 'healthcare',
        description: 'Health Information Technology for Economic and Clinical Health',
        effectiveDate: '2009-02-17',
        requirements: [
          { id: 'breach-notification', category: 'Breach', description: 'Breach notification requirements', controlType: 'administrative', priority: 'critical' },
          { id: 'business-associate', category: 'Contracts', description: 'Business associate agreements', controlType: 'administrative', priority: 'critical' },
          { id: 'enforcement', category: 'Enforcement', description: 'Enforcement provisions', controlType: 'administrative', priority: 'high' }
        ]
      },
      {
        id: 'iso27001',
        name: 'ISO 27001',
        version: '2022',
        category: 'general',
        description: 'Information Security Management System',
        effectiveDate: '2022-10-01',
        requirements: [
          { id: 'A.5.1', category: 'Policies', description: 'Information security policies', controlType: 'administrative', priority: 'high' },
          { id: 'A.6.1', category: 'Organization', description: 'Internal organization', controlType: 'administrative', priority: 'high' },
          { id: 'A.8.1', category: 'Asset Management', description: 'User endpoint devices', controlType: 'technical', priority: 'medium' },
          { id: 'A.8.2', category: 'Asset Management', description: 'Information classification', controlType: 'administrative', priority: 'high' },
          { id: 'A.9.1', category: 'Access Control', description: 'Access to networks', controlType: 'technical', priority: 'critical' },
          { id: 'A.9.2', category: 'Access Control', description: 'User access management', controlType: 'technical', priority: 'critical' },
          { id: 'A.12.3', category: 'Operations', description: 'Information backup', controlType: 'technical', priority: 'high' },
          { id: 'A.12.4', category: 'Operations', description: 'Logging and monitoring', controlType: 'technical', priority: 'critical' }
        ]
      },
      {
        id: 'gdpr',
        name: 'GDPR',
        version: '2016',
        category: 'general',
        description: 'General Data Protection Regulation',
        effectiveDate: '2018-05-25',
        requirements: [
          { id: 'art-5', category: 'Principles', description: 'Data processing principles', controlType: 'administrative', priority: 'critical' },
          { id: 'art-6', category: 'Lawfulness', description: 'Lawfulness of processing', controlType: 'administrative', priority: 'critical' },
          { id: 'art-7', category: 'Consent', description: 'Conditions for consent', controlType: 'administrative', priority: 'critical' },
          { id: 'art-17', category: 'Rights', description: 'Right to erasure', controlType: 'technical', priority: 'high' },
          { id: 'art-25', category: 'Privacy', description: 'Data protection by design', controlType: 'technical', priority: 'critical' },
          { id: 'art-32', category: 'Security', description: 'Security of processing', controlType: 'technical', priority: 'critical' },
          { id: 'art-33', category: 'Breach', description: 'Breach notification', controlType: 'administrative', priority: 'critical' }
        ]
      }
    ];

    frameworks.forEach((f) => this.frameworks.set(f.id, f));
    logger.info('Initialized compliance frameworks', { count: frameworks.length });
  }

  /**
   * Initialize default compliance packs
   */
  private initializeDefaultPacks(): void {
    const now = new Date().toISOString();

    // Financial Pack (SOC2 + PCI-DSS)
    const financialControls = this.generateControls(['soc2-type2', 'pci-dss']);
    const financialPack: CompliancePack = {
      id: 'financial-compliance',
      name: 'Financial Compliance Pack',
      description: 'SOC 2 Type II and PCI-DSS compliance for financial services',
      category: 'financial',
      frameworks: ['soc2-type2', 'pci-dss'],
      controls: financialControls,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    // Healthcare Pack (HIPAA + HITECH)
    const healthcareControls = this.generateControls(['hipaa', 'hitech']);
    const healthcarePack: CompliancePack = {
      id: 'healthcare-compliance',
      name: 'Healthcare Compliance Pack',
      description: 'HIPAA and HITECH compliance for healthcare organizations',
      category: 'healthcare',
      frameworks: ['hipaa', 'hitech'],
      controls: healthcareControls,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    // General Pack (ISO27001 + GDPR)
    const generalControls = this.generateControls(['iso27001', 'gdpr']);
    const generalPack: CompliancePack = {
      id: 'general-compliance',
      name: 'General Compliance Pack',
      description: 'ISO 27001 and GDPR compliance for general data protection',
      category: 'general',
      frameworks: ['iso27001', 'gdpr'],
      controls: generalControls,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    [financialPack, healthcarePack, generalPack].forEach((p) => {
      this.packs.set(p.id, p);
      p.controls.forEach((c) => this.controls.set(c.id, c));
    });

    logger.info('Initialized compliance packs', { count: 3 });
  }

  /**
   * Generate controls from framework requirements
   */
  private generateControls(frameworkIds: string[]): ComplianceControl[] {
    const controls: ComplianceControl[] = [];

    frameworkIds.forEach((frameworkId) => {
      const framework = this.frameworks.get(frameworkId);
      if (!framework) return;

      framework.requirements.forEach((req) => {
        controls.push({
          id: `${frameworkId}-${req.id}`,
          frameworkId,
          requirementId: req.id,
          name: `${framework.name} - ${req.category}: ${req.description}`,
          description: `Implements ${req.controlType} control for ${req.description}`,
          implementation: {
            status: 'implemented',
            automated: req.controlType === 'technical',
            lastTested: new Date().toISOString()
          },
          testingFrequency: req.priority === 'critical' ? 'continuous' : 'monthly'
        });
      });
    });

    return controls;
  }

  /**
   * Create custom compliance pack
   */
  async createPack(request: CreateCompliancePackRequest): Promise<CompliancePack> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const controls = this.generateControls(request.frameworks);

    const pack: CompliancePack = {
      id,
      name: request.name,
      description: request.description,
      category: request.category,
      frameworks: request.frameworks,
      controls,
      status: 'draft',
      createdAt: now,
      updatedAt: now
    };

    this.packs.set(id, pack);
    controls.forEach((c) => this.controls.set(c.id, c));

    logger.info('Created compliance pack', { packId: id, name: request.name });

    return pack;
  }

  /**
   * Get all compliance packs
   */
  getAllPacks(): CompliancePack[] {
    return Array.from(this.packs.values());
  }

  /**
   * Get pack by ID
   */
  getPack(packId: string): CompliancePack | undefined {
    return this.packs.get(packId);
  }

  /**
   * Get framework by ID
   */
  getFramework(frameworkId: string): ComplianceFramework | undefined {
    return this.frameworks.get(frameworkId);
  }

  /**
   * Run automated compliance audit
   */
  async runAudit(request: RunAuditRequest, context: AuditContext): Promise<ComplianceAssessment> {
    const pack = this.packs.get(request.packId);
    if (!pack) {
      throw new Error(`Pack ${request.packId} not found`);
    }

    const assessmentId = randomUUID();
    const now = new Date().toISOString();

    const controlsToTest = request.controlIds
      ? pack.controls.filter((c) => request.controlIds!.includes(c.id))
      : pack.controls;

    const results: AuditResult[] = [];

    for (const control of controlsToTest) {
      const result = await this.testControl(control, context);
      results.push(result);
    }

    const summary = this.calculateSummary(results);
    const certifiable = summary.overallScore >= 80 && summary.failed === 0;

    const assessment: ComplianceAssessment = {
      id: assessmentId,
      packId: request.packId,
      name: `${pack.name} Assessment - ${now}`,
      status: 'completed',
      startedAt: now,
      completedAt: new Date().toISOString(),
      results,
      summary,
      certifiable
    };

    this.assessments.set(assessmentId, assessment);

    // Store in history
    if (!this.auditHistory.has(request.packId)) {
      this.auditHistory.set(request.packId, []);
    }
    this.auditHistory.get(request.packId)!.push(...results);

    logger.info('Compliance audit completed', {
      assessmentId,
      packId: request.packId,
      overallScore: summary.overallScore,
      certifiable
    });

    return assessment;
  }

  /**
   * Test a single control
   */
  private async testControl(control: ComplianceControl, context: AuditContext): Promise<AuditResult> {
    const testedAt = new Date().toISOString();

    // Simulate control testing logic
    let status: AuditResult['status'] = 'pass';
    let score = 100;
    const findings: AuditResult['findings'] = [];

    // Test based on control type and framework
    if (control.frameworkId === 'pci-dss' && control.requirementId === 'req-3') {
      // Check if cardholder data is encrypted
      const hasEncryption = await this.checkEncryption(context);
      if (!hasEncryption) {
        status = 'fail';
        score = 0;
        findings.push({
          severity: 'critical',
          description: 'Cardholder data not properly encrypted at rest',
          recommendation: 'Implement AES-256 encryption for all stored cardholder data'
        });
      }
    }

    if (control.frameworkId === 'hipaa' && control.requirementId === '164.312-a') {
      // Check unique user identification
      const hasUniqueIds = await this.checkUniqueUserIds(context);
      if (!hasUniqueIds) {
        status = 'warning';
        score = 60;
        findings.push({
          severity: 'high',
          description: 'Some user accounts lack unique identification',
          recommendation: 'Ensure all users have unique, non-shared credentials'
        });
      }
    }

    if (control.frameworkId === 'gdpr' && control.requirementId === 'art-25') {
      // Check privacy by design
      const hasPrivacyByDesign = await this.checkPrivacyByDesign(context);
      if (!hasPrivacyByDesign) {
        status = 'warning';
        score = 75;
        findings.push({
          severity: 'medium',
          description: 'Privacy-by-design principles not fully implemented',
          recommendation: 'Implement data minimization and purpose limitation'
        });
      }
    }

    // Random variation for demo purposes (in production, this would be actual tests)
    if (status === 'pass' && Math.random() < 0.05) {
      status = 'warning';
      score = 85;
      findings.push({
        severity: 'low',
        description: 'Minor configuration drift detected',
        recommendation: 'Review and update configuration settings'
      });
    }

    return {
      id: randomUUID(),
      packId: control.frameworkId,
      controlId: control.id,
      status,
      score,
      findings,
      testedAt,
      testedBy: 'automated-audit'
    };
  }

  /**
   * Simulated compliance checks
   */
  private async checkEncryption(context: AuditContext): Promise<boolean> {
    // In production: Check actual encryption status
    return Math.random() > 0.1; // 90% pass rate
  }

  private async checkUniqueUserIds(context: AuditContext): Promise<boolean> {
    return Math.random() > 0.15; // 85% pass rate
  }

  private async checkPrivacyByDesign(context: AuditContext): Promise<boolean> {
    return Math.random() > 0.2; // 80% pass rate
  }

  /**
   * Calculate assessment summary
   */
  private calculateSummary(results: AuditResult[]): ComplianceAssessment['summary'] {
    const totalControls = results.length;
    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const warnings = results.filter((r) => r.status === 'warning').length;
    const notApplicable = results.filter((r) => r.status === 'not_applicable').length;

    const overallScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

    return {
      totalControls,
      passed,
      failed,
      warnings,
      notApplicable,
      overallScore: Math.round(overallScore)
    };
  }

  /**
   * Get assessment by ID
   */
  getAssessment(assessmentId: string): ComplianceAssessment | undefined {
    return this.assessments.get(assessmentId);
  }

  /**
   * Get all assessments for a pack
   */
  getPackAssessments(packId: string): ComplianceAssessment[] {
    return Array.from(this.assessments.values()).filter((a) => a.packId === packId);
  }

  /**
   * Get real-time compliance score for a pack
   */
  async getRealTimeScore(packId: string): Promise<{
    score: number;
    lastUpdated: string;
    trend: 'improving' | 'stable' | 'declining';
    criticalFindings: number;
  }> {
    const history = this.auditHistory.get(packId) || [];
    const recent = history.slice(-10);

    if (recent.length === 0) {
      return { score: 0, lastUpdated: new Date().toISOString(), trend: 'stable', criticalFindings: 0 };
    }

    const avgScore = recent.reduce((sum, r) => sum + r.score, 0) / recent.length;
    const criticalFindings = recent.filter((r) =>
      r.findings?.some((f) => f.severity === 'critical')
    ).length;

    // Calculate trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recent.length >= 2) {
      const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
      const secondHalf = recent.slice(Math.floor(recent.length / 2));
      const firstAvg = firstHalf.reduce((sum, r) => sum + r.score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, r) => sum + r.score, 0) / secondHalf.length;

      if (secondAvg > firstAvg + 5) trend = 'improving';
      else if (secondAvg < firstAvg - 5) trend = 'declining';
    }

    return {
      score: Math.round(avgScore),
      lastUpdated: recent[recent.length - 1]?.testedAt || new Date().toISOString(),
      trend,
      criticalFindings
    };
  }

  /**
   * Issue certification for a pack
   */
  async issueCertification(
    packId: string,
    frameworkId: string,
    issuedBy: string
  ): Promise<CertificationRecord> {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack ${packId} not found`);
    }

    // Verify pack is certifiable
    const latestAssessment = this.getPackAssessments(packId).pop();
    if (!latestAssessment || !latestAssessment.certifiable) {
      throw new Error('Pack is not certifiable - requires passing audit with score >= 80');
    }

    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year validity

    const certification: CertificationRecord = {
      id: randomUUID(),
      packId,
      frameworkId,
      status: 'certified',
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      issuedBy,
      certificateNumber: `ODDJOB-${frameworkId.toUpperCase()}-${now.getFullYear()}-${randomUUID().slice(0, 8)}`
    };

    this.certifications.set(certification.id, certification);

    logger.info('Certification issued', {
      certificationId: certification.id,
      packId,
      frameworkId,
      issuedBy
    });

    return certification;
  }

  /**
   * Get certifications for a pack
   */
  getCertifications(packId: string): CertificationRecord[] {
    return Array.from(this.certifications.values()).filter((c) => c.packId === packId);
  }

  /**
   * Get compliance gap analysis
   */
  async getGapAnalysis(packId: string): Promise<{
    totalControls: number;
    implemented: number;
    partial: number;
    notImplemented: number;
    gaps: Array<{
      controlId: string;
      controlName: string;
      framework: string;
      severity: string;
      remediationSteps: string[];
    }>;
  }> {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack ${packId} not found`);
    }

    const gaps = pack.controls
      .filter((c) => c.implementation.status !== 'implemented')
      .map((c) => ({
        controlId: c.id,
        controlName: c.name,
        framework: c.frameworkId,
        severity: this.getControlSeverity(c),
        remediationSteps: this.generateRemediationSteps(c)
      }));

    return {
      totalControls: pack.controls.length,
      implemented: pack.controls.filter((c) => c.implementation.status === 'implemented').length,
      partial: pack.controls.filter((c) => c.implementation.status === 'partially_implemented').length,
      notImplemented: pack.controls.filter((c) => c.implementation.status === 'not_implemented').length,
      gaps
    };
  }

  private getControlSeverity(control: ComplianceControl): string {
    const framework = this.frameworks.get(control.frameworkId);
    const req = framework?.requirements.find((r) => r.id === control.requirementId);
    return req?.priority || 'medium';
  }

  private generateRemediationSteps(control: ComplianceControl): string[] {
    const steps: string[] = [];

    if (control.implementation.status === 'not_implemented') {
      steps.push(`Implement ${control.name}`);
      steps.push(`Configure ${control.frameworkId} requirements for ${control.requirementId}`);
    }

    if (control.implementation.status === 'partially_implemented') {
      steps.push('Complete partial implementation');
      steps.push('Review and address gaps in current implementation');
    }

    steps.push('Document implementation evidence');
    steps.push('Schedule follow-up audit to verify compliance');

    return steps;
  }
}

export const compliancePackService = new CompliancePackService();
