import { z } from "zod";
import { OrgContext } from "../../utils/auth-context.js";
import { McpPermission } from "@shared/schema/index.js";
import { createLogger } from "../../utils/logger.js";

// Create logger for MCP handlers
const logger = createLogger("MCP:Handlers");

// ============================================================================
// Types
// ============================================================================

import type { ToolContext } from "../../domain/tools/v1/capabilities/types.js";
export type { ToolContext };

export type ToolHandler<TArgs = unknown, TResult = unknown> = (
    args: TArgs,
    context?: ToolContext
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

export interface HandlerWrapperOptions {
    /** Log handler execution */
    logExecution?: boolean;
    /** Require admin access */
    requireAdmin?: boolean;
    /** Require org admin or higher */
    requireOrgAdmin?: boolean;
    /** Require super admin */
    requireSuperAdmin?: boolean;
    /** Custom permission check */
    permissionCheck?: (context: ToolContext) => boolean | string;
}

// ============================================================================
// Core Utilities
// ============================================================================

const getOrgId = (): number => {
    return parseInt(process.env.ODDJOB_ORG_ID || "1", 10);
};

export function getOrgContext(context?: ToolContext): OrgContext {
    return {
        organizationId: context?.organizationId ?? getOrgId(),
        userId: context?.userId ?? 'mcp-server',
        isAdmin: context?.isAdmin ?? false,
        isOrgAdmin: context?.isOrgAdmin ?? false,
        isSuperAdmin: context?.isSuperAdmin ?? false
    };
}

export function successResponse(data: unknown, summary?: string) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(
                    {
                        success: true,
                        summary,
                        data,
                    },
                    null,
                    2
                ),
            },
        ],
    };
}


export function errorResponse(error: string) {
    return {
        isError: true,
        content: [
            {
                type: "text" as const,
                text: JSON.stringify({ success: false, error }, null, 2),
            },
        ],
    };
}


// ============================================================================
// Handler Wrapper - Consistent error handling for all handlers
// ============================================================================

/**
 * Create a wrapped handler with consistent error handling
 * 
 * @example
 * ```typescript
 * const handleListPipelines = createHandlerWrapper(
 *   async (args: { limit?: number }, context) => {
 *     const pipelines = await pipelineService.list(getOrgContext(context), args.limit);
 *     return successResponse(pipelines, `Found ${pipelines.length} pipelines`);
 *   },
 *   { logExecution: true }
 * );
 * ```
 */
export function createHandlerWrapper<TArgs = unknown>(
    handler: ToolHandler<TArgs>,
    options: HandlerWrapperOptions = {}
): ToolHandler<TArgs> {
    return async (args: TArgs, context?: ToolContext) => {
        const { logExecution, requireAdmin, requireOrgAdmin, requireSuperAdmin, permissionCheck } = options;
        const startTime = Date.now();

        try {
            // Permission checks with logging
            if (requireSuperAdmin && !context?.isSuperAdmin) {
                logger.warn("Access denied: Super admin required", {
                    context: { userId: context?.userId, required: 'superAdmin' }
                });
                return errorResponse("Super admin access required");
            }

            if (requireAdmin && !context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                logger.warn("Access denied: Admin required", {
                    context: { userId: context?.userId, required: 'admin' }
                });
                return errorResponse("Admin access required");
            }

            if (requireOrgAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                logger.warn("Access denied: Org admin required", {
                    context: { userId: context?.userId, required: 'orgAdmin' }
                });
                return errorResponse("Organization admin access required");
            }

            if (permissionCheck) {
                const result = permissionCheck(context || { named: {}, positional: {} } as ToolContext);
                if (typeof result === 'string') {
                    logger.warn("Custom permission check failed", {
                        context: { userId: context?.userId, error: result }
                    });
                    return errorResponse(result);
                }
                if (!result) {
                    logger.warn("Custom permission check denied", {
                        context: { userId: context?.userId }
                    });
                    return errorResponse("Permission denied");
                }
            }

            // Log execution if enabled
            if (logExecution) {
                logger.debug("Handler executing", {
                    context: {
                        args: JSON.stringify(args).slice(0, 200),
                        userId: context?.userId,
                        orgId: context?.organizationId
                    }
                });
            }

            // Execute handler
            const result = await handler(args, context);

            // Log success with duration
            if (logExecution) {
                logger.debug("Handler completed", {
                    context: { durationMs: Date.now() - startTime }
                });
            }

            return result;

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;

            logger.error("Handler error", {
                context: {
                    error: message,
                    durationMs: Date.now() - startTime,
                    userId: context?.userId,
                    orgId: context?.organizationId
                },
                error: error instanceof Error ? {
                    name: error.name,
                    message: error.message,
                    stack
                } : undefined
            });

            return errorResponse(message);
        }
    };
}

