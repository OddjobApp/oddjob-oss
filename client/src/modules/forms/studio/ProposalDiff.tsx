import React, { useEffect, useState } from "react";
import type { StudioDefinition } from "@shared/form-studio";
import { summarizeChanges } from "@shared/form-studio-merge";
import { changedFields, selectProposal } from './proposal-selection';

export interface Proposal {
  definition: StudioDefinition;
  checks: string[];
  tests: Array<{ name: string; passed: boolean }>;
  summary: string;
}

const plural = (noun: string, count: number) => `${count} ${noun.toLowerCase()}${count === 1 ? "" : "s"}`;

/** What a generated proposal would change, before anything is saved. */
export function ProposalDiff({ before, proposal, onSelectionChange }: { before: StudioDefinition; proposal: Proposal; onSelectionChange?: (definition: StudioDefinition) => void }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [includeOther, setIncludeOther] = useState(true);
  useEffect(() => { setExcluded([]); setIncludeOther(true); }, [proposal]);
  const fields = changedFields(before, proposal.definition);
  const update = (keys: string[], other: boolean) => {
    setExcluded(keys); setIncludeOther(other);
    onSelectionChange?.(selectProposal(before, proposal.definition, keys, other));
  };
  const changes = summarizeChanges(before, proposal.definition);
  const failing = proposal.tests.filter((t) => !t.passed);
  const issues = proposal.definition.studio.issues;
  return (
    <div className="grid gap-3 text-sm" data-testid="proposal-diff">
      {fields.map(field => <details key={field.key} className="rounded-md border p-3" open>
        <summary className="cursor-pointer font-medium">{field.after?.label || field.before?.label || field.key} · {!field.before ? 'Added' : !field.after ? 'Removed' : 'Changed'}</summary>
        {onSelectionChange && <label className="my-2 flex items-center gap-2"><input type="checkbox" checked={!excluded.includes(field.key)} onChange={event => update(event.target.checked ? excluded.filter(key => key !== field.key) : [...excluded, field.key], includeOther)} />Accept changes to {field.after?.label || field.before?.label || field.key}</label>}
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs">
          <thead><tr><th className="p-1">Property</th><th className="p-1">Before</th><th className="p-1">Proposed</th></tr></thead>
          <tbody>{[...new Set([...Object.keys(field.before ?? {}), ...Object.keys(field.after ?? {})])].filter(key => JSON.stringify((field.before as any)?.[key]) !== JSON.stringify((field.after as any)?.[key])).map(key => <tr key={key} className="border-t">
            <th className="p-1 font-medium">{key.replace(/([A-Z])/g, ' $1')}</th>
            {[field.before, field.after].map((value, index) => <td key={index} className="max-w-64 whitespace-pre-wrap break-words p-1 align-top">{(value as any)?.[key] === undefined ? 'Not set' : typeof (value as any)[key] === 'string' ? (value as any)[key] : JSON.stringify((value as any)[key], null, 2)}</td>)}
          </tr>)}</tbody>
        </table></div>
      </details>)}
      {onSelectionChange && <label className="flex items-center gap-2"><input type="checkbox" checked={includeOther} onChange={event => update(excluded, event.target.checked)} />Include proposed pages, rules, tests, sources and settings</label>}
      {changes.length === 0 ? (
        <p className="text-muted-foreground">The proposal changes nothing.</p>
      ) : (
        <ul className="grid gap-2">
          {changes.map((change) => (
            <li key={change.collection} className="rounded-md border p-2">
              <p className="font-medium">
                {[change.added.length && `${plural(change.noun, change.added.length)} added`, change.changed.length && `${plural(change.noun, change.changed.length)} changed`, change.removed.length && `${plural(change.noun, change.removed.length)} removed`].filter(Boolean).join(", ")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[...change.added.map((l) => `+ ${l}`), ...change.changed.map((l) => `~ ${l}`), ...change.removed.map((l) => `− ${l}`)].join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p>
        {proposal.tests.length ? `${proposal.tests.length - failing.length} of ${proposal.tests.length} tests pass.` : "No tests were proposed."}
        {failing.length > 0 && <span className="text-red-700 dark:text-red-300"> Failing: {failing.map((t) => t.name).join(", ")}.</span>}
      </p>
      {proposal.checks.length > 0 && (
        <div>
          <p className="font-medium">Would block publishing</p>
          <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{proposal.checks.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {issues.length > 0 && (
        <div>
          <p className="font-medium">What the sources leave open</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{issues.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
