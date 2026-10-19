import { z } from "zod";
import { expressionReferences, tryEvaluateExpression } from "./form-expression";

/**
 * Form Studio definitions: what a form asks, how it scores, what it decides, and
 * what each audience sees. The server, the Studio and the tests share this module,
 * so a preview, a test run and a real submission compute the same thing.
 *
 * Version 2 adds stages, page navigation, groups, rating scales, result blocks,
 * ordered decision rules, actions and a response dataset. `fields` stays top-level
 * because pipeline steps, the instant-app form block and built apps read
 * `schema.fields` directly. Version 1 definitions and plain `{ fields }` forms are
 * upgraded on read.
 */

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "must start with a letter and use only letters, digits and underscores").max(100);
const expression = z.string().max(4000);
const title = z.string().min(1).max(300);

export const STUDIO_FIELD_TYPES = [
  "text", "number", "textarea", "markdown", "select", "multiselect", "radio", "rating", "slider", "boolean",
  "computed", "location", "geo", "date", "datetime", "time", "email", "url", "query",
] as const;
const NUMERIC_TYPES: ReadonlySet<string> = new Set(["number", "rating", "slider"]);

/**
 * Unset field properties arrive as null from Org Forge installs (`placeholder: null`,
 * `options: null`) and older builders. They mean "not set", but a strict optional()
 * rejected them, so no Org Forge form could be duplicated or saved in the Studio.
 */
const withoutNulls = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null))
    : value;

export const studioFieldSchema = z.preprocess(withoutNulls, z.object({
  key, label: z.string().min(1).max(300),
  type: z.enum(STUDIO_FIELD_TYPES),
  description: z.string().max(10000).optional(), required: z.boolean().optional(),
  options: z.array(z.union([z.string(), z.object({ label: z.string(), value: z.string() })])).optional(),
  defaultValue: z.string().optional(), placeholder: z.string().optional(), readOnly: z.boolean().optional(),
  min: z.number().optional(), max: z.number().optional(), unit: z.string().optional(),
  formula: z.string().max(4000).optional(), format: z.enum(["number", "currency", "percent", "text"]).optional(),
  url: z.string().optional(), jsonPath: z.string().optional(), params: z.record(z.any()).optional(),
  cacheTtlSeconds: z.number().int().min(0).max(86400).optional(), credentialId: z.number().optional(),
  pageId: z.string().optional(), visibleWhen: z.string().max(4000).optional(), source: z.string().optional(),
  // The name a source document used when it is not a valid formula identifier,
  // e.g. the succession spec's "360_leadership_reputation_score" kept as key
  // "leadership_360_score". Import and export map through it.
  sourceKey: z.string().max(200).optional(),
  // A block of questions within a page, and a rating scale shared by several questions.
  group: z.string().optional(), scale: z.string().optional(),
}).passthrough());

const pageSchema = z.object({ id: key, title: z.string().min(1), html: z.string().max(50000).default(""), visibleWhen: z.string().optional() });
const sourceSchema = z.object({ id: z.number().int().positive(), title: z.string(), updatedAt: z.string(), digest: z.string() });

const studioDefinitionV1Schema = z.object({
  fields: z.array(studioFieldSchema).max(500),
  studio: z.object({
    version: z.literal(1), pages: z.array(pageSchema).min(1).max(100),
    sources: z.array(sourceSchema).default([]),
    issues: z.array(z.string()).default([]), reports: z.array(pageSchema).default([]),
    tests: z.array(z.object({ name: z.string(), inputs: z.record(z.any()), expected: z.record(z.any()) })).default([]),
  }),
}).passthrough();

const navigationSchema = z.object({
  mode: z.enum(["paged", "single"]).default("paged"),
  allowBack: z.boolean().default(true),
  reviewBeforeSubmit: z.boolean().default(true),
  showProgress: z.boolean().default(true),
});
const groupSchema = z.object({ id: key, title, description: z.string().max(10000).optional(), visibleWhen: expression.optional() });
// anchors label points on the scale, e.g. { "1": "Strongly disagree", "5": "Strongly agree" }.
const scaleSchema = z.object({ id: key, label: title, min: z.number(), max: z.number(), step: z.number().positive().optional(), anchors: z.record(z.string()).optional() });
const assigneeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respondent") }),
  z.object({ type: z.literal("role"), role: z.string().min(1).max(200) }),
  z.object({ type: z.literal("person"), userId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("agent"), agent: z.string().min(1).max(200) }),
]);
// A stage is who fills in which pages, and which earlier stages' answers they may see.
const stageSchema = z.object({ id: key, title, pageIds: z.array(key).min(1), assignee: assigneeSchema, sees: z.array(key).default([]) });