// ============================================================================
// Permission Checking Utilities
// ============================================================================

/**
 * Check if context has admin access (any level)
 */
export function requireAdminAccess(context?: ToolContext): boolean {
    return !!(context?.isAdmin || context?.isOrgAdmin || context?.isSuperAdmin);
}

/**
 * Check if context has org admin or higher access
 */
export function requireOrgAdminAccess(context?: ToolContext): boolean {
    return !!(context?.isOrgAdmin || context?.isSuperAdmin);
}

/**
 * Check if context has super admin access
 */
export function requireSuperAdminAccess(context?: ToolContext): boolean {
    return !!context?.isSuperAdmin;
}

/**
 * Check if context has a specific MCP permission
 */
export function hasPermission(context: ToolContext | undefined, permission: McpPermission): boolean {
    if (!context?.permissions) return false;
    return context.permissions.includes(permission);
}

/**
 * Check if context has access to a specific topic
 */
export function hasTopicAccess(context: ToolContext | undefined, topicId: number): boolean {
    // Super admins and admins have full access
    if (context?.isSuperAdmin || context?.isAdmin) return true;

    // If no topic restrictions, allow access
    if (!context?.allowedTopicIds) return true;

    return context.allowedTopicIds.includes(topicId);
}

/**
 * Check if context has access to a specific dataset
 */
export function hasDatasetAccess(context: ToolContext | undefined, datasetId: number): boolean {
    if (context?.isSuperAdmin || context?.isAdmin) return true;
    if (!context?.allowedDatasetIds) return true;
    return context.allowedDatasetIds.includes(datasetId);
}

/**
 * Check if context has access to a specific pipeline
 */
export function hasPipelineAccess(context: ToolContext | undefined, pipelineId: number): boolean {
    if (context?.isSuperAdmin || context?.isAdmin) return true;
    if (!context?.allowedPipelineIds) return true;
    return context.allowedPipelineIds.includes(pipelineId);
}

// ============================================================================
// Entity Resolution Utilities
// ============================================================================

export interface ResolveOptions<T> {
    /** Function to fetch by ID */
    getById: (id: number, orgContext: OrgContext) => Promise<T | undefined>;
    /** Function to fetch by name */
    getByName?: (name: string, orgContext: OrgContext) => Promise<T | undefined>;
    /** Entity name for error messages */
    entityName: string;
}

/**
 * Resolve an entity by ID or name
 * 
 * @example
 * ```typescript
 * const pipeline = await resolveEntityByIdOrName(
 *   { id: args.pipelineId, name: args.pipelineName },
 *   {
 *     getById: (id, ctx) => pipelineService.get(id, ctx),
 *     getByName: (name, ctx) => pipelineService.getByName(name, ctx),
 *     entityName: 'Pipeline'
 *   },
 *   context
 * );
 * ```
 */
