/**
 * SchemaMappingHygiene
 * Data hygiene configuration tab (deduplication, null handling, validation)
 */

import React from "react";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { AlertTriangle, CheckCircle2, Scissors } from "lucide-react";

export interface SchemaMappingHygieneProps {
  dedupEnabled: boolean;
  onDedupEnabledChange: (v: boolean) => void;
  dedupStrategy: string;
  onDedupStrategyChange: (v: string) => void;
  dedupScope: string;
  onDedupScopeChange: (v: string) => void;
  dedupGlobalConflict: string;
  onDedupGlobalConflictChange: (v: string) => void;
  dedupKeyColumns: string[];
  onDedupKeyColumnsChange: (v: string[]) => void;
  nullStrategy: string;
  onNullStrategyChange: (v: string) => void;
  nullFillValue: string;
  onNullFillValueChange: (v: string) => void;
  dropInvalidTypes: boolean;
  onDropInvalidTypesChange: (v: boolean) => void;
  selectedKeys: Set<string>;
  renameMap: Record<string, string>;
}

export function SchemaMappingHygiene({
  dedupEnabled,
  onDedupEnabledChange,
  dedupStrategy,
  onDedupStrategyChange,
  dedupScope,
  onDedupScopeChange,
  dedupGlobalConflict,
  onDedupGlobalConflictChange,
  dedupKeyColumns,
  onDedupKeyColumnsChange,
  nullStrategy,
  onNullStrategyChange,
  nullFillValue,
  onNullFillValueChange,
  dropInvalidTypes,
  onDropInvalidTypesChange,
  selectedKeys,
  renameMap,
}: SchemaMappingHygieneProps) {
  return (
    <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-200">
      {/* Deduplication Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Scissors className="h-5 w-5 text-indigo-500" />
            Deduplication
          </h3>
          <Switch checked={dedupEnabled} onCheckedChange={onDedupEnabledChange} />
        </div>

        <div className={`space-y-4 p-4 border rounded-md transition-all ${dedupEnabled ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 opacity-50 pointer-events-none'}`}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Deduplication Scope</Label>
              <Select value={dedupScope} onValueChange={onDedupScopeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="batch">Batch Only (Input)</SelectItem>
                  <SelectItem value="global">Global (Database)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Check for duplicates within input or against database.</p>
            </div>

            {dedupScope === 'global' && (
              <div className="space-y-2 animate-in fade-in">
                <Label>Conflict Resolution</Label>
                <Select value={dedupGlobalConflict} onValueChange={onDedupGlobalConflictChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip (Keep Existing)</SelectItem>
                    <SelectItem value="update">Update (Overwrite)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Action when a duplicate is found.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-indigo-200/50">
            <div className="space-y-2">
              <Label>Batch Strategy</Label>
              <Select value={dedupStrategy} onValueChange={onDedupStrategyChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keepFirst">Keep First Occurrence</SelectItem>
                  <SelectItem value="keepLast">Keep Last Occurrence</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Which record to preserve within the batch.</p>
            </div>
            <div className="space-y-2">
              <Label>Unique Key Columns</Label>
              <div className="h-32 border rounded-md bg-white overflow-y-auto p-2">
                {Array.from(selectedKeys).length === 0 && (
                  <div className="text-xs text-muted-foreground p-2 text-center">Select fields in Mapping tab first.</div>
                )}
                {Array.from(selectedKeys).map(key => (
                  <div key={key} className="flex items-center gap-2 p-1 hover:bg-slate-50 rounded">
                    <Checkbox
                      id={`dd-${key}`}
                      checked={dedupKeyColumns.includes(key)}
                      onCheckedChange={(checked) => {
                        if (checked) onDedupKeyColumnsChange([...dedupKeyColumns, key]);
                        else onDedupKeyColumnsChange(dedupKeyColumns.filter(k => k !== key));
                      }}
                    />
                    <Label htmlFor={`dd-${key}`} className="text-xs font-mono cursor-pointer">{renameMap[key] || key}</Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Rows are duplicates if ALL selected columns match. Leave empty to check ALL columns.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Null Handling Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Null Handling
          </h3>
        </div>

        <div className="p-4 border rounded-md bg-orange-50/30 border-orange-200 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Strategy</Label>
              <Select value={nullStrategy} onValueChange={onNullStrategyChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep Nulls (Default)</SelectItem>
                  <SelectItem value="drop">Drop Row</SelectItem>
                  <SelectItem value="fill">Fill with Value</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Action to take when a row contains null values.</p>
            </div>
            {nullStrategy === 'fill' && (
              <div className="space-y-2 animate-in fade-in">
                <Label>Fill Value</Label>
                <Input
                  value={nullFillValue}
                  onChange={e => onNullFillValueChange(e.target.value)}
                  placeholder="e.g. N/A"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Validation Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            Validation
          </h3>
        </div>

        <div className="p-4 border rounded-md bg-green-50/30 border-green-200">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Drop Invalid Types</Label>
              <p className="text-xs text-muted-foreground">
                If a value cannot be coerced to the target type (e.g. text to number), drop the row.
              </p>
            </div>
            <Switch checked={dropInvalidTypes} onCheckedChange={onDropInvalidTypesChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
