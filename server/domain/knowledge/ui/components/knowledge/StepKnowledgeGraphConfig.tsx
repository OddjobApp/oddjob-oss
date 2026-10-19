import React, { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useFieldArray, useFormContext } from "react-hook-form";
import {
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormDescription,
    FormMessage,
} from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Plus, Trash2, Network, Loader2, ChevronDown, Sparkles } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface StepKnowledgeGraphConfigProps {
    stepIndex: number;
    outputSchema?: any;
}

export const StepKnowledgeGraphConfig: React.FC<StepKnowledgeGraphConfigProps> = ({ stepIndex, outputSchema }) => {
    const { control, register, watch, setValue } = useFormContext();
    const { toast } = useToast();

    const { fields: ruleFields, append: appendRule, remove: removeRule } = useFieldArray({
        control,
        name: `steps.${stepIndex}.knowledgeGraphConfig.rules`,
    });

    const { fields: edgeFields, append: appendEdge, remove: removeEdge } = useFieldArray({
        control,
        name: `steps.${stepIndex}.knowledgeGraphConfig.internalEdges`,
    });

    // Watch rules to populate dropdowns for edges
    const rules = watch(`steps.${stepIndex}.knowledgeGraphConfig.rules`);

    // AI Schema Architect State
    const [isAIDialogOpen, setIsAIDialogOpen] = useState(false);
    const [domainDescription, setDomainDescription] = useState("");
    const [generatedSchema, setGeneratedSchema] = useState<{ nodes: any[]; edges: any[] } | null>(null);

    // AI Schema Generation Mutation
    const generateSchemaMutation = useMutation({
        mutationFn: async (description: string) => {
            const res = await apiRequest("POST", "/api/knowledge-graph/schema/suggest", {
                description,
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || "Failed to generate schema");
            }
            return res.json();
        },
        onSuccess: (data) => {
            setGeneratedSchema(data);
            toast({
                title: "Schema Generated",
                description: `AI suggested ${data.nodes?.length || 0} entity types and ${data.edges?.length || 0} relationships.`,
            });
        },
        onError: (error: any) => {
            toast({
                title: "Generation Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    // Apply Generated Schema to Form
    const applyGeneratedSchema = () => {
        if (!generatedSchema) return;

        // Clear existing rules and edges
        const currentRules = watch(`steps.${stepIndex}.knowledgeGraphConfig.rules`) || [];
        const currentEdges = watch(`steps.${stepIndex}.knowledgeGraphConfig.internalEdges`) || [];

        // Remove all existing rules
        for (let i = currentRules.length - 1; i >= 0; i--) {
            removeRule(i);
        }
        // Remove all existing edges
        for (let i = currentEdges.length - 1; i >= 0; i--) {
            removeEdge(i);
        }

        // Add new rules from AI-generated schema
        const nodeToRuleId: Record<string, string> = {};
        generatedSchema.nodes.forEach((node, idx) => {
            const ruleId = `rule_ai_${Date.now()}_${idx}`;
            nodeToRuleId[node.label] = ruleId;

            appendRule({
                ruleId,
                name: `Extract ${node.label}`,
                entityType: node.label,
                sourceRootPath: "$",
                entityNamePath: node.properties?.find((p: any) => p.name === 'name')?.name || 'name',
                externalIdPath: node.properties?.find((p: any) => p.name === 'id')?.name || 'id',
                includeFullSourceData: true,
            });
        });

        // Add edges from AI-generated schema (with slight delay to ensure rules are set)
        setTimeout(() => {
            generatedSchema.edges.forEach((edge) => {
                const sourceRuleId = nodeToRuleId[edge.source_label];
                const targetRuleId = nodeToRuleId[edge.target_label];

                if (sourceRuleId && targetRuleId) {
                    appendEdge({
                        sourceRuleId,
                        targetRuleId,
                        relationType: edge.relation,
                    });
                }
            });
        }, 100);

        setIsAIDialogOpen(false);
        setGeneratedSchema(null);
        setDomainDescription("");

        toast({
            title: "Schema Applied",
            description: "AI-generated extraction rules have been added. Review and adjust paths as needed.",
        });
    };

    // Fetch existing entity types (schema)
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

    const { data: storedLabels = [], isLoading: isLoadingLabels } = useQuery<string[]>({
        queryKey: ['/api/knowledge-graph/schema/labels'],
        queryFn: async () => {
            const res = await fetch('/api/knowledge-graph/schema/labels');
            if (res.status === 404) return []; // Endpoint might not exist yet during dev
            if (!res.ok) throw new Error("Failed to fetch labels");
            return res.json();
        },
        staleTime: 60 * 1000,
    });

    const entityTypeOptions = useMemo(() => {
        const defaults = ['Ticket', 'User', 'Organization', 'Repository', 'PullRequest', 'Comment', 'Document', 'Project', 'Task'];
        const topicNames = topicsData.topics.map((t: any) => t.name) || [];
        // Merge and deduplicate
        return Array.from(new Set([...defaults, ...(storedLabels || []), ...topicNames])).sort();
    }, [storedLabels, topicsData]);

    // Calculate suggested paths from schema
    const suggestedPaths = useMemo(() => {
        if (!outputSchema?.schemaDef) return [];
        return Object.keys(outputSchema.schemaDef).sort();
    }, [outputSchema]);

    // Helper component for Path Input with suggestions
    const PathInput = ({ field, label, placeholder, description, testId }: { field: any, label?: string, placeholder: string, description?: string, testId?: string }) => {
        const defaultLabel = field.name ? field.name.split('.').pop().replace(/([A-Z])/g, ' $1').replace(/^./, (str: string) => str.toUpperCase()) : "Field";

        return (
            <FormItem>
                <FormLabel>{label || defaultLabel}</FormLabel>
                <div className="flex gap-2">
                    <FormControl>
                        <Input {...field} placeholder={placeholder} data-testid={testId} />
                    </FormControl>
                    {suggestedPaths.length > 0 && (
                        <Select onValueChange={(val) => field.onChange(val)}>
                            <SelectTrigger className="w-[40px] px-2" title="Select from schema">
                                <ChevronDown className="h-4 w-4" />
                            </SelectTrigger>
                            <SelectContent align="end" className="max-h-[300px]">
                                {suggestedPaths.map(path => (
                                    <SelectItem key={path} value={path}>
                                        {path}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
                {description && <FormDescription>{description}</FormDescription>}
                <FormMessage />
            </FormItem>
        );
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">Explicit Entity Mapping</h3>
                <p className="text-sm text-muted-foreground">
                    Define rules to extract entities and relationships from this step's output.
                </p>
                {outputSchema && (
                    <div className="mt-2 text-xs text-green-600 flex items-center">
                        <Badge variant="outline" className="text-green-600 border-green-200">Schema Detected</Badge>
                        <span className="ml-2">Output schema is available for path suggestions.</span>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Entity Extraction Rules</h4>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsAIDialogOpen(true)}
                            className="text-purple-600 border-purple-200 hover:bg-purple-50"
                        >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Auto-Generate with AI
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => appendRule({
                                ruleId: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                name: "New Rule",
                                entityType: "Generic",
                                sourceRootPath: "$",
                                entityNamePath: "name",
                                externalIdPath: "id",
                                includeFullSourceData: true
                            })}
                            data-testid="button-add-kg-rule"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Rule
                        </Button>
                    </div>
                </div>

                {ruleFields.length === 0 && (
                    <div className="text-center p-8 border border-dashed rounded-md text-muted-foreground">
                        No extraction rules defined. Click "Add Rule" to map JSON output to entities.
                    </div>
                )}

                {ruleFields.map((field, index) => (
                    <Card key={field.id} className="relative">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 text-destructive hover:text-destructive/90"
                            onClick={() => removeRule(index)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Rule #{index + 1}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.name`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Rule Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="e.g. Extract Tickets" data-testid={`input-rule-name-${index}`} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.entityType`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Entity Type</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger data-testid={`select-entity-type-${index}`}>
                                                        <SelectValue placeholder="Select type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {isLoadingLabels ? (
                                                        <div className="flex items-center justify-center p-2 text-muted-foreground text-xs">
                                                            <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                                            Loading...
                                                        </div>
                                                    ) : (
                                                        entityTypeOptions.map((type) => (
                                                            <SelectItem key={type} value={type}>{type}</SelectItem>
                                                        ))
                                                    )}
                                                    <Separator className="my-1" />
                                                    <SelectItem value="Other">Other (Custom)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {field.value === "Other" && (
                                                <Input
                                                    className="mt-2"
                                                    placeholder="Enter custom type"
                                                    onChange={(e) => field.onChange(e.target.value)}
                                                />
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.sourceRootPath`}
                                render={({ field }) => (
                                    <PathInput
                                        field={field}
                                        label="Source JSONPath"
                                        placeholder="e.g. $.tickets[*]"
                                        description="Root path to array or object to process. Use $ for root."
                                        testId={`input-source-root-path-${index}`}
                                    />
                                )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.entityNamePath`}
                                    render={({ field }) => (
                                        <PathInput
                                            field={field}
                                            label="Name Path"
                                            placeholder="e.g. title"
                                            description="Relative JSONPath for entity name"
                                            testId={`input-entity-name-path-${index}`}
                                        />
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.externalIdPath`}
                                    render={({ field }) => (
                                        <PathInput
                                            field={field}
                                            label="External ID Path"
                                            placeholder="e.g. id"
                                            description="Relative JSONPath for unique ID"
                                            testId={`input-external-id-path-${index}`}
                                        />
                                    )}
                                />
                            </div>

                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.rules.${index}.includeFullSourceData`}
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                        <div className="space-y-0.5">
                                            <FormLabel>Include Full Source Data</FormLabel>
                                            <FormDescription>
                                                Store the entire JSON object in the entity payload.
                                            </FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Separator />

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Internal Relationships</h4>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendEdge({
                            sourceRuleId: "",
                            targetRuleId: "",
                            relationType: "RELATED_TO"
                        })}
                        disabled={!rules || rules.length < 2}
                    >
                        <Network className="h-4 w-4 mr-2" />
                        Add Relationship
                    </Button>
                </div>

                {edgeFields.length === 0 && (
                    <div className="text-center p-8 border border-dashed rounded-md text-muted-foreground">
                        No internal relationships defined.
                        {(!rules || rules.length < 2) && <div className="text-xs mt-1">(Requires at least 2 rules)</div>}
                    </div>
                )}

                {edgeFields.map((field, index) => (
                    <div key={field.id} className="border p-3 rounded-md bg-muted/40 space-y-3">
                        <div className="flex gap-2 items-center">
                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.internalEdges.${index}.sourceRuleId`}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel className="text-xs">Source Rule</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select rule" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {rules?.map((r: any) => (
                                                    <SelectItem key={r.ruleId} value={r.ruleId}>
                                                        {r.name} ({r.entityType})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="pb-3 text-muted-foreground w-4 text-center">→</div>

                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.internalEdges.${index}.relationType`}
                                render={({ field }) => (
                                    <FormItem className="w-[150px]">
                                        <FormLabel className="text-xs">Relation</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="RELATED_TO" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="pb-3 text-muted-foreground w-4 text-center">→</div>

                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.internalEdges.${index}.targetRuleId`}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel className="text-xs">Target Rule</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select rule" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {rules?.map((r: any) => (
                                                    <SelectItem key={r.ruleId} value={r.ruleId}>
                                                        {r.name} ({r.entityType})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="mb-0.5 text-destructive hover:text-destructive/90"
                                onClick={() => removeEdge(index)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Join Keys Configuration */}
                        <div className="grid grid-cols-2 gap-4 px-2 pb-2">
                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.internalEdges.${index}.sourcePath`}
                                render={({ field }) => (
                                    <PathInput
                                        field={field}
                                        label="Source Join Key (Optional)"
                                        placeholder="e.g. userId"
                                    />
                                )}
                            />
                            <FormField
                                control={control}
                                name={`steps.${stepIndex}.knowledgeGraphConfig.internalEdges.${index}.targetPath`}
                                render={({ field }) => (
                                    <PathInput
                                        field={field}
                                        label="Target Join Key (Optional)"
                                        placeholder="e.g. id"
                                    />
                                )}
                            />
                        </div>
                    </div>
                ))}
            </div>

            {/* AI Schema Architect Dialog */}
            <Dialog open={isAIDialogOpen} onOpenChange={setIsAIDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-purple-600" />
                            AI Schema Architect
                        </DialogTitle>
                        <DialogDescription>
                            Describe your domain in natural language and let AI suggest an ontology for your Knowledge Graph.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Domain Description</label>
                            <Textarea
                                placeholder="e.g., IT Service Management with tickets, users, teams, and infrastructure components like servers and databases. Users report issues, teams resolve tickets, and tickets can affect infrastructure."
                                value={domainDescription}
                                onChange={(e) => setDomainDescription(e.target.value)}
                                rows={4}
                                className="resize-none"
                            />
                            <p className="text-xs text-muted-foreground">
                                Be specific about the entities, relationships, and properties you want to capture.
                            </p>
                        </div>

                        {generatedSchema && (
                            <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                                <div className="font-medium text-sm">Generated Ontology Preview</div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-2">Entity Types ({generatedSchema.nodes.length})</div>
                                        <div className="space-y-1">
                                            {generatedSchema.nodes.map((node, idx) => (
                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                    <Badge variant="secondary" className="text-xs">{node.label}</Badge>
                                                    <span className="text-muted-foreground text-xs truncate">{node.description}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-2">Relationships ({generatedSchema.edges.length})</div>
                                        <div className="space-y-1">
                                            {generatedSchema.edges.map((edge, idx) => (
                                                <div key={idx} className="text-xs text-muted-foreground">
                                                    {edge.source_label} <span className="font-mono text-purple-600">{edge.relation}</span> {edge.target_label}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                setIsAIDialogOpen(false);
                                setGeneratedSchema(null);
                                setDomainDescription("");
                            }}
                        >
                            Cancel
                        </Button>
                        {!generatedSchema ? (
                            <Button
                                type="button"
                                onClick={() => generateSchemaMutation.mutate(domainDescription)}
                                disabled={!domainDescription.trim() || generateSchemaMutation.isPending}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                {generateSchemaMutation.isPending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-4 w-4 mr-2" />
                                        Generate Schema
                                    </>
                                )}
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setGeneratedSchema(null)}
                                >
                                    Regenerate
                                </Button>
                                <Button
                                    type="button"
                                    onClick={applyGeneratedSchema}
                                    className="bg-green-600 hover:bg-green-700"
                                >
                                    Apply to Form
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

