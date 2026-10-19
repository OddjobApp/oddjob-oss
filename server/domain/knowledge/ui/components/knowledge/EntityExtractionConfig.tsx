
import { useState } from 'react';
import { Plus, Trash2, Key } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import type { EntityRule, RelationshipRule } from "@shared/schema/knowledge-config";
import type { JobOutputSchema } from "@shared/schema/jobs/types";
import type { VariableInfo } from '@shared/utils/variableDiscovery';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';

import { OutputBrowser } from '@domain-ui/core/ui/components/shared/OutputBrowser';
import VariablePicker from '@domain-ui/core/ui/components/shared/VariablePicker';
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Loader2 } from "lucide-react";

interface EntityExtractionConfigProps {
  entityRules: EntityRule[];
  relationshipRules: RelationshipRule[];
  onChange: (entityRules: EntityRule[], relationshipRules: RelationshipRule[]) => void;
  outputSchema?: JobOutputSchema | null;
  stepOutputs?: Record<number, any>; // Map of stepID -> OutputData
  availableVariables?: (string | VariableInfo)[];
}

export default function EntityExtractionConfig({
  entityRules,
  relationshipRules,
  onChange,
  outputSchema,
  stepOutputs,
  availableVariables = [],
}: EntityExtractionConfigProps) {
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState(false);
  const [activeRuleIndex, setActiveRuleIndex] = useState<number | null>(null);
  const [newMappingKey, setNewMappingKey] = useState('');
  const [newMappingPath, setNewMappingPath] = useState('');
  const [activeInput, setActiveInput] = useState<'key' | 'path' | null>(null);
  const [targetStepId, setTargetStepId] = useState<number | null>(null); // For future multi-step support, currently unused or default

  // Helper to get active step output
  // Note: currently we don't know WHICH step the user is targeting until we look at config.
  // But wait, EntiryExtractionConfig is passed ONE outputSchema.
  // If we receive stepOutputs, we assume outputSchema corresponds to the selected step?
  // Let's assume passed stepOutputs has the data relevant to the current context or we pick the first available if single.
  // Actually, we should probably output the data matching the schema.

  // For now, let's just grab the first value from stepOutputs if available, or allow prop to specify.
  const activeOutputData = stepOutputs ? Object.values(stepOutputs)[0] : null;

  // Helper to strip root path and array indices from a full path
  // e.g. issues[0].fields.summary with root "issues" -> fields.summary
  const makeRelativePath = (fullPath: string, rootPath?: string): string => {
    if (!rootPath) return fullPath;

    // Normalize path (convert [0] to .0)
    const normalizedFull = fullPath.replace(/\[(\d+)\]/g, '.$1');
    const normalizedRoot = rootPath.replace(/\[(\d+)\]/g, '.$1');

    if (normalizedFull.startsWith(normalizedRoot)) {
      let remainder = normalizedFull.slice(normalizedRoot.length);
      // Remove leading dot or array index (e.g. .0.fields -> fields)
      remainder = remainder.replace(/^(\.\d+)?\./, '');
      if (remainder) return remainder;
    }
    return fullPath;
  };

  const handlePathSelect = (path: string, value: any) => {
    // If we are editing a rule, apply relative path logic
    let finalPath = path;
    if (activeRuleIndex !== null) {
      const rule = entityRules[activeRuleIndex];
      finalPath = makeRelativePath(path, rule.rootPath);
    }

    if (activeInput === 'key') {
      setNewMappingKey(finalPath);
    } else {
      // Default to path input if none active or path active
      setNewMappingPath(finalPath);

      // Also update the active rule directly if we're focused on "name" or "externalId" input 
      // (This requires us to know which input is focused at a finer grain, which we don't right now, 
      // but the user complained about "Name Path", so let's stick to the dialog logic for data mappings 
      // and maybe main inputs if I can access them.)
    }
  };

  // Get suggested paths from schema (keys and fields)
  const getSuggestedPaths = (rootPath?: string): string[] => {
    if (!outputSchema?.schemaDef) return [];

    const allPaths = Object.keys(outputSchema.schemaDef);

    if (rootPath) {
      const normalizedRoot = rootPath.replace(/\[(\d+)\]/g, '.$1');
      return allPaths
        .filter(p => p.startsWith(normalizedRoot))
        .map(p => makeRelativePath(p, rootPath))
        .filter(p => p !== '');
    }

    return allPaths;
  };

  const getKeyPaths = (): string[] => {
    if (!outputSchema?.schemaDef) return [];
    return Object.entries(outputSchema.schemaDef)
      .filter(([_, field]) => field.isKey || field.isForeignKey)
      .map(([path, _]) => path);
  };

  const addEntityRule = () => {
    const newRule: EntityRule = {
      entityType: '',
      label: '',
      mappings: {
        name: '',
      },
    };
    onChange([...entityRules, newRule], relationshipRules);
  };

  const removeEntityRule = (index: number) => {
    const newRules = entityRules.filter((_, i) => i !== index);
    onChange(newRules, relationshipRules);
  };

  const updateEntityRule = (index: number, updates: Partial<EntityRule>) => {
    const newRules = [...entityRules];
    newRules[index] = { ...newRules[index], ...updates };
    onChange(newRules, relationshipRules);
  };

  const updateEntityRuleMappings = (index: number, updates: Partial<EntityRule['mappings']>) => {
    const newRules = [...entityRules];
    newRules[index] = {
      ...newRules[index],
      mappings: { ...newRules[index].mappings, ...updates },
    };
    onChange(newRules, relationshipRules);
  };

  const addEntityDataMapping = (index: number, key: string, path: string) => {
    const rule = entityRules[index];
    const newDataMappings = {
      ...(rule.mappings.data || {}),
      [key]: path,
    };
    updateEntityRuleMappings(index, { data: newDataMappings });
  };

  const removeEntityDataMapping = (index: number, key: string) => {
    const rule = entityRules[index];
    const newDataMappings = { ...(rule.mappings.data || {}) };
    delete newDataMappings[key];
    updateEntityRuleMappings(index, { data: Object.keys(newDataMappings).length > 0 ? newDataMappings : undefined });
  };

  const openMappingDialog = (index: number) => {
    setActiveRuleIndex(index);
    setNewMappingKey('');
    setNewMappingPath('');
    setIsMappingDialogOpen(true);
  };

  const handleAddMapping = () => {
    if (activeRuleIndex !== null && newMappingKey && newMappingPath) {
      addEntityDataMapping(activeRuleIndex, newMappingKey, newMappingPath);
      setIsMappingDialogOpen(false);
      setActiveRuleIndex(null);
      setNewMappingKey('');
      setNewMappingPath('');
    }
  };

  const addRelationshipRule = () => {
    const newRule: RelationshipRule = {
      relation: '',
      sourceEntity: '',
      targetEntity: '',
      sourcePath: '',
      targetPath: '',
    };
    onChange(entityRules, [...relationshipRules, newRule]);
  };

  const removeRelationshipRule = (index: number) => {
    const newRules = relationshipRules.filter((_, i) => i !== index);
    onChange(entityRules, newRules);
  };

  const updateRelationshipRule = (index: number, updates: Partial<RelationshipRule>) => {
    const newRules = [...relationshipRules];
    newRules[index] = { ...newRules[index], ...updates };
    onChange(entityRules, newRules);
  };

  const suggestedPaths = getSuggestedPaths();
  const keyPaths = getKeyPaths();

  // We'll calculate specific entity types for the dropdowns based on rules + schema

  // Fetch Knowledge Topics (to suggest as High Level entity types)
  const { data: topicsData = { topics: [] } } = useQuery({
    queryKey: ['/api/knowledge/topics'],
    queryFn: async () => {
      const res = await fetch('/api/knowledge/topics');
      if (!res.ok) return { topics: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000
  });

  // Fetch existing entity types (schema)
  const { data: storedLabels = [], isLoading: isLoadingLabels } = useQuery<string[]>({
    queryKey: ['/api/knowledge-graph/schema/labels'],
    queryFn: async () => {
      const res = await fetch('/api/knowledge-graph/schema/labels');
      if (res.status === 404) return [];
      if (!res.ok) throw new Error("Failed to fetch labels");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const entityTypeOptions = useMemo(() => {
    const defaults = ['Ticket', 'User', 'Organization', 'Repository', 'PullRequest', 'Comment', 'Document', 'Project', 'Task'];
    const topicNames = topicsData.topics.map((t: any) => t.name) || [];
    return Array.from(new Set([...defaults, ...(storedLabels || []), ...topicNames])).sort();
  }, [storedLabels, topicsData]);

  const existingRuleTypes = Array.from(new Set(entityRules.map((r) => r.entityType).filter(Boolean)));
  // Merge rule types into options for the Relationship selector
  const relationshipEntityOptions = useMemo(() => {
    return Array.from(new Set([...entityTypeOptions, ...existingRuleTypes])).sort();
  }, [entityTypeOptions, existingRuleTypes]);

  return (
    <div className="space-y-6">
      {/* Entity Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Entity Rules</CardTitle>
          <CardDescription>
            Define how to extract entities from transformed data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {entityRules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No entity rules defined</p>
              <p className="text-sm mt-2">Click "Add Entity Rule" to create your first rule</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entityRules.map((rule, index) => (
                <Card key={index} className="border">
                  <CardContent className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Entity Type *</Label>
                        <Select
                          value={rule.entityType}
                          onValueChange={(value) => updateEntityRule(index, { entityType: value === "Other" ? "" : value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLoadingLabels ? (
                              <div className="flex items-center justify-center p-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin mr-2" />Loading...</div>
                            ) : (
                              entityTypeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)
                            )}
                            <div className="border-t my-1"></div>
                            <SelectItem value="Other">Other (Custom)</SelectItem>
                          </SelectContent>
                        </Select>
                        {/* Show input if value is not in options or if they want custom */}
                        {(!entityTypeOptions.includes(rule.entityType) || rule.entityType === "") && (
                          <Input
                            className="mt-2"
                            value={rule.entityType}
                            onChange={(e) => updateEntityRule(index, { entityType: e.target.value })}
                            placeholder="e.g., User, Issue, Project"
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Root Path (Optional)</Label>
                        <Input
                          value={rule.rootPath || ''}
                          onChange={(e) => updateEntityRule(index, { rootPath: e.target.value || undefined })}
                          placeholder="e.g., issues (for iterating over lists)"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Label *</Label>
                        <Input
                          value={rule.label}
                          onChange={(e) => updateEntityRule(index, { label: e.target.value })}
                          placeholder="e.g., User Name, Issue Title"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Name Path *</Label>
                      <Input
                        value={rule.mappings.name}
                        onChange={(e) => updateEntityRuleMappings(index, { name: e.target.value })}
                        placeholder="e.g., fields.summary, name, title"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use the Output Browser in the mapping dialog to select a path, or type manually
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>External ID Path (optional)</Label>
                      <Input
                        value={rule.mappings.externalId || ''}
                        onChange={(e) =>
                          updateEntityRuleMappings(index, { externalId: e.target.value || undefined })
                        }
                        placeholder="e.g., id, key, external_id"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Data Mappings (optional)</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openMappingDialog(index)}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Mapping
                        </Button>
                      </div>
                      {rule.mappings.data && Object.keys(rule.mappings.data).length > 0 && (
                        <div className="space-y-1">
                          {Object.entries(rule.mappings.data).map(([key, path]) => (
                            <div key={key} className="flex items-center gap-2 p-2 bg-muted rounded">
                              <code className="text-xs flex-1">{key}</code>
                              <span className="text-xs text-muted-foreground">→</span>
                              <code className="text-xs flex-1">{path}</code>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeEntityDataMapping(index, key)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEntityRule(index)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Button onClick={addEntityRule} variant="outline" className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Entity Rule
          </Button>
        </CardContent>
      </Card>

      {/* Relationship Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Relationship Rules</CardTitle>
          <CardDescription>
            Define relationships between extracted entities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {relationshipRules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No relationship rules defined</p>
              <p className="text-sm mt-2">Click "Add Relationship Rule" to create your first rule</p>
            </div>
          ) : (
            <div className="space-y-3">
              {relationshipRules.map((rule, index) => (
                <Card key={index} className="border">
                  <CardContent className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Relation *</Label>
                        <Input
                          value={rule.relation}
                          onChange={(e) => updateRelationshipRule(index, { relation: e.target.value })}
                          placeholder="e.g., assigned_to, belongs_to, related_to"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Source Entity Type *</Label>
                        <Select
                          value={rule.sourceEntity}
                          onValueChange={(value) => updateRelationshipRule(index, { sourceEntity: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select entity type" />
                          </SelectTrigger>
                          <SelectContent>
                            {relationshipEntityOptions.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={rule.sourceEntity}
                          onChange={(e) => updateRelationshipRule(index, { sourceEntity: e.target.value })}
                          placeholder="Or type entity type"
                          className="mt-2"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Target Entity Type *</Label>
                        <Select
                          value={rule.targetEntity}
                          onValueChange={(value) => updateRelationshipRule(index, { targetEntity: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select entity type" />
                          </SelectTrigger>
                          <SelectContent>
                            {relationshipEntityOptions.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={rule.targetEntity}
                          onChange={(e) => updateRelationshipRule(index, { targetEntity: e.target.value })}
                          placeholder="Or type entity type"
                          className="mt-2"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Source Path *</Label>
                        <div className="flex gap-2">
                          <Select
                            value={rule.sourcePath}
                            onValueChange={(value) => updateRelationshipRule(index, { sourcePath: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select path" />
                            </SelectTrigger>
                            <SelectContent>
                              {keyPaths.map((path) => (
                                <SelectItem key={path} value={path}>
                                  {path}
                                  <Key className="w-3 h-3 ml-2 inline" />
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={rule.sourcePath}
                            onChange={(e) => updateRelationshipRule(index, { sourcePath: e.target.value })}
                            placeholder="e.g., userId"
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Target Path *</Label>
                        <div className="flex gap-2">
                          <Select
                            value={rule.targetPath}
                            onValueChange={(value) => updateRelationshipRule(index, { targetPath: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select path" />
                            </SelectTrigger>
                            <SelectContent>
                              {keyPaths.map((path) => (
                                <SelectItem key={path} value={path}>
                                  {path}
                                  <Key className="w-3 h-3 ml-2 inline" />
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={rule.targetPath}
                            onChange={(e) => updateRelationshipRule(index, { targetPath: e.target.value })}
                            placeholder="e.g., projectId"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Weight (optional)</Label>
                        <Input
                          type="number"
                          value={rule.weight || ''}
                          onChange={(e) =>
                            updateRelationshipRule(index, {
                              weight: e.target.value ? parseFloat(e.target.value) : undefined,
                            })
                          }
                          placeholder="1.0"
                          step="0.1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Condition (optional)</Label>
                        <Input
                          value={rule.condition || ''}
                          onChange={(e) =>
                            updateRelationshipRule(index, { condition: e.target.value || undefined })
                          }
                          placeholder="e.g., status === 'active'"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRelationshipRule(index)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Button onClick={addRelationshipRule} variant="outline" className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Relationship Rule
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isMappingDialogOpen} onOpenChange={setIsMappingDialogOpen}>
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>Add Data Mapping</DialogTitle>
            <DialogDescription>
              Map a property name to a data path from the source.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="key" className="text-right">
                Property Name
              </Label>
              <Input
                id="key"
                value={newMappingKey}
                onChange={(e) => setNewMappingKey(e.target.value)}
                onFocus={() => setActiveInput('key')}
                className="col-span-3"
                placeholder="e.g. description"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="path" className="text-right">
                Source Path
              </Label>
              <div className="col-span-3 relative flex gap-2">
                <Input
                  id="path"
                  value={newMappingPath}
                  onChange={(e) => setNewMappingPath(e.target.value)}
                  onFocus={() => setActiveInput('path')}
                  placeholder="e.g. fields.description"
                  className="flex-1"
                />
                {availableVariables && availableVariables.length > 0 && (
                  <VariablePicker
                    variables={availableVariables}
                    onSelect={(variable) => setNewMappingPath((prev) => prev ? prev + variable : variable)}
                  />
                )}
              </div>
            </div>

            {/* Output Browser Area */}
            <div className="mt-4 border-t pt-4">
              <Label className="mb-2 block">Output Browser</Label>
              <OutputBrowser
                data={activeOutputData}
                onSelectPath={handlePathSelect}
                height="300px"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMappingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddMapping} disabled={!newMappingKey || !newMappingPath}>Add Mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

