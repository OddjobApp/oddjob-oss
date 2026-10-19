/**
 * Variable Discovery Utilities
 * Discovers and validates variable references available in pipeline context
 */

export type VariableCategory = 'step' | 'pipeline' | 'item' | 'event' | 'custom';

export interface VariableInfo {
    /** Full variable reference: {{step.0.output}} */
    name: string;
    /** Display name without braces: step.0.output */
    shortName: string;
    /** Category for grouping */
    category: VariableCategory;
    /** Human-readable description */
    description?: string;
    /** Sample/truncated value preview */
    preview?: string;
    /** For step outputs, the step index */
    stepIndex?: number;
    /** For named outputs, the output name */
    outputName?: string;
    /** Available nested properties (for JSON outputs) */
    properties?: string[];
}

export interface VariableDiscoveryContext {
    /** Pipeline ID if in pipeline context */
    pipelineId?: number;
    /** Current step order (0-based) */
    currentStepOrder?: number;
    /** Outputs from previous steps */
    previousStepOutputs?: {
        stepOrder: number;
        stepName?: string;
        output: any;
        outputName?: string;
    }[];
    /** Whether currently inside an iterator */
    isInIterator?: boolean;
    /** Sample item if in iterator */
    iteratorItemSample?: any;
    /** Initial variables passed to pipeline */
    initialVariables?: Record<string, any>;
}

/**
 * Truncate a value for preview display
 */
function truncatePreview(value: any, maxLength: number = 50): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    let str: string;
    if (typeof value === 'object') {
        str = JSON.stringify(value);
    } else {
        str = String(value);
    }

    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

/**
 * Extract available properties from a JSON object
 */
export function extractProperties(
    obj: any,
    maxDepth: number = 2,
    prefix: string = '',
    results: string[] = []
): string[] {
    if (maxDepth <= 0 || obj === null || obj === undefined) {
        return results;
    }

    if (typeof obj !== 'object') {
        return results;
    }

    if (Array.isArray(obj)) {
        // For arrays, show [0] notation
        if (obj.length > 0) {
            const arrayPrefix = prefix ? `${prefix}[0]` : '[0]';
            results.push(arrayPrefix);
            extractProperties(obj[0], maxDepth - 1, arrayPrefix, results);
        }
        return results;
    }

    // Object
    for (const key of Object.keys(obj)) {
        const propPath = prefix ? `${prefix}.${key}` : key;
        results.push(propPath);

        if (typeof obj[key] === 'object' && obj[key] !== null) {
            extractProperties(obj[key], maxDepth - 1, propPath, results);
        }
    }

    return results;
}

/**
 * Parse JSON safely, handling markdown code blocks
 */
function safeParseJson(value: any): any {
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
 * Discover all available variables based on context
 */
export function discoverAvailableVariables(context: VariableDiscoveryContext): VariableInfo[] {
    const variables: VariableInfo[] = [];

    // Step outputs
    if (context.previousStepOutputs) {
        for (const step of context.previousStepOutputs) {
            // Only include outputs from steps before the current one
            if (context.currentStepOrder !== undefined && step.stepOrder >= context.currentStepOrder) {
                continue;
            }

            const parsedOutput = safeParseJson(step.output);
            const properties = typeof parsedOutput === 'object' && parsedOutput !== null
                ? extractProperties(parsedOutput)
                : [];

            // Positional reference
            variables.push({
                name: `{{step.${step.stepOrder}.output}}`,
                shortName: `step.${step.stepOrder}.output`,
                category: 'step',
                description: step.stepName || `Step ${step.stepOrder + 1} output`,
                preview: truncatePreview(parsedOutput),
                stepIndex: step.stepOrder,
                properties,
            });

            // Add property-level variables for common paths
            for (const prop of properties.slice(0, 5)) { // Limit to prevent explosion
                variables.push({
                    name: `{{step.${step.stepOrder}.output.${prop}}}`,
                    shortName: `step.${step.stepOrder}.output.${prop}`,
                    category: 'step',
                    description: `${step.stepName || `Step ${step.stepOrder + 1}`} → ${prop}`,
                    preview: truncatePreview(getNestedValue(parsedOutput, prop)),
                    stepIndex: step.stepOrder,
                });
            }

            // Named output reference
            if (step.outputName) {
                variables.push({
                    name: `{{pipeline.${step.outputName}}}`,
                    shortName: `pipeline.${step.outputName}`,
                    category: 'pipeline',
                    description: `Named output: ${step.outputName}`,
                    preview: truncatePreview(parsedOutput),
                    outputName: step.outputName,
                    properties,
                });
            }
        }
    }

    // Iterator variables
    if (context.isInIterator) {
        variables.push({
            name: '{{item}}',
            shortName: 'item',
            category: 'item',
            description: 'Current iteration item',
            preview: context.iteratorItemSample ? truncatePreview(context.iteratorItemSample) : undefined,
        });

        variables.push({
            name: '{{item.index}}',
            shortName: 'item.index',
            category: 'item',
            description: 'Current iteration index (0-based)',
            preview: '0',
        });

        // If we have a sample item, show its properties
        if (context.iteratorItemSample && typeof context.iteratorItemSample === 'object') {
            const itemProps = extractProperties(context.iteratorItemSample);
            for (const prop of itemProps.slice(0, 10)) {
                variables.push({
                    name: `{{item.${prop}}}`,
                    shortName: `item.${prop}`,
                    category: 'item',
                    description: `Item property: ${prop}`,
                    preview: truncatePreview(getNestedValue(context.iteratorItemSample, prop)),
                });
            }
        }
    }

    // Initial variables (event data, etc.)
    if (context.initialVariables) {
        for (const [key, value] of Object.entries(context.initialVariables)) {
            variables.push({
                name: `{{${key}}}`,
                shortName: key,
                category: 'event',
                description: `Initial variable: ${key}`,
                preview: truncatePreview(value),
            });

            // Add nested properties
            if (typeof value === 'object' && value !== null) {
                const props = extractProperties(value);
                for (const prop of props.slice(0, 5)) {
                    variables.push({
                        name: `{{${key}.${prop}}}`,
                        shortName: `${key}.${prop}`,
                        category: 'event',
                        description: `${key} → ${prop}`,
                        preview: truncatePreview(getNestedValue(value, prop)),
                    });
                }
            }
        }
    }

    return variables;
}

/**
 * Get a nested value from an object using dot notation
 */

/**
 * Extract all {{variable}} placeholders from a string or object
 */
export function extractAllVariables(input: any): string[] {
    const variables = new Set<string>();
    const pattern = /\{\{([a-zA-Z0-9_.]+)(\[".+?"\])?\}\}/g;

    const scanString = (str: string) => {
        let match;
        while ((match = pattern.exec(str)) !== null) {
            variables.add(match[1]);
        }
    };

    const scanObject = (obj: any) => {
        if (!obj) return;
        if (typeof obj === 'string') {
            scanString(obj);
        } else if (Array.isArray(obj)) {
            obj.forEach(item => scanObject(item));
        } else if (typeof obj === 'object') {
            Object.values(obj).forEach(val => scanObject(val));
        }
    };

    scanObject(input);
    return Array.from(variables);
}

function getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') return undefined;

    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }

    return current;
}

