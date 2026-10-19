/**
 * Automated Payload Schema Inference Engine
 *
 * Parses raw JSON/XML event ingress payloads, infers JSON Schema specifications with type confidence scores,
 * and detects structural schema drift across event streams.
 */

import { createLogger } from "@server/utils/logger.js";
import { XMLParser } from "fast-xml-parser";

const logger = createLogger("EventSchemaInferencer");

export interface InferredFieldProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | "null" | "unknown";
  required: boolean;
  confidenceScore: number;
  sampleValue?: any;
  items?: InferredFieldProperty;
  properties?: Record<string, InferredFieldProperty>;
}

export interface InferredSchemaResult {
  title: string;
  inferredAt: Date;
  totalFieldsCount: number;
  confidenceAverage: number;
  jsonSchema: {
    $schema: string;
    type: string;
    properties: Record<string, InferredFieldProperty>;
    required: string[];
  };
}

export interface SchemaDriftCheckResult {
  hasDrift: boolean;
  similarityScore: number; // 0.0 to 1.0
  addedFields: string[];
  removedFields: string[];
  typeMismatches: Array<{ field: string; expected: string; actual: string }>;
}

export class EventSchemaInferencerService {
  private xmlParser = new XMLParser({ ignoreAttributes: false });

  /**
   * Infers structural JSON Schema draft spec from raw input string or object
   */
  inferSchemaFromPayload(rawPayload: string | Record<string, any>, title = "InferredEventSchema"): InferredSchemaResult {
    let parsedObj: Record<string, any>;

    if (typeof rawPayload === "string") {
      const trimmed = rawPayload.trim();
      if (trimmed.startsWith("<")) {
        try {
          parsedObj = this.xmlParser.parse(trimmed);
        } catch {
          throw new Error("Malformed XML payload submitted for schema inference");
        }
      } else {
        try {
          parsedObj = JSON.parse(trimmed);
        } catch {
          throw new Error("Malformed JSON payload submitted for schema inference");
        }
      }
    } else {
      parsedObj = rawPayload;
    }

    const properties: Record<string, InferredFieldProperty> = {};
    const required: string[] = [];
    let totalScore = 0;
    let fieldsCount = 0;

    for (const [key, value] of Object.entries(parsedObj)) {
      const inferredProp = this.inferValueProperty(value);
      properties[key] = inferredProp;
      required.push(key);
      totalScore += inferredProp.confidenceScore;
      fieldsCount++;
    }

    const confidenceAverage = fieldsCount > 0 ? Math.round((totalScore / fieldsCount) * 100) / 100 : 1.0;

    logger.info(`[EventSchemaInferencer] Successfully inferred schema '${title}' across ${fieldsCount} fields (Avg Confidence: ${confidenceAverage})`);

    return {
      title,
      inferredAt: new Date(),
      totalFieldsCount: fieldsCount,
      confidenceAverage,
      jsonSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties,
        required,
      },
    };
  }

  /**
   * Evaluates structural drift between a baseline schema and a new payload
   */
  checkSchemaDrift(baselineSchema: InferredSchemaResult, newPayload: string | Record<string, any>): SchemaDriftCheckResult {
    const newSchema = this.inferSchemaFromPayload(newPayload, "ComparisonPayload");

    const baselineKeys = Object.keys(baselineSchema.jsonSchema.properties);
    const newKeys = Object.keys(newSchema.jsonSchema.properties);

    const addedFields = newKeys.filter((k) => !baselineKeys.includes(k));
    const removedFields = baselineKeys.filter((k) => !newKeys.includes(k));
    const typeMismatches: Array<{ field: string; expected: string; actual: string }> = [];

    for (const key of baselineKeys) {
      if (newSchema.jsonSchema.properties[key]) {
        const expectedType = baselineSchema.jsonSchema.properties[key].type;
        const actualType = newSchema.jsonSchema.properties[key].type;
        if (expectedType !== actualType) {
          typeMismatches.push({ field: key, expected: expectedType, actual: actualType });
        }
      }
    }

    const totalFields = new Set([...baselineKeys, ...newKeys]).size;
    const unchangedFields = baselineKeys.filter((k) => newKeys.includes(k) && !typeMismatches.some((m) => m.field === k)).length;
    const similarityScore = totalFields > 0 ? Math.round((unchangedFields / totalFields) * 100) / 100 : 1.0;
    const hasDrift = addedFields.length > 0 || removedFields.length > 0 || typeMismatches.length > 0;

    return {
      hasDrift,
      similarityScore,
      addedFields,
      removedFields,
      typeMismatches,
    };
  }

  private inferValueProperty(val: any): InferredFieldProperty {
    if (val === null || val === undefined) {
      return { type: "null", required: true, confidenceScore: 0.5 };
    }

    const valType = typeof val;

    if (valType === "string") {
      return { type: "string", required: true, confidenceScore: 0.98, sampleValue: val };
    }
    if (valType === "number") {
      return { type: "number", required: true, confidenceScore: 0.99, sampleValue: val };
    }
    if (valType === "boolean") {
      return { type: "boolean", required: true, confidenceScore: 1.0, sampleValue: val };
    }

    if (Array.isArray(val)) {
      const sampleItem = val.length > 0 ? this.inferValueProperty(val[0]) : undefined;
      return { type: "array", required: true, confidenceScore: 0.9, sampleValue: val.slice(0, 3), items: sampleItem };
    }

    if (valType === "object") {
      const nestedProps: Record<string, InferredFieldProperty> = {};
      for (const [k, v] of Object.entries(val)) {
        nestedProps[k] = this.inferValueProperty(v);
      }
      return { type: "object", required: true, confidenceScore: 0.95, properties: nestedProps };
    }

    return { type: "unknown", required: false, confidenceScore: 0.1 };
  }
}

export const eventSchemaInferencerService = new EventSchemaInferencerService();