const audienceSchema = z.enum(["respondent", "reviewer"]);
const bandSchema = z.object({ min: z.number(), max: z.number(), label: z.string().min(1).max(200), tone: z.enum(["good", "warning", "critical", "neutral"]).default("neutral") });
const gridAxisSchema = z.object({ field: key, label: title, cuts: z.array(z.number()).min(1).max(9) });
// Blocks default to reviewers: a block shown to the wrong audience can reveal
// what a respondent must not see, such as a candidate's flight risk.
const resultHead = { id: key, title, audience: audienceSchema.default("reviewer"), visibleWhen: expression.optional() };
const resultBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...resultHead, type: z.literal("score"), field: key, bands: z.array(bandSchema).default([]), format: z.enum(["number", "currency", "percent", "text"]).optional() }),
  z.object({ ...resultHead, type: z.literal("breakdown"), items: z.array(z.object({ field: key, label: title, weight: z.number().optional() })).min(1) }),
  // Without `field`, the status is the decision rules' outcome.
  z.object({ ...resultHead, type: z.literal("status"), field: key.optional(), labels: z.record(z.string()).default({}) }),
  z.object({ ...resultHead, type: z.literal("gates"), items: z.array(z.object({ label: title, trippedWhen: expression })).min(1) }),
  // cells[row][column]: row 0 is the lowest band of y, column 0 the lowest band of x.
  z.object({ ...resultHead, type: z.literal("grid"), x: gridAxisSchema, y: gridAxisSchema, cells: z.array(z.array(z.string().max(200))) }),
  z.object({ ...resultHead, type: z.literal("narrative"), html: z.string().max(50000) }),
  // This response's value against a cohort metric over earlier responses, with how many and as of when.
  z.object({ ...resultHead, type: z.literal("cohort"), field: key, metric: key, format: z.enum(["number", "currency", "percent", "text"]).optional() }),
]);

const decisionRuleSchema = z.object({ id: key, when: expression, status: z.string().min(1).max(200), label: z.string().max(300).optional(), actions: z.array(key).default([]) });
// Actions are declarations. Nothing runs them yet; each is meant to become an
// approval request that a person approves before anything happens.
const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: key, label: title, type: z.literal("start_pipeline"), pipelineId: z.number().int().positive(), approverRole: z.string().max(200).optional() }),
  z.object({ id: key, label: title, type: z.literal("notify"), channel: z.enum(["inbox", "email", "slack"]), to: z.string().min(1).max(300), message: z.string().max(4000) }),
]);

// A metric over this form's earlier completed responses, which formulas, rules and
// result blocks read as cohort.<id>, with cohort.<id>.rows and cohort.<id>.asOf.
const cohortSchema = z.object({
  id: key, label: title,
  aggregate: z.enum(["count", "sum", "avg", "min", "max"]),
  // The value aggregated from each earlier response; a count needs none.
  field: key.optional(),
  // Which earlier responses count, e.g. "readiness_horizon == 'Emergency_Ready_Now' && lri >= 85".
  where: expression.optional(),
});

const studioSettingsSchema = z.object({
  version: z.literal(2),
  pages: z.array(pageSchema).min(1).max(100),
  navigation: navigationSchema.default({}),
  groups: z.array(groupSchema).max(200).default([]),
  scales: z.array(scaleSchema).max(50).default([]),
  stages: z.array(stageSchema).max(20).default([]),
  results: z.array(resultBlockSchema).max(100).default([]),
  decisionRules: z.array(decisionRuleSchema).max(100).default([]),
  defaultStatus: z.string().min(1).max(200).optional(),
  actions: z.array(actionSchema).max(50).default([]),
  dataset: z.object({ datasetId: z.number().int().positive() }).nullable().default(null),
  cohorts: z.array(cohortSchema).max(20).default([]),
  sources: z.array(sourceSchema).default([]),
  issues: z.array(z.string()).default([]),
  tests: z.array(z.object({ name: z.string(), inputs: z.record(z.any()), expected: z.record(z.any()).default({}), expectedStatus: z.string().optional() })).default([]),
});

export const studioDefinitionSchema = z.object({
  fields: z.array(studioFieldSchema).max(500),
  studio: studioSettingsSchema,
}).passthrough();

