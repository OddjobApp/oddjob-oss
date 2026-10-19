import { z } from "zod";

/**
 * Request and response contracts for the legacy HIL forms API and the
 * instant-app form block. Pure (no database), so each rule is unit-tested.
 */

/**
 * What PUT /api/forms/:id may change.
 *
 * The route used to pass req.body straight to `db.update().set()`, so a caller
 * could rewrite any column, including `organizationId` (moving a form into
 * another tenant), `status`, or submitted `data`. Unknown keys are rejected
 * rather than silently dropped, so a caller learns its field was not saved.
 */
export const formUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(300).optional(),
        description: z.string().max(10000).nullable().optional(),
        schema: z.object({ fields: z.array(z.record(z.any())) }).passthrough().optional(),
        themeConfig: z.record(z.any()).optional(),
        securityConfig: z.record(z.any()).optional(),
        isArchived: z.boolean().optional(),
    })
    .strict();

export type FormUpdate = z.infer<typeof formUpdateSchema>;

/**
 * What POST /api/forms may set when authoring a template.
 *
 * `organizationId` comes from the caller's session, never the body (the route
 * used to honour a body value, so anyone could create forms in another org).
 * `stepExecutionId` is refused: a form is linked to a pipeline step by the step
 * that runs it, and accepting it here let a caller attach a form to a step in
 * another organization.
 */
export const formCreateSchema = z
    .object({
        name: z.string().trim().min(1).max(300),
        description: z.string().max(10000).nullable().optional(),
        schema: z.object({ fields: z.array(z.record(z.any())) }).passthrough().optional(),
        themeConfig: z.record(z.any()).optional(),
        securityConfig: z.record(z.any()).optional(),
        config: z.record(z.any()).optional(),
    })
    .strict();

export type FormCreate = z.infer<typeof formCreateSchema>;

/** Field shape PlatformFormBlock renders. */
export interface BlockFormField {
    id: string;
    type: "text" | "textarea" | "number" | "email" | "select" | "checkbox" | "switch" | "date" | "url";
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    validation?: { min?: number; max?: number };
}

export interface BlockForm {
    id: number;
    name: string;
    description?: string;
    fields: BlockFormField[];
}

const TYPE_MAP: Record<string, BlockFormField["type"]> = {
    text: "text",
    string: "text",
    textarea: "textarea",
    markdown: "textarea",
    url_list: "textarea",
    number: "number",
    rating: "number",
    email: "email",
    url: "url",
    select: "select",
    radio: "select",
    multiselect: "select",
    checkbox: "checkbox",
    boolean: "checkbox",
    switch: "switch",
    date: "date",
    datetime: "date",
};

function toOptions(options: unknown): BlockFormField["options"] {
    if (!Array.isArray(options)) return undefined;
    const mapped = options
        .map((option) => {
            if (option == null) return null;
            if (typeof option === "object") {
                const value = String((option as any).value ?? (option as any).label ?? "");
                return value ? { value, label: String((option as any).label ?? value) } : null;
            }
            const value = String(option);
            return value.trim() ? { value, label: value } : null;
        })
        .filter((option): option is { value: string; label: string } => option !== null);
    return mapped.length ? mapped : undefined;
}

/**
 * Map a stored HIL form field (keyed by `key`, the builder's shape) to the
 * block's field (keyed by `id`). Returns null for fields a respondent does not
 * fill in: computed fields are derived, and a field with no key cannot be
 * submitted. Types the block cannot draw fall back to a text input.
 */
export function toBlockField(field: Record<string, any>): BlockFormField | null {
    const id = String(field?.key ?? field?.name ?? field?.id ?? "").trim();
    if (!id) return null;
    const rawType = String(field?.type ?? "text").toLowerCase();
    if (rawType === "computed") return null;

    const type = TYPE_MAP[rawType] ?? "text";
    const mapped: BlockFormField = {
        id,
        type,
        label: String(field?.label ?? id),
        required: Boolean(field?.required),
    };
    if (typeof field?.placeholder === "string" && field.placeholder) mapped.placeholder = field.placeholder;

    const options = toOptions(field?.options);
    if (options && type === "select") mapped.options = options;

    if (rawType === "rating") {
        mapped.validation = { min: 1, max: Number.isFinite(field?.max) ? Number(field.max) : 5 };
    } else if (type === "number" && (Number.isFinite(field?.min) || Number.isFinite(field?.max))) {
        mapped.validation = {
            ...(Number.isFinite(field?.min) ? { min: Number(field.min) } : {}),
            ...(Number.isFinite(field?.max) ? { max: Number(field.max) } : {}),
        };
    }
    return mapped;
}

export function toBlockForm(row: { id: number; name: string | null; description?: string | null; schema: unknown }): BlockForm {
    const fields = Array.isArray((row.schema as any)?.fields) ? ((row.schema as any).fields as Record<string, any>[]) : [];
    return {
        id: row.id,
        name: row.name || "Form",
        ...(row.description ? { description: row.description } : {}),
        fields: fields.map(toBlockField).filter((field): field is BlockFormField => field !== null),
    };
}

/** Required block fields with no value in `data`, by id. */
export function missingRequiredFields(fields: BlockFormField[], data: Record<string, unknown>): string[] {
    return fields
        .filter((field) => field.required)
        .filter((field) => {
            const value = data[field.id];
            return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
        })
        .map((field) => field.id);
}
