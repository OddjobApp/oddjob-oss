import { z } from "zod";

export const skillVariableName = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "Use a lowercase name with underscores");
export const skillInputSchema = z.object({
  name: skillVariableName,
  description: z.string().max(500).optional(),
  example: z.string().max(10000).optional(),
  required: z.boolean().optional(),
  type: z.enum(["string", "date", "number"]).optional(),
});
export type SkillInput = z.infer<typeof skillInputSchema>;
export const skillStepSchema = z.object({
  kind: z.enum(["navigate", "click", "fill", "select", "check", "press", "wait", "extract"]),
  url: z.string().max(10000),
  at: z.number().nonnegative(),
  direct: z.boolean().optional(),
  target: z.object({
    tag: z.string(), css: z.string().min(1), testId: z.string().optional(), id: z.string().optional(),
    role: z.string().optional(), name: z.string().optional(), label: z.string().optional(),
    placeholder: z.string().optional(), nameAttr: z.string().optional(), text: z.string().optional(), inputType: z.string().optional(),
  }).optional(),
  value: z.string().max(20000).optional(), checked: z.boolean().optional(), key: z.string().optional(),
  secret: z.enum(["password", "otp", "payment"]).optional(),
  output: skillVariableName.optional(),
  extractMode: z.enum(["text", "attribute", "structured_json", "table", "url"]).optional(),
  attribute: z.string().optional(),
}).superRefine((step, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (step.kind === "navigate" && !/^https?:\/\//i.test(step.url)) fail("Navigation requires an HTTP(S) URL");
  if (!["navigate", "press"].includes(step.kind) && !(step.kind === "extract" && step.extractMode === "url") && !step.target) fail("This step needs a target");
  if (step.kind === "extract" && !step.output) fail("Extraction needs an output name");
  if (step.extractMode === "attribute" && !step.attribute) fail("Attribute extraction needs an attribute name");
  if (step.output && !["click", "extract"].includes(step.kind)) fail("Only extraction or a download click can return an output");
  if (step.secret && step.value !== undefined) fail("Secret fields cannot contain recorded values");
});
export type SkillStep = z.infer<typeof skillStepSchema>;
export const skillDefinitionSchema = z.object({
  inputs: z.array(skillInputSchema).max(100),
  steps: z.array(skillStepSchema).min(1).max(1000),
}).superRefine(({ inputs, steps }, ctx) => {
  const names = new Set(inputs.map(i => i.name));
  if (names.size !== inputs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Input names must be unique" });
  const outputs = steps.flatMap(s => s.output ? [s.output] : []);
  if (new Set(outputs).size !== outputs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Output names must be unique" });
  for (const step of steps) for (const match of (step.value ?? "").matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)) {
    if (!names.has(match[1])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Define input ${match[1]} before using it` });
  }
});

/**
 * Compiles a list of SkillInputs into a dynamic Zod validation schema.
 * Allows agents or executors to validate task arguments at runtime before replaying.
 */
export function buildRuntimeInputSchema(inputs: SkillInput[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const input of inputs ?? []) {
    let fieldSchema: z.ZodTypeAny;
    switch (input.type) {
      case "number":
        fieldSchema = z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]);
        break;
      case "date":
        fieldSchema = z.string().min(1);
        break;
      case "string":
      default:
        fieldSchema = z.string();
        break;
    }
    if (!input.required) {
      fieldSchema = fieldSchema.optional();
    }
    shape[input.name] = fieldSchema;
  }
  return z.object(shape);
}