/**
 * Validate a variable reference against the context
 */
export function validateVariableReference(
    ref: string,
    context: VariableDiscoveryContext
): { valid: boolean; error?: string } {
    // Extract the variable name from {{...}}
    const match = ref.match(/^\{\{(.+)\}\}$/);
    if (!match) {
        return { valid: false, error: 'Invalid variable syntax. Use {{variableName}}' };
    }

    const varName = match[1];

    // Check step references
    const stepMatch = varName.match(/^step\.(\d+)\.output/);
    if (stepMatch) {
        const stepIndex = parseInt(stepMatch[1], 10);

        if (context.currentStepOrder !== undefined && stepIndex >= context.currentStepOrder) {
            return {
                valid: false,
                error: `Cannot reference step ${stepIndex} from step ${context.currentStepOrder}. Only previous steps are accessible.`
            };
        }

        if (context.previousStepOutputs) {
            const stepExists = context.previousStepOutputs.some(s => s.stepOrder === stepIndex);
            if (!stepExists) {
                const available = context.previousStepOutputs.map(s => s.stepOrder).join(', ');
                return {
                    valid: false,
                    error: `Step ${stepIndex} not found. Available steps: ${available || 'none'}`
                };
            }
        }

        return { valid: true };
    }

    // Check pipeline references
    if (varName.startsWith('pipeline.')) {
        const outputName = varName.substring('pipeline.'.length);
        if (context.previousStepOutputs) {
            const exists = context.previousStepOutputs.some(s => s.outputName === outputName);
            if (!exists) {
                return {
                    valid: false,
                    error: `Named output '${outputName}' not found in pipeline`
                };
            }
        }
        return { valid: true };
    }

    // Check item references
    if (varName.startsWith('item')) {
        if (!context.isInIterator) {
            return {
                valid: false,
                error: 'Item variables are only available inside an iterator'
            };
        }
        return { valid: true };
    }

    // For other variables, we can't validate without more context
    return { valid: true };
}

/**
 * Find the variable trigger position in a string
 * Returns the start position of '{{' if cursor is inside an incomplete variable
 */
export function findVariableTrigger(
    value: string,
    cursorPosition: number
): { triggered: boolean; start: number; partial: string } | null {
    // Look backwards from cursor for '{{'
    const beforeCursor = value.substring(0, cursorPosition);
    const lastOpenBrace = beforeCursor.lastIndexOf('{{');

    if (lastOpenBrace === -1) {
        return null;
    }

    // Check if there's a closing '}}' between the '{{' and cursor
    const betweenBracesAndCursor = value.substring(lastOpenBrace + 2, cursorPosition);
    if (betweenBracesAndCursor.includes('}}')) {
        return null;
    }

    // We're inside an incomplete variable reference
    const partial = betweenBracesAndCursor;

    return {
        triggered: true,
        start: lastOpenBrace,
        partial,
    };
}

/**
 * Filter variables based on partial input
 */
export function filterVariables(
    variables: VariableInfo[],
    partial: string
): VariableInfo[] {
    if (!partial) return variables;

    const lowerPartial = partial.toLowerCase();

    return variables.filter(v =>
        v.shortName.toLowerCase().includes(lowerPartial) ||
        (v.description?.toLowerCase().includes(lowerPartial))
    ).sort((a, b) => {
        // Prioritize matches at the start
        const aStartsWith = a.shortName.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
        const bStartsWith = b.shortName.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
        return aStartsWith - bStartsWith;
    });
}
