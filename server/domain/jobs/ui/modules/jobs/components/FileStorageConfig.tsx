import React from 'react';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';

interface FileStorageConfigProps {
    saveOutputToFile: boolean;
    screenshotDirectory?: string;
    onSaveOutputChange: (value: boolean) => void;
    onDirectoryChange: (value: string) => void;
    disabled?: boolean;
    label?: string;
    placeholder?: string;
}

export default function FileStorageConfig({
    saveOutputToFile,
    screenshotDirectory,
    onSaveOutputChange,
    onDirectoryChange,
    disabled = false,
    label = "Save Output to JSON",
    placeholder = "e.g. extractions/reports"
}: FileStorageConfigProps) {
    return (
        <div className="space-y-4 pt-4 border-t mt-4">
            <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                    <Switch
                        checked={saveOutputToFile || false}
                        onCheckedChange={onSaveOutputChange}
                        disabled={disabled}
                    />
                    <Label className="text-sm cursor-pointer" onClick={() => !disabled && onSaveOutputChange(!saveOutputToFile)}>
                        {label}
                    </Label>
                </div>

                {saveOutputToFile && (
                    <div className="flex-1 min-w-[200px] space-y-2">
                        <Label className="text-xs">Storage Directory</Label>
                        <Input
                            placeholder={placeholder}
                            value={screenshotDirectory || ''}
                            onChange={(e) => onDirectoryChange(e.target.value)}
                            disabled={disabled}
                            className="h-8 text-xs"
                        />
                    </div>
                )}
            </div>
            <p className="text-[10px] text-muted-foreground">
                When enabled, job results will be saved to a timestamped folder in the specified directory.
            </p>
        </div>
    );
}
