/**
 * DiffViewer Component
 * 
 * Displays a visual diff between two JSON objects or text blobs.
 * Used in the Reactive Intelligence feature for Human Approvals and Run Details.
 */

import React, { useState, useMemo } from 'react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import {
    Plus,
    Minus,
    RefreshCw,
    Eye,
    Code,
    LayoutPanelLeft,
} from 'lucide-react';

export interface DiffChange {
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: any;
    oldValue?: any;
}

export interface DiffResult {
    hasChanges: boolean;
    changeCount: number;
    changes: DiffChange[];
    summary: {
        added: number;
        removed: number;
        modified: number;
    };
}

interface DiffViewerProps {
    diff: DiffResult;
    baseline?: any;
    current?: any;
    title?: string;
    showRawView?: boolean;
}

export function DiffViewer({
    diff,
    baseline,
    current,
    title = 'Changes',
    showRawView = true,
}: DiffViewerProps) {
    const [viewMode, setViewMode] = useState<'changes' | 'side-by-side' | 'raw'>('changes');

    if (!diff.hasChanges) {
        return (
            <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                <CardContent className="flex items-center justify-center py-8">
                    <div className="text-center">
                        <RefreshCw className="h-8 w-8 mx-auto mb-2 text-green-600" />
                        <p className="text-green-700 dark:text-green-300 font-medium">
                            No changes detected
                        </p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                            The output matches the previous run
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                        {title}
                        <Badge variant="secondary" className="ml-2">
                            {diff.changeCount} {diff.changeCount === 1 ? 'change' : 'changes'}
                        </Badge>
                    </CardTitle>
                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
                        <TabsList className="h-8">
                            <TabsTrigger value="changes" className="text-xs px-2">
                                <Eye className="h-3 w-3 mr-1" />
                                Changes
                            </TabsTrigger>
                            <TabsTrigger value="side-by-side" className="text-xs px-2">
                                <LayoutPanelLeft className="h-3 w-3 mr-1" />
                                Side-by-Side
                            </TabsTrigger>
                            {showRawView && (
                                <TabsTrigger value="raw" className="text-xs px-2">
                                    <Code className="h-3 w-3 mr-1" />
                                    Raw
                                </TabsTrigger>
                            )}
                        </TabsList>
                    </Tabs>
                </div>
                {/* Summary badges */}
                <div className="flex gap-2 mt-2">
                    {diff.summary.added > 0 && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <Plus className="h-3 w-3 mr-1" />
                            {diff.summary.added} added
                        </Badge>
                    )}
                    {diff.summary.removed > 0 && (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                            <Minus className="h-3 w-3 mr-1" />
                            {diff.summary.removed} removed
                        </Badge>
                    )}
                    {diff.summary.modified > 0 && (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                            <RefreshCw className="h-3 w-3 mr-1" />
                            {diff.summary.modified} modified
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {viewMode === 'changes' && <ChangesView changes={diff.changes} />}
                {viewMode === 'side-by-side' && baseline && current && (
                    <SideBySideView baseline={baseline} current={current} />
                )}
                {viewMode === 'raw' && <RawView diff={diff} />}
            </CardContent>
        </Card>
    );
}

function ChangesView({ changes }: { changes: DiffChange[] }) {
    return (
        <div className="space-y-2 max-h-96 overflow-y-auto">
            {changes.map((change, index) => (
                <div
                    key={index}
                    className={`rounded-md p-3 text-sm font-mono ${change.op === 'add'
                            ? 'bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800'
                            : change.op === 'remove'
                                ? 'bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800'
                                : 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800'
                        }`}
                >
                    <div className="flex items-start gap-2">
                        <span
                            className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${change.op === 'add'
                                    ? 'bg-green-200 text-green-800'
                                    : change.op === 'remove'
                                        ? 'bg-red-200 text-red-800'
                                        : 'bg-yellow-200 text-yellow-800'
                                }`}
                        >
                            {change.op === 'add' ? '+' : change.op === 'remove' ? '-' : '~'}
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-muted-foreground mb-1">{change.path}</div>
                            {change.op === 'replace' && (
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-red-600 line-through">
                                            {formatValue(change.oldValue)}
                                        </span>
                                        <span className="text-muted-foreground">→</span>
                                        <span className="text-green-600">
                                            {formatValue(change.value)}
                                        </span>
                                    </div>
                                </div>
                            )}
                            {change.op === 'add' && (
                                <span className="text-green-700">{formatValue(change.value)}</span>
                            )}
                            {change.op === 'remove' && (
                                <span className="text-red-700 line-through">
                                    {formatValue(change.oldValue)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function SideBySideView({ baseline, current }: { baseline: any; current: any }) {
    const baselineStr = formatJson(baseline);
    const currentStr = formatJson(current);

    return (
        <div className="grid grid-cols-2 gap-4 max-h-96 overflow-y-auto">
            <div>
                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Previous
                </div>
                <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md text-xs overflow-x-auto border border-red-200">
                    {baselineStr}
                </pre>
            </div>
            <div>
                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Current
                </div>
                <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md text-xs overflow-x-auto border border-green-200">
                    {currentStr}
                </pre>
            </div>
        </div>
    );
}

function RawView({ diff }: { diff: DiffResult }) {
    return (
        <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md text-xs overflow-x-auto max-h-96">
            {JSON.stringify(diff, null, 2)}
        </pre>
    );
}

function formatValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function formatJson(value: any): string {
    if (typeof value === 'string') {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            return value;
        }
    }
    return JSON.stringify(value, null, 2);
}

export default DiffViewer;
