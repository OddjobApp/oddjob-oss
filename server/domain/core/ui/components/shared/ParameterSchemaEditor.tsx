
import React from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { JobParameter } from "@shared/schema/jobs/types";

interface ParameterSchemaEditorProps {
    parameters: JobParameter[];
    onChange: (parameters: JobParameter[]) => void;
}

export default function ParameterSchemaEditor({ parameters, onChange }: ParameterSchemaEditorProps) {

    const handleAddParameter = () => {
        onChange([
            ...parameters,
            {
                name: "",
                type: "string",
                required: true,
                defaultValue: "",
                description: ""
            }
        ]);
    };

    const handleUpdateParameter = (index: number, field: keyof JobParameter, value: any) => {
        const newParameters = [...parameters];
        newParameters[index] = { ...newParameters[index], [field]: value };
        onChange(newParameters);
    };

    const handleRemoveParameter = (index: number) => {
        const newParameters = parameters.filter((_, i) => i !== index);
        onChange(newParameters);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Input Parameters</h3>
                <Button onClick={handleAddParameter} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Parameter
                </Button>
            </div>

            <div className="space-y-3">
                {(!parameters || !Array.isArray(parameters) || parameters.length === 0) ? (
                    <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
                        No input parameters defined. Click "Add Parameter" to define expected inputs.
                    </div>
                ) : (
                    parameters.map((param, index) => (
                        <Card key={index} className="relative group">
                            <CardContent className="p-4 space-y-4">
                                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleRemoveParameter(index)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs">Variable Name</Label>
                                        <Input
                                            placeholder="e.g. step.0.output"
                                            value={param.name}
                                            onChange={(e) => handleUpdateParameter(index, "name", e.target.value)}
                                            className="h-8"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs">Type</Label>
                                        <Select
                                            value={param.type}
                                            onValueChange={(value) => handleUpdateParameter(index, "type", value)}
                                        >
                                            <SelectTrigger className="h-8">
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
                                </div>

                                <div className="flex items-center space-x-4">
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            id={`required-${index}`}
                                            checked={param.required}
                                            onCheckedChange={(checked) => handleUpdateParameter(index, "required", checked)}
                                        />
                                        <Label htmlFor={`required-${index}`} className="text-xs font-normal">Required</Label>
                                    </div>

                                    <div className="flex-1 space-y-2">
                                        <Label className="text-xs">Default Value</Label>
                                        <Input
                                            placeholder="Optional default value"
                                            value={param.defaultValue || ""}
                                            onChange={(e) => handleUpdateParameter(index, "defaultValue", e.target.value)}
                                            className="h-8"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs">Description</Label>
                                    <Input
                                        placeholder="Help text for this parameter"
                                        value={param.description || ""}
                                        onChange={(e) => handleUpdateParameter(index, "description", e.target.value)}
                                        className="h-8"
                                    />
                                </div>

                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
