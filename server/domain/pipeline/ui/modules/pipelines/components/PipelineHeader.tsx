import React from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Play, Pencil, Trash2, X, Save, History, Copy as CopyIcon } from 'lucide-react';
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";

interface PipelineHeaderProps {
    pipeline: Pipeline;
    isEditing: boolean;
    editedName: string;
    setEditedName: (value: string) => void;
    editedDescription: string;
    setEditedDescription: (value: string) => void;
    onEdit: () => void;
    onCancel: () => void;
    onSave: () => void;
    onDelete: () => void;
    onRun: () => void;
    onShowHistory: () => void;
    onSaveTemplate: () => void;
    isSaving: boolean;
    isRunning: boolean;
}

export function PipelineHeader({
    pipeline,
    isEditing,
    editedName,
    setEditedName,
    editedDescription,
    setEditedDescription,
    onEdit,
    onCancel,
    onSave,
    onDelete,
    onRun,
    onShowHistory,
    onSaveTemplate,
    isSaving,
    isRunning
}: PipelineHeaderProps) {
    return (
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex-1 space-y-4">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <Input
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="text-2xl font-bold h-auto py-2 px-3"
                            placeholder="Pipeline Name"
                            data-testid="input-edit-pipeline-name"
                        />
                    ) : (
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-bold tracking-tight text-foreground">{pipeline.name}</h1>
                            <Badge variant={pipeline.isActive ? 'default' : 'secondary'} className={pipeline.isActive ? 'bg-green-100 text-green-800' : ''}>
                                {pipeline.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                        </div>
                    )}
                </div>

                {isEditing ? (
                    <div className="max-w-2xl">
                        <Textarea
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="text-sm resize-none"
                            rows={2}
                            placeholder="Pipeline description..."
                            data-testid="input-edit-pipeline-description"
                        />
                    </div>
                ) : (
                    <p className="text-muted-foreground">{pipeline.description || 'No description provided'}</p>
                )}
            </div>

            <div className="flex gap-2">
                {!isEditing && (
                    <>
                        <Button variant="outline" onClick={onShowHistory}>
                            <History className="mr-2 h-4 w-4" />
                            History
                        </Button>
                        <Button
                            variant="default"
                            onClick={onRun}
                            disabled={isRunning}
                            data-testid="button-run-pipeline"
                        >
                            <Play className="w-4 h-4 mr-2" />
                            {isRunning ? 'Running...' : 'Run Now'}
                        </Button>
                    </>
                )}
                {isEditing ? (
                    <>
                        <Button
                            variant="outline"
                            onClick={onCancel}
                            disabled={isSaving}
                            data-testid="button-cancel-edit"
                        >
                            <X className="w-4 h-4 mr-2" />
                            Cancel
                        </Button>
                        <Button
                            variant="default"
                            onClick={onSave}
                            disabled={isSaving}
                            data-testid="button-save-pipeline"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="outline" onClick={onEdit} data-testid="button-edit-pipeline">
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                        </Button>
                        <Button variant="outline" onClick={onSaveTemplate}>
                            <CopyIcon className="w-4 h-4 mr-2" />
                            Save as Template
                        </Button>
                        <Button
                            variant="outline"
                            onClick={onDelete}
                            data-testid="button-delete-pipeline"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
