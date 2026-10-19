import {
    ListJobsInput,
    GetJobDetailsInput,
    CreateJobInput,
    UpdateJobInput,
    DeleteJobInput,
} from "../tools/jobs.js";
import { jobService } from "../../domain/jobs/job.service.js";
import {
    successResponse,
    getOrgContext,
    createHandlerWrapper,
    type ToolContext
} from "./utils.js";
import type { Job } from "@shared/schema/index.js";

// Type for job list item response
interface JobListItem {
    id: number;
    name: string;
    type: string;
    description: string | null;
    isActive: boolean;
}

// Type for job details response
interface JobDetails extends JobListItem {
    config: Record<string, unknown>;
    outputDatasetId: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export const handleListJobs = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListJobsInput.parse(args);
        const orgContext = getOrgContext(context);

        const result = await jobService.list(orgContext, {
            type: input.type,
            limit: input.limit
        });
        let jobList = result.items;

        if (input.search) {
            const searchLower = input.search.toLowerCase();
            jobList = jobList.filter(
                j => j.name.toLowerCase().includes(searchLower) ||
                    (j.description && j.description.toLowerCase().includes(searchLower))
            );
        }

        return successResponse(
            jobList.map((j): JobListItem => ({
                id: j.id,
                name: j.name,
                type: j.type,
                description: j.description,
                isActive: j.isActive ?? false,
            })),
            `Found ${jobList.length} jobs`
        );
    }
);

export const handleGetJobDetails = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetJobDetailsInput.parse(args);
        const orgContext = getOrgContext(context);

        let job: Job | null = null;

        if (input.jobId) {
            job = await jobService.getById(input.jobId, orgContext);
        } else if (input.jobName) {
            const results = await jobService.list(orgContext, { limit: 10 });
            job = results.items.find(j => j.name.toLowerCase().includes(input.jobName!.toLowerCase())) || null;
        }

        if (!job) {
            throw new Error("Job not found");
        }

        const response: JobDetails = {
            id: job.id,
            name: job.name,
            type: job.type,
            description: job.description,
            config: job.config as Record<string, unknown>,
            isActive: job.isActive ?? false,
            // Surface the current output-dataset routing so the agent can see
            // whether a job writes to a dataset (and verify its own update_job
            // writes). Without this the agent can't tell the field exists.
            outputDatasetId: job.outputDatasetId ?? null,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        };

        return successResponse(response);
    }
);

export const handleCreateJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateJobInput.parse(args);
        const orgContext = getOrgContext(context);

        const newJob = await jobService.create({
            ...input,
            description: input.description || null,
            config: input.config || {},
            isActive: true
        }, orgContext);

        return successResponse(
            {
                id: newJob.id,
                name: newJob.name,
                type: newJob.type,
                description: newJob.description,
            },
            `Created new ${input.type} job: "${input.name}" (ID: ${newJob.id})`
        );
    },
    { requireAdmin: true }
);

export const handleUpdateJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateJobInput.parse(args);
        const orgContext = getOrgContext(context);

        const updatedJob = await jobService.update(input.jobId, input, orgContext);

        return successResponse(
            {
                id: updatedJob.id,
                name: updatedJob.name,
                isActive: updatedJob.isActive,
            },
            `Updated job "${updatedJob.name}" (ID: ${updatedJob.id})`
        );
    },
    { requireAdmin: true }
);

export const handleDeleteJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = DeleteJobInput.parse(args);
        const orgContext = getOrgContext(context);

        const job = await jobService.getById(input.jobId, orgContext);
        await jobService.delete(input.jobId, orgContext);

        return successResponse(
            { id: input.jobId, deleted: true },
            `Deleted job "${job.name}" (ID: ${input.jobId})`
        );
    },
    { requireAdmin: true }
);

