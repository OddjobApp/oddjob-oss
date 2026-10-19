import React from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { PipelinePerformanceBadge } from './PipelinePerformanceBadge.js';

interface PipelineFormActionsProps {
    isPending: boolean;
    isSuperAdmin: boolean;
    onCancel: () => void;
    onSaveAsTemplate: () => void;
    performanceEstimates: any;
}

export const PipelineFormActions: React.FC<PipelineFormActionsProps> = ({
    isPending,
    isSuperAdmin,
    onCancel,
    onSaveAsTemplate,
    performanceEstimates
}) => {
    return (
        <div className="flex justify-between items-center pt-4">
            <PipelinePerformanceBadge estimates={performanceEstimates} />

            <div className="flex gap-4">
                <Button
                    variant="secondary"
                    type="button"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCancel();
                    }}
                    disabled={isPending}
                >
                    Cancel
                </Button>
                {isSuperAdmin && (
                    <Button
                        variant="outline"
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSaveAsTemplate();
                        }}
                    >
                        Save as Template
                    </Button>
                )}
                <Button
                    type="submit"
                    disabled={isPending}
                    data-testid="button-save-pipeline"
                >
                    {isPending ? 'Saving...' : 'Save Workstream'}
                </Button>
            </div>
        </div>
    );
};
