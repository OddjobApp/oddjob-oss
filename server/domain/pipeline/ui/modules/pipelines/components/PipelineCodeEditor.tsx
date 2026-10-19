// @ts-nocheck
import React from 'react';

// Simplified interface to satisfy imports
interface PipelineCodeEditorProps {
  pipeline?: any;
  onPipelineChange?: (pipeline: any) => void;
  onValidationChange?: (errors: any[]) => void;
  initialMode?: 'visual' | 'code' | 'split';
  readOnly?: boolean;
  className?: string;
}

export const PipelineCodeEditor: React.FC<PipelineCodeEditorProps> = () => {
  return (
    <div className="p-4 border rounded bg-muted">
      <p>Code Editor Temporarily Disabled for Maintenance</p>
    </div>
  );
};