export type StudioDefinition = z.infer<typeof studioDefinitionSchema>;
export type StudioField = z.infer<typeof studioFieldSchema>;
export type StudioStage = z.infer<typeof stageSchema>;
export type StudioResultBlock = z.infer<typeof resultBlockSchema>;
export type StudioCohort = z.infer<typeof cohortSchema>;

/** A cohort metric the server computed for an evaluation: its value, how many responses it covers, and when. */
export interface CohortValue { value: number | ""; rows: number; asOf: string }
export type CohortValues = Record<string, CohortValue>;

/** A response's values without the cohort metrics it was evaluated with, for storing as its answers. */
export function withoutCohortValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => !name.startsWith("cohort.")));
}
export type StudioAudience = z.infer<typeof audienceSchema>;
export interface FormStudioSelection { formId: number; revision: number; kind: "application" | "page" | "field" | "report" | "result" | "rule" | "stage"; key: string; label: string }
export const formStudioScopePrefix = (s: FormStudioSelection) => `[Form Studio selection: ${JSON.stringify(s)}]`;

/**
 * Any stored form as a version 2 definition.
 *
 * A plain `{ fields }` form (Form Builder, Org Forge, agent-published) keeps its
 * fields as they are, unvalidated, so the Studio can open forms using types it
 * does not know; parseStudioDefinition validates them when the form is saved.
 */
export function asStudioDefinition(schema: any): StudioDefinition {
  const version = schema?.studio?.version;
  if (version === 2) return studioDefinitionSchema.parse(schema);
  if (version === 1) return upgradeV1(studioDefinitionV1Schema.parse(schema));
  if (schema?.studio) throw new Error(`Unsupported Form Studio definition version: ${String(version)}.`);
  return {
    ...(schema ?? {}),
    fields: Array.isArray(schema?.fields) ? schema.fields : [],
    studio: studioSettingsSchema.parse({ version: 2, pages: [{ id: "page_1", title: "Form" }] }),
  } as StudioDefinition;
}

/** A definition submitted for saving: upgraded if it is older, and fully validated. */
export function parseStudioDefinition(input: unknown): StudioDefinition {
  return studioDefinitionSchema.parse(asStudioDefinition(input));
}

function upgradeV1(v1: z.infer<typeof studioDefinitionV1Schema>): StudioDefinition {
  const { studio, ...rest } = v1;
  return studioDefinitionSchema.parse({
    ...rest,
    studio: {
      version: 2, pages: studio.pages, sources: studio.sources, issues: studio.issues, tests: studio.tests,
      // Version 1 reports were HTML with {{field}} bindings. They become narrative
      // blocks for reviewers: nothing showed them to respondents, and a report can
      // hold scores a respondent should not see.
      results: studio.reports.map(report => ({
        id: report.id, title: report.title, type: "narrative", audience: "reviewer", html: report.html,
        ...(report.visibleWhen ? { visibleWhen: report.visibleWhen } : {}),
      })),
    },
  });
}

const BINDING = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

function isAbsent(value: unknown): boolean {
  return value === "" || value === null || value === undefined;
}
function truthy(value: unknown): boolean {
  return !!value && value !== "0" && value !== "false" && value !== 0;
}

export function orderedComputedFields(fields: StudioField[]): StudioField[] {
  const computed = new Map(fields.filter(f => f.type === "computed").map(f => [f.key, f]));
  const visited = new Set<string>(), active = new Set<string>(), result: StudioField[] = [];
  function visit(name: string) {
    if (visited.has(name)) return;
    if (active.has(name)) throw new Error(`Circular formula dependency: ${name}`);
    active.add(name);
    const field = computed.get(name)!;
    for (const ref of expressionReferences(field.formula || "")) if (computed.has(ref)) visit(ref);
    active.delete(name); visited.add(name); result.push(field);
  }
  for (const name of computed.keys()) visit(name);
  return result;
}

