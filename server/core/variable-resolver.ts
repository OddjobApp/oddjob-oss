/**
 * Variable Resolver for Pipeline Execution
 * 
 * Substitutes template variables in job configurations during pipeline execution:
 * - {{pipeline.name}} - Named output from previous step with outputName="name"
 * - {{step.N.output}} - Output from step at position N (0-based)
 */

export interface VariableContext {
  // Named outputs: { "description": "...", "pricing": "..." }
  named: Record<string, string>;
  // Positional outputs: { "0": "...", "1": "..." }
  positional: Record<number, string>;
  currentStepOrder?: number;
  item?: any;
  itemIndex?: number;
  // Data context for {{data.X}} patterns
  data?: Record<string, any>;
  // Environment variables for {{env.X}} patterns
  env?: Record<string, string>;
  // Financial Context (Phase 1)
  missionId?: number;
  orgId?: number;
}


import { AppError, ErrorCode } from "../utils/errors.js";

export class VariableResolverError extends AppError {
  constructor(message: string) {
    super(message, 400, ErrorCode.VALIDATION_FAILED);
    this.name = "VariableResolverError";
  }
}

/**
 * Resolves variables in a string using the provided context.
 * Supported formats:
 * - {{pipeline.name}} - Named output from a previous step
 * - {{step.N.output}} - Output from step N (0-based index)
 * 
 * Smart Fallback:
 * If {{step.N.output}} is not found, and N seems to be 1-based (i.e., N == currentStepOrder + 1),
 * it attempts to resolve {{step.N-1.output}} instead.
 */
