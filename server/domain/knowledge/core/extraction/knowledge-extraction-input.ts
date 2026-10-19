import { BadRequestError } from "@server/utils/errors.js";

export function parseExtractionId(value: string, label: string): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestError(`Invalid ${label} ID`);
    return id;
}

export function parseSingleExtractionInput(value: unknown): {
    documentId: number;
    schemaId: number;
    priority: number;
} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new BadRequestError("Extraction request must be an object");
    }
    const input = value as Record<string, unknown>;
    const documentId = parseExtractionId(String(input.documentId ?? ""), "document");
    const schemaId = parseExtractionId(String(input.schemaId ?? ""), "schema");
    const priority = input.priority === undefined ? 0 : Number(input.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
        throw new BadRequestError("Priority must be an integer between 0 and 10");
    }
    return { documentId, schemaId, priority };
}