/** Problems that block publishing. A draft may be saved with them. */
export function definitionIssues(def: StudioDefinition): string[] {
  const issues: string[] = [];
  const { studio } = def;
  const requireUnique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) issues.push(`${label} IDs must be unique.`); };
  requireUnique("Page", studio.pages.map(p => p.id));
  requireUnique("Group", studio.groups.map(g => g.id));
  requireUnique("Scale", studio.scales.map(s => s.id));
  requireUnique("Stage", studio.stages.map(s => s.id));
  requireUnique("Result", studio.results.map(r => r.id));
  requireUnique("Rule", studio.decisionRules.map(r => r.id));
  requireUnique("Action", studio.actions.map(a => a.id));
  requireUnique("Cohort", studio.cohorts.map(c => c.id));

  const pageIds = new Set(studio.pages.map(p => p.id));
  const groupIds = new Set(studio.groups.map(g => g.id));
  const scaleIds = new Set(studio.scales.map(s => s.id));
  const actionIds = new Set(studio.actions.map(a => a.id));
  const cohortIds = new Set(studio.cohorts.map(c => c.id));
  const cohortRefs = new Set(studio.cohorts.flatMap(c => [`cohort.${c.id}`, `cohort.${c.id}.rows`, `cohort.${c.id}.asOf`]));
  const keys = new Set<string>();
  for (const f of def.fields) {
    if (keys.has(f.key)) issues.push(`Duplicate field: ${f.key}`);
    keys.add(f.key);
    if (f.pageId && !pageIds.has(f.pageId)) issues.push(`${f.key}: page does not exist.`);
    if (f.group && !groupIds.has(f.group)) issues.push(`${f.key}: group ${f.group} does not exist.`);
    if (f.scale && !NUMERIC_TYPES.has(f.type)) issues.push(`${f.key}: only number, rating and slider fields can use a scale.`);
    else if (f.scale && !scaleIds.has(f.scale)) issues.push(`${f.key}: scale ${f.scale} does not exist.`);
    if (f.type === "computed" && !f.formula?.trim()) issues.push(`${f.key}: formula is required.`);
  }
  for (const scale of studio.scales) if (scale.min >= scale.max) issues.push(`Scale ${scale.id}: its minimum must be below its maximum.`);

  const stagedPages = new Map<string, string>();
  studio.stages.forEach((stage, index) => {
    for (const pageId of stage.pageIds) {
      if (!pageIds.has(pageId)) issues.push(`Stage ${stage.id}: page ${pageId} does not exist.`);
      else if (stagedPages.has(pageId)) issues.push(`Page ${pageId} is in both stage ${stagedPages.get(pageId)} and stage ${stage.id}.`);
      else stagedPages.set(pageId, stage.id);
    }
    const earlier = new Set(studio.stages.slice(0, index).map(s => s.id));
    for (const seen of stage.sees) if (!earlier.has(seen)) issues.push(`Stage ${stage.id}: can only see earlier stages, and ${seen} is not one.`);
  });
  if (studio.stages.length) {
    for (const page of studio.pages) if (!stagedPages.has(page.id)) issues.push(`Page ${page.id} is not in any stage, so nobody is asked to fill it in.`);
  }

  const knownField = (label: string, field: string) => { if (!keys.has(field)) issues.push(`${label}: unknown field ${field}.`); };
  for (const page of studio.pages) for (const match of page.html.matchAll(BINDING)) knownField(page.title, match[1]);
  for (const block of studio.results) {
    const label = `Result ${block.id}`;
    switch (block.type) {
      case "score":
        knownField(label, block.field);
        for (const band of block.bands) if (band.min > band.max) issues.push(`${label}: band "${band.label}" starts above where it ends.`);
        break;
      case "breakdown":
        for (const item of block.items) knownField(label, item.field);
        break;
      case "status":
        if (block.field) knownField(label, block.field);
        else if (!studio.decisionRules.length && !studio.defaultStatus) issues.push(`${label}: the form has no decision rules, so name the field that holds the status.`);
        break;
      case "grid": {
        for (const axis of [block.x, block.y]) {
          knownField(label, axis.field);
          if (axis.cuts.some((cut, i) => i > 0 && cut <= axis.cuts[i - 1])) issues.push(`${label}: ${axis.label} cut points must increase.`);
        }
        const rows = block.y.cuts.length + 1, columns = block.x.cuts.length + 1;
        if (block.cells.length !== rows || block.cells.some(row => row.length !== columns)) issues.push(`${label}: needs ${rows} rows of ${columns} cells.`);
        break;
      }
      case "narrative":
        for (const match of block.html.matchAll(BINDING)) knownField(label, match[1]);
        break;
      case "cohort":
        knownField(label, block.field);
        if (!cohortIds.has(block.metric)) issues.push(`${label}: cohort ${block.metric} does not exist.`);
        break;
      case "gates":
        break;
    }
  }
  for (const cohort of studio.cohorts) {
    const label = `Cohort ${cohort.id}`;
    const verb = { sum: "sum", avg: "average", min: "take the minimum of", max: "take the maximum of", count: "count" }[cohort.aggregate];
    if (cohort.aggregate !== "count" && !cohort.field) issues.push(`${label}: name the field to ${verb}.`);
    if (cohort.field) knownField(label, cohort.field);
    if (cohort.where) {
      // A condition reads an earlier response's own answers, not other cohorts.
      try { for (const ref of expressionReferences(cohort.where)) if (!keys.has(ref)) issues.push(`${label}: unknown field ${ref}.`); }
      catch (error) { issues.push(`${label}: ${(error as Error).message}`); }
    }
  }
  for (const rule of studio.decisionRules) {
    for (const action of rule.actions) if (!actionIds.has(action)) issues.push(`Rule ${rule.id}: action ${action} does not exist.`);
  }

  const expressions = [
    ...def.fields.flatMap(f => [f.formula, f.visibleWhen].filter(Boolean).map(expr => ({ label: f.key, expr: expr! }))),
    ...[...studio.pages, ...studio.groups].filter(x => x.visibleWhen).map(x => ({ label: x.title, expr: x.visibleWhen! })),
    ...studio.results.filter(b => b.visibleWhen).map(b => ({ label: `Result ${b.id}`, expr: b.visibleWhen! })),
    ...studio.results.flatMap(b => (b.type === "gates" ? b.items.map(item => ({ label: `Result ${b.id}`, expr: item.trippedWhen })) : [])),
    ...studio.decisionRules.map(rule => ({ label: `Rule ${rule.id}`, expr: rule.when })),
  ];
  for (const { label, expr } of expressions) {
    try { for (const ref of expressionReferences(expr)) if (!keys.has(ref) && !cohortRefs.has(ref)) issues.push(`${label}: unknown field ${ref}.`); }
    catch (error) { issues.push(`${label}: ${(error as Error).message}`); }
  }
  try { orderedComputedFields(def.fields); } catch (error) { issues.push((error as Error).message); }
  return [...new Set(issues)];
}

