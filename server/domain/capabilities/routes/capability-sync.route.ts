/**
 * Capability Sync HTTP API (ACDD bi-directional engine)
 * =====================================================
 *
 * Org-scoped surface for driving the two pipelines and inspecting sync state.
 * The org is always resolved from the session, never a request parameter.
 *
 *   POST /api/capabilities/sync/code-to-docs   body: { manifest }        (Path A)
 *   POST /api/capabilities/sync/docs-to-code   body: { path? | dir? }    (Path B)
 *   GET  /api/capabilities/sync/status                                    (overview)
 *
 * By default work is ENQUEUED onto the capability-sync fleet. Pass `?inline=true`
 * (or `{ inline: true }`) to run synchronously and get the result in the
 * response — handy for demos/CI where no worker/Redis is running.
 */

import { Router } from "express";
import { eq, desc } from "drizzle-orm";

import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { assertOrgId, getUserOrgContext, requireOrgAdminOrSuper } from "@server/utils/auth-context.js";
import { db } from "@server/database_service.js";
import { capabilitySyncState, safeParseCapabilityManifest } from "@shared/schema/capabilities/index.js";
import {
    enqueueCodeToDocs,
    enqueueDocsToCodeFile,
    enqueueDocsToCodeFolder,
} from "../infrastructure/capability-sync-queue.js";
import { codeToDocsPipeline } from "../core/code-to-docs.pipeline.js";
import { docsToCodePipeline } from "../core/docs-to-code.pipeline.js";
import { capabilitySyncStateService } from "../core/capability-sync-state.service.js";

const capabilitySyncRouter = Router();

async function orgIdOf(req: any): Promise<number> {
    const ctx = await getUserOrgContext(req);
    return assertOrgId(ctx.organizationId);
}

function wantsInline(req: any): boolean {
    return req.query?.inline === "true" || req.body?.inline === true;
}

// Path A: compile + commit docs for a manifest.
capabilitySyncRouter.post(
    "/code-to-docs",
    requireAuth,
    requireOrgAdminOrSuper,
    asyncHandler(async (req: any, res: any) => {
        const organizationId = await orgIdOf(req);
        const parsed = safeParseCapabilityManifest(req.body?.manifest ?? req.body);
        if (!parsed.success) {
            return res.status(422).json({ error: "invalid manifest", issues: parsed.error.issues });
        }
        if (wantsInline(req)) {
            const result = await codeToDocsPipeline.run(organizationId, parsed.data);
            return res.json({ mode: "inline", result });
        }
        const job = await enqueueCodeToDocs(organizationId, parsed.data);
        return res.json({ mode: "queued", jobId: job.id, capabilityId: parsed.data.capability_id });
    }),
);

// Path B: ingest a Markdown file or a whole docs folder back into the router.
capabilitySyncRouter.post(
    "/docs-to-code",
    requireAuth,
    requireOrgAdminOrSuper,
    asyncHandler(async (req: any, res: any) => {
        const organizationId = await orgIdOf(req);
        const filePath = typeof req.body?.path === "string" ? req.body.path : undefined;
        const dir = typeof req.body?.dir === "string" ? req.body.dir : undefined;

        if (wantsInline(req)) {
            const result = filePath
                ? await docsToCodePipeline.ingestFile(organizationId, filePath)
                : await docsToCodePipeline.ingestFolder(organizationId, dir);
            return res.json({ mode: "inline", result });
        }
        const job = filePath
            ? await enqueueDocsToCodeFile(organizationId, filePath)
            : await enqueueDocsToCodeFolder(organizationId, dir);
        return res.json({ mode: "queued", jobId: job.id, target: filePath ?? dir ?? "(default docs dir)" });
    }),
);

// Overview: what the reconciler has recorded for this org.
capabilitySyncRouter.get(
    "/status",
    requireAuth,
    asyncHandler(async (req: any, res: any) => {
        const organizationId = await orgIdOf(req);
        const rows = await capabilitySyncStateService.listForOrg(organizationId);

        return res.json({
            organizationId,
            trackedCapabilities: rows.length,
            capabilities: rows,
        });
    }),
);

export default capabilitySyncRouter;
