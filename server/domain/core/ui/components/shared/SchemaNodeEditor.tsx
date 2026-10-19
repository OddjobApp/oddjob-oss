import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import type { FieldDefinition } from "@shared/schema/jobs/types";

interface SchemaNodeEditorProps {
    field: FieldDefinition;
    path: string;
    onUpdate: (path: string, updates: Partial<FieldDefinition>) => void;
}

export default function SchemaNodeEditor({ field, path, onUpdate }: SchemaNodeEditorProps) {
    return (
        <div className="pt-2 border-t space-y-3 mt-2">
            <div className="flex items-center gap-2">
                <Switch
                    checked={field.isKey || false}
                    onCheckedChange={(checked) =>
                        onUpdate(path, { isKey: checked })
                    }
                    className="scale-75 origin-left"
                />
                <Label className="text-xs">Mark as Key</Label>
            </div>

            <div className="flex items-center gap-2">
                <Switch
                    checked={field.isForeignKey || false}
                    onCheckedChange={(checked) =>
                        onUpdate(path, {
                            isForeignKey: checked,
                            foreignKeyTarget: checked ? field.foreignKeyTarget || '' : undefined,
                        })
                    }
                    className="scale-75 origin-left"
                />
                <Label className="text-xs">Mark as Foreign Key</Label>
            </div>

            {field.isForeignKey && (
                <div className="space-y-1 ml-1">
                    <Label className="text-xs text-muted-foreground">Foreign Key Target</Label>
                    <Input
                        value={field.foreignKeyTarget || ''}
                        onChange={(e) =>
                            onUpdate(path, {
                                foreignKeyTarget: e.target.value,
                            })
                        }
                        placeholder="e.g., users.id"
                        className="text-xs h-7"
                    />
                </div>
            )}

            <div className="flex items-center gap-2">
                <Switch
                    checked={field.required || false}
                    onCheckedChange={(checked) =>
                        onUpdate(path, { required: checked })
                    }
                    className="scale-75 origin-left"
                />
                <Label className="text-xs">Required</Label>
            </div>

            <div className="space-y-1 ml-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                    value={field.description || ''}
                    onChange={(e) =>
                        onUpdate(path, { description: e.target.value })
                    }
                    placeholder="Field description"
                    className="text-xs h-7"
                />
            </div>
        </div>
    );
}
