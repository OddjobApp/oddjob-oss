
import { db } from "@server/database_service.js";
import { eq, asc } from "drizzle-orm";
import {
    pipelineInputParams,
    PipelineInputParam,
    ValidationResult,
    ValidationError,
    InputParamDataType
} from "@shared/schema/pipelineInputParams.js";
import { pipelineSteps, jobs } from "@shared/schema/index.js";
import { extractAllVariables } from "@shared/utils/variableDiscovery.js";

export class InputValidationService {
    /**
     * Get all input parameters for a pipeline
     */
    static async getParamsForPipeline(pipelineId: number): Promise<PipelineInputParam[]> {
        const parsedId = typeof pipelineId === 'number' ? pipelineId : parseInt(String(pipelineId), 10);
        if (isNaN(parsedId)) {
            return [];
        }
        const explicit = await db.query.pipelineInputParams.findMany({
            where: eq(pipelineInputParams.pipelineId, parsedId),
            orderBy: [asc(pipelineInputParams.displayOrder)]
        });

        const implicit = await this.discoverImplicitParams(parsedId);

        // Merge - explicit ones take precedence and provide more metadata
        const merged = [...explicit];
        const explicitNames = new Set(explicit.map(p => p.name));

        for (const imp of implicit) {
            if (!explicitNames.has(imp.name)) {
                merged.push(imp);
            }
        }

        return merged;
    }

    /**
     * Automatically discover implicit input requirements by scanning job configs
     */
    static async discoverImplicitParams(pipelineId: number): Promise<PipelineInputParam[]> {
        const parsedId = typeof pipelineId === 'number' ? pipelineId : parseInt(String(pipelineId), 10);
        if (isNaN(parsedId)) {
            return [];
        }
        const rows = await db.select({
            stepId: pipelineSteps.id,
            stepOrder: pipelineSteps.order,
            outputName: pipelineSteps.outputName,
            jobId: pipelineSteps.jobId,
            jobName: jobs.name,
            jobConfig: jobs.config
        })
            .from(pipelineSteps)
            .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(eq(pipelineSteps.pipelineId, parsedId))
            .orderBy(asc(pipelineSteps.order));

        console.log(`[InputValidationService] Found ${rows.length} rows for pipeline ${pipelineId}`);
        const implicitParams: Map<string, PipelineInputParam> = new Map();
        const availableOutputs: Set<string> = new Set();

        for (const row of rows) {
            console.log(`[InputValidationService] Processing step ${row.stepOrder}: ${row.jobName}`);
            const jobConfig = row.jobConfig as any;
            if (!jobConfig) {
                console.log(`[InputValidationService] No jobConfig for step ${row.stepOrder}`);
                continue;
            }

            // Extract variables from this step's config
            console.log(`[InputValidationService] Config type: ${typeof jobConfig}, Content: ${JSON.stringify(jobConfig)}`);
            const variables = extractAllVariables(jobConfig);
            console.log(`[InputValidationService] Extracted variables: ${JSON.stringify(variables)}`);

            for (const varName of variables) {
                // Ignore if it's a step output, pipeline named output, or reserved prefix
                if (
                    varName.startsWith('step.') ||
                    varName.startsWith('pipeline.') ||
                    varName.startsWith('data.') ||
                    varName.startsWith('env.') ||
                    varName.startsWith('item.')
                ) {
                    continue;
                }

                // If not in availableOutputs, it's an implicit requirement
                if (!availableOutputs.has(varName)) {
                    if (!implicitParams.has(varName)) {
                        implicitParams.set(varName, {
                            id: 0, // Virtual ID
                            pipelineId,
                            name: varName,
                            label: varName.charAt(0).toUpperCase() + varName.slice(1).replace(/_/g, ' '),
                            description: `Auto-discovered requirement from step: ${row.jobName}`,
                            dataType: 'string',
                            isRequired: true,
                            displayOrder: 999,
                            defaultValue: null,
                            minLength: null,
                            maxLength: null,
                            minValue: null,
                            maxValue: null,
                            pattern: null,
                            patternMessage: null,
                            allowedValues: null,
                            createdAt: new Date()
                        } as PipelineInputParam);
                    }
                }
            }

            // After processing step, add its outputName to available outputs
            if (row.outputName) {
                availableOutputs.add(row.outputName);
            }
        }

        return Array.from(implicitParams.values());
    }

