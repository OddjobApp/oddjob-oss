import { z, type ZodTypeAny } from "zod";
import { safeJsonParse } from "@server/utils/json-repair.js";

export interface StructuredOutputResult<T> {
    success: boolean;
    value?: T;
    raw: string;
    repaired: boolean;
    errors: string[];
}

function stripCodeFence(raw: string): string {
    return raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, "$1").trim();
}

export class StructuredOutputService {
    parse<TSchema extends ZodTypeAny>(
        raw: string,
        schema: TSchema,
    ): StructuredOutputResult<z.infer<TSchema>> {
        const stripped = stripCodeFence(raw);
        let repaired = false;
        let parsed: unknown;

        try {
            parsed = JSON.parse(stripped);
        } catch {
            repaired = true;
            parsed = safeJsonParse(stripped);
        }

        const result = schema.safeParse(parsed);
        if (!result.success) {
            return {
                success: false,
                raw,
                repaired,
                errors: result.error.errors.map((err) => `${err.path.join(".") || "<root>"}: ${err.message}`),
            };
        }

        return {
            success: true,
            value: result.data,
            raw,
            repaired,
            errors: [],
        };
    }
}

export const structuredOutputService = new StructuredOutputService();

