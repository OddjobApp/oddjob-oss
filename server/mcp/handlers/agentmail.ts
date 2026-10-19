import { agentMailService } from "../../domain/integrations/core/agentmail.service.js";
import { AgentMailSendInput, AgentMailListThreadsInput, AgentMailGetThreadInput } from "../tools/agentmail.js";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";

export async function handleAgentMailSend(args: unknown, _context?: ToolContext) {
    try {
        const input = AgentMailSendInput.parse(args);
        if (!agentMailService.isConfigured()) {
            return errorResponse("AgentMail is not configured. Set AGENTMAIL_API_KEY in environment.");
        }
        const result = await agentMailService.send(input);
        return successResponse(result, `Email sent to ${input.to.join(", ")} (thread: ${result.thread_id})`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailListThreads(args: unknown, _context?: ToolContext) {
    try {
        const input = AgentMailListThreadsInput.parse(args ?? {});
        if (!agentMailService.isConfigured()) {
            return errorResponse("AgentMail is not configured. Set AGENTMAIL_API_KEY in environment.");
        }
        const result = await agentMailService.listThreads(input.limit);
        return successResponse(result, `Found ${result.count} thread(s)`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

export async function handleAgentMailGetThread(args: unknown, _context?: ToolContext) {
    try {
        const input = AgentMailGetThreadInput.parse(args);
        if (!agentMailService.isConfigured()) {
            return errorResponse("AgentMail is not configured. Set AGENTMAIL_API_KEY in environment.");
        }
        const result = await agentMailService.getThread(input.thread_id);
        return successResponse(result, `Thread ${input.thread_id} retrieved`);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