/** The pages a stage's assignee fills in. */
export function pagesOfStage(def: StudioDefinition, stageId: string): Set<string> {
  const stage = def.studio.stages.find(s => s.id === stageId);
  if (!stage) throw new Error(`Stage ${stageId} does not exist.`);
  return new Set(stage.pageIds);
}

export type StudioDecision =
  | { state: "none" }
  | { state: "decided"; status: string; ruleId: string | null; actions: string[] }
  | { state: "pending"; ruleId: string; waitingOn: string[] }
  | { state: "error"; ruleId: string; message: string }
  | { state: "undecided" };

/**
 * The first decision rule that holds, in order.
 *
 * A rule that cannot be answered yet stops the evaluation: skipping it would let a
 * later, weaker rule issue a status the unanswered rule could have overridden,
 * such as a hard stop whose input has not arrived.
 */
export function evaluateDecision(def: StudioDefinition, values: Record<string, any>): StudioDecision {
  const { decisionRules, defaultStatus } = def.studio;
  if (!decisionRules.length && !defaultStatus) return { state: "none" };
  for (const rule of decisionRules) {
    const outcome = tryEvaluateExpression(rule.when, values);
    if (!outcome.ok) {
      return "missing" in outcome
        ? { state: "pending", ruleId: rule.id, waitingOn: outcome.missing }
        : { state: "error", ruleId: rule.id, message: outcome.error };
    }
    if (truthy(outcome.value)) return { state: "decided", status: rule.status, ruleId: rule.id, actions: rule.actions };
  }
  return defaultStatus ? { state: "decided", status: defaultStatus, ruleId: null, actions: [] } : { state: "undecided" };
}

export interface EvaluateOptions {
  /** Validate only the pages of this stage, the part being submitted. */
  stageId?: string;
  /** Cohort metrics the server computed. Without them, anything reading a cohort has no value yet. */
  cohort?: CohortValues;
}

