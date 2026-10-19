export type CycleInputType = "url_list" | "dataset" | "credential" | "text" | "number";

export interface CycleInputRequirement {
  id: string;
  label: string;
  type: CycleInputType;
  description: string;
  placeholder?: string;
  required: boolean;
  source: "resources" | "resourcesRequired" | "inputs";
}

export interface CycleMissionInputContextParams {
  cycle?: any;
  blueprint?: any;
  resolvedDataFlows?: Record<string, unknown>;
}

const REQUIREMENT_KEY_RE = /(require|ticket|brief|document|story|feature|spec|incident|intake)/i;

function requirementKeyRank(key: string): number {
  if (/(business_requirements|feature_requirements|requirements?|story|spec)/i.test(key)) return 0;
  if (/(brief|document|intake)/i.test(key)) return 1;
  if (/(ticket|incident)/i.test(key)) return 2;
  return 3;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function toId(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function inferType(id: string): CycleInputType {
  if (/(url|link|uri|webhook)/i.test(id)) return "url_list";
  if (/(count|limit|budget|points|capacity|number|qty|quantity)/i.test(id)) return "number";
  if (/(credential|token|secret|password|key)/i.test(id)) return "credential";
  if (/(dataset|data_set|csv|table)/i.test(id)) return "dataset";
  return "text";
}

function asRequirementList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  if (value && typeof value === "object") return [value];
  return [];
}

function normalizeObjectRequirement(raw: Record<string, any>, source: CycleInputRequirement["source"]): CycleInputRequirement | null {
  const id = toId(String(raw.id ?? raw.key ?? raw.name ?? raw.label ?? ""));
  if (!id) return null;
  const label = String(raw.label ?? raw.name ?? humanize(id));
  const type = ["url_list", "dataset", "credential", "text", "number"].includes(raw.type)
    ? raw.type as CycleInputType
    : inferType(id);
  return {
    id,
    label,
    type,
    description: String(raw.description ?? raw.helpText ?? `Provide ${label}.`),
    placeholder: raw.placeholder ? String(raw.placeholder) : undefined,
    required: raw.required !== false,
    source,
  };
}

function normalizeStringRequirement(raw: string, source: CycleInputRequirement["source"]): CycleInputRequirement | null {
  const id = toId(raw);
  if (!id) return null;
  const label = humanize(raw);
  return {
    id,
    label,
    type: inferType(id),
    description: `Provide ${label}.`,
    placeholder: `Enter ${label}...`,
    required: true,
    source,
  };
}

function addRequirement(
  byId: Map<string, CycleInputRequirement>,
  raw: unknown,
  source: CycleInputRequirement["source"],
) {
  const requirement = typeof raw === "string"
    ? normalizeStringRequirement(raw, source)
    : normalizeObjectRequirement(asRecord(raw), source);
  if (!requirement || byId.has(requirement.id)) return;
  byId.set(requirement.id, requirement);
}

export function normalizeCycleInputRequirements(blueprint: any): CycleInputRequirement[] {
  const byId = new Map<string, CycleInputRequirement>();

  for (const item of Array.isArray(blueprint?.resources) ? blueprint.resources : []) {
    addRequirement(byId, item, "resources");
  }

  const resourceAliases = [
    blueprint?.resourcesRequired,
    blueprint?.resources_required,
    blueprint?.metadata?.resourcesRequired,
    blueprint?.metadata?.resources_required,
  ];
  for (const list of resourceAliases) {
    for (const item of asRequirementList(list)) {
      addRequirement(byId, item, "resourcesRequired");
    }
  }

  for (const item of asRequirementList(blueprint?.inputs)) {
    addRequirement(byId, item, "inputs");
  }

  return [...byId.values()];
}

function valueForRequirement(
  requirement: CycleInputRequirement,
  sources: Record<string, any>[],
): unknown {
  const labels = [
    requirement.id,
    requirement.label,
    requirement.label.replace(/\s+/g, "_").toLowerCase(),
  ];
  for (const source of sources) {
    for (const key of labels) {
      if (isPresent(source[key])) return source[key];
    }
  }
  return undefined;
}

export function buildCycleMissionInputContext({
  cycle,
  blueprint,
  resolvedDataFlows = {},
}: CycleMissionInputContextParams): Record<string, any> {
  const metadata = asRecord(cycle?.metadata);
  const allAnswers = asRecord(metadata.resource_answers);
  const blueprintAnswers = asRecord(allAnswers[blueprint?.name]);
  const parentCycleContext = asRecord(metadata.parent_cycle_context);
  const directCycleInputs = asRecord(metadata.inputs);
  const requirements = normalizeCycleInputRequirements(blueprint);

  const sources = [
    parentCycleContext,
    directCycleInputs,
    metadata,
    asRecord(allAnswers),
    blueprintAnswers,
    resolvedDataFlows,
  ];

  const providedInputs: Record<string, unknown> = {};
  for (const requirement of requirements) {
    const value = valueForRequirement(requirement, sources);
    if (isPresent(value)) providedInputs[requirement.id] = value;
  }

  const missingInputs = requirements
    .filter(req => !isPresent(providedInputs[req.id]) && !isPresent(resolvedDataFlows[req.id]))
    .map(req => req.id);

  const requirementCandidates = [
    ...Object.keys(providedInputs),
    ...Object.keys(resolvedDataFlows),
  ]
    .filter(key => REQUIREMENT_KEY_RE.test(key))
    .sort((a, b) => requirementKeyRank(a) - requirementKeyRank(b));
  const primaryRequirementKey = requirementCandidates[0]
    ?? Object.keys(providedInputs)[0]
    ?? Object.keys(resolvedDataFlows)[0];
  const primaryRequirement = primaryRequirementKey
    ? (providedInputs[primaryRequirementKey] ?? resolvedDataFlows[primaryRequirementKey])
    : undefined;

  const requiredInputs = requirements.map(req => ({
    id: req.id,
    label: req.label,
    type: req.type,
    required: req.required,
    source: req.source,
  }));

  const contract = {
    cycleId: cycle?.id ?? null,
    cycleName: cycle?.name ?? null,
    cycleObjective: cycle?.objective ?? null,
    blueprintName: blueprint?.name ?? null,
    blueprintObjective: blueprint?.objective ?? null,
    requiredInputs,
    providedInputs,
    missingInputs,
    outputs: Array.isArray(blueprint?.outputs) ? blueprint.outputs : [],
    dataFlows: Array.isArray(blueprint?.dataFlows) ? blueprint.dataFlows : [],
    resourceAnswers: blueprintAnswers,
  };

  return {
    ...parentCycleContext,
    ...providedInputs,
    ...resolvedDataFlows,
    cycleId: cycle?.id ?? null,
    cycleName: cycle?.name ?? null,
    cycleObjective: cycle?.objective ?? null,
    blueprintName: blueprint?.name ?? null,
    blueprintObjective: blueprint?.objective ?? null,
    blueprint: {
      name: blueprint?.name ?? null,
      objective: blueprint?.objective ?? null,
      inputs: requiredInputs,
      outputs: contract.outputs,
    },
    inputContract: contract,
    inputRequirements: requiredInputs.map(req => req.id),
    requiredInputs,
    providedInputs,
    missingInputs,
    resourceAnswers: blueprintAnswers,
    dataFlowInputs: resolvedDataFlows,
    requirement: primaryRequirement,
    requirements: isPresent(primaryRequirement)
      ? primaryRequirement
      : {
          required: requiredInputs.map(req => req.id),
          provided: providedInputs,
          missing: missingInputs,
        },
  };
}

export function buildCycleInputBriefing(groundTruth: Record<string, any>): string {
  const contract = asRecord(groundTruth.inputContract);
  const requiredInputs = Array.isArray(contract.requiredInputs) ? contract.requiredInputs : [];
  const missingInputs = Array.isArray(contract.missingInputs) ? contract.missingInputs : [];
  const providedInputs = asRecord(contract.providedInputs);
  if (requiredInputs.length === 0 && Object.keys(providedInputs).length === 0) return "";

  const lines = [
    "",
    "Cycle input contract:",
    requiredInputs.length
      ? `- Required inputs: ${requiredInputs.map((input: any) => input.id ?? input.label).join(", ")}`
      : "- Required inputs: none declared",
    Object.keys(providedInputs).length
      ? `- Provided inputs: ${Object.keys(providedInputs).join(", ")}`
      : "- Provided inputs: none",
    missingInputs.length
      ? `- Missing inputs: ${missingInputs.join(", ")}`
      : "- Missing inputs: none",
  ];

  if (isPresent(groundTruth.requirement)) {
    const value = typeof groundTruth.requirement === "string"
      ? groundTruth.requirement
      : JSON.stringify(groundTruth.requirement);
    lines.push(`- Primary requirement: ${value.slice(0, 2000)}`);
  }

  return lines.join("\n");
}
