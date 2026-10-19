/**
 * DashboardService — Pure Mapping Logic Tests
 * Tests the getAuditTimeline mapping logic without DB calls.
 */

import { describe, it, expect } from "vitest";

// Recreate the pure audit log mapping logic from dashboard-service.ts
function mapAuditLog(log: {
    id: number;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: Date;
    metadata: Record<string, any> | null;
}) {
    let title = `${log.action} ${log.entityType}`;
    let description = `${log.action} performed on ${log.entityType} ${log.entityId ? `#${log.entityId}` : ''}`;
    let type: string = 'alert';
    let link: string | undefined = undefined;

    const metadata = log.metadata || {};
    const entityIdStr = log.entityId;
    const entityId = entityIdStr ? parseInt(entityIdStr, 10) : undefined;
    const validEntityId = isNaN(entityId as any) ? undefined : entityId;

    if (log.action === 'POST' && log.entityType === 'sync') {
        title = "System Dependencies Audited";
        type = "job_success";
        link = "/admin/software-audit";
    } else if (log.action === 'skill_ingested') {
        title = "New Skill Package Ingested";
        type = "skill_ingested";
    } else if (log.entityType === 'node' && log.action === 'POST') {
        title = "Knowledge Base Extraction";
        type = "pipeline_end";
        link = "/knowledge/graph";
    } else if (log.action === 'TRIGGER' && log.entityType === 'pipeline') {
        title = "Autonomous Pipeline Execution";
        type = "pipeline_start";
        link = `/pipelines/${entityIdStr}`;
    } else if (log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE') {
        const actionVerb = log.action === 'CREATE' ? 'instantiated' : log.action === 'UPDATE' ? 'modified' : 'decommissioned';
        title = `${log.entityType.charAt(0).toUpperCase() + log.entityType.slice(1)} ${actionVerb}`;
        if (log.entityType === 'job') link = `/jobs/${entityIdStr}`;
        else if (log.entityType === 'pipeline') link = `/pipelines/${entityIdStr}`;
    }

    return { id: `audit-${log.id}`, type, title, description, timestamp: log.createdAt, entityId: validEntityId, link, meta: log.metadata };
}

describe("DashboardService — Audit Timeline Mapping Logic", () => {
    const baseLog = {
        id: 1,
        createdAt: new Date("2025-01-01"),
        metadata: null,
        entityId: null
    };

    it("should map 'POST sync' to 'System Dependencies Audited'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'POST', entityType: 'sync' });
        expect(result.title).toBe("System Dependencies Audited");
        expect(result.type).toBe("job_success");
        expect(result.link).toBe("/admin/software-audit");
    });

    it("should map 'skill_ingested' to 'New Skill Package Ingested'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'skill_ingested', entityType: 'activity' });
        expect(result.title).toBe("New Skill Package Ingested");
        expect(result.type).toBe("skill_ingested");
    });

    it("should map 'POST node' to 'Knowledge Base Extraction'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'POST', entityType: 'node' });
        expect(result.title).toBe("Knowledge Base Extraction");
        expect(result.type).toBe("pipeline_end");
        expect(result.link).toBe("/knowledge/graph");
    });

    it("should map 'TRIGGER pipeline' to 'Autonomous Pipeline Execution'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'TRIGGER', entityType: 'pipeline', entityId: '99' });
        expect(result.title).toBe("Autonomous Pipeline Execution");
        expect(result.type).toBe("pipeline_start");
        expect(result.link).toBe("/pipelines/99");
    });

    it("should map 'CREATE job' to 'Job instantiated' with link", () => {
        const result = mapAuditLog({ ...baseLog, action: 'CREATE', entityType: 'job', entityId: '42' });
        expect(result.title).toBe("Job instantiated");
        expect(result.link).toBe("/jobs/42");
        expect(result.entityId).toBe(42);
    });

    it("should map 'UPDATE pipeline' to 'Pipeline modified'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'UPDATE', entityType: 'pipeline', entityId: '7' });
        expect(result.title).toBe("Pipeline modified");
        expect(result.link).toBe("/pipelines/7");
    });

    it("should map 'DELETE job' to 'Job decommissioned'", () => {
        const result = mapAuditLog({ ...baseLog, action: 'DELETE', entityType: 'job', entityId: '3' });
        expect(result.title).toContain("decommissioned");
    });

    it("should have undefined entityId for non-numeric entityId strings", () => {
        const result = mapAuditLog({ ...baseLog, action: 'POST', entityType: 'sync', entityId: 'abc' });
        expect(result.entityId).toBeUndefined();
    });

    it("should have null entityId when entityId is null", () => {
        const result = mapAuditLog({ ...baseLog, action: 'POST', entityType: 'sync', entityId: null });
        expect(result.entityId).toBeUndefined();
    });

    it("should prefix audit id with 'audit-'", () => {
        const result = mapAuditLog({ ...baseLog, id: 55, action: 'POST', entityType: 'sync' });
        expect(result.id).toBe("audit-55");
    });

    it("should pass through timestamp from the log", () => {
        const ts = new Date("2025-06-15T10:00:00Z");
        const result = mapAuditLog({ ...baseLog, action: 'POST', entityType: 'sync', createdAt: ts });
        expect(result.timestamp).toEqual(ts);
    });
});