export function evaluateStudio(def: StudioDefinition, inputs: Record<string, any>, validate = false, options: EvaluateOptions = {}) {
  const values: Record<string, any> = Object.create(null), errors: Record<string, string> = {};
  const scales = new Map(def.studio.scales.map(s => [s.id, s]));
  for (const f of def.fields.filter(f => f.type !== "computed")) {
    const raw = inputs[f.key] ?? f.defaultValue ?? "";
    const absent = isAbsent(raw) || (Array.isArray(raw) && raw.length === 0);
    if (NUMERIC_TYPES.has(f.type)) values[f.key] = absent ? "" : Number(raw);
    else if (f.type === "boolean") values[f.key] = raw === true || raw === "true";
    else if (f.type === "multiselect") values[f.key] = absent ? "" : (Array.isArray(raw) ? raw.map(String) : [String(raw)]);
    else values[f.key] = raw;
    if (absent) continue;
    const scale = f.scale ? scales.get(f.scale) : undefined;
    const min = f.min ?? scale?.min, max = f.max ?? scale?.max;
    if (NUMERIC_TYPES.has(f.type) && (!Number.isFinite(values[f.key]) || (min !== undefined && values[f.key] < min) || (max !== undefined && values[f.key] > max))) errors[f.key] = "Enter a number within the allowed range.";
    if (f.options?.length) {
      const allowed = new Set(f.options.map(o => (typeof o === "string" ? o : o.value)));
      const chosen: unknown[] = Array.isArray(values[f.key]) ? values[f.key] : [raw];
      if (!chosen.every(choice => allowed.has(choice as string))) errors[f.key] = "Choose an available option.";
    }
  }
  // Cohort metrics come from the server, never from the inputs: no field key has a dot.
  for (const cohort of def.studio.cohorts) {
    const metric = options.cohort?.[cohort.id];
    values[`cohort.${cohort.id}`] = metric ? metric.value : "";
    values[`cohort.${cohort.id}.rows`] = metric ? metric.rows : "";
    values[`cohort.${cohort.id}.asOf`] = metric ? metric.asOf : "";
  }
  try { for (const f of orderedComputedFields(def.fields)) {
    // A formula with an unanswered input it depends on has no value yet; that is not
    // an error. An optional field left blank, or a field on a page that does not
    // apply, used to throw "Missing input" here and reject the whole submission.
    // A missing required input is still reported, by the required check below.
    const outcome = tryEvaluateExpression(f.formula || "", values);
    if (outcome.ok) values[f.key] = outcome.value;
    else if ("missing" in outcome) values[f.key] = "";
    else errors[f.key] = outcome.error;
  }} catch (error) { errors.formula = (error as Error).message; }
  if (validate) {
    const stagePages = options.stageId ? pagesOfStage(def, options.stageId) : null;
    const firstPageId = def.studio.pages[0]?.id;
    for (const f of def.fields) {
      if (f.type === "computed" || !f.required) continue;
      const pageId = f.pageId || firstPageId;
      if (stagePages && !stagePages.has(pageId)) continue;
      const page = def.studio.pages.find(p => p.id === pageId);
      const group = f.group ? def.studio.groups.find(g => g.id === f.group) : undefined;
      if (!isVisible(page?.visibleWhen, values) || !isVisible(group?.visibleWhen, values) || !isVisible(f.visibleWhen, values)) continue;
      // A required checkbox is consent: unticked is `false`, which the blank check
      // below never caught, so required consent could be submitted unticked.
      if (f.type === "boolean") { if (values[f.key] !== true) errors[f.key] = "This must be checked."; }
      else if (isAbsent(values[f.key])) errors[f.key] = "This field is required.";
    }
  }
  return { values, errors, decision: evaluateDecision(def, values) };
}

export function isVisible(expression: string | undefined, values: Record<string, any>) {
  if (!expression) return true;
  const outcome = tryEvaluateExpression(expression, values);
  return outcome.ok && truthy(outcome.value);
}

type ResultHead = { id: string; title: string; audience: StudioAudience };
export type ResolvedResult =
  | (ResultHead & { type: "score"; value: unknown; band: { label: string; tone: string } | null; format?: string })
  | (ResultHead & { type: "breakdown"; items: Array<{ field: string; label: string; weight?: number; value: unknown }> })
  | (ResultHead & { type: "status"; status: string | null; label: string | null; waitingOn: string[] })
  | (ResultHead & { type: "gates"; items: Array<{ label: string; state: "tripped" | "clear" | "pending" | "error"; detail?: string }> })
  | (ResultHead & { type: "grid"; xLabel: string; yLabel: string; cell: { row: number; column: number; label: string } | null })
  | (ResultHead & { type: "narrative"; html: string })
  | (ResultHead & { type: "cohort"; value: unknown; format?: string; metric: { id: string; label: string; aggregate: StudioCohort["aggregate"]; value: unknown; rows: unknown; asOf: string | null } });

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Put answers into HTML at {{field}} bindings, escaped so an answer cannot inject
 * markup. Unanswered bindings are left empty. The HTML itself still needs
 * sanitizing before it is rendered.
 */
