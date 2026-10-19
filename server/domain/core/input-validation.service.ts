
import { db } from "@server/database_service.js";
import { eq, asc } from "drizzle-orm";
import {
    pipelineInputParams,
    type PipelineInputParam,
    type ValidationResult,
    type ValidationError,
    type InputParamDataType
} from "@shared/schema/pipelineInputParams.js";
import {
    pipelineOutputParams,
    type PipelineOutputParam,
    type OutputParamDataType
} from "@shared/schema/pipelineOutputParams.js";
import { pipelineSteps, jobs } from "@shared/schema/index.js";
import { extractAllVariables, extractProperties } from "@shared/utils/variableDiscovery.js";

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
     * Parse JSON safely, handling markdown code blocks (helper)
     */
    static safeParseJson(value: any): any {
        if (typeof value !== 'string') return value;

        let str = value.trim();

        // Strip markdown code blocks
        if (str.startsWith('```json')) {
            str = str.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (str.startsWith('```')) {
            str = str.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        try {
            return JSON.parse(str);
        } catch {
            return value;
        }
    }

    /**
     * Get all output parameters for a pipeline (explicit + implicit)
     */
    static async getOutputParamsForPipeline(pipelineId: number): Promise<PipelineOutputParam[]> {
        const parsedId = typeof pipelineId === 'number' ? pipelineId : parseInt(String(pipelineId), 10);
        if (isNaN(parsedId)) {
            return [];
        }
        const explicit = await db.query.pipelineOutputParams.findMany({
            where: eq(pipelineOutputParams.pipelineId, parsedId),
            orderBy: [asc(pipelineOutputParams.displayOrder)]
        });

        const implicit = await this.discoverImplicitOutputParams(parsedId);

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
     * Discover implicit output parameters by scanning job output schemas in pipeline steps
     */
    static async discoverImplicitOutputParams(pipelineId: number): Promise<PipelineOutputParam[]> {
        const parsedId = typeof pipelineId === 'number' ? pipelineId : parseInt(String(pipelineId), 10);
        if (isNaN(parsedId)) {
            return [];
        }
        const rows = await db.select({
            stepOrder: pipelineSteps.order,
            jobName: jobs.name,
            jobType: jobs.type,
            jobConfig: jobs.config,
            jobOutputSchema: jobs.outputSchema
        })
            .from(pipelineSteps)
            .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(eq(pipelineSteps.pipelineId, parsedId))
            .orderBy(asc(pipelineSteps.order));

        const implicitOutputs: Map<string, PipelineOutputParam> = new Map();

        for (const row of rows) {
            const jobConfig = row.jobConfig as any;

            // 1. Handle Form Agent outputs
            if (row.jobType === 'form_agent' && jobConfig?.formSchema?.fields) {
                for (const field of jobConfig.formSchema.fields) {
                    if (!implicitOutputs.has(field.key)) {
                        implicitOutputs.set(field.key, {
                            id: 0,
                            pipelineId,
                            name: field.key,
                            label: field.label || field.key,
                            description: `Output from Form Agent: ${row.jobName}`,
                            dataType: this.mapFormTypeToDataType(field.type),
                            isRequired: false,
                            schemaDef: null,
                            sampleValue: field.defaultValue || null,
                            displayOrder: 999,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        } as PipelineOutputParam);
                    }
                }
            }

            // 2. Handle Structured Output Schemas (AI Agents, etc.)
            if (row.jobOutputSchema) {
                const parsedSchema = this.safeParseJson(row.jobOutputSchema);
                if (parsedSchema && typeof parsedSchema === 'object') {
                    // Normalize schema items
                    const schemaItems = parsedSchema.schemaDef || parsedSchema.fields || {};
                    Object.entries(schemaItems).forEach(([key, info]: [string, any]) => {
                        if (!implicitOutputs.has(key)) {
                            implicitOutputs.set(key, {
                                id: 0,
                                pipelineId,
                                name: key,
                                label: info.label || key,
                                description: info.description || `Output from ${row.jobName}`,
                                dataType: info.type || 'string',
                                isRequired: info.required || false,
                                schemaDef: info,
                                sampleValue: null,
                                displayOrder: 999,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            } as PipelineOutputParam);
                        }
                    });
                }
            }
        }

        return Array.from(implicitOutputs.values());
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
            jobType: jobs.type,
            jobConfig: jobs.config,
            jobOutputSchema: jobs.outputSchema
        })
            .from(pipelineSteps)
            .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(eq(pipelineSteps.pipelineId, parsedId))
            .orderBy(asc(pipelineSteps.order));

        const implicitParams: Map<string, PipelineInputParam> = new Map();
        const availableOutputs: Set<string> = new Set();

        for (const row of rows) {
            const jobConfig = row.jobConfig as any;

            // 1. Process Requirements from inputs
            if (jobConfig) {
                // Special case: Form Agents
                if (row.jobType === 'form_agent' && jobConfig.formSchema?.fields) {
                    for (const field of jobConfig.formSchema.fields) {
                        if (!availableOutputs.has(field.key) && !implicitParams.has(field.key)) {
                            // Normalize allowedValues if they are objects
                            let allowedValues = field.options || null;
                            if (Array.isArray(allowedValues) && allowedValues.length > 0 && typeof allowedValues[0] === 'object') {
                                allowedValues = allowedValues.map((o: any) => o.value ?? o.label ?? String(o));
                            }

                            implicitParams.set(field.key, {
                                id: 0,
                                pipelineId,
                                name: field.key,
                                label: field.label || field.key,
                                description: `Auto-discovered from Form Agent: ${row.jobName}${field.description ? ` - ${field.description}` : ''}`,
                                dataType: this.mapFormTypeToDataType(field.type),
                                isRequired: field.required || false,
                                displayOrder: 999,
                                defaultValue: field.defaultValue || null,
                                allowedValues,
                                pattern: field.pattern || null,
                                patternMessage: field.patternMessage || null,
                                minLength: field.minLength || null,
                                maxLength: field.maxLength || null,
                                minValue: field.minValue ? String(field.minValue) : null,
                                maxValue: field.maxValue ? String(field.maxValue) : null,
                                createdAt: new Date()
                            } as PipelineInputParam);
                        }
                    }
                }

                // Extract variables from this step's config placeholders {{...}}
                const variables = extractAllVariables(jobConfig);

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
                            // Smart Type Detection for implicit variables
                            let dataType: InputParamDataType = 'string';
                            if (varName.toLowerCase().includes('location') || varName.toLowerCase().includes('address')) {
                                dataType = 'location';
                            }

                            implicitParams.set(varName, {
                                id: 0, // Virtual ID
                                pipelineId,
                                name: varName,
                                label: varName.charAt(0).toUpperCase() + varName.slice(1).replace(/_/g, ' '),
                                description: `Auto-discovered requirement from step: ${row.jobName}`,
                                dataType,
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
            }

            // 2. Register Outputs for subsequent steps

            // Form Agent outputs its fields
            if (row.jobType === 'form_agent' && jobConfig?.formSchema?.fields) {
                jobConfig.formSchema.fields.forEach((f: any) => {
                    availableOutputs.add(f.key);
                });
            }

            // A. Named output
            if (row.outputName) {
                availableOutputs.add(row.outputName);
            }

            // B. Schema outputs (flattened properties)
            if (row.jobOutputSchema) {
                const parsedSchema = this.safeParseJson(row.jobOutputSchema);
                if (parsedSchema && typeof parsedSchema === 'object') {
                    // 1. Handle JobOutputSchema structure (with schemaDef)
                    if (parsedSchema.schemaDef && typeof parsedSchema.schemaDef === 'object') {
                        Object.keys(parsedSchema.schemaDef).forEach(key => availableOutputs.add(key));
                    }

                    // 2. Handle sampleOutput if present
                    if (parsedSchema.sampleOutput && typeof parsedSchema.sampleOutput === 'object') {
                        const properties = extractProperties(parsedSchema.sampleOutput);
                        properties.forEach((prop: any) => availableOutputs.add(prop));
                    }

                    // 3. Fallback: Treat as raw JSON object if no schemaDef/sampleOutput (legacy or direct object)
                    if (!parsedSchema.schemaDef && !parsedSchema.sampleOutput) {
                        const properties = extractProperties(parsedSchema);
                        properties.forEach((prop: any) => availableOutputs.add(prop));
                    }
                }
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
            case "location":
                if (typeof value !== 'string' || value.trim() === '') {
                    errors.push({ field: param.name, message: "Invalid location address", value, constraint: "type" });
                }
                break;
        }
    }

    /**
     * Generate prompt text for an agent describing the required inputs
     */
    static async generateAgentPrompt(pipelineId: number): Promise<string> {
        const params = await this.getParamsForPipeline(pipelineId);
        if (params.length === 0) return "";

        let prompt = "This pipeline requires the following input parameters. You must ensure they are provided before or during execution:\n\n";

        for (const param of params) {
            const req = param.isRequired ? " (Required)" : " (Optional)";
            const defaultValue = param.defaultValue ? ` (Default: ${param.defaultValue})` : "";
            prompt += `- **${param.name}** (${param.dataType})${req}${defaultValue}: ${param.description || param.label || ''}\n`;

            const constraints: string[] = [];
            if (param.minLength) constraints.push(`min length: ${param.minLength}`);
            if (param.maxLength) constraints.push(`max length: ${param.maxLength}`);
            if (param.minValue) constraints.push(`min value: ${param.minValue}`);
            if (param.maxValue) constraints.push(`max value: ${param.maxValue}`);
            if (param.pattern) constraints.push(`pattern: ${param.pattern}`);

            if (param.allowedValues && Array.isArray(param.allowedValues) && param.allowedValues.length > 0) {
                constraints.push(`allowed values: [${param.allowedValues.join(", ")}]`);
            }

            if (constraints.length > 0) {
                prompt += `  Constraints: ${constraints.join(", ")}\n`;
            }
        }

        prompt += `\n**CRITICAL INSTRUCTION**: To provide these inputs, you can either synthesize them if they are clearly derivable from the mission context/intent, or you MUST call the \`show_pipeline_input_form\` tool with pipelineId: ${pipelineId}. This will present a structured form to the user. DO NOT attempt to collect these fields conversationally in text if you cannot synthesize them. When requesting HIL, always explain **why** you need the value (reason) and provide an **acceptable suggestion or hint** (suggestion) to help the user.
        
**HIL UI CAPABILITIES**:
- **boolean**: Use for simple yes/no or toggle; will be rendered as a **checkbox**.
- **enum** (array): Use for pre-defined choices; will be rendered as a **select or radio list**.
- **number/string**: Standard numeric or text input.
Once parameters are available, proceed with execution.`;
        return prompt;
    }

    /**
     * Generate prompt text for a job's parameter schema
     */
    static generateJobParameterPrompt(parameterSchema: any): string {
        if (!parameterSchema) return "";

        let schemaEntries: any[] = [];

        // Determine if it's a flat array of params or a standard JSON Schema object
        if (Array.isArray(parameterSchema)) {
            schemaEntries = parameterSchema;
        } else if (typeof parameterSchema === 'object') {
            if (parameterSchema.properties) {
                // Standard JSON Schema
                const required = new Set(parameterSchema.required || []);
                schemaEntries = Object.entries(parameterSchema.properties).map(([name, config]: [string, any]) => ({
                    name,
                    ...config,
                    isRequired: required.has(name)
                }));
            } else {
                // Flat object mapping name -> config
                schemaEntries = Object.entries(parameterSchema).map(([name, config]: [string, any]) => ({
                    name,
                    ...(typeof config === 'object' ? config : { description: String(config) })
                }));
            }
        }

        if (schemaEntries.length === 0) return "";

        let prompt = "This job requires the following input parameters:\n\n";

        for (const param of schemaEntries) {
            const req = param.isRequired !== false ? " (Required)" : " (Optional)";
            const defaultValue = param.defaultValue ? ` (Default: ${param.defaultValue})` : "";
            const dataType = param.dataType || param.type || 'string';
            prompt += `- **${param.name}** (${dataType})${req}${defaultValue}: ${param.description || param.label || ''}\n`;
        }

        prompt += `\n**CRITICAL INSTRUCTION**: You must provide these parameters in the task arguments when delegating. If you can synthesize them from context (e.g. naming a knowledge base based on the goal), you should do so. If you cannot synthesize them, you MUST use a preceding Human-In-The-Loop (HIL) step to collect them. When requesting HIL, always explain **why** you need the value (reason) and provide an **acceptable suggestion or hint** (suggestion) to help the user.
        
**HIL UI CAPABILITIES**:
- **boolean**: Renders as a **checkbox**.
- **enum**: Renders as a **select/radio button set**.
- **string/number**: Standard input fields.`;
        return prompt;
    }

    /**
     * Map Form Agent field types to Pipeline Input Param data types
     */
    private static mapFormTypeToDataType(formType: string): InputParamDataType {
        switch (formType) {
            case 'number': return 'number';
            case 'boolean':
            case 'checkbox': return 'boolean';
            case 'date': return 'date';
            case 'email': return 'email';
            case 'url': return 'url';
            case 'phone': return 'phone';
            case 'vin': return 'vin';
            case 'location': return 'location';
            case 'text':
            case 'textarea':
            case 'select':
            default: return 'string';
        }
    }
}




