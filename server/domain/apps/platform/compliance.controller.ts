import { type Request, type Response } from "express";
import { BadRequestError } from "@server/utils/errors.js";
import { hilRequests } from "@domain/pipeline/core/hil-requests.service.js";
import { ComplianceSentinelService } from "./compliance-sentinel.service.js";

function serviceFor(req: Request) {
    const { orgId, appId, deploymentId } = req.appTokenContext!;
    return new ComplianceSentinelService(undefined, async ({ prompt, context }) => {
        const form = await hilRequests.create({
            source: "app",
            name: "Compliance Sentinel remediation review",
            description: prompt,
            organizationId: orgId,
            schema: {
                fields: [{ key: "response", type: "text", label: "Decision and rationale", required: true }],
                sourceType: "app",
                sourceId: String(deploymentId),
                sourceLabel: "Compliance Sentinel",
                context: { ...context, appId },
            },
        });
        return String(form.id);
    });
}

export class ComplianceController {
    static async evidence(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        res.json(await serviceFor(req).collectEvidence({ organizationId: orgId, agentId: appId }));
    }

    static async simulate(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        if (!req.body?.scenarioId || !req.body?.name || !req.body?.proposedAction || !req.body?.targetFramework) {
            throw new BadRequestError("scenarioId, name, targetFramework, and proposedAction are required");
        }
        res.status(201).json(await serviceFor(req).simulate(req.body, { organizationId: orgId, agentId: appId }));
    }
}