export function fillBindings(html: string, values: Record<string, any>): string {
  return html.replace(BINDING, (_match, name: string) => {
    const value = values[name];
    return isAbsent(value) ? "" : escapeHtml(Array.isArray(value) ? value.join(", ") : String(value));
  });
}
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bucket = (value: number, cuts: number[]) => cuts.filter(cut => value >= cut).length;

/**
 * The result blocks an audience sees, resolved against evaluated answers.
 * Reviewers see every block; respondents see only blocks marked for them.
 */
export function evaluateResults(def: StudioDefinition, values: Record<string, any>, decision: StudioDecision, audience: StudioAudience): ResolvedResult[] {
  return def.studio.results
    .filter(block => audience === "reviewer" || block.audience === "respondent")
    .filter(block => isVisible(block.visibleWhen, values))
    .map((block): ResolvedResult => {
      const head = { id: block.id, title: block.title, audience: block.audience };
      switch (block.type) {
        case "score": {
          const value = values[block.field] ?? "";
          const band = isNumber(value) ? block.bands.find(b => value >= b.min && value <= b.max) : undefined;
          return { ...head, type: "score", value, band: band ? { label: band.label, tone: band.tone } : null, ...(block.format ? { format: block.format } : {}) };
        }
        case "breakdown":
          return { ...head, type: "breakdown", items: block.items.map(item => ({ ...item, value: values[item.field] ?? "" })) };
        case "status": {
          let status: string | null = null, waitingOn: string[] = [];
          if (block.field) status = isAbsent(values[block.field]) ? null : String(values[block.field]);
          else if (decision.state === "decided") status = decision.status;
          else if (decision.state === "pending") waitingOn = decision.waitingOn;
          return { ...head, type: "status", status, label: status === null ? null : block.labels[status] ?? status, waitingOn };
        }
        case "gates":
          return {
            ...head, type: "gates",
            items: block.items.map(item => {
              const outcome = tryEvaluateExpression(item.trippedWhen, values);
              if (outcome.ok) return { label: item.label, state: truthy(outcome.value) ? "tripped" as const : "clear" as const };
              return "missing" in outcome
                ? { label: item.label, state: "pending" as const, detail: `Waiting on ${outcome.missing.join(", ")}` }
                : { label: item.label, state: "error" as const, detail: outcome.error };
            }),
          };
        case "grid": {
          const x = values[block.x.field], y = values[block.y.field];
          const cell = isNumber(x) && isNumber(y)
            ? { row: bucket(y, block.y.cuts), column: bucket(x, block.x.cuts) }
            : null;
          return { ...head, type: "grid", xLabel: block.x.label, yLabel: block.y.label, cell: cell ? { ...cell, label: block.cells[cell.row]?.[cell.column] ?? "" } : null };
        }
        case "cohort": {
          const cohort = def.studio.cohorts.find(c => c.id === block.metric);
          return {
            ...head, type: "cohort", value: values[block.field] ?? "", ...(block.format ? { format: block.format } : {}),
            metric: {
              id: block.metric, label: cohort?.label ?? block.metric, aggregate: cohort?.aggregate ?? "count",
              value: values[`cohort.${block.metric}`] ?? "", rows: values[`cohort.${block.metric}.rows`] ?? "",
              asOf: values[`cohort.${block.metric}.asOf`] || null,
            },
          };
        }
        case "narrative":
          return {
            ...head, type: "narrative",
            html: fillBindings(block.html, values),
          };
      }
    });
}

export function runStudioTests(def: StudioDefinition) {
  return def.studio.tests.map(test => {
    const result = evaluateStudio(def, test.inputs);
    const failures = Object.entries(test.expected).filter(([k, v]) => typeof v === "number" ? Math.abs(Number(result.values[k]) - v) > 0.000001 || !Number.isFinite(Number(result.values[k])) : result.values[k] !== v);
    const actualStatus = result.decision.state === "decided" ? result.decision.status : null;
    const statusFailed = test.expectedStatus !== undefined && actualStatus !== test.expectedStatus;
    return { ...test, actual: result.values, actualStatus, errors: result.errors, passed: failures.length === 0 && !statusFailed && Object.keys(result.errors).length === 0 };
  });
}

/**
 * The `{ fields }` that renderers predating Form Studio understand, stored with
 * each release for them and for built apps carrying frozen copies of those
 * renderers. A field's scale becomes its min and max.
 */
