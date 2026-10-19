import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Info } from 'lucide-react';
import EntityExtractionConfig from '@domain-ui/knowledge/ui/components/knowledge/EntityExtractionConfig';
import { FormStep } from './types.js';

interface PipelineKGConfigProps {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    config: any;
    setConfig: (config: any) => void;
    steps: FormStep[];
    schemas: any[];
}

export default function PipelineKGConfig({
    enabled,
    setEnabled,
    config,
    setConfig,
    steps,
    schemas
}: PipelineKGConfigProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                    <Label>Knowledge Graph Integration</Label>
                    <p className="text-sm text-muted-foreground">
                        Extract entities and relationships from workstream outputs to build a knowledge graph
                    </p>
                </div>
                <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                />
            </div>

            {enabled && (
                <div className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                        <Label>Link to Knowledge Documents</Label>
                        <p className="text-sm text-muted-foreground">
                            Link extracted entities to knowledge documents created by jobs in this workstream
                        </p>
                        <Switch
                            checked={config?.linkToKnowledgeDocuments ?? true}
                            onCheckedChange={(checked) => {
                                setConfig({
                                    ...config,
                                    linkToKnowledgeDocuments: checked,
                                    autoCreate: config?.autoCreate ?? true,
                                    entityRules: config?.entityRules || [],
                                    relationshipRules: config?.relationshipRules || [],
                                });
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Auto-create Nodes/Edges</Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically create knowledge graph nodes and edges without manual approval
                        </p>
                        <Switch
                            checked={config?.autoCreate ?? true}
                            onCheckedChange={(checked) => {
                                setConfig({
                                    ...config,
                                    autoCreate: checked,
                                    linkToKnowledgeDocuments: config?.linkToKnowledgeDocuments ?? true,
                                    entityRules: config?.entityRules || [],
                                    relationshipRules: config?.relationshipRules || [],
                                });
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Extract From Steps</Label>
                        <p className="text-sm text-muted-foreground">
                            Select which steps to extract entities from. Leave empty to extract from all steps.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {steps.map((step, idx) => {
                                const stepNumber = idx + 1;
                                const isSelected = config?.extractFromSteps?.includes(stepNumber) ?? false;
                                return (
                                    <Button
                                        key={step.tempId}
                                        type="button"
                                        variant={isSelected ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            const currentSteps = config?.extractFromSteps || [];
                                            const newSteps = isSelected
                                                ? currentSteps.filter((s: number) => s !== stepNumber)
                                                : [...currentSteps, stepNumber];
                                            setConfig({
                                                ...config,
                                                extractFromSteps: newSteps.length > 0 ? newSteps : undefined,
                                                entityRules: config?.entityRules || [],
                                                relationshipRules: config?.relationshipRules || [],
                                                autoCreate: config?.autoCreate ?? true,
                                                linkToKnowledgeDocuments: config?.linkToKnowledgeDocuments ?? true,
                                            });
                                        }}
                                    >
                                        Step {stepNumber}
                                    </Button>
                                );
                            })}
                        </div>
                        {steps.length === 0 && (
                            <p className="text-sm text-muted-foreground">Add pipeline steps to select extraction sources</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>Default Extraction Schema</Label>
                        <p className="text-sm text-muted-foreground">
                            Select the Knowledge Schema used for AI extraction when no specific instruction is provided
                        </p>
                        <Select
                            value={String(config?.defaultExtractionSchemaId || "")}
                            onValueChange={(value) => {
                                setConfig({
                                    ...config,
                                    defaultExtractionSchemaId: value ? parseInt(value) : undefined,
                                    autoCreate: config?.autoCreate ?? true,
                                    linkToKnowledgeDocuments: config?.linkToKnowledgeDocuments ?? true,
                                    entityRules: config?.entityRules || [],
                                    relationshipRules: config?.relationshipRules || [],
                                });
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Default (Schema 1)" />
                            </SelectTrigger>
                            <SelectContent>
                                {/* Always allow default/generic */}
                                <SelectItem value="0">Default (Generic)</SelectItem>
                                {schemas?.map((s: any) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-4 border-t pt-4">
                        <Label>Entity & Relationship Extraction Rules</Label>
                        <p className="text-sm text-muted-foreground">
                            Configure how to extract entities and relationships from pipeline step outputs
                        </p>
                        <EntityExtractionConfig
                            entityRules={config?.entityRules || []}
                            relationshipRules={config?.relationshipRules || []}
                            onChange={(entityRules, relationshipRules) => {
                                setConfig({
                                    ...config,
                                    entityRules,
                                    relationshipRules,
                                    extractFromSteps: config?.extractFromSteps,
                                    autoCreate: config?.autoCreate ?? true,
                                    linkToKnowledgeDocuments: config?.linkToKnowledgeDocuments ?? true,
                                });
                            }}
                        />
                    </div>

                    <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                            <Info className="w-4 h-4 inline mr-1" />
                            Pipeline-level extraction will run at the end of pipeline execution on selected step outputs.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