    /**
     * Validate input values against the pipeline's schema
     */
    static async validateInputs(pipelineId: number, inputs: Record<string, any>): Promise<ValidationResult> {
        const params = await this.getParamsForPipeline(pipelineId);
        const errors: ValidationError[] = [];

        for (const param of params) {
            const value = inputs[param.name];

            // 1. Check requirement
            if (param.isRequired && (value === undefined || value === null || value === "")) {
                errors.push({
                    field: param.name,
                    message: `${param.label || param.name} is required`,
                    constraint: "required"
                });
                continue;
            }

            // Skip further validation if optional and missing
            if (value === undefined || value === null || value === "") {
                continue;
            }

            // 2. Type-specific validation
            this.validateType(param, value, errors);

            // 3. String validation (length, pattern)
            if (typeof value === 'string') {
                if (param.minLength !== null && value.length < param.minLength) {
                    errors.push({
                        field: param.name,
                        message: `${param.label || param.name} must be at least ${param.minLength} characters`,
                        value,
                        constraint: "minLength"
                    });
                }
                if (param.maxLength !== null && value.length > param.maxLength) {
                    errors.push({
                        field: param.name,
                        message: `${param.label || param.name} must be no more than ${param.maxLength} characters`,
                        value,
                        constraint: "maxLength"
                    });
                }
                if (param.pattern) {
                    try {
                        const regex = new RegExp(param.pattern);
                        if (!regex.test(value)) {
                            errors.push({
                                field: param.name,
                                message: param.patternMessage || `${param.label || param.name} format is invalid`,
                                value,
                                constraint: "pattern"
                            });
                        }
                    } catch (e) {
                        console.error(`Invalid regex pattern for param ${param.name}:`, param.pattern);
                    }
                }
            }

            // 4. Number validation (min, max)
            const numValue = Number(value);
            if (!isNaN(numValue)) {
                if (param.minValue !== null && numValue < Number(param.minValue)) {
                    errors.push({
                        field: param.name,
                        message: `${param.label || param.name} must be at least ${param.minValue}`,
                        value: numValue,
                        constraint: "minValue"
                    });
                }
                if (param.maxValue !== null && numValue > Number(param.maxValue)) {
                    errors.push({
                        field: param.name,
                        message: `${param.label || param.name} must be no more than ${param.maxValue}`,
                        value: numValue,
                        constraint: "maxValue"
                    });
                }
            }

            // 5. Allowed values (enum)
            if (param.allowedValues && Array.isArray(param.allowedValues)) {
                if (!param.allowedValues.includes(value)) {
                    errors.push({
                        field: param.name,
                        message: `${param.label || param.name} must be one of: ${param.allowedValues.join(", ")}`,
                        value,
                        constraint: "allowedValues"
                    });
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Helper to validate data type
     */
    private static validateType(param: PipelineInputParam, value: any, errors: ValidationError[]) {
        const type = param.dataType as InputParamDataType;

        switch (type) {
            case "number":
                if (isNaN(Number(value))) {
                    errors.push({ field: param.name, message: "Must be a number", value, constraint: "type" });
                }
                break;
            case "boolean":
                if (typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
                    errors.push({ field: param.name, message: "Must be a boolean", value, constraint: "type" });
                }
                break;
            case "email":
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(String(value))) {
                    errors.push({ field: param.name, message: "Invalid email address", value, constraint: "type" });
                }
                break;
            case "url":
                try {
                    new URL(String(value));
                } catch (e) {
                    errors.push({ field: param.name, message: "Invalid URL", value, constraint: "type" });
                }
                break;
            // Add other specialized types as needed
        }
    }

    /**
     * Generate prompt text for an agent describing the required inputs
     */
    static async generateAgentPrompt(pipelineId: number): Promise<string> {
        const params = await this.getParamsForPipeline(pipelineId);
        if (params.length === 0) return "";

        let prompt = "This pipeline requires the following input parameters:\n\n";

        for (const param of params) {
            const req = param.isRequired ? " (Required)" : " (Optional)";
            prompt += `- **${param.name}** (${param.dataType})${req}: ${param.description || param.label || ''}\n`;

            const constraints: string[] = [];
            if (param.minLength) constraints.push(`min length: ${param.minLength}`);
            if (param.maxLength) constraints.push(`max length: ${param.maxLength}`);
            if (param.minValue) constraints.push(`min value: ${param.minValue}`);
            if (param.maxValue) constraints.push(`max value: ${param.maxValue}`);
            if (param.pattern) constraints.push(`pattern: ${param.pattern}`);
            if (param.allowedValues && Array.isArray(param.allowedValues)) {
                constraints.push(`allowed values: [${param.allowedValues.join(", ")}]`);
            }

            if (constraints.length > 0) {
                prompt += `  Constraints: ${constraints.join(", ")}\n`;
            }
        }

        prompt += "\nBefore calling run_pipeline, ensure you have collected and validated all required parameters from the user.";
        return prompt;
    }
}




