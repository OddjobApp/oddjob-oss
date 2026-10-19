import React, { useState } from "react";
import { conflictDifferences, type MergeConflict } from "@shared/form-studio-merge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROPERTY_LABELS: Record<string, string> = {
  label: "Question", title: "Title", html: "Text", formula: "Formula", format: "Shown as", type: "Type", required: "Required",
  options: "Choices", description: "Help text", placeholder: "Placeholder", pageId: "Page", group: "Group", scale: "Scale",
  visibleWhen: "Shown when", when: "When", status: "Status", actions: "Proposes", audience: "Shown to", field: "Value",
  bands: "Bands", items: "Items", min: "Minimum", max: "Maximum", unit: "Unit", key: "Key", id: "Id", pageIds: "Pages",
  sees: "May see", assignee: "Filled in by", inputs: "Answers", expected: "Expected", expectedStatus: "Expected status",
};

function propertyLabel(property: string): string {
  return PROPERTY_LABELS[property] ?? property.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function show(value: unknown): string {
  if (value === undefined) return "Not set";
  if (value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return value.join(", ");
  return JSON.stringify(value);
}

/**
 * Parts of the form both the author and someone else changed since the author's
 * last save. Everything else was merged already; these wait for a choice. Each
 * shows only what the two versions disagree on.
 */
export function ConflictPanel({ conflicts, onResolve }: { conflicts: MergeConflict[]; onResolve: (choices: Record<string, "mine" | "theirs">) => void }) {
  const [choices, setChoices] = useState<Record<string, "mine" | "theirs">>({});
  const chooseAll = (side: "mine" | "theirs") => setChoices(Object.fromEntries(conflicts.map((c) => [c.id, side])));
  const complete = conflicts.every((c) => choices[c.id]);

  return (
    <section aria-labelledby="conflict-title" className="grid gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" data-testid="conflict-panel">
      <div>
        <h2 id="conflict-title" className="text-sm font-semibold">Someone else saved changes to the same parts</h2>
        <p className="text-sm text-muted-foreground">Their other changes and yours are already combined. Choose which version to keep for each of these.</p>
      </div>
      <ul className="grid gap-4">
        {conflicts.map((conflict) => {
          const removed = conflict.mine === undefined ? "mine" : conflict.theirs === undefined ? "theirs" : null;
          const differences = removed ? [] : conflictDifferences(conflict);
          return (
            <li key={conflict.id} className="grid gap-2">
              <p className="text-sm font-medium">{conflict.label}</p>
              {removed ? (
                <p className="text-sm text-muted-foreground">
                  {removed === "mine" ? "You removed it; the saved version changed it." : "The saved version removed it; you changed it."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border bg-background">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr><th scope="col" className="px-3 py-1.5 font-medium">&nbsp;</th><th scope="col" className="px-3 py-1.5 font-medium">Yours</th><th scope="col" className="px-3 py-1.5 font-medium">Saved</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {differences.map((difference) => (
                        <tr key={difference.property || "value"}>
                          <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal text-muted-foreground">{difference.property ? propertyLabel(difference.property) : "Value"}</th>
                          <td className="break-words px-3 py-1.5">{show(difference.mine)}</td>
                          <td className="break-words px-3 py-1.5">{show(difference.theirs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Version of ${conflict.label} to keep`}>
                {(["mine", "theirs"] as const).map((side) => (
                  <label key={side} className={cn("flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring", choices[conflict.id] === side && "border-primary")}>
                    <input type="radio" name={conflict.id} checked={choices[conflict.id] === side} onChange={() => setChoices({ ...choices, [conflict.id]: side })} />
                    {side === "mine" ? (removed === "mine" ? "Keep it removed" : "Keep yours") : (removed === "theirs" ? "Keep it removed" : "Keep the saved version")}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => chooseAll("mine")}>Keep all of yours</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => chooseAll("theirs")}>Keep all saved versions</Button>
        <Button type="button" size="sm" className="ml-auto" disabled={!complete} onClick={() => onResolve(choices)}>Apply and save</Button>
      </div>
    </section>
  );
}
