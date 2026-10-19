import type { StudioDefinition } from '@shared/form-studio';
import { stableStringify } from '@shared/form-studio-merge';

export function changedFields(before: StudioDefinition, after: StudioDefinition) {
  return [...new Set([...before.fields, ...after.fields].map(field => field.key))].flatMap(key => {
    const old = before.fields.find(field => field.key === key);
    const next = after.fields.find(field => field.key === key);
    return stableStringify(old) === stableStringify(next) ? [] : [{ key, before: old, after: next }];
  });
}

/** Declined fields stay exactly as saved, including fields the proposal would delete. */
export function selectProposal(before: StudioDefinition, proposed: StudioDefinition, excluded: string[], includeOther: boolean): StudioDefinition {
  const fields = proposed.fields.flatMap(field => {
    if (!excluded.includes(field.key)) return [field];
    const original = before.fields.find(item => item.key === field.key);
    return original ? [original] : [];
  });
  for (const [index, field] of before.fields.entries()) {
    if (excluded.includes(field.key) && !proposed.fields.some(next => next.key === field.key)) fields.splice(Math.min(index, fields.length), 0, field);
  }
  return { ...(includeOther ? proposed : before), fields };
}
