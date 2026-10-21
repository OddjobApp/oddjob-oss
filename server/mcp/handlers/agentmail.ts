import { requireToolOrgId } from "../../domain/tools/v1/capabilities/org-context.js";
import { agentMailService } from "../../domain/integrations/core/agentmail.service.js";
import { AgentMailSendInput, AgentMailListThreadsInput, AgentMailGetThreadInput } from "../tools/agentmail.js";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";
import { agentMailThreadScope, threadScopeCtx } from "../../domain/integrations/core/agentmail-thread-scope.service.js";

export async function handleAgentMailSend(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailSendInput.parse(args);
        const orgId = requireToolOrgId(context);
        if (input.thread_id) await agentMailThreadScope.assertReadable(threadScopeCtx(context, orgId), input.thread_id);
        const mail = await agentMailService.forOrg(orgId);
        const result = await mail.send(input);
        return successResponse(result, `Email sent to ${input.to.join(", ")} (thread: ${result.thread_id})`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailListThreads(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailListThreadsInput.parse(args ?? {});
        const orgId = requireToolOrgId(context);
        const mail = await agentMailService.forOrg(orgId);
        const result = await mail.listThreads(input.limit);
        const threads = await agentMailThreadScope.filterThreads(threadScopeCtx(context, orgId), result.threads ?? []);
        return successResponse({ ...result, count: threads.length, threads }, `Found ${threads.length} thread(s)`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailGetThread(args: unknown, context?: ToolContext) {
    try {
        const input = AgentMailGetThreadInput.parse(args);
        const orgId = requireToolOrgId(context);
        await agentMailThreadScope.assertReadable(threadScopeCtx(context, orgId), input.thread_id);
        const mail = await agentMailService.forOrg(orgId);
        const result = await mail.getThread(input.thread_id);
        return successResponse(result, `Thread ${input.thread_id} retrieved`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
