import type { StudioDefinition } from "./form-studio";

/**
 * Three-way merge of Form Studio drafts, for a save that lost a revision race.
 *
 * When a save is refused because someone else saved first, the Studio keeps the
 * author's unsaved edits on top of the latest revision rather than overwriting
 * either side. Definitions merge unit by unit: a field by key; a page, group,
 * scale, stage, result, rule or action by id; a test by name; each setting as a
 * whole. Two people editing different fields never conflict. Only a unit both
 * sides changed differently is a conflict, and the merged draft holds the saved
 * version of it until the author chooses.
 */

export type CollectionName = "fields" | "pages" | "groups" | "scales" | "stages" | "results" | "decisionRules" | "actions" | "tests";
export type SettingName = "navigation" | "defaultStatus" | "dataset" | "issues" | "sources";

export interface NamedDefinition {
  name: string;
  schema: StudioDefinition;
}

export interface MergeConflict {
  /** `name`, `setting:<name>` or `<collection>:<key>`. */
  id: string;
  scope: "name" | "setting" | "collection";
  setting?: SettingName;
  collection?: CollectionName;
  key?: string;
  label: string;
  /** `undefined` means the unit is absent on that side: never added, or deleted. */
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

interface Collection {
  name: CollectionName;
  noun: string;
  keyOf: (item: any) => string;
  labelOf: (item: any) => string;
}

const COLLECTIONS: Collection[] = [
  { name: "fields", noun: "Field", keyOf: i => i?.key, labelOf: i => i?.label || i?.key },
  { name: "pages", noun: "Page", keyOf: i => i?.id, labelOf: i => i?.title || i?.id },
  { name: "groups", noun: "Group", keyOf: i => i?.id, labelOf: i => i?.title || i?.id },
  { name: "scales", noun: "Scale", keyOf: i => i?.id, labelOf: i => i?.label || i?.id },
  { name: "stages", noun: "Stage", keyOf: i => i?.id, labelOf: i => i?.title || i?.id },
  { name: "results", noun: "Result", keyOf: i => i?.id, labelOf: i => i?.title || i?.id },
  { name: "decisionRules", noun: "Rule", keyOf: i => i?.id, labelOf: i => i?.label || i?.status || i?.id },
  { name: "actions", noun: "Action", keyOf: i => i?.id, labelOf: i => i?.label || i?.id },
  { name: "tests", noun: "Test", keyOf: i => i?.name, labelOf: i => i?.name },
];
const COLLECTION_BY_NAME = new Map(COLLECTIONS.map(c => [c.name, c]));

const SETTINGS: Array<{ name: SettingName; label: string }> = [
  { name: "navigation", label: "Page navigation" },
  { name: "defaultStatus", label: "Default status" },
  { name: "dataset", label: "Response dataset" },
  { name: "issues", label: "Open issues" },
  { name: "sources", label: "Sources" },
];

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
export function stableStringify(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function pick(base: unknown, mine: unknown, theirs: unknown): { value: unknown; conflict: boolean } {
  if (same(mine, theirs)) return { value: theirs, conflict: false };
  if (same(mine, base)) return { value: theirs, conflict: false };
  if (same(theirs, base)) return { value: mine, conflict: false };
  return { value: theirs, conflict: true };
}

function listOf(schema: StudioDefinition, name: CollectionName): any[] {
  const list = name === "fields" ? schema.fields : (schema.studio as any)[name];
  return Array.isArray(list) ? list : [];
}
function setList(schema: any, name: CollectionName, list: any[]) {
  if (name === "fields") schema.fields = list;
  else schema.studio[name] = list;
}
function byKey(list: any[], collection: Collection): Map<string, any> {
  const map = new Map<string, any>();
  for (const item of list) {
    const key = collection.keyOf(item);
    if (typeof key === "string" && key && !map.has(key)) map.set(key, item);
  }
  return map;
}

function mergeCollection(collection: Collection, base: any[], mine: any[], theirs: any[], conflicts: MergeConflict[]): any[] {
  const b = byKey(base, collection), m = byKey(mine, collection), t = byKey(theirs, collection);
  // Keep whichever side reordered: the author's order unless the saved version was reordered.
  const theirsReordered = !same([...t.keys()].filter(k => b.has(k)), [...b.keys()].filter(k => t.has(k)));
  const [first, second] = theirsReordered ? [t, m] : [m, t];
  const order = [...first.keys()];
  for (const key of second.keys()) if (!first.has(key)) order.push(key);
  for (const key of b.keys()) if (!order.includes(key)) order.push(key);

  const merged: any[] = [];
  for (const key of order) {
    const result = pick(b.get(key), m.get(key), t.get(key));
    if (result.conflict) {
      conflicts.push({
        id: `${collection.name}:${key}`, scope: "collection", collection: collection.name, key,
        label: `${collection.noun} "${collection.labelOf(m.get(key) ?? t.get(key) ?? b.get(key))}"`,
        base: b.get(key), mine: m.get(key), theirs: t.get(key),
      });
    }
    if (result.value !== undefined) merged.push(result.value);
  }
  return merged;
}

export function mergeDefinitions(base: NamedDefinition, mine: NamedDefinition, theirs: NamedDefinition): { merged: NamedDefinition; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  const name = pick(base.name, mine.name, theirs.name);
  if (name.conflict) conflicts.push({ id: "name", scope: "name", label: "Form name", base: base.name, mine: mine.name, theirs: theirs.name });

  const schema: any = structuredClone(theirs.schema);
  for (const collection of COLLECTIONS) {
    setList(schema, collection.name, mergeCollection(collection, listOf(base.schema, collection.name), listOf(mine.schema, collection.name), listOf(theirs.schema, collection.name), conflicts));
  }
  for (const setting of SETTINGS) {
    const [b, m, t] = [base.schema.studio, mine.schema.studio, theirs.schema.studio].map(studio => (studio as any)?.[setting.name]);
    const result = pick(b, m, t);
    if (result.value === undefined) delete schema.studio[setting.name];
    else schema.studio[setting.name] = result.value;
    if (result.conflict) conflicts.push({ id: `setting:${setting.name}`, scope: "setting", setting: setting.name, label: setting.label, base: b, mine: m, theirs: t });
  }
  return { merged: { name: name.value as string, schema }, conflicts };
}

export interface PropertyDifference {
  /** The property both sides set differently; empty when the unit is not an object (a name, a setting). */
  property: string;
  mine: unknown;
  theirs: unknown;
}

/**
 * What the two versions of a conflicting unit disagree on, property by property,
 * so the choice reads "Title: yours / saved" rather than two JSON objects.
 */
export function conflictDifferences(conflict: Pick<MergeConflict, "mine" | "theirs">): PropertyDifference[] {
  const { mine, theirs } = conflict;
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!isObject(mine) || !isObject(theirs)) return [{ property: "", mine, theirs }];
  return [...new Set([...Object.keys(mine), ...Object.keys(theirs)])]
    .filter(property => !same(mine[property], theirs[property]))
    .map(property => ({ property, mine: mine[property], theirs: theirs[property] }));
}

/** Apply the author's choices. A conflict not chosen as "mine" keeps the saved version. */
export function resolveConflicts(merged: NamedDefinition, conflicts: MergeConflict[], choices: Record<string, "mine" | "theirs">): NamedDefinition {
  const result: NamedDefinition = { name: merged.name, schema: structuredClone(merged.schema) };
  const schema: any = result.schema;
  for (const conflict of conflicts) {
    if (choices[conflict.id] !== "mine") continue;
    const value = conflict.mine;
    if (conflict.scope === "name") {
      result.name = value as string;
    } else if (conflict.scope === "setting") {
      if (value === undefined) delete schema.studio[conflict.setting!];
      else schema.studio[conflict.setting!] = value;
    } else {
      const collection = COLLECTION_BY_NAME.get(conflict.collection!)!;
      const list = [...listOf(schema, collection.name)];
      const index = list.findIndex(item => collection.keyOf(item) === conflict.key);
      if (value === undefined) { if (index >= 0) list.splice(index, 1); }
      else if (index >= 0) list[index] = value;
      else list.push(value);
      setList(schema, collection.name, list);
    }
  }
  return result;
}

export interface DefinitionChange {
  collection: CollectionName;
  noun: string;
  added: string[];
  removed: string[];
  changed: string[];
}

/** What changes between two definitions, by unit, for showing a proposal before it is applied. */
export function summarizeChanges(before: StudioDefinition, after: StudioDefinition): DefinitionChange[] {
  const changes: DefinitionChange[] = [];
  for (const collection of COLLECTIONS) {
    const b = byKey(listOf(before, collection.name), collection), a = byKey(listOf(after, collection.name), collection);
    const change: DefinitionChange = {
      collection: collection.name, noun: collection.noun,
      added: [...a.keys()].filter(k => !b.has(k)).map(k => collection.labelOf(a.get(k))),
      removed: [...b.keys()].filter(k => !a.has(k)).map(k => collection.labelOf(b.get(k))),
      changed: [...a.keys()].filter(k => b.has(k) && !same(a.get(k), b.get(k))).map(k => collection.labelOf(a.get(k))),
    };
    if (change.added.length || change.removed.length || change.changed.length) changes.push(change);
  }
  return changes;
}
