import { type Express, type Request, type Response } from "express";
import * as fs from "fs";
import {
    updateJobSchema
} from "@shared/schema/index.js";
import { assertOrgId, getUserOrgContext } from "@server/utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/index.js";
import { UnauthorizedError, NotFoundError, BadRequestError, ForbiddenError, JobNotFoundError, ValidationError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { jobService, type OrgContext, type UpdateJobInput } from "./job.service.js";
import { getVersions } from "@domain/pipeline/core/version.service.js";
import multer from "multer";
import { SkillImportService } from "./skill-import.service.js";
import { SkillExportService } from "./skill-export.service.js";
import { AuditEvents } from "@domain/audit/index.js";
import { adminService } from "@domain/admin/admin.service.js";
import { jobSynthesisService } from "./job-synthesis.service.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const logger = createLogger('Jobs');

export function registerJobRoutes(app: Express) {
    // --- Jobs ---
    app.get("/api/jobs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;

        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
        const includeDrafts = req.query.includeDrafts === 'true';
        const search = req.query.search as string | undefined;

        const result = await jobService.list(
            orgContext,
            {
                includeDrafts,
                includeHidden: false,
                limit,
                offset,
                search
            }
        );


        logger.debug(`Returning ${result.items.length} jobs (Total: ${result.total})`, {
            correlationId: req.correlationId,
            organizationId: orgContext.organizationId,
            count: result.items.length,
            total: result.total
        });
        res.json(result);
    }));

    app.post("/api/jobs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const userId = (req.session as any)?.userId;
        if (!userId) {
            throw new UnauthorizedError("Not authenticated");
        }

        const orgContext = await getUserOrgContext(req);

        logger.info('Creating job', {
            correlationId: req.correlationId,
            name: req.body.name,
            type: req.body.type,
            organizationId: orgContext.organizationId,
        });

        const job = await jobService.create(req.body, orgContext);
        res.status(201).json(job);
    }));

    app.get("/api/jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        const job = await jobService.getById(jobId, orgContext);
        res.json(job);
    }));

    app.put("/api/jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        const updatedJob = await jobService.update(jobId, req.body, orgContext);
        res.json(updatedJob);
    }));

    app.patch("/api/jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        logger.debug('Updating job', {
            correlationId: req.correlationId,
            jobId,
            hasConfig: !!req.body.config,
            configKeys: req.body.config && typeof req.body.config === 'object' ? Object.keys(req.body.config) : [],
        });

        // Validate request body against schema
        const validation = updateJobSchema.safeParse(req.body);
        if (!validation.success) {
            throw new ValidationError('Validation failed', validation.error.issues);
        }

        const updateData: UpdateJobInput = {
            ...validation.data,
            isActive: validation.data.isActive ?? undefined
        };

        const updatedJob = await jobService.update(jobId, updateData, orgContext);

        logger.info('Job updated', { correlationId: req.correlationId, jobId });
        res.json(updatedJob);
    }));

    // Internal endpoint for runner to store job outputs (no auth required, but should be localhost only)
    // Internal endpoint for runner to store job outputs (no auth required, but should be localhost only)
    app.post("/api/jobs/:id/store-output", asyncHandler(async (req: Request, res: Response) => {
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID");
        }

        const { output, status, workQueueItemId } = req.body;

        if (!output || typeof output !== 'string') {
            throw new BadRequestError("Output is required and must be a string");
        }

        const result = await jobService.storeOutput(jobId, output, status);

        if (!result.stored) {
            return res.status(200).json({ message: result.message });
        }

        res.json({ message: result.message });
    }));

    app.delete("/api/jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        await jobService.delete(jobId, orgContext);
        res.status(204).send();
    }));

    app.post("/api/jobs/bulk-delete", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const { jobIds } = req.body;

        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            throw new BadRequestError("jobIds array is required");
        }

        const result = await jobService.bulkDelete(jobIds, orgContext);
        res.json(result);
    }));

    app.post("/api/jobs/bulk-update", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const { jobIds, data } = req.body;

        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            throw new BadRequestError("jobIds array is required");
        }

        if (!data || typeof data !== 'object') {
            throw new BadRequestError("Update data is required");
        }

        const result = await jobService.bulkUpdate(jobIds, data, orgContext);
        res.json(result);
    }));

    app.post("/api/jobs/:id/copy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;

        if (!userId) {
            throw new UnauthorizedError("Not authenticated");
        }

        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        const newJob = await jobService.copy(jobId, orgContext);
        res.json(newJob);
    }));

    app.get("/api/jobs/:id/pipeline-status", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }

        const pipelineList = await jobService.getPipelineStatus(jobId, orgContext);
        res.json(pipelineList);
    }));

    app.post("/api/jobs/bulk/pipeline-status", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const { jobIds } = req.body;

        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            throw new BadRequestError("jobIds array is required");
        }

        const results = await jobService.getBulkPipelineStatus(jobIds, orgContext);
        res.json(results);
    }));

    // ============================================================================
    // JOB DEPENDENCY ENDPOINTS
    // ============================================================================

    app.post("/api/jobs/:id/dependencies", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);
        const { dependsOnJobId, type } = req.body;

        if (isNaN(jobId) || typeof dependsOnJobId !== 'number') {
            throw new BadRequestError("Invalid job IDs provided");
        }

        // Verify access to both jobs
        await jobService.getById(jobId, orgContext);
        await jobService.getById(dependsOnJobId, orgContext);

        const { jobDependencyService } = await import("./core/job-dependency.service.js");
        
        // Check for circular dependency
        const isCircular = await jobDependencyService.detectCircularDependency(jobId, dependsOnJobId);
        if (isCircular) {
            throw new BadRequestError('Circular dependency detected');
        }

        await jobDependencyService.addDependency({
            jobId,
            dependsOnJobId,
            dependencyType: type || 'hard',
            organizationId: orgContext.organizationId || undefined,
        });

        res.json({ success: true });
    }));

    app.get("/api/jobs/:id/dependencies", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);

        await jobService.getById(jobId, orgContext);

        const { jobDependencyService } = await import("./core/job-dependency.service.js");
        const dependencies = await jobDependencyService.getDependencies(jobId);
        res.json(dependencies);
    }));

    // ============================================================================
    // CONFIGURATION VALIDATION ENDPOINTS
    // ============================================================================

    app.post("/api/jobs/validate-config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const { type, config } = req.body;
        
        if (!type || !config) {
            throw new BadRequestError("Type and config are required");
        }
        
        const { configValidationService } = await import("./core/config-validation.service.js");
        const validation = configValidationService.validate(type, config);
        
        res.json(validation);
    }));

    app.post("/api/jobs/:id/validate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);
        const userId = (req.session as any)?.userId;

        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID");
        }

        const job = await jobService.getById(jobId, orgContext);
        
        const config = typeof job.config === 'string' 
            ? JSON.parse(job.config) 
            : job.config;
        
        const { configValidationService } = await import("./core/config-validation.service.js");
        const validation = configValidationService.validate(job.type, config);
        
        res.json(validation);
    }));

    // ============================================================================
    // VERSION CONTROL ENDPOINTS
    // ============================================================================

    // List versions for a job
    app.get("/api/jobs/:id/versions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);

        // Verify job exists and user has access
        await jobService.getById(jobId, orgContext);

        const { rollbackToVersion } = await import("@domain/pipeline/core/version.service.js");
        const versions = await getVersions("job", jobId);
        res.json(versions);
    }));

    // Get specific version
    app.get("/api/jobs/:id/versions/:version", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);
        const version = parseInt(req.params.version);

        await jobService.getById(jobId, orgContext);

        const { getVersion } = await import("@domain/pipeline/core/version.service.js");
        const versionData = await getVersion("job", jobId, version);

        if (!versionData) {
            throw new NotFoundError(`Version ${version} not found`);
        }
        res.json(versionData);
    }));

    // Rollback to version
    app.post("/api/jobs/:id/rollback/:version", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const jobId = parseInt(req.params.id);
        const version = parseInt(req.params.version);

        // Verify access
        await jobService.getById(jobId, orgContext);

        const { rollbackToVersion } = await import("@domain/pipeline/core/version.service.js");
        const snapshot = await rollbackToVersion("job", jobId, version, {
            userId,
            organizationId: orgContext.organizationId ?? undefined,
        });

        logger.info("Job rolled back", { jobId, version });
        res.json({ message: `Rolled back to version ${version}`, snapshot });
    }));

    // Compare two versions
    app.get("/api/jobs/:id/versions/diff", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);
        const v1 = parseInt(req.query.v1 as string);
        const v2 = parseInt(req.query.v2 as string);

        if (isNaN(v1) || isNaN(v2)) {
            throw new BadRequestError("v1 and v2 query params required");
        }

        await jobService.getById(jobId, orgContext);

        const { diffVersions } = await import("@domain/pipeline/core/version.service.js");
        const diff = await diffVersions("job", jobId, v1, v2);
        res.json(diff);
    }));

    // ============================================================================
    // EXECUTION HISTORY ENDPOINTS
    // ============================================================================

    // Get recent executions for a job
    // Get recent executions for a job
    app.get("/api/jobs/:id/executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);
        if (isNaN(jobId)) {
            throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);
        }
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

        const executions = await jobService.getJobExecutions(jobId, limit, orgContext);
        res.json(executions);
    }));

    // ============================================================================
    // IMPACT ANALYSIS ENDPOINTS
    // ============================================================================

    // Get job impact analysis
    app.get("/api/jobs/:id/impact", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const jobId = parseInt(req.params.id);

        // Verify access via getById
        await jobService.getById(jobId, orgContext);

        const { lineageService } = await import("@domain/pipeline/core/lineage.service.js");
        const impact = await lineageService.getJobImpact(jobId);
        res.json(impact);
    }));

    // ============================================================================
    // SKILL IMPORT ENDPOINTS
    // ============================================================================

    // POST /api/jobs/import/analyze - Analyze a skill file/zip
    app.post("/api/jobs/import/analyze", requireAuth, upload.single("file"), asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        // Governance Check
        const settings = await adminService.getOrgSettings(assertOrgId(orgContext.organizationId));
        if (!settings.skillImportEnabled) {
            throw new ForbiddenError("Skill import is disabled for this organization");
        }

        // RBAC Check (Disallow for regular users by default unless Super Admin or explicitly permitted in future)
        if (!orgContext.isAdmin && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("You do not have permission to import skills");
        }

        const organizationId = assertOrgId(orgContext.organizationId);
        const file = req.file;

        if (!file) {
            throw new BadRequestError("No file provided");
        }

        const analyzedSkills = await SkillImportService.analyze(file.buffer, file.originalname, organizationId);
        res.json({ skills: analyzedSkills });
    }));

    // POST /api/jobs/import/analyze-url - Analyze a skill from a URL
    app.post("/api/jobs/import/analyze-url", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        // Governance Check
        const settings = await adminService.getOrgSettings(assertOrgId(orgContext.organizationId));
        if (!settings.skillImportEnabled) {
            throw new ForbiddenError("Skill import is disabled for this organization");
        }

        // RBAC Check
        if (!orgContext.isAdmin && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("You do not have permission to import skills");
        }

        const organizationId = assertOrgId(orgContext.organizationId);
        const { url } = req.body;

        if (!url) {
            throw new BadRequestError("URL is required");
        }

        const analyzedSkills = await SkillImportService.analyzeUrl(url, organizationId);
        res.json({ skills: analyzedSkills });
    }));

    app.get("/api/jobs/import/discover", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        // Governance Check
        const settings = await adminService.getOrgSettings(assertOrgId(orgContext.organizationId));
        if (!settings.skillImportEnabled) {
            throw new ForbiddenError("Skill import is disabled for this organization");
        }

        const query = req.query.q as string | undefined;
        const skills = await SkillImportService.discoverSkills(query);
        res.json({ skills });
    }));

    // GET /api/jobs/:id/export/openai - Export agent as OpenAI package
    app.get("/api/jobs/:id/export/openai", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = parseInt(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;

        const job = await jobService.getById(id, orgContext);

        if (job.type !== "ai_agent") throw new BadRequestError("Only AI Agents can be exported.");

        const buffer = await SkillExportService.exportAsOpenAI(job);

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${job.name.toLowerCase().replace(/ /g, "_")}_openai.zip"`);
        res.send(buffer);
    }));

    // GET /api/jobs/:id/export - Export agent as OpenClaw bundle
    app.get("/api/jobs/:id/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = parseInt(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;

        const job = await jobService.getById(id, orgContext);

        if (job.type !== "ai_agent") throw new BadRequestError("Only AI Agents can be exported.");

        const buffer = await SkillExportService.exportAsOpenClaw(job);

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${job.name.toLowerCase().replace(/ /g, "_")}_openclaw.zip"`);
        res.send(buffer);
    }));

    // POST /api/jobs/confirm-skill-import - Confirm import and create job
    app.post("/api/jobs/confirm-skill-import", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const userId = (req.session as any)?.userId;
        const orgContext = await getUserOrgContext(req);

        // Governance Check
        const settings = await adminService.getOrgSettings(assertOrgId(orgContext.organizationId));
        if (!settings.skillImportEnabled) {
            throw new ForbiddenError("Skill import is disabled for this organization");
        }

        // RBAC Check
        if (!orgContext.isAdmin && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("You do not have permission to import skills");
        }

        const organizationId = orgContext.organizationId;

        const { skill, extractedJobs } = req.body;
        console.log(`[IMPORT_CONFIRM] Inbound request for skill: ${skill?.name || 'unknown'}. Jobs: ${extractedJobs?.length || 0}`);
        
        if (!skill) {
            console.error("[IMPORT_CONFIRM] Error: Skill data is required but was missing in the payload.");
            throw new BadRequestError("Skill data is required");
        }

        try {
            console.log(`[IMPORT_CONFIRM] Starting confirmation logic for userId: ${userId}, orgId: ${assertOrgId(organizationId)}`);
            const job = await SkillImportService.confirmImport(
                skill,
                extractedJobs,
                assertOrgId(organizationId),
                userId
            );
            console.log(`[IMPORT_CONFIRM] Successfully created job with ID: ${job?.id}`);
            res.json(job);
        } catch (error: any) {
            console.error(`[IMPORT_CONFIRM] CRITICAL FAILURE: ${error.message}`);
            if (error.stack) console.error(error.stack);
            
            res.status(error.statusCode || 500).json({ 
                success: false, 
                error: { 
                    message: error.message || "Internal server error during skill confirmation",
                    code: error.code || "IMPORT_ERROR"
                } 
            });

            // Integrate with Incident Triage System
            try {
                const { errorDiagnosisEngine } = await import("@domain/diagnostics/index.js");
                await errorDiagnosisEngine.diagnose({
                    error,
                    httpStatus: 500,
                    requestUrl: req.originalUrl,
                    jobType: "skill_import",
                    organizationId: assertOrgId(organizationId)
                });
            } catch (diagErr) {
                logger.error("Failed to log diagnostic for skill import failure", diagErr);
            }
            throw error; // Rethrow for global async handler
        }
    }));

    // --- Job Synthesis ---
    app.post("/api/jobs/synthesize", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const userId = (req.session as any)?.userId;
        const orgContext = await getUserOrgContext(req);
        const { role, context, suggestedConfig } = req.body;

        if (!role) {
            throw new BadRequestError("Role description is required for synthesis");
        }

        try {
            const job = await jobSynthesisService.synthesizeJob(
                role,
                assertOrgId(orgContext.organizationId),
                userId,
                context,
                suggestedConfig
            );
            res.json(job);
        } catch (error: any) {
            // Integrate with Incident Triage System
            try {
                const { errorDiagnosisEngine } = await import("@domain/diagnostics/index.js");
                await errorDiagnosisEngine.diagnose({
                    error,
                    httpStatus: 500,
                    requestUrl: req.originalUrl,
                    jobType: "job_synthesis",
                    organizationId: assertOrgId(orgContext.organizationId)
                });
            } catch (diagErr) {
                logger.error("Failed to log diagnostic for job synthesis failure", diagErr);
            }
            throw error;
        }
    }));

    // --- Transformation Test Harness ---
    app.post("/api/jobs/test-transformation", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const { inputData, rules } = req.body;

        if (!inputData || !rules) {
            throw new BadRequestError("inputData and rules are required");
        }

        try {
            const { TransformationEngine } = await import("@domain/pipeline/core/transformation-engine.service.js");
            const engine = new TransformationEngine();

            const config = { rules, inputSource: "provided" as const };
            const result = engine.executeTransformations(inputData, config, { inputData });

            res.json({ success: true, output: result });
        } catch (error: any) {
            logger.error("Transformation test failed", { error: error.message });
            res.status(400).json({ 
                success: false, 
                error: error.message || "Transformation failed" 
            });
        }
    }));
}


