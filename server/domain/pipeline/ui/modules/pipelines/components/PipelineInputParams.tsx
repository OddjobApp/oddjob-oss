
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    Trash2,
    Settings2,
    ChevronDown,
    ChevronUp,
    CheckCircle2,
    AlertCircle,
    GripVertical,
    Loader2
} from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@domain-ui/core/ui/components/ui/card';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger
} from '@domain-ui/core/ui/components/ui/accordion';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type {
    PipelineInputParam,
    InputParamDataType,
} from '@shared/schema/pipelineInputParams';

const inputParamDataTypes = [
    "string",
    "number",
    "boolean",
    "date",
    "email",
    "url",
    "phone",
    "vin",
    "location",
] as const;

interface PipelineInputParamsProps {
    pipelineId: number;
    isEditing: boolean;
    importableJob?: any; // Job object passed from parent
}

export function PipelineInputParams({ pipelineId, isEditing, importableJob }: PipelineInputParamsProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [expandedParam, setExpandedParam] = useState<string | undefined>(undefined);
    const [isImporting, setIsImporting] = useState(false);

    // Fetch parameters
    const { data: params = [], isLoading } = useQuery<PipelineInputParam[]>({
        queryKey: ['/api/pipelines', pipelineId, 'input-params'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/input-params`);
            return res.json();
        },
        enabled: !!pipelineId
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: async (data?: Partial<PipelineInputParam>) => {
            const res = await apiRequest('POST', `/api/pipelines/${pipelineId}/input-params`, {
                name: data?.name || `new_param_${(params?.length || 0) + 1}`,
                label: data?.label || 'New Parameter',
                description: data?.description || '',
                dataType: data?.dataType || 'string',
                isRequired: data?.isRequired ?? true,
                displayOrder: params?.length || 0,
                // Optional fields
                defaultValue: data?.defaultValue,
                allowedValues: data?.allowedValues
            });
            return res.json();
        },
        onSuccess: (newParam) => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'input-params'] });
            if (newParam?.id && !isImporting) { // Don't expand if bulk importing
                setExpandedParam(`item-${newParam.id}`);
            }
            if (!isImporting) {
                toast({ title: 'Parameter added', description: 'New input parameter created' });
            }
        }
    });

    const handleImportFromJob = async () => {
        if (!importableJob || !importableJob.config?.formSchema?.fields) return;

        setIsImporting(true);
        try {
            const fields = importableJob.config.formSchema.fields;
            let importCount = 0;

            for (const field of fields) {
                const existingParam = params.find((p: any) => p.name === field.key);

                // Map field type to param data type
                let dataType: any = 'string';
                if (field.type === 'number') dataType = 'number';
                if (field.type === 'boolean') dataType = 'boolean';
                // 'date', 'textarea', 'select' fall back to 'string' or could be refined if we supported more types
                if (field.type === 'date') dataType = 'string'; // or 'date' if supported by schema

                // Handle select options
                let allowedValues: any[] | undefined = undefined;
                if (field.options && Array.isArray(field.options) && field.options.length > 0) {
                    // Form Agent options are objects { label, value } or strings
                    allowedValues = field.options.map((opt: any) => typeof opt === 'object' ? opt.value : opt);
                }

                if (existingParam) {
                    await updateMutation.mutateAsync({
                        id: existingParam.id,
                        data: {
                            label: field.label,
                            dataType: dataType,
                            isRequired: field.required,
                            defaultValue: field.defaultValue,
                            allowedValues: allowedValues
                        }
                    });
                } else {
                    await createMutation.mutateAsync({
                        name: field.key,
                        label: field.label,
                        description: `Imported from ${importableJob.name}`,
                        dataType: dataType,
                        isRequired: field.required,
                        defaultValue: field.defaultValue,
                        allowedValues: allowedValues
                    });
                }
                importCount++;
            }

            toast({
                title: 'Import Complete',
                description: `Successfully imported ${importCount} parameters from ${importableJob.name}`
            });
        } catch (error) {
            console.error("Import failed:", error);
            toast({
                title: 'Import Failed',
                description: 'Failed to import some parameters',
                variant: 'destructive'
            });
        } finally {
            setIsImporting(false);
        }
    };

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number, data: Partial<PipelineInputParam> }) => {
            const res = await apiRequest('PATCH', `/api/pipelines/${pipelineId}/input-params/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'input-params'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest('DELETE', `/api/pipelines/${pipelineId}/input-params/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'input-params'] });
            toast({ title: 'Parameter deleted', description: 'Input parameter removed' });
        }
    });

    const handleUpdate = (id: number, field: keyof PipelineInputParam, value: any) => {
        updateMutation.mutate({ id, data: { [field]: value } });
    };

    if (isLoading) return <div className="p-4 text-muted-foreground">Loading parameters...</div>;

    // Check if we can import from job (only if list is empty or explicitly requested?)
    const canImport = importableJob && importableJob.type === 'form_agent';
    // Let's show banner if list is empty and job is present
    const showImportBanner = canImport && (!params || params.length === 0);

    return (
        <Card className="w-full mx-auto border-border/40 shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl flex items-center gap-2">
                            <Settings2 className="w-5 h-5 text-primary" />
                            Input Parameters
                        </CardTitle>
                        <CardDescription>
                            Define expected inputs and validation rules for Agent AI and Oddjob Assistant
                        </CardDescription>
                    </div>
                    {isEditing && (
                        <div className="flex gap-2">
                            {canImport && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleImportFromJob}
                                    disabled={createMutation.isPending || isImporting}
                                >
                                    {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                    Sync from First Job
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => createMutation.mutate({})}
                                disabled={createMutation.isPending}
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                Add Parameter
                            </Button>
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {!Array.isArray(params) || params.length === 0 ? (
                    <div className="p-8 text-center bg-background">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                            <Plus className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium">{!Array.isArray(params) ? 'Error loading parameters' : 'No input parameters defined'}</h3>
                        <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-4">
                            {!Array.isArray(params)
                                ? 'There was an issue loading the parameter list. Please refresh or check the server logs.'
                                : 'Define parameters like customer_id or vin to enable validation and help Agent AI understand what info to collect.'}
                        </p>
                        {showImportBanner && (
                            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 max-w-md mx-auto">
                                <h4 className="text-blue-800 font-medium mb-1">Form Agent Detected</h4>
                                <p className="text-blue-600 text-sm mb-3">
                                    Your first step is a Form Agent. You can automatically import its fields as pipeline parameters.
                                </p>
                                <Button
                                    size="sm"
                                    onClick={handleImportFromJob}
                                    disabled={createMutation.isPending || isImporting}
                                    className="w-full"
                                >
                                    {isImporting ? "Importing..." : "Import Parameters from Job"}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <Accordion
                        type="single"
                        collapsible
                        value={expandedParam}
                        onValueChange={setExpandedParam}
                        className="w-full"
                    >
                        {params.map((param) => {
                            const isInherited = param.id === 0 || !param.id;
                            const itemKey = isInherited ? `inherited-${param.name}` : `explicit-${param.id}`;
                            const itemValue = `item-${itemKey}`;

                            return (
                                <AccordionItem key={itemKey} value={itemValue} className={`px-4 border-b last:border-b-0 ${isInherited ? 'bg-muted/10' : ''}`}>
                                    <div className="flex items-center gap-2 group">
                                        <div className={`text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity ${isInherited ? '' : 'cursor-grab'}`}>
                                            <GripVertical className="w-4 h-4" />
                                        </div>
                                        <AccordionTrigger className="hover:no-underline flex-1 py-4">
                                            <div className="flex items-center gap-3 text-left">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-sm">
                                                        {param.label || param.name}
                                                        {param.isRequired && <span className="text-destructive ml-1">*</span>}
                                                    </span>
                                                    <code className="text-[10px] bg-muted px-1 rounded text-muted-foreground w-fit mt-1">
                                                        {param.name}
                                                    </code>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-[10px] h-5">
                                                        {param.dataType}
                                                    </Badge>
                                                    {Array.isArray(param.allowedValues) && (param.allowedValues as any[]).length > 0 && (
                                                        <Badge variant="secondary" className="text-[10px] h-5 bg-amber-500/10 text-amber-700 border-amber-200">
                                                            {(param.allowedValues as any[]).length} Options
                                                        </Badge>
                                                    )}
                                                    {isInherited && (
                                                        <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-600 border-blue-200">
                                                            Inherited
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </AccordionTrigger>
                                        {isEditing && (
                                            <div className="flex items-center gap-1">
                                                {isInherited ? (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // Promote to explicit
                                                            createMutation.mutate({
                                                                name: param.name,
                                                                label: param.label,
                                                                description: param.description,
                                                                dataType: 'string'
                                                            } as any);
                                                        }}
                                                    >
                                                        <Settings2 className="w-3 h-3 mr-1" />
                                                        Configure
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm('Delete this parameter?')) deleteMutation.mutate(param.id);
                                                        }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <AccordionContent className="pb-6 pt-2 pl-6 border-l-2 border-primary/10 ml-2">
                                        {isInherited ? (
                                            <div className="p-4 bg-muted/30 rounded-lg border border-dashed border-border mb-4">
                                                <div className="flex items-start gap-3">
                                                    <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                                                    <div className="space-y-1">
                                                        <h4 className="text-sm font-medium">Auto-Discovered Parameter</h4>
                                                        <p className="text-xs text-muted-foreground">
                                                            This parameter was found in your job configuration placeholders (e.g. <code>{"{{"}{param.name}{"}}"}</code>).
                                                            Oddjob automatically inherits it as a required input for Agent AI.
                                                        </p>
                                                        <p className="text-xs text-muted-foreground pt-2">
                                                            <strong>Want to add validation?</strong> Click "Configure" to promote it and add rules like regex, min/max length, or allowed values.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {/* Basic Info */}
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Internal Name (Variable)</Label>
                                                        <Input
                                                            value={param.name}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'name', e.target.value)}
                                                            className="h-8 text-sm font-mono"
                                                            placeholder="customer_id"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display Label</Label>
                                                        <Input
                                                            value={param.label || ''}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'label', e.target.value)}
                                                            className="h-8 text-sm"
                                                            placeholder="Customer ID"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Description (Instruction for Agent)</Label>
                                                        <Textarea
                                                            value={param.description || ''}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'description', e.target.value)}
                                                            className="text-sm min-h-[80px]"
                                                            placeholder="Ask the user for their 8-digit customer identifier found on their billing statement."
                                                        />
                                                    </div>
                                                </div>

                                                {/* Validation Rules */}
                                                <div className="space-y-4 bg-muted/20 p-4 rounded-lg border border-border/40">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-xs font-bold uppercase tracking-widest">Validation Rules</Label>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-muted-foreground uppercase">Required</span>
                                                            <Switch
                                                                checked={param.isRequired}
                                                                disabled={!isEditing}
                                                                onCheckedChange={(val) => handleUpdate(param.id, 'isRequired', val)}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-2">
                                                            <Label className="text-xs">Data Type</Label>
                                                            <Select
                                                                value={param.dataType}
                                                                disabled={!isEditing}
                                                                onValueChange={(val) => handleUpdate(param.id, 'dataType', val)}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {inputParamDataTypes.map(type => (
                                                                        <SelectItem key={type} value={type} className="text-xs">
                                                                            {type.charAt(0).toUpperCase() + type.slice(1)}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs">Default Value</Label>
                                                            <Input
                                                                value={param.defaultValue || ''}
                                                                disabled={!isEditing}
                                                                onChange={(e) => handleUpdate(param.id, 'defaultValue', e.target.value)}
                                                                className="h-8 text-xs"
                                                                placeholder="None"
                                                            />
                                                        </div>
                                                    </div>

                                                    {param.dataType === 'string' && (
                                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                                            <div className="space-y-2">
                                                                <Label className="text-[10px] uppercase">Min Length</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={param.minLength || ''}
                                                                    disabled={!isEditing}
                                                                    onChange={(e) => handleUpdate(param.id, 'minLength', e.target.value ? parseInt(e.target.value) : null)}
                                                                    className="h-7 text-xs"
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-[10px] uppercase">Max Length</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={param.maxLength || ''}
                                                                    disabled={!isEditing}
                                                                    onChange={(e) => handleUpdate(param.id, 'maxLength', e.target.value ? parseInt(e.target.value) : null)}
                                                                    className="h-7 text-xs"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {(param.dataType === 'string' || param.dataType === 'vin' || param.dataType === 'phone') && (
                                                        <div className="space-y-2 pt-2">
                                                            <Label className="text-[10px] uppercase">Regex Pattern (Advanced)</Label>
                                                            <Input
                                                                value={param.pattern || ''}
                                                                disabled={!isEditing}
                                                                onChange={(e) => handleUpdate(param.id, 'pattern', e.target.value)}
                                                                className="h-7 text-xs font-mono"
                                                                placeholder="^[A-Z0-9]{17}$"
                                                            />
                                                            <Input
                                                                value={param.patternMessage || ''}
                                                                disabled={!isEditing}
                                                                onChange={(e) => handleUpdate(param.id, 'patternMessage', e.target.value)}
                                                                className="h-7 text-[10px]"
                                                                placeholder="Custom error message..."
                                                            />
                                                        </div>
                                                    )}

                                                    {param.dataType === 'number' && (
                                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                                            <div className="space-y-2">
                                                                <Label className="text-[10px] uppercase">Min Value</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={param.minValue || ''}
                                                                    disabled={!isEditing}
                                                                    onChange={(e) => handleUpdate(param.id, 'minValue', e.target.value)}
                                                                    className="h-7 text-xs"
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-[10px] uppercase">Max Value</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={param.maxValue || ''}
                                                                    disabled={!isEditing}
                                                                    onChange={(e) => handleUpdate(param.id, 'maxValue', e.target.value)}
                                                                    className="h-7 text-xs"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="pt-4 flex items-center gap-2 text-[10px] text-primary/60 font-medium">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        Live validation enabled for this field
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                )}
            </CardContent>
        </Card>
    );
}

