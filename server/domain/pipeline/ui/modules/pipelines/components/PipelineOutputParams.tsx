
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    Trash2,
    Settings2,
    CheckCircle2,
    AlertCircle,
    GripVertical,
    Activity
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

// Using shared schema types if available, otherwise defining local
// Since I just created the schema, I might need to import it carefully
// The backend uses @shared/schema/pipelineOutputParams

export function PipelineOutputParams({ pipelineId, isEditing }: { pipelineId: number; isEditing: boolean }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [expandedParam, setExpandedParam] = useState<string | undefined>(undefined);

    // Fetch parameters (returns both explicit and implicit)
    const { data: params = [], isLoading } = useQuery<any[]>({
        queryKey: ['/api/pipelines', pipelineId, 'output-params'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/output-params`);
            return res.json();
        },
        enabled: !!pipelineId
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: async (data?: any) => {
            const res = await apiRequest('POST', `/api/pipelines/${pipelineId}/output-params`, {
                name: data?.name || `new_output_${(params?.length || 0) + 1}`,
                label: data?.label || 'New Output',
                description: data?.description || '',
                dataType: data?.dataType || 'string',
                isRequired: data?.isRequired ?? false,
                displayOrder: params?.length || 0,
            });
            return res.json();
        },
        onSuccess: (newParam) => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'output-params'] });
            if (newParam?.id) {
                setExpandedParam(`item-${newParam.id}`);
            }
            toast({ title: 'Output parameter added', description: 'New explicit output parameter created' });
        }
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number, data: any }) => {
            const res = await apiRequest('PATCH', `/api/pipelines/${pipelineId}/output-params/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'output-params'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest('DELETE', `/api/pipelines/${pipelineId}/output-params/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId, 'output-params'] });
            toast({ title: 'Output parameter deleted', description: 'Explicit output parameter removed' });
        }
    });

    const handleUpdate = (id: number, field: string, value: any) => {
        updateMutation.mutate({ id, data: { [field]: value } });
    };

    if (isLoading) return <div className="p-4 text-muted-foreground">Loading output parameters...</div>;

    return (
        <Card className="w-full mx-auto border-border/40 shadow-sm overflow-hidden mt-6">
            <CardHeader className="bg-muted/30 pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-600" />
                            Output Parameters
                        </CardTitle>
                        <CardDescription>
                            Discovered outputs from steps and explicitly defined return values
                        </CardDescription>
                    </div>
                    {isEditing && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => createMutation.mutate({})}
                            disabled={createMutation.isPending}
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Explicit Output
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {!Array.isArray(params) || params.length === 0 ? (
                    <div className="p-8 text-center bg-background">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                            <Activity className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium">No output parameters discovered</h3>
                        <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-4">
                            Outputs are automatically discovered from your pipeline steps. Add steps with structured job outputs (like Agent AI or Form Agents) to see them here.
                        </p>
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
                                <AccordionItem key={itemKey} value={itemValue} className={`px-4 border-b last:border-b-0 ${isInherited ? 'bg-indigo-50/10' : ''}`}>
                                    <div className="flex items-center gap-2 group">
                                        <div className={`text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity ${isInherited ? '' : 'cursor-grab'}`}>
                                            <GripVertical className="w-4 h-4" />
                                        </div>
                                        <AccordionTrigger className="hover:no-underline flex-1 py-4">
                                            <div className="flex items-center gap-3 text-left">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-sm">
                                                        {param.label || param.name}
                                                    </span>
                                                    <code className="text-[10px] bg-muted px-1 rounded text-muted-foreground w-fit mt-1">
                                                        {param.name}
                                                    </code>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-[10px] h-5">
                                                        {param.dataType}
                                                    </Badge>
                                                    {isInherited && (
                                                        <Badge variant="outline" className="text-[10px] h-5 bg-indigo-500/10 text-indigo-600 border-indigo-200">
                                                            Auto-Discovered
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
                                                        className="h-8 text-[10px] text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // Promote to explicit
                                                            createMutation.mutate({
                                                                name: param.name,
                                                                label: param.label,
                                                                description: param.description,
                                                                dataType: param.dataType
                                                            });
                                                        }}
                                                    >
                                                        <Settings2 className="w-3 h-3 mr-1" />
                                                        Promote
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm('Delete this explicit output?')) deleteMutation.mutate(param.id);
                                                        }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <AccordionContent className="pb-6 pt-2 pl-6 border-l-2 border-indigo-500/20 ml-2">
                                        {isInherited ? (
                                            <div className="p-4 bg-muted/30 rounded-lg border border-dashed border-border mb-4">
                                                <div className="flex items-start gap-3">
                                                    <AlertCircle className="w-5 h-5 text-indigo-500 mt-0.5" />
                                                    <div className="space-y-1">
                                                        <h4 className="text-sm font-medium">Auto-Discovered Output</h4>
                                                        <p className="text-xs text-muted-foreground">
                                                            This output was automatically detected from one of your pipeline steps.
                                                        </p>
                                                        <p className="text-xs text-muted-foreground pt-2">
                                                            <strong>Want to rename or change its type?</strong> Click "Promote" to make it an explicit pipeline output.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Variable Name</Label>
                                                        <Input
                                                            value={param.name}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'name', e.target.value)}
                                                            className="h-8 text-sm font-mono"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display Label</Label>
                                                        <Input
                                                            value={param.label || ''}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'label', e.target.value)}
                                                            className="h-8 text-sm"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data Type</Label>
                                                        <Select
                                                            value={param.dataType}
                                                            disabled={!isEditing}
                                                            onValueChange={(val) => handleUpdate(param.id, 'dataType', val)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="string">String</SelectItem>
                                                                <SelectItem value="number">Number</SelectItem>
                                                                <SelectItem value="boolean">Boolean</SelectItem>
                                                                <SelectItem value="json">JSON</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Description</Label>
                                                        <Textarea
                                                            value={param.description || ''}
                                                            disabled={!isEditing}
                                                            onChange={(e) => handleUpdate(param.id, 'description', e.target.value)}
                                                            className="text-sm min-h-[80px]"
                                                        />
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


