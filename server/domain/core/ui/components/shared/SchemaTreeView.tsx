import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Key, Link as LinkIcon, Info, Edit2, X } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@domain-ui/core/ui/components/ui/collapsible';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card } from '@domain-ui/core/ui/components/ui/card';
import type { FieldDefinition, JobInputSchema, JobOutputSchema } from "@shared/schema/jobs/types";
import SchemaNodeEditor from './SchemaNodeEditor.js';

interface SchemaNode {
    name: string;
    fullPath: string;
    field?: FieldDefinition;
    children: Record<string, SchemaNode>;
}

interface SchemaTreeViewProps {
    schema: JobOutputSchema | JobInputSchema | null | undefined;
    editable?: boolean;
    editingPath?: string | null;
    onEdit?: (path: string | null) => void;
    onUpdateField?: (path: string, updates: Partial<FieldDefinition>) => void;
}

export default function SchemaTreeView({
    schema,
    editable = false,
    editingPath = null,
    onEdit,
    onUpdateField
}: SchemaTreeViewProps) {
    if (!schema || !schema.schemaDef) {
        return (
            <div className="text-sm text-muted-foreground p-4 text-center border rounded-md border-dashed">
                No schema definition available
            </div>
        );
    }

    // Build the tree structure from flat paths
    const tree = useMemo(() => {
        const root: Record<string, SchemaNode> = {};

        Object.entries(schema.schemaDef).forEach(([path, field]) => {
            const parts = path.split('.');
            let currentLevel = root;

            parts.forEach((part, index) => {
                const isLast = index === parts.length - 1;

                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        fullPath: parts.slice(0, index + 1).join('.'),
                        children: {},
                    };
                }

                if (isLast) {
                    currentLevel[part].field = field;
                }

                currentLevel = currentLevel[part].children;
            });
        });

        return root;
    }, [schema]);

    const renderNode = (node: SchemaNode) => {
        const hasChildren = Object.keys(node.children).length > 0;
        const isArrayField = node.name.endsWith('[]');
        // Clean name for display (remove [] if present for cleaner tree view look, or keep it to be explicit? 
        // Keeping it explicit is probably better for accuracy)
        const displayName = node.name;
        const isEditing = editable && editingPath === node.fullPath;

        return (
            <div key={node.fullPath} className="ml-4 border-l pl-2 py-1">
                <Collapsible defaultOpen={false}>
                    <div className="flex items-start gap-2">
                        {hasChildren ? (
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 p-0 mt-0.5 shrink-0 transition-transform [&[data-state=open]>svg]:rotate-90">
                                    <ChevronRight className="h-4 w-4 transition-transform duration-200" />
                                    <span className="sr-only">Toggle</span>
                                </Button>
                            </CollapsibleTrigger>
                        ) : (
                            <div className="w-6 shrink-0" />
                        )}

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-sm font-medium hover:text-primary transition-colors cursor-text select-text" title={node.fullPath}>
                                        {displayName}
                                    </span>

                                    {node.field && (
                                        <>
                                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                                                {node.field.type}
                                            </Badge>

                                            {node.field.isKey && (
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100 border-blue-200">
                                                    <Key className="w-2.5 h-2.5 mr-1" />
                                                    Key
                                                </Badge>
                                            )}

                                            {node.field.isForeignKey && (
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-100 border-purple-200">
                                                    <LinkIcon className="w-2.5 h-2.5 mr-1" />
                                                    {node.field.foreignKeyTarget ? `FK: ${node.field.foreignKeyTarget}` : 'FK'}
                                                </Badge>
                                            )}

                                            {node.field.required && (
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 border-red-200">
                                                    Required
                                                </Badge>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Edit Button */}
                                {editable && node.field && onEdit && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent toggling collapse if clicking edit
                                            onEdit(isEditing ? null : node.fullPath);
                                        }}
                                    >
                                        {isEditing ? <X className="w-3 h-3" /> : <Edit2 className="w-3 h-3 text-muted-foreground hover:text-foreground" />}
                                    </Button>
                                )}
                            </div>

                            {/* Description */}
                            {node.field?.description && (
                                <div className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>{node.field.description}</span>
                                </div>
                            )}

                            {/* Examples */}
                            {node.field?.examples && node.field.examples.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {node.field.examples.slice(0, 5).map((ex, i) => (
                                        <code key={i} className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground max-w-[200px] truncate block" title={JSON.stringify(ex)}>
                                            {typeof ex === 'object' ? JSON.stringify(ex).substring(0, 30) + (JSON.stringify(ex).length > 30 ? '...' : '') : String(ex)}
                                        </code>
                                    ))}
                                    {node.field.examples.length > 5 && (
                                        <span className="text-[10px] text-muted-foreground self-center">
                                            +{node.field.examples.length - 5} more
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Editor */}
                            {isEditing && node.field && onUpdateField && (
                                <SchemaNodeEditor
                                    field={node.field}
                                    path={node.fullPath}
                                    onUpdate={onUpdateField}
                                />
                            )}
                        </div>
                    </div>

                    <CollapsibleContent>
                        {hasChildren && (
                            <div className="mt-1">
                                {Object.values(node.children).map(child => renderNode(child))}
                            </div>
                        )}
                    </CollapsibleContent>
                </Collapsible>
            </div>
        );
    };

    return (
        <div className="rounded-md border bg-card text-card-foreground shadow-sm">
            <div className="p-4 space-y-2 max-h-[600px] overflow-y-auto">
                <div className="text-sm font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                    <span>Schema Structure</span>
                    <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full">
                        {Object.keys(schema.schemaDef).length} flat paths
                    </span>
                </div>
                <div className="-ml-2">
                    {Object.values(tree).map(node => renderNode(node))}
                </div>
            </div>
        </div>
    );
}
