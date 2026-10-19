import { useMemo } from 'react';
import * as yaml from 'js-yaml';
import { validatePipeline as validatePipelineShared, type PipelineValidationError, type PipelineValidationWarning } from '@/utils/pipeline-utils';
import type { Job } from "@shared/schema/jobs/table";

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  path?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface PipelineSchema {
  type: 'object';
  properties: {
    name: { type: 'string'; minLength: 1 };
    description?: { type: 'string' };
    steps: {
      type: 'array';
      items: {
        type: 'object';
        properties: {
          tempId: { type: 'string' };
          jobId: { type: ['number', 'null'] };
          outputName?: { type: 'string' };
          order: { type: 'number' };
          retryConfig?: { type: 'object'; nullable: true };
        };
        required: ['tempId', 'jobId'];
      };
    };
    triggers?: {
      type: 'array';
      items: {
        type: 'object';
        properties: {
          type: {
            type: 'string';
            enum: ['manual', 'webhook', 'event', 'schedule'];
          };
          config: {
            type: 'object';
            description: 'Configuration specific to trigger type';
          };
        };
        minItems: 0;
      };
    };
  };
}

const useSchemaValidation = () => {
  const pipelineSchema: PipelineSchema = useMemo(() => ({
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        description: 'Human-readable name for the pipeline'
      },
      description: {
        type: 'string',
        description: 'Detailed description of what the pipeline does'
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tempId: {
              type: 'string',
              pattern: '^step_[a-zA-Z0-9_]+$',
              description: 'Unique identifier for the step'
            },
            jobId: {
              type: ['number', 'null'],
              description: 'Reference to the job definition to execute'
            },
            outputName: {
              type: 'string',
              description: 'Name of the output variable from this step'
            },
            order: {
              type: 'number',
              minimum: 1,
              description: 'Sequential order of execution'
            },
            retryConfig: {
              type: 'object',
              nullable: true,
              properties: {
                maxRetries: {
                  type: 'number',
                  minimum: 0,
                  maximum: 10,
                  description: 'Maximum number of retry attempts'
                },
                retryDelay: {
                  type: 'number',
                  minimum: 100,
                  description: 'Delay between retry attempts in milliseconds'
                }
              }
            }
          },
          required: ['tempId', 'jobId']
        }
      },
      triggers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['manual', 'webhook', 'event', 'schedule'],
              description: 'Type of trigger that initiates the pipeline'
            },
            config: {
              type: 'object',
              description: 'Configuration specific to trigger type'
            }
          },
          minItems: 0
        }
      }
    }
  }), []);

  const validatePipeline = (pipeline: any, jobs: Job[] = []): ValidationResult => {
    const result = validatePipelineShared(pipeline, jobs);

    const errors: ValidationError[] = result.errors.map((err: PipelineValidationError) => ({
      line: 0,
      column: 0,
      message: err.message,
      severity: 'error',
      path: err.field
    }));

    const warnings: ValidationError[] = result.warnings.map((warn: PipelineValidationWarning) => ({
      line: 0,
      column: 0,
      message: warn.message,
      severity: 'warning',
      path: warn.field
    }));

    return {
      isValid: result.isValid,
      errors,
      warnings
    };
  };

  const validateYAML = (yamlContent: string): ValidationResult => {
    const errors: ValidationError[] = [];

    try {
      // Basic YAML structure check
      const lines = yamlContent.split('\n');
      let lineNumber = 0;

      for (const line of lines) {
        lineNumber++;

        if (line.includes('\t') && !line.trim().startsWith('"')) {
          errors.push({
            line: lineNumber,
            column: line.indexOf('\t'),
            message: 'Invalid YAML indentation: use spaces instead of tabs',
            severity: 'error'
          });
        }

        // Check for trailing whitespace
        if (line.endsWith(' ')) {
          errors.push({
            line: lineNumber,
            column: line.length,
            message: 'Trailing whitespace not allowed',
            severity: 'warning'
          });
        }
      }

      if (errors.length === 0) {
        // Try parsing as YAML
        yaml.load(yamlContent);
      }
    } catch (error) {
      errors.push({
        line: 1,
        column: 1,
        message: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: errors.filter(e => e.severity === 'warning')
    };
  };

  const formatJSON = (json: string): string => {
    try {
      const parsed = JSON.parse(json);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  };

  const formatYAML = (obj: any): string => {
    try {
      return yaml.dump(obj, { indent: 2, lineWidth: 0 });
    } catch (error) {
      throw new Error('Failed to format as YAML');
    }
  };

  return {
    pipelineSchema,
    validatePipeline,
    validateYAML,
    formatJSON,
    formatYAML
  };
};

export default useSchemaValidation;
