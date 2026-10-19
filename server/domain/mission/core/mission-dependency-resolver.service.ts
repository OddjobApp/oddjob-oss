/**
 * Mission Pre-Creation Dependency Resolver
 *
 * Identifies all downstream dependencies of proposed mission members (jobs/pipelines),
 * validates their existence, and reports missing dependencies before creation.
 */

import { db } from "@server/database_service.js";
import { jobs, pipelines, pipelineSteps, credentials, apiSpecs, hilForms } from "@shared/schema/index.js";
import { orgs } from "@shared/schema/index.js";
import { systemDependencies } from "@shared/schema/system.js";
import { eq, and, or, sql, asc } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionDependencyResolver");
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MemberInput {
  entityType: "job" | "pipeline";
  entityId?: number;
  role: string;
  description?: string;
}

export interface DependencySummary {
  credentialIds: number[];
  apiSpecIds: number[];
  formIds: number[];
  pipelineIds: number[];
  jobIds: number[];
}

export interface MemberResolution {
  memberIndex: number;
  entityType: "job" | "pipeline";
  entityId: number | undefined;
  entityName: string;
  exists: boolean;
  dependencies: DependencySummary;
  missing: string[];
}

export interface MissingDependency {
  memberIndex: number;
  entityType: "job" | "pipeline";
  entityId: number | undefined;
  missingType: "entity" | "credential" | "apiSpec" | "form" | "pipeline" | "job";
  refId: number;
  message: string;
  remediation?: {
    action: "create_credential" | "create_form" | "select_pipeline" | "synthesize_agent" | "configure_api_spec";
    type?: string; // e.g. "slack", "openai", "gmail"
    context?: any;
  };
}

export interface ValidateResult {
  valid: boolean;
  resolved: MemberResolution[];
  missing: MissingDependency[];
  warnings: string[];
  blockers: string[];
}


function extractJobDependencies(job: { type: string; config: any }): DependencySummary {
  const deps: DependencySummary = {
    credentialIds: [],
    apiSpecIds: [],
    formIds: [],
    pipelineIds: [],
    jobIds: [],
  };

  const cfg = (job.config as any) || {};

  const addCred = (id: number | undefined) => {
    if (id && typeof id === "number") deps.credentialIds.push(id);
  };
  const addSpec = (id: number | undefined) => {
    if (id && typeof id === "number") deps.apiSpecIds.push(id);
  };
  const addForm = (id: number | undefined) => {
    if (id && typeof id === "number") deps.formIds.push(id);
  };
  const addPipes = (ids: number[] | undefined) => {
    if (Array.isArray(ids)) ids.forEach((id) => typeof id === "number" && deps.pipelineIds.push(id));
  };
  const addJob = (id: number | undefined) => {
    if (id && typeof id === "number") deps.jobIds.push(id);
  };

  switch (job.type) {
    case "curl":
    case "api":
      addCred(cfg.credentialId as number);
      break;
    case "openapi":
      addSpec(cfg.specId as number);
      addCred(cfg.credentialId as number);
      break;
    case "ai_agent":
    case "ai_api_call":
      addCred(cfg.credentialId as number);
      break;
    case "airflow_dag_run":
      // connectionId references credential by env var; skip structural check
      break;
    case "human_approval":
      addForm(cfg.formId as number);
      break;
    case "supervisor":
      addCred(cfg.credentialId as number);
      addPipes(cfg.allowedPipelines as number[]);
      break;
    case "iterator": {
      const tid = cfg.targetId as number | undefined;
      const mode = (cfg.mode as string) || "job";
      if (tid) {
        if (mode === "pipeline") deps.pipelineIds.push(tid);
        else deps.jobIds.push(tid);
      }
      break;
    }
    case "slack_post":
    case "email_send":
      addCred(cfg.credentialId as number);
      break;
    case "jira_sync":
    case "confluence_sync":
    case "google_drive_sync":
      addCred(cfg.credentialId as number);
      break;
    case "sql_query":
      addCred(cfg.credentialId as number);
      break;
    case "reranker":
      addCred(cfg.credentialId as number);
      break;
    default:
      break;
  }

  return deps;
}

