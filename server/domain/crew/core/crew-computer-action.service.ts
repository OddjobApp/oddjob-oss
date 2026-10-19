import type { AgentCardRecord } from "@shared/schema/index.js";
import type { RoundContext } from "./crew-round-context.js";
import { postTurn } from "./crew-form-studio.service.js";
import { trycuaService } from "@domain/integrations/trycua/trycua-service.js";
import { trycuaComputerUseTaskService } from "@domain/integrations/trycua/computer-use-task.service.js";

/** Explicit desktop commands are user actions, independent of the room's agent tools. */
export function isComputerCommand(message: string): boolean {
    const text = message.trim();
    if (/\b(?:don't|do not|discuss|explain|plan|how to|how do|how would)\b/i.test(text)) return false;
    return /^(?:please\s+)?(?:use|using)\s+(?:the\s+)?(?:computer|desktop|browser)(?:\s+use)?\s+to\s+\S/i.test(text)
        || /^(?:please\s+)?open\s+(?:the\s+)?(?:(?:firefox|chrome|chromium)\s+)?browser\b/i.test(text)
        || /^(?:please\s+)?(?:open|navigate to|visit)\s+\S+[\s\S]*\bin\s+(?:the\s+)?(?:browser|computer|desktop)\b/i.test(text);
}

export function isActiveStudioWebCommand(message: string): boolean {
    const text = message.trim();
    if (/\b(?:don't|do not|discuss|explain|plan|how to|how do|how would)\b/i.test(text)) return false;
    return /^(?:please\s+)?(?:open|navigate(?:\s+to)?|visit|browse|search|find|look\s+up|go\s+to)\b/i.test(text)
        && /\b(?:https?:\/\/|www\.|website|web|site|page|article|browser|\.com\b|\.org\b|\.net\b|\.io\b)/i.test(text);
}

export async function runDirectComputerAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    const shouldRun = isComputerCommand(ctx.message)
        || (ctx.computerUseStudioActive && isActiveStudioWebCommand(ctx.message));
    if (!card || !shouldRun) return false;
    const started = Date.now();
    try {
        if (!ctx.userId) throw new Error("Sign in to run a computer task.");
        const sessions = await trycuaService.listSessions(ctx.orgId, ctx.userId);
        const session = sessions.find(s => s.status === "active" && new Date(s.expiresAt).getTime() > Date.now())
            ?? await trycuaService.createSession({ organizationId: ctx.orgId, userId: ctx.userId, requestedOs: "linux" });
        const { task } = await trycuaComputerUseTaskService.createTask({
            organizationId: ctx.orgId, userId: ctx.userId, sessionId: session.id,
            task: ctx.message, requireConfirmation: false, executeImmediately: false,
        });
        ctx.cost.toolCalls++;
        await postTurn(ctx, card, {
            content: "Running your command on the desktop. You can watch it in Computer Use Studio.",
            artifact: { tool: "trycua_run_task", payload: {
                type: "assistant_app", module: "ComputerUseStudioPod", title: "Computer Use Studio",
                props: { sessionId: session.id, taskId: task.id },
            } },
        });
        const completed = await trycuaComputerUseTaskService.runAutonomousLoop(task.id, ctx.orgId, ctx.userId);
        const result = completed.task.result as { summary?: string; pending?: { explanation?: string } } | null;
        const ok = completed.task.status === "succeeded";
        await postTurn(ctx, card, {
            content: result?.summary || completed.task.error || result?.pending?.explanation || `Computer task: ${completed.task.status}. See the task steps in the studio.`,
            record: { name: "trycua_run_task", ok, ms: Date.now() - started },
        });
    } catch (error) {
        await postTurn(ctx, card, {
            content: `The computer command did not complete: ${error instanceof Error ? error.message : String(error)}`,
            record: { name: "trycua_run_task", ok: false, ms: Date.now() - started },
        });
    }
    return true;
}
