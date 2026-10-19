/**
 * Schema Generator Utility
 * 
 * Generates enhanced schemas from data with automatic key detection
 */

import type { FieldDefinition, JobInputSchema, JobOutputSchema } from "@shared/schema/index.js";

/**
 * Detect if a field name looks like a key/identifier
 */
export function detectKeyFields(fieldName: string, value: any): boolean {
  const lowerName = fieldName.toLowerCase();

  // Common key patterns
  if (
    lowerName === 'id' ||
    lowerName === 'key' ||
    lowerName === 'uuid' ||
    lowerName.endsWith('id') ||
    lowerName.endsWith('key') ||
    lowerName.endsWith('uuid')
  ) {
    return true;
  }

  // JIRA key pattern: "PROJECT-123"
  if (typeof value === 'string' && /^[A-Z]+-\d+$/.test(value)) {
    return true;
  }

  // UUID pattern
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true;
  }

  return false;
}

/**
 * Generate enhanced schema from data with automatic key detection
 */
export function generateEnhancedSchemaFromData(
  data: any,
  prefix = "",
  detectedKeys: Set<string> = new Set()
): Record<string, FieldDefinition> {
  const schema: Record<string, FieldDefinition> = {};

  if (data === null || data === undefined) {
    return schema;
  }

  // Handle arrays - analyze first element
  if (Array.isArray(data)) {
    if (data.length > 0) {
      const itemSchema = generateEnhancedSchemaFromData(data[0], prefix, detectedKeys);
      Object.assign(schema, itemSchema);
      // Mark array fields
      Object.keys(itemSchema).forEach(key => {
        schema[`${key}[]`] = {
          type: `array<${itemSchema[key].type}>`,
          required: itemSchema[key].required,
          isKey: itemSchema[key].isKey,
          isForeignKey: itemSchema[key].isForeignKey,
          foreignKeyTarget: itemSchema[key].foreignKeyTarget,
        };
      });
    } else {
      // Empty array - mark as array type
      schema[prefix || "items"] = {
        type: "array",
        required: false,
      };
    }
    return schema;
  }

  // Handle objects
  if (typeof data === 'object' && data !== null) {
    for (const key in data) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      const value = data[key];

      // Detect if this looks like a key
      const isKey = detectKeyFields(key, value);
      if (isKey) {
        detectedKeys.add(newKey);
      }

      // Determine type
      let fieldType: string;
      if (value === null) {
        fieldType = "null";
      } else if (Array.isArray(value)) {
        fieldType = "array";
        if (value.length > 0) {
          const itemType = typeof value[0];
          fieldType = `array<${itemType}>`;
        }
      } else {
        fieldType = typeof value;
      }

      const fieldDef: FieldDefinition = {
        type: fieldType,
        required: value !== null && value !== undefined,
        isKey: isKey,
        examples: value !== null && value !== undefined ? [value] : undefined,
      };

      // Always add the base field definition
      schema[newKey] = fieldDef;

      // Recursive for nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nestedSchema = generateEnhancedSchemaFromData(value, newKey, detectedKeys);
        Object.assign(schema, nestedSchema);
      }
      // Recursive for arrays (new logic to handle nested array items)
      else if (Array.isArray(value) && value.length > 0) {
        // Generate schema for the array contents (this passes the array to the top-level array handler)
        // which will generate keys like "issues.id[]"
        const arraySchema = generateEnhancedSchemaFromData(value, newKey, detectedKeys);
        Object.assign(schema, arraySchema);
      }
    }
  } else {
    // Primitive value
    schema[prefix || 'value'] = {
      type: typeof data,
      required: data !== null && data !== undefined,
      examples: data !== null && data !== undefined ? [data] : undefined,
    };
  }

  return schema;
}

/**
 * Validate data against a schema
 */
export function validateDataAgainstSchema(
  data: any,
  schema: Record<string, FieldDefinition>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const dataSchema = generateEnhancedSchemaFromData(data);

  // Check required fields
  for (const [path, fieldDef] of Object.entries(schema)) {
    if (fieldDef.required && !(path in dataSchema)) {
      errors.push(`Missing required field: ${path}`);
      continue;
    }

    if (path in dataSchema) {
      const actualType = dataSchema[path].type;
      const expectedType = fieldDef.type;

      // Allow array type flexibility
      if (actualType !== expectedType && !path.endsWith('[]')) {
        // Check if types are compatible
        if (!areTypesCompatible(actualType, expectedType)) {
          errors.push(`Type mismatch for ${path}: expected ${expectedType}, got ${actualType}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if two types are compatible
 */
function areTypesCompatible(actual: string, expected: string): boolean {
  // Exact match
  if (actual === expected) return true;

  // Number/string flexibility
  if ((actual === 'number' && expected === 'string') ||
    (actual === 'string' && expected === 'number')) {
    return true;
  }

  // Array compatibility
  if (actual.startsWith('array<') && expected.startsWith('array<')) {
    return true;
  }

  return false;
}

/**
 * Create JobInputSchema from data
 */
export function createJobInputSchema(sampleInput: any): JobInputSchema {
  return {
    capturedAt: new Date().toISOString(),
    sampleInput,
    schemaDef: generateEnhancedSchemaFromData(sampleInput),
  };
}

/**
 * Create JobOutputSchema from data
 */
export function createJobOutputSchema(sampleOutput: any): JobOutputSchema {
  return {
    capturedAt: new Date().toISOString(),
    sampleOutput,
    schemaDef: generateEnhancedSchemaFromData(sampleOutput),
  };
}