async function resolveJobDependencies(
  jobId: number,
  orgId: number | null,
  visited = new Set<string>()
): Promise<DependencySummary> {
  const visitKey = `job-${jobId}`;
  if (visited.has(visitKey)) return { credentialIds: [], apiSpecIds: [], formIds: [], pipelineIds: [], jobIds: [] };
  visited.add(visitKey);
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), orgId != null ? eq(jobs.organizationId, orgId) : undefined))
    .limit(1);

  if (!job) return { credentialIds: [], apiSpecIds: [], formIds: [], pipelineIds: [], jobIds: [] };

  const deps = extractJobDependencies(job as any);

  // Recurse into iterator targetId (job)
  for (const jid of deps.jobIds) {
    const sub = await resolveJobDependencies(jid, orgId, visited);
    deps.credentialIds.push(...sub.credentialIds);
    deps.apiSpecIds.push(...sub.apiSpecIds);
    deps.formIds.push(...sub.formIds);
    deps.pipelineIds.push(...sub.pipelineIds);
  }

  return deps;
}

async function resolvePipelineDependencies(
  pipelineId: number,
  orgId: number | null,
  visited = new Set<string>()
): Promise<DependencySummary> {
  const visitKey = `pipeline-${pipelineId}`;
  if (visited.has(visitKey)) return { credentialIds: [], apiSpecIds: [], formIds: [], pipelineIds: [], jobIds: [] };
  visited.add(visitKey);

  const deps: DependencySummary = {
    credentialIds: [],
    apiSpecIds: [],
    formIds: [],
    pipelineIds: [],
    jobIds: [],
  };

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), orgId != null ? eq(pipelines.organizationId, orgId) : undefined))
    .limit(1);

  if (!pipeline) return deps;

  if (pipeline.triggerCredentialId) {
    deps.credentialIds.push(pipeline.triggerCredentialId);
  }

  const steps = await db
    .select({ jobId: pipelineSteps.jobId })
    .from(pipelineSteps)
    .where(eq(pipelineSteps.pipelineId, pipelineId));

  for (const step of steps) {
    if (step.jobId) {
      deps.jobIds.push(step.jobId);
      const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
      const jobDeps = await resolveJobDependencies(step.jobId, orgId, visited);
      deps.credentialIds.push(...jobDeps.credentialIds);
      deps.apiSpecIds.push(...jobDeps.apiSpecIds);
      deps.formIds.push(...jobDeps.formIds);
      deps.jobIds.push(...jobDeps.jobIds);

      for (const pid of jobDeps.pipelineIds) {
        deps.pipelineIds.push(pid);
        const pipeDeps = await resolvePipelineDependencies(pid, orgId, visited);
        deps.credentialIds.push(...pipeDeps.credentialIds);
        deps.apiSpecIds.push(...pipeDeps.apiSpecIds);
        deps.formIds.push(...pipeDeps.formIds);
        deps.pipelineIds.push(...pipeDeps.pipelineIds);
        deps.jobIds.push(...pipeDeps.jobIds);
      }
    }
  }

  return deps;
}

async function checkCredentialExists(id: number, orgId: number | null): Promise<boolean> {
  const [c] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);
  return !!c;
}

async function checkApiSpecExists(id: number): Promise<boolean> {
  const [s] = await db
    .select({ id: apiSpecs.id })
    .from(apiSpecs)
    .where(eq(apiSpecs.id, id))
    .limit(1);
  return !!s;
}

async function checkFormExists(id: number): Promise<boolean> {
  const [f] = await db
    .select({ id: hilForms.id })
    .from(hilForms)
    .where(eq(hilForms.id, id))
    .limit(1);
  return !!f;
}