export async function resolveEntityByIdOrName<T>(
    identifier: { id?: number | string; name?: string },
    options: ResolveOptions<T>,
    context?: ToolContext
): Promise<{ entity: T } | { error: string }> {
    const { getById, getByName, entityName } = options;
    const orgContext = getOrgContext(context);

    // Try by ID first
    if (identifier.id !== undefined) {
        const id = typeof identifier.id === 'string' ? parseInt(identifier.id, 10) : identifier.id;

        if (isNaN(id)) {
            return { error: `Invalid ${entityName} ID: ${identifier.id}` };
        }

        const entity = await getById(id, orgContext);
        if (entity) {
            return { entity };
        }

        return { error: `${entityName} not found with ID: ${id}` };
    }

    // Try by name
    if (identifier.name && getByName) {
        const entity = await getByName(identifier.name, orgContext);
        if (entity) {
            return { entity };
        }

        return { error: `${entityName} not found with name: ${identifier.name}` };
    }

    return { error: `Either ${entityName.toLowerCase()} ID or name must be provided` };
}

/**
 * Parse and validate a numeric ID from string or number input
 */
export function parseId(value: unknown, fieldName: string = 'ID'): number | { error: string } {
    if (typeof value === 'number') {
        if (isNaN(value) || value < 0) {
            return { error: `Invalid ${fieldName}: must be a positive number` };
        }
        return value;
    }

    if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < 0) {
            return { error: `Invalid ${fieldName}: "${value}" is not a valid positive number` };
        }
        return parsed;
    }

    return { error: `Invalid ${fieldName}: must be a number or numeric string` };
}

/**
 * Validates args against a tool's inputSchema. Returns a typed args object or an error response.
 * Use this at the top of every handler to replace `args: any`.
 *
 * @example
 * const validated = validateArgs(args, { cycleId: 'number', status: 'string?' });
 * if ('isError' in validated) return validated;
 *
 * NOTE: the guard is `'isError' in ...`, not `'error' in ...`. `errorResponse`
 * returns `{ isError: true, content: [...] }` with no top-level `error` key, so
 * an `'error' in` check never fires and the handler would carry on with the
 * error envelope in place of its arguments.
 */
export function validateArgs<T extends Record<string, unknown>>(
    args: unknown,
    schema: Record<string, 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'boolean?' | 'any'>
): T | ReturnType<typeof errorResponse> {
    if (typeof args !== 'object' || args === null) {
        return errorResponse('args must be an object');
    }
    const input = args as Record<string, unknown>;
    for (const [field, type] of Object.entries(schema)) {
        const optional = type.endsWith('?');
        const baseType = type.replace('?', '') as 'string' | 'number' | 'boolean' | 'any';
        const value = input[field];
        if (value === undefined || value === null) {
            if (!optional) return errorResponse(`Missing required field: ${field}`);
            continue;
        }
        if (baseType !== 'any' && typeof value !== baseType) {
            return errorResponse(`Field "${field}" must be a ${baseType}, got ${typeof value}`);
        }
    }
    return input as T;
}

/**
 * Validates args against a zod schema, returning parsed data (with defaults and
 * coercions applied) or an MCP error response.
 *
 * Prefer this over {@link validateArgs} when the tool already declares a zod
 * schema alongside its `inputSchema` — several do, in `server/mcp/tools/*.ts`.
 * It enforces what `validateArgs` cannot: enums, array element types, and
 * numeric ranges.
 *
 * Guard the result with `'isError' in ...`, exactly as with `validateArgs`.
 *
 * @example
 * const v = validateWithSchema(args, ResolveIncidentInput);
 * if ('isError' in v) return v;
 */
export function validateWithSchema<T extends z.ZodTypeAny>(
    args: unknown,
    schema: T
): z.infer<T> | ReturnType<typeof errorResponse> {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
        return errorResponse(`Invalid arguments — ${detail}`);
    }
    return parsed.data;
}

/**
 * Validate required fields in args
 */
export function validateRequiredFields<T extends object>(
    args: T,
    requiredFields: (keyof T)[]
): { valid: true } | { valid: false; error: string } {
    const missing = requiredFields.filter(field => {
        const value = args[field];
        return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
        return {
            valid: false,
            error: `Missing required fields: ${missing.join(', ')}`
        };
    }

    return { valid: true };
}