export function resolveVariables(
  template: string,
  context: VariableContext
): string {
  if (!template) return "";

  let resolved = template;

  // Replace {{pipeline.name}} patterns
  const namedPattern = /\{\{pipeline\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  resolved = resolved.replace(namedPattern, (match, name) => {
    if (name in context.named) {
      return context.named[name];
    }
    throw new VariableResolverError(`Named output '${name}' not found in pipeline context`);
  });

  // Replace {{step.N.output}} patterns with optional path
  // Matches {{step.1.output}} or {{step.1.output.key}} or {{step.1.output.data.id}}
  const positionalPattern = /\{\{step\.(\d+)\.output(\.[a-zA-Z0-9_.]+)?\}\}/g;
  resolved = resolved.replace(positionalPattern, (match, stepNum, path) => {
    const stepIndex = parseInt(stepNum, 10);

    if (isNaN(stepIndex)) {
      throw new VariableResolverError(`Invalid step index: ${stepNum}`);
    }

    const resolvePath = (outputStr: string, propertyPath?: string): string => {
      if (!propertyPath || propertyPath === "") return outputStr;

      // Remove leading dot
      const cleanPath = propertyPath.startsWith('.') ? propertyPath.substring(1) : propertyPath;

      try {
        // Strip markdown code blocks if present
        let jsonStr = outputStr.trim();
        if (jsonStr.startsWith('```json')) {
          jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        let current = JSON.parse(jsonStr);
        const parts = cleanPath.split('.');

        for (const part of parts) {
          if (current === null || current === undefined) {
            throw new VariableResolverError(`Cannot access property '${part}' of null/undefined in step output`);
          }
          current = current[part];
        }

        if (current === undefined) {
          throw new VariableResolverError(`Property '${cleanPath}' not found in step output`);
        }

        return typeof current === 'object' ? JSON.stringify(current) : String(current);
      } catch (e) {
        if (e instanceof VariableResolverError) throw e;
        // If JSON parse fails but we requested a path, that's an error
        throw new VariableResolverError(`Failed to parse step output as JSON for property extraction: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // Try exact match (0-based)
    if (stepIndex in context.positional) {
      const output = context.positional[stepIndex];
      const outputString = typeof output === 'string' ? output : String(output);
      console.log(`[Variable Resolver] Resolving {{step.${stepNum}.output${path || ''}}}: length=${outputString.length}`);
      return resolvePath(outputString, path);
    }

    // Smart Fallback: Check for off-by-one error (User used 1-based index)
    if (context.currentStepOrder !== undefined) {
      // Case: User referenced "Step 1" (index 1) but meant the first step (index 0)
      // and we are currently at Step 2 (index 1).
      if (stepIndex === context.currentStepOrder + 1 || stepIndex === context.currentStepOrder) {
        const fallbackIndex = stepIndex - 1;
        if (fallbackIndex >= 0 && fallbackIndex in context.positional) {
          console.warn(`[Variable Resolver] Smart Fallback: Resolved {{step.${stepIndex}.output${path || ''}}} to step ${fallbackIndex} output.`);
          const output = context.positional[fallbackIndex];
          const outputString = typeof output === 'string' ? output : String(output);
          return resolvePath(outputString, path);
        }
      }
    } else {
      // Without current step context, just try N-1 if N > 0
      const fallbackIndex = stepIndex - 1;
      if (fallbackIndex >= 0 && fallbackIndex in context.positional) {
        console.warn(`[Variable Resolver] Smart Fallback: Resolved {{step.${stepIndex}.output${path || ''}}} to step ${fallbackIndex} output.`);
        const output = context.positional[fallbackIndex];
        const outputString = typeof output === 'string' ? output : String(output);
        return resolvePath(outputString, path);
      }
    }

    // Smart Fallback (Forward): Check for off-by-one error (User used 0-based index but System is 1-based)
    // This handles cases where database steps start at order 1, but config uses step.0
    const forwardFallbackIndex = stepIndex + 1;
    console.log(`[Variable Resolver] Debug: stepIndex=${stepIndex}, forwardFallback=${forwardFallbackIndex}, keys=${Object.keys(context.positional)}`);
    if (forwardFallbackIndex in context.positional) {
      console.warn(`[Variable Resolver] Smart Fallback (Forward): Resolved {{step.${stepIndex}.output${path || ''}}} to step ${forwardFallbackIndex} output.`);
      const output = context.positional[forwardFallbackIndex];
      const outputString = typeof output === 'string' ? output : String(output);
      return resolvePath(outputString, path);
    }


    console.log(`[Variable Resolver] Failed to resolve step ${stepIndex}. Context keys:`, Object.keys(context.positional));
    throw new VariableResolverError(`Step output ${stepIndex} not found. Available steps: ${Object.keys(context.positional).join(", ")}`);
  });

  // Replace {{step.name.output}} patterns for named step references
  // Matches {{step.fetch_data.output}} or {{step.my_step.output.key}}
  const namedStepPattern = /\{\{step\.([a-zA-Z_][a-zA-Z0-9_]*)\.output(\.[a-zA-Z0-9_.]+)?\}\}/g;
  resolved = resolved.replace(namedStepPattern, (match, stepName, path) => {
    if (context.named && stepName in context.named) {
      const output = context.named[stepName];
      const outputString = typeof output === 'string' ? output : String(output);
      console.log(`[Variable Resolver] Resolving {{step.${stepName}.output${path || ''}}}: length=${outputString.length}`);

      if (!path || path === "") return outputString;

      // Remove leading dot and parse path
      const cleanPath = path.startsWith('.') ? path.substring(1) : path;
      try {
        let current = JSON.parse(outputString);
        for (const part of cleanPath.split('.')) {
          if (current === null || current === undefined) {
            throw new VariableResolverError(`Cannot access property '${part}' of null/undefined`);
          }
          current = current[part];
        }
        return typeof current === 'object' ? JSON.stringify(current) : String(current);
      } catch (e) {
        if (e instanceof VariableResolverError) throw e;
        throw new VariableResolverError(`Failed to parse named step output as JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[Variable Resolver] Named step '${stepName}' not found. Available: ${context.named ? Object.keys(context.named).join(", ") : "none"}`);
    throw new VariableResolverError(`Named step '${stepName}' not found. Available: ${context.named ? Object.keys(context.named).join(", ") : "none"}`);
  });

  // Supports field names with special characters like "KUS: Feature" using brackets
  if (context.item !== undefined) {
    // Handle bracket notation: {{item["([^"]+)"]}}
    const itemBracketPattern = /\{\{item\["([^"]+)"\]\}\}/g;
    resolved = resolved.replace(itemBracketPattern, (match, field) => {
      if (context.item && typeof context.item === 'object' && field in context.item) {
        const value = context.item[field];
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value);
      }
      throw new VariableResolverError(
        `Variable {{item["${field}"]}} not found. Available fields: ${context.item && typeof context.item === 'object' ? Object.keys(context.item).join(", ") : "none"}`
      );
    });

    // Handle dot notation: {{item.key}} or {{item.nested.key}}
    const itemPattern = /\{\{item\.([a-zA-Z0-9_.]+)\}\}/g;
    resolved = resolved.replace(itemPattern, (match, field) => {
      if (context.item && typeof context.item === 'object') {
        const parts = field.split('.');
        let current: any = context.item;
        let found = true;

        for (const part of parts) {
          if (current !== null && current !== undefined && typeof current === 'object' && part in current) {
            current = current[part];
          } else {
            found = false;
            break;
          }
        }

        if (found && current !== undefined) {
          if (typeof current === 'object') {
            return JSON.stringify(current);
          }
          return String(current);
        }
      }

      throw new VariableResolverError(
        `Variable {{item.${field}}} not found. Available fields: ${context.item && typeof context.item === 'object' ? Object.keys(context.item).join(", ") : "none"}`
      );
    });

    // Replace {{item.index}} pattern
    if (context.itemIndex !== undefined) {
      const itemIndexPattern = /\{\{item\.index\}\}/g;
      resolved = resolved.replace(itemIndexPattern, () => String(context.itemIndex));
    }
  }

  // Replace generic variables from context.data (e.g. {{event.ticket.id}})
  // This supports accessing any key passed in 'initialVariables' to the pipeline executor

  // NEW: Explicit {{data.path}} pattern - e.g., {{data.apiKey}} or {{data.config.timeout}}
  if (context.data) {
    const dataPattern = /\{\{data\.([a-zA-Z0-9_.]+)\}\}/g;
    resolved = resolved.replace(dataPattern, (match, path) => {
      const parts = path.split('.');
      let value: any = context.data;

      for (const part of parts) {
        if (value === null || value === undefined) return match;
        value = value[part];
      }

      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  // NEW: Explicit {{env.VAR}} pattern - e.g., {{env.NODE_ENV}} or {{env.API_KEY}}
  if (context.env) {
    const envPattern = /\{\{env\.([a-zA-Z0-9_]+)\}\}/g;
    resolved = resolved.replace(envPattern, (match, varName) => {
      if (varName in context.env!) {
        return context.env![varName];
      }
      // Only the variables the caller put in context.env. Falling back to
      // process.env let a template written by a user — {{env.ENCRYPTION_KEY}}
      // in a step that posts to their server — read any platform secret.
      return match; // Keep original if not found
    });
  }

  // Pattern: {{key}} or {{key.path.to.prop}}
  if ((context as any).data) { // Cast because interface might not strictly have data yet in all files
    const dataContext = (context as any).data;

    // Pattern that matches {{key}} or {{key.path}} but EXCLUDES {{step...}} ran earlier
    // and {{pipeline...}}
    // Simplest way is to match generic {{...}} and blindly try to resolve if it looks like a variable
    // But we already processed specific patterns.
    // Let's use a specific pattern that avoids 'step.' and 'pipeline.' and 'item.' prefix if possible,
    // OR just match everything and check if it starts with known prefixes.

    // Actually, simple regex for {{variable.path}}:
    const genericPattern = /\{\{([a-zA-Z0-9_]+)(\.[a-zA-Z0-9_.]+)?\}\}/g;

    resolved = resolved.replace(genericPattern, (match, key, path) => {
      // Ignore if it starts with reserved keywords we already handled (if they weren't replaced yet?)
      // Actually, previous replace calls would have consumed them if they matched.
      // But if they didn't match (e.g. {{step.99}} invalid), they might remain.
      if (key === 'step' || key === 'pipeline' || key === 'item') return match;

      if (key in dataContext) {
        let value = dataContext[key];

        // Resolve path if present
        if (path) {
          const parts = path.substring(1).split('.'); // remove leading dot
          for (const part of parts) {
            if (value === null || value === undefined) return match; // Cannot traverse
            value = value[part];
          }
        }

        if (value === undefined) return match;

        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }

      return match;
    });
  }

  return resolved;
}

/**
 * Resolves variables in job configuration based on job type
 */
export function resolveJobConfig(
  jobType: string,
  config: any,
  context: VariableContext & { item?: any; itemIndex?: number }
): any {
  const resolved = { ...config };

  switch (jobType) {
    case "ai_api_call":
      // Resolve system prompt if present
      if (resolved.systemPrompt) {
        resolved.systemPrompt = resolveVariables(resolved.systemPrompt, context);
      }
      // Resolve user prompt
      if (resolved.userPrompt) {
        resolved.userPrompt = resolveVariables(resolved.userPrompt, context);
      }
      break;

    case "shell":
      // Resolve executable and parameters
      if (resolved.executable) {
        resolved.executable = resolveVariables(resolved.executable, context);
      }
      if (resolved.parameters) {
        resolved.parameters = resolveVariables(resolved.parameters, context);
      }
      break;

    case "api":
    case "curl":
      // Resolve URL
      if (resolved.url) {
        resolved.url = resolveVariables(resolved.url, context);
      }
      // Resolve request body
      if (resolved.body) {
        // Handle body - it might be a string or an object
        let bodyStr: string;
        if (typeof resolved.body === 'string') {
          bodyStr = resolved.body;
        } else if (typeof resolved.body === 'object' && resolved.body !== null) {
          // Body is an object - stringify it first
          bodyStr = JSON.stringify(resolved.body);
        } else {
          bodyStr = String(resolved.body);
        }

        // Skip variable resolution if body is already a complete JSON object (no variables)
        // This allows pre-constructed bodies (like from repeater dynamic field construction) to pass through
        if (!bodyStr.includes('{{')) {
          // Body has no variables, use as-is
          resolved.body = bodyStr;
        } else {
          resolved.body = resolveVariables(bodyStr, context);
        }
      }
      // Resolve query parameters
      if (resolved.queryParams) {
        const resolvedQueryParams: Record<string, string> = {};
        for (const [key, value] of Object.entries(resolved.queryParams)) {
          resolvedQueryParams[key] = resolveVariables(value as string, context);
        }
        resolved.queryParams = resolvedQueryParams;
      }
      // Resolve headers
      if (resolved.headers) {
        const resolvedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(resolved.headers)) {
          resolvedHeaders[key] = resolveVariables(value as string, context);
        }
        resolved.headers = resolvedHeaders;
      }
      break;

    case "python":
      // Resolve script content
      if (resolved.scriptContent) {
        resolved.scriptContent = resolveVariables(resolved.scriptContent, context);
      }
      break;

    case "ai_agent":
      if (resolved.goal) {
        resolved.goal = resolveVariables(resolved.goal, context);
      }
      if (resolved.systemPrompt) {
        resolved.systemPrompt = resolveVariables(resolved.systemPrompt, context);
      }
      break; // End case ai_agent


    case "file_writer":
      if (resolved.content) {
        // Content might be an object if passed directly, or string if from template
        if (typeof resolved.content === 'string') {
          resolved.content = resolveVariables(resolved.content, context);
        }
      }
      if (resolved.path) {
        resolved.path = resolveVariables(resolved.path, context);
      }
      break;

    case "iterator":
      if (resolved.inputArray) {
        resolved.inputArray = resolveVariables(resolved.inputArray, context);
      }
      break;

    case "static_response":
      if (resolved.content) {
        resolved.content = resolveVariables(resolved.content, context);
      }
      if (resolved.outputMapping) {
        const resolvedMapping: Record<string, string> = {};
        for (const [key, value] of Object.entries(resolved.outputMapping)) {
          resolvedMapping[key] = resolveVariables(value as string, context);
        }
        resolved.outputMapping = resolvedMapping;
      }
      break;

    case "sql_query":
      if (resolved.query) {
        resolved.query = resolveVariables(resolved.query, context);
      }
      if (resolved.parameters) {
        const resolvedParams: Record<string, string> = {};
        for (const [key, value] of Object.entries(resolved.parameters)) {
          resolvedParams[key] = resolveVariables(value as string, context);
        }
        resolved.parameters = resolvedParams;
      }
      break;

    case "supervisor":
      if (resolved.intent) {
        resolved.intent = resolveVariables(resolved.intent, context);
      }
      if (resolved.model) {
        resolved.model = resolveVariables(resolved.model, context);
      }
      if (resolved.systemPrompt) {
        resolved.systemPrompt = resolveVariables(resolved.systemPrompt, context);
      }
      // Allow allowedPipelines from {{data.allowedPipelineIds}} for workgroup launch
      if (resolved.allowedPipelines !== undefined && typeof resolved.allowedPipelines === "string" && resolved.allowedPipelines.includes("{{")) {
        const val = resolveVariables(resolved.allowedPipelines, context);
        try {
          resolved.allowedPipelines = typeof val === "string" ? JSON.parse(val) : val;
        } catch {
          resolved.allowedPipelines = [];
        }
      }
      break;

    default:
      // Unknown job type - return as-is
      break;
  }

  return resolved;
}

/**
 * Extracts output from job execution result based on job type
 */
export function extractJobOutput(jobType: string, result: any): string {
  // For AI jobs, the result is { success, output, metadata }
  if (jobType === "ai_api_call") {
    return result.output || "";
  }

  // For other job types, we'll need to define the output format
  // For now, return stringified result
  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result);
}