async function checkPipelineExists(id: number, orgId: number | null): Promise<boolean> {
  const [p] = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.id, id), orgId != null ? eq(pipelines.organizationId, orgId) : undefined))
    .limit(1);
  return !!p;
}

async function checkJobExists(id: number, orgId: number | null): Promise<boolean> {
  const [j] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, id), orgId != null ? eq(jobs.organizationId, orgId) : undefined))
    .limit(1);
  return !!j;
}

function inferCredentialType(jobType: string): string | undefined {
  switch (jobType) {
    case "slack_post": return "slack";
    case "email_send": return "smtp";
    case "jira_sync": return "jira";
    case "confluence_sync": return "confluence";
    case "google_drive_sync": return "google_drive";
    case "openapi": return "api_key";
    case "sql_query": return "database";
    case "ai_agent":
    case "ai_api_call":
    case "supervisor":
    case "reranker": return "ai_provider";
    default: return undefined;
  }
}

export const missionDependencyResolver = {
  async validateAndResolve(
    members: MemberInput[],
    organizationId: number | null
  ): Promise<ValidateResult> {
    const resolved: MemberResolution[] = [];
    const missing: MissingDependency[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const orgId = organizationId ?? null;

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const res: MemberResolution = {
        memberIndex: i,
        entityType: m.entityType,
        entityId: m.entityId,
        entityName: "Unknown",
        exists: false,
        dependencies: { credentialIds: [], apiSpecIds: [], formIds: [], pipelineIds: [], jobIds: [] },
        missing: [],
      };

      // Waitlist: no entityId
      if (!m.entityId) {
        blockers.push(`Member "${m.role}": No agent selected. Synthesize or select an existing job.`);
        res.missing.push("entityId missing");
        resolved.push(res);
        continue;
      }

      if (m.entityType === "job") {
        const [job] = await db
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, m.entityId!), orgId != null ? eq(jobs.organizationId, orgId) : undefined))
          .limit(1);

        if (!job) {
          blockers.push(`Member "${m.role}": Job #${m.entityId} not found or belongs to another organization.`);
          res.missing.push(`Job #${m.entityId} not found`);
          resolved.push(res);
          continue;
        }

        res.entityName = job.name;
        res.exists = true;
        res.dependencies = await resolveJobDependencies(m.entityId, orgId);

        for (const cid of res.dependencies.credentialIds) {
          const ok = await checkCredentialExists(cid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "job",
              entityId: m.entityId,
              missingType: "credential",
              refId: cid,
              message: `Job ${job.name} (Role: ${m.role}) requires credential #${cid} (not found)`,
              remediation: {
                action: "create_credential",
                type: (job as any).type ? inferCredentialType((job as any).type) : undefined,
                context: { jobId: job.id, credentialId: cid }
              }
            });
            blockers.push(`Member "${m.role}": Credential #${cid} for job "${job.name}" not found.`);
          }
        }
        for (const sid of res.dependencies.apiSpecIds) {
          const ok = await checkApiSpecExists(sid);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "job",
              entityId: m.entityId,
              missingType: "apiSpec",
              refId: sid,
              message: `Job ${job.name} requires API spec #${sid} (not found)`,
              remediation: {
                action: "configure_api_spec",
                context: { jobId: job.id, specId: sid }
              }
            });
            blockers.push(`Member ${i + 1} (${job.name}): API spec #${sid} not found.`);
          }
        }
        for (const fid of res.dependencies.formIds) {
          const ok = await checkFormExists(fid);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "job",
              entityId: m.entityId,
              missingType: "form",
              refId: fid,
              message: `Job ${job.name} requires form #${fid} (not found)`,
              remediation: {
                action: "create_form",
                context: { jobId: job.id, formId: fid }
              }
            });
            blockers.push(`Member ${i + 1} (${job.name}): Form #${fid} not found.`);
          }
        }
        for (const pid of res.dependencies.pipelineIds) {
          const ok = await checkPipelineExists(pid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "job",
              entityId: m.entityId,
              missingType: "pipeline",
              refId: pid,
              message: `Job ${job.name} references pipeline #${pid} (not found)`,
              remediation: {
                action: "select_pipeline",
                context: { jobId: job.id, pipelineId: pid }
              }
            });
            blockers.push(`Member ${i + 1} (${job.name}): Pipeline #${pid} not found.`);
          }
        }
        for (const jid of res.dependencies.jobIds) {
          const ok = await checkJobExists(jid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "job",
              entityId: m.entityId,
              missingType: "job",
              refId: jid,
              message: `Job ${job.name} references job #${jid} (not found)`,
              remediation: {
                action: "synthesize_agent",
                context: { jobId: job.id, refJobId: jid }
              }
            });
            blockers.push(`Member ${i + 1} (${job.name}): Job #${jid} not found.`);
          }
        }
      } else {
        const [pipeline] = await db
          .select()
          .from(pipelines)
          .where(and(eq(pipelines.id, m.entityId!), orgId != null ? eq(pipelines.organizationId, orgId) : undefined))
          .limit(1);

        if (!pipeline) {
          blockers.push(`Member ${i + 1}: Pipeline #${m.entityId} not found.`);
          res.missing.push(`Pipeline #${m.entityId} not found`);
          resolved.push(res);
          continue;
        }

        res.entityName = pipeline.name;
        res.exists = true;
        res.dependencies = await resolvePipelineDependencies(m.entityId, orgId);

        for (const cid of res.dependencies.credentialIds) {
          const ok = await checkCredentialExists(cid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "pipeline",
              entityId: m.entityId,
              missingType: "credential",
              refId: cid,
              message: `Pipeline ${pipeline.name} requires credential #${cid} (not found)`,
              remediation: {
                action: "create_credential",
                context: { pipelineId: pipeline.id, credentialId: cid }
              }
            });
            blockers.push(`Member ${i + 1} (${pipeline.name}): Credential #${cid} not found.`);
          }
        }
        for (const sid of res.dependencies.apiSpecIds) {
          const ok = await checkApiSpecExists(sid);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "pipeline",
              entityId: m.entityId,
              missingType: "apiSpec",
              refId: sid,
              message: `Pipeline ${pipeline.name} requires API spec #${sid} (not found)`,
              remediation: {
                action: "configure_api_spec",
                context: { pipelineId: pipeline.id, specId: sid }
              }
            });
            blockers.push(`Member ${i + 1} (${pipeline.name}): API spec #${sid} not found.`);
          }
        }
        for (const fid of res.dependencies.formIds) {
          const ok = await checkFormExists(fid);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "pipeline",
              entityId: m.entityId,
              missingType: "form",
              refId: fid,
              message: `Pipeline ${pipeline.name} requires form #${fid} (not found)`,
              remediation: {
                action: "create_form",
                context: { pipelineId: pipeline.id, formId: fid }
              }
            });
            blockers.push(`Member ${i + 1} (${pipeline.name}): Form #${fid} not found.`);
          }
        }
        for (const pid of res.dependencies.pipelineIds) {
          const ok = await checkPipelineExists(pid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "pipeline",
              entityId: m.entityId,
              missingType: "pipeline",
              refId: pid,
              message: `Pipeline ${pipeline.name} references pipeline #${pid} (not found)`,
              remediation: {
                action: "select_pipeline",
                context: { pipelineId: pipeline.id, refPipelineId: pid }
              }
            });
            blockers.push(`Member ${i + 1} (${pipeline.name}): Pipeline #${pid} not found.`);
          }
        }
        for (const jid of res.dependencies.jobIds) {
          const ok = await checkJobExists(jid, orgId);
          if (!ok) {
            missing.push({
              memberIndex: i,
              entityType: "pipeline",
              entityId: m.entityId,
              missingType: "job",
              refId: jid,
              message: `Pipeline ${pipeline.name} references job #${jid} (not found)`,
              remediation: {
                action: "synthesize_agent",
                context: { pipelineId: pipeline.id, jobId: jid }
              }
            });
            blockers.push(`Member ${i + 1} (${pipeline.name}): Job #${jid} not found.`);
          }
        }
      }

      resolved.push(res);
    }

    // Mission readiness: ensure a supervisor pipeline exists so missions can be launched
    const supervisorPipelineExists = await checkSupervisorPipelineExists(orgId);
    if (!supervisorPipelineExists) {
      warnings.push(
        "No supervisor pipeline found. Missions require a pipeline with a Supervisor job to launch. " +
        "One will be created automatically when you create the mission."
      );
    }

    const valid = blockers.length === 0;

    return {
      valid,
      resolved,
      missing,
      warnings,
      blockers,
    };
  },
};

