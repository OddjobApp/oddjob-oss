import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@domain-ui/core/ui/components/ui/button';

interface FileDropzoneProps {
    onFileSelect: (file: File) => void;
    maxSize?: number; // in bytes
    accept?: string;
    className?: string;
    label?: string;
    description?: string;
}

export function FileDropzone({
    onFileSelect,
    maxSize = 10 * 1024 * 1024, // 10MB default
    accept,
    className,
    label = "Click or drag file to this area to upload",
    description = "Support for single or bulk upload. Strictly prohibit from uploading company data or other band files"
}: FileDropzoneProps) {
    const [isDragActive, setIsDragActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) return;

        const file = files[0];
        setError(null);

        if (file.size > maxSize) {
            setError(`File is too large. Max size is ${Math.round(maxSize / (1024 * 1024))}MB.`);
            return;
        }

        if (accept) {
            const acceptedTypes = accept.split(',').map(t => t.trim());
            const fileType = file.type;
            const fileExtension = `.${file.name.split('.').pop()}`;

            const isAccepted = acceptedTypes.some(type => {
                if (type.startsWith('.')) return type === fileExtension;
                if (type.endsWith('/*')) {
                    const baseType = type.split('/')[0];
                    return fileType.startsWith(`${baseType}/`);
                }
                return type === fileType;
            });

            if (!isAccepted) {
                setError(`File type not supported. Accepted: ${accept}`);
                return;
            }
        }

        onFileSelect(file);
    }, [accept, maxSize, onFileSelect]);

    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(true);
    }, []);

    const onDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
        handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files);
        // Reset input value so same file can be selected again
        e.target.value = '';
    };

    return (
        <div className={cn("space-y-2", className)}>
            <div
                onClick={handleClick}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={cn(
                    "relative border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center gap-3 text-center",
                    isDragActive
                        ? "border-primary bg-primary/5 scale-[1.01]"
                        : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900",
                    error && "border-red-500/50 bg-red-500/5"
                )}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onInputChange}
                    accept={accept}
                    className="hidden"
                    aria-label={label}
                />

                <div className={cn(
                    "p-3 rounded-full bg-zinc-800 border border-zinc-700 shadow-inner",
                    isDragActive && "bg-primary/20 border-primary/30"
                )}>
                    <Upload className={cn("w-6 h-6 text-zinc-400", isDragActive && "text-primary")} />
                </div>

                <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-200">{label}</p>
                    <p className="text-xs text-zinc-500 max-w-[280px] mx-auto leading-relaxed">
                        {description}
                    </p>
                </div>

                {isDragActive && (
                    <div className="absolute inset-0 bg-primary/5 rounded-xl flex items-center justify-center pointer-events-none">
                        <p className="text-primary font-bold text-sm uppercase tracking-widest font-mono">Drop to upload</p>
                    </div>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 text-xs text-red-500 mt-1 px-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