export function legacyFieldsProjection(def: StudioDefinition): { fields: Record<string, unknown>[] } {
  const scales = new Map(def.studio.scales.map(s => [s.id, s]));
  return {
    fields: def.fields.map(field => {
      const { group: _group, scale: scaleId, pageId: _pageId, visibleWhen: _visibleWhen, source: _source, sourceKey: _sourceKey, ...rest } = field;
      const scale = scaleId ? scales.get(scaleId) : undefined;
      return {
        ...rest,
        ...(scale && rest.min === undefined ? { min: scale.min } : {}),
        ...(scale && rest.max === undefined ? { max: scale.max } : {}),
      };
    }),
  };
}

/** What renderers predating Form Studio will not show of this definition. */
export function legacyConsumerWarnings(def: StudioDefinition): string[] {
  const { studio } = def, warnings: string[] = [];
  if (studio.pages.length > 1) warnings.push("Older form renderers show every page's questions on one page.");
  if ([...studio.pages, ...studio.groups].some(x => x.visibleWhen) || def.fields.some(f => f.visibleWhen)) warnings.push("Older form renderers ignore conditions and show every question, including ones that do not apply.");
  if (studio.stages.length) warnings.push("Older form renderers ask every stage's questions of one person at once.");
  if (studio.results.length) warnings.push("Older form renderers show no result blocks.");
  if (studio.decisionRules.length || studio.defaultStatus) warnings.push("Older form renderers do not evaluate decision rules.");
  return warnings;
}

/**
 * What a respondent's browser may receive: no knowledge sources, tests, open
 * issues, reviewer-only results, decision rules, actions, dataset binding or
 * cohort metrics, which summarize other people's responses.
 */
export function respondentDefinition(def: StudioDefinition): StudioDefinition {
  const copy = structuredClone(def);
  copy.studio.sources = [];
  copy.studio.tests = [];
  copy.studio.issues = [];
  copy.studio.results = copy.studio.results.filter(block => block.audience === "respondent");
  copy.studio.decisionRules = [];
  delete copy.studio.defaultStatus;
  copy.studio.actions = [];
  copy.studio.dataset = null;
  copy.studio.cohorts = [];
  for (const field of copy.fields) delete (field as Record<string, unknown>).source;
  return copy;
}

/**
 * How a template's fields differ from a form's, by key. `notInTemplate` lists
 * fields the form has and the template lacks, usually ones added in Form Studio;
 * applying a template update keeps them.
 */
export function compareFields(current: unknown[], incoming: unknown[]): { added: string[]; changed: string[]; notInTemplate: string[] } {
  const keyOf = (field: any) => String(field?.key ?? field?.name ?? "");
  const props = (field: any) => JSON.stringify([field?.label ?? null, field?.type ?? null, Boolean(field?.required), field?.placeholder ?? null, field?.options ?? null]);
  const byKey = (list: unknown[]) => new Map((Array.isArray(list) ? list : []).map(field => [keyOf(field), field] as const).filter(([key]) => key));
  const before = byKey(current), after = byKey(incoming);
  return {
    added: [...after.keys()].filter(key => !before.has(key)),
    changed: [...after.keys()].filter(key => before.has(key) && props(before.get(key)) !== props(after.get(key))),
    notInTemplate: [...before.keys()].filter(key => !after.has(key)),
  };
}

export interface TemplateUpdate {
  at: string;
  templateKey: string;
  description: string | null;
  fields: Record<string, unknown>[];
  added: string[];
  changed: string[];
  notInTemplate: string[];
}

export type TemplateFormAction =
  | { action: "overwrite" }
  | { action: "unchanged" }
  | { action: "hold"; templateUpdate: TemplateUpdate };

/**
 * What an Org Forge reinstall does to a form that already exists.
 *
 * A reinstall used to overwrite `schema` with the template's `{ fields }`, which
 * silently deleted a Form Studio form's pages, rules, results and tests. A plain
 * form is still replaced. A Studio form is left as it is, and the template's
 * version is held on it for its owner to apply or dismiss.
 */
export function reconcileTemplateForm(
  existing: { schema: unknown; config: unknown },
  template: { key: string; description: string | null; fields: Record<string, unknown>[] },
  now = new Date(),
): TemplateFormAction {
  const studioEdited = Boolean((existing.schema as any)?.studio || (existing.config as any)?.formStudio);
  if (!studioEdited) return { action: "overwrite" };
  const difference = compareFields((existing.schema as any)?.fields ?? [], template.fields);
  if (!difference.added.length && !difference.changed.length) return { action: "unchanged" };
  return { action: "hold", templateUpdate: { at: now.toISOString(), templateKey: template.key, description: template.description, fields: template.fields, ...difference } };
}