async function checkSupervisorPipelineExists(orgId: number | null): Promise<boolean> {
  const [row] = await db
    .select({ pipelineId: pipelines.id })
    .from(pipelineSteps)
    .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
    .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
    .where(
      and(
        eq(jobs.type, "supervisor"),
        orgId != null
          ? or(eq(pipelines.organizationId, orgId), sql`${pipelines.organizationId} IS NULL`)
          : sql`${pipelines.organizationId} IS NULL`
      )
    )
    .orderBy(asc(pipelines.id))
    .limit(1);
  return !!row;
}

export const dependencySyncService = {
  async sync(): Promise<{ success: boolean; synced: number }> {
    try {
      const rootDir = path.resolve(__dirname, "../../../../");
      const pkgPath = path.join(rootDir, "package.json");
      
      if (!fs.existsSync(pkgPath)) {
        logger.error(`DependencySync: package.json not found at ${pkgPath}`);
        return { success: false, synced: 0 };
      }

      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {})
      };

      // Run npm audit
      logger.info("DependencySync: running npm audit");
      let auditData: any = { vulnerabilities: {} };
      try {
        const auditOutput = execSync("npm audit --json", { cwd: rootDir, encoding: "utf-8" });
        auditData = JSON.parse(auditOutput);
      } catch (error: any) {
        // npm audit exits with non-zero if vulnerabilities are found
        if (error.stdout) {
          try {
            auditData = JSON.parse(error.stdout.toString());
          } catch (e) {
            logger.error("DependencySync: failed to parse audit output", e as Error);
          }
        } else {
          logger.error("DependencySync: npm audit failed", error as Error);
        }
      }

      let syncedCount = 0;
      for (const [name, version] of Object.entries(allDeps)) {
        const vuln = auditData.vulnerabilities[name];
        const alertsCount = vuln ? (Array.isArray(vuln.via) ? vuln.via.length : 1) : 0;
        const details = vuln ? (Array.isArray(vuln.via) ? vuln.via : [vuln]) : [];

        const [existing] = await db.select()
          .from(systemDependencies)
          .where(eq(systemDependencies.name, name))
          .limit(1);

        if (existing) {
          await db.update(systemDependencies)
            .set({
              version: version as string,
              lastSyncedAt: new Date(),
              securityAlertsCount: alertsCount,
              vulnerabilityDetails: details
            })
            .where(eq(systemDependencies.name, name));
        } else {
          await db.insert(systemDependencies)
            .values({
              name,
              version: version as string,
              lastSyncedAt: new Date(),
              securityAlertsCount: alertsCount,
              vulnerabilityDetails: details
            });
        }
        syncedCount++;
      }

      logger.info(`DependencySync: successfully synced ${syncedCount} dependencies and security audits`);
      return { success: true, synced: syncedCount };
    } catch (error) {
      logger.error("DependencySync: sync failed", error as Error);
      return { success: false, synced: 0 };
    }
  }
};


