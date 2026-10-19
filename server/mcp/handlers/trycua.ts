import { successResponse, errorResponse, getOrgContext, createHandlerWrapper, type ToolContext } from "./utils.js";
import {
    CreateTrycuaTaskInput,
    ListTrycuaTasksInput,
    GetTrycuaTaskDetailsInput,
    ConfirmTrycuaTaskInput,
    CancelTrycuaTaskInput,
    RunTrycuaAutonomousLoopInput
} from "../tools/trycua.js";
import { trycuaComputerUseTaskService } from "../../domain/integrations/trycua/computer-use-task.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

function resolveOrgContext(context?: ToolContext): { organizationId: number; userId?: string } {
    const orgContext = getOrgContext(context);
    return {
        organizationId: assertOrgId(orgContext.organizationId),
        userId: orgContext.userId,
    };
}

export const handleCreateTrycuaTask = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateTrycuaTaskInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.createTask({
            sessionId: input.sessionId,
            organizationId: orgId,
            userId: userId ?? "mcp-agent",
            task: input.task,
            requireConfirmation: input.requireConfirmation,
            allowSensitive: input.allowSensitive,
            executeImmediately: input.executeImmediately,
        });

        return successResponse(result, "Created Trycua computer-use task");
    },
    { logExecution: true }
);

export const handleListTrycuaTasks = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListTrycuaTasksInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.listTasks({
            organizationId: orgId,
            userId,
            limit: input.limit,
        });

        return successResponse(result, "Fetched Trycua tasks");
    },
    { logExecution: true }
);

export const handleGetTrycuaTaskDetails = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetTrycuaTaskDetailsInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.getTaskWithSteps(
            input.taskId,
            orgId,
            userId
        );

        return successResponse(result, "Fetched Trycua task details");
    },
    { logExecution: true }
);

export const handleConfirmTrycuaTask = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ConfirmTrycuaTaskInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.confirmTask({
            taskId: input.taskId,
            organizationId: orgId,
            userId,
            allow: input.allow,
            text: input.text,
            clipboardText: input.clipboardText,
        });

        return successResponse(result, "Confirmed Trycua task");
    },
    { logExecution: true }
);

export const handleCancelTrycuaTask = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CancelTrycuaTaskInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.cancelTask(
            input.taskId,
            orgId,
            userId
        );

        return successResponse(result, "Cancelled Trycua task");
    },
    { logExecution: true }
);

export const handleRunTrycuaAutonomousLoop = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = RunTrycuaAutonomousLoopInput.parse(args);
        const { organizationId: orgId, userId } = resolveOrgContext(context);

        const result = await trycuaComputerUseTaskService.runAutonomousLoop(
            input.taskId,
            orgId,
            userId
        );

        return successResponse(result, "Ran Trycua autonomous loop");
    },
    { logExecution: true }
);
