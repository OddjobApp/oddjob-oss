import { requireToolOrgId } from "../../domain/tools/v1/capabilities/org-context.js";
import { agentMailService } from "../../domain/integrations/core/agentmail.service.js";
import { AgentMailSendInput, AgentMailListThreadsInput, AgentMailGetThreadInput } from "../tools/agentmail.js";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";

export async function handleAgentMailSend(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailSendInput.parse(args);
        const mail = await agentMailService.forOrg(requireToolOrgId(context));
        const result = await mail.send(input);
        return successResponse(result, `Email sent to ${input.to.join(", ")} (thread: ${result.thread_id})`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailListThreads(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailListThreadsInput.parse(args ?? {});
        const mail = await agentMailService.forOrg(requireToolOrgId(context));
        const result = await mail.listThreads(input.limit);
        return successResponse(result, `Found ${result.count} thread(s)`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailGetThread(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailGetThreadInput.parse(args);
        const mail = await agentMailService.forOrg(requireToolOrgId(context));
        const result = await mail.getThread(input.thread_id);
        return successResponse(result, `Thread ${input.thread_id} retrieved`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
