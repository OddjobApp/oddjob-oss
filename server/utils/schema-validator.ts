/**
 * Schema Validator Utility
 * 
 * Validates transformation rules against schemas
 */

import type { FieldDefinition, TransformationRule, TransformerConfig } from "@shared/schema/index.js";
import lodash from "lodash";
const { get } = lodash;

/**
 * Validate transformation rules against input schema
 */
export function validateTransformationRules(
  rules: TransformationRule[],
  inputSchema?: Record<string, FieldDefinition>,
  outputSchema?: Record<string, FieldDefinition>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const rule of rules) {
    // Validate source path exists in input schema
    if (inputSchema && !isPathValid(rule.sourcePath, inputSchema)) {
      errors.push(`Source path "${rule.sourcePath}" not found in input schema`);
    }

    // Validate target path format
    if (!rule.targetPath || rule.targetPath.trim() === '') {
      errors.push(`Rule ${rule.id} has empty target path`);
    }

    // Validate rule type specific config
    if (rule.type === "wrap_object" && !rule.config?.wrapperKey) {
      errors.push(`Rule ${rule.id} (wrap_object) requires wrapperKey in config`);
    }

    if (rule.type === "map_value" && !rule.config?.mapping) {
      errors.push(`Rule ${rule.id} (map_value) requires mapping in config`);
    }

    if (rule.type === "extract_field" && !rule.config?.extractPath) {
      errors.push(`Rule ${rule.id} (extract_field) requires extractPath in config`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if a path is valid in the schema
 */
function isPathValid(path: string, schema: Record<string, FieldDefinition>): boolean {
  // Check exact match
  if (path in schema) {
    return true;
  }

  // Check if path matches array pattern (e.g., "items[].field" matches "items[].field")
  const arrayPattern = path.replace(/\[\]/g, '[]');
  if (arrayPattern in schema) {
    return true;
  }

  // Check if parent path exists (for nested paths)
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const parentPath = parts.slice(0, i).join('.');
    if (parentPath in schema) {
      return true;
    }
  }

  return false;
}

/**
 * Validate entity extraction rules
 */
export function validateEntityExtractionRules(
  entityRules: any[],
  relationshipRules: any[],
  inputSchema?: Record<string, FieldDefinition>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const rule of entityRules) {
    // Validate required mappings
    if (!rule.mappings?.name) {
      errors.push(`Entity rule ${rule.entityType} missing name mapping`);
    }

    // Validate paths exist in schema
    if (inputSchema) {
      if (rule.mappings.name && !isPathValid(rule.mappings.name, inputSchema)) {
        errors.push(`Entity rule ${rule.entityType}: name path "${rule.mappings.name}" not found in schema`);
      }

      if (rule.mappings.externalId && !isPathValid(rule.mappings.externalId, inputSchema)) {
        errors.push(`Entity rule ${rule.entityType}: externalId path "${rule.mappings.externalId}" not found in schema`);
      }

      // Validate data mappings
      if (rule.mappings.data) {
        for (const [key, path] of Object.entries(rule.mappings.data)) {
          if (typeof path === 'string' && !isPathValid(path, inputSchema)) {
            errors.push(`Entity rule ${rule.entityType}: data path "${path}" not found in schema`);
          }
        }
      }
    }
  }

  for (const rule of relationshipRules) {
    // Validate required fields
    if (!rule.sourcePath || !rule.targetPath) {
      errors.push(`Relationship rule ${rule.relation} missing sourcePath or targetPath`);
    }

    // Validate paths exist in schema
    if (inputSchema) {
      if (rule.sourcePath && !isPathValid(rule.sourcePath, inputSchema)) {
        errors.push(`Relationship rule ${rule.relation}: sourcePath "${rule.sourcePath}" not found in schema`);
      }

      if (rule.targetPath && !isPathValid(rule.targetPath, inputSchema)) {
        errors.push(`Relationship rule ${rule.relation}: targetPath "${rule.targetPath}" not found in schema`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate that required fields are present in data
 */
export function validateRequiredFields(
  data: any,
  schema: Record<string, FieldDefinition>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [path, fieldDef] of Object.entries(schema)) {
    if (fieldDef.required) {
      const value = get(data, path);
      if (value === null || value === undefined) {
        errors.push(`Required field missing: ${path}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get field definition for a path
 */
export function getFieldDefinition(
  path: string,
  schema: Record<string, FieldDefinition>
): FieldDefinition | undefined {
  return schema[path];
}

/**
 * Check if a field is a key
 */
export function isKeyField(
  path: string,
  schema: Record<string, FieldDefinition>
): boolean {
  const fieldDef = schema[path];
  return fieldDef?.isKey === true;
}

/**
 * Check if a field is a foreign key
 */
export function isForeignKeyField(
  path: string,
  schema: Record<string, FieldDefinition>
): boolean {
  const fieldDef = schema[path];
  return fieldDef?.isForeignKey === true;
}


