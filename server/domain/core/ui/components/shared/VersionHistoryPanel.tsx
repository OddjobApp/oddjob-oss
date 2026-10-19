
import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Card, CardContent } from '../ui/card.js';
import { useEntityVersions, useRollbackVersion } from "@domain-ui/core/ui/hooks/use-entity-versions";
import { format } from "date-fns";
import { History, RotateCcw, AlertTriangle, FileDiff } from "lucide-react";
import { VersionDiffDialog } from './VersionDiffDialog.js';
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog.js';

interface VersionHistoryPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityType: "job" | "pipeline";
    entityId: number;
}

export function VersionHistoryPanel({ open, onOpenChange, entityType, entityId }: VersionHistoryPanelProps) {
    const { data: versions, isLoading } = useEntityVersions(entityType, entityId);
    const rollbackMutation = useRollbackVersion(entityType, entityId);
    const { toast } = useToast();
    const [diffDialog, setDiffDialog] = React.useState({
        open: false,
        versionId: 0,
        versionNumber: 0
    });

    const handleRollback = async (version: number) => {
        try {
            await rollbackMutation.mutateAsync(version);
            onOpenChange(false);
        } catch (error) {
            // Handled by hook
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[400px] sm:w-[540px]">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" />
                        Version History
                    </SheetTitle>
                    <SheetDescription>
                        View and restore previous configurations for this {entityType}.
                    </SheetDescription>
                </SheetHeader>

                <ScrollArea className="h-[calc(100vh-120px)] mt-6 pr-4">
                    {isLoading ? (
                        <div className="text-center py-4 text-muted-foreground">Loading versions...</div>
                    ) : (
                        <div className="space-y-4">
                            {versions?.map((version, index) => (
                                <Card key={version.id} className={index === 0 ? "border-green-500/50 bg-green-500/5" : ""}>
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant={index === 0 ? "default" : "secondary"}>
                                                    v{version.version}
                                                </Badge>
                                                {index === 0 && <span className="text-xs text-green-600 font-medium -ml-1">(Current)</span>}
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(version.createdAt), "MMM d, yyyy HH:mm")}
                                            </span>
                                        </div>

                                        {version.changeSummary && (
                                            <p className="text-sm text-foreground/80 mb-3 bg-muted/50 p-2 rounded">
                                                {version.changeSummary}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between mt-3">
                                            <div className="text-xs text-muted-foreground">
                                                {version.userId ? `User #${version.userId}` : "System"}
                                            </div>

                                            {index !== 0 && (
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 text-xs gap-1"
                                                        onClick={() => setDiffDialog({
                                                            open: true,
                                                            versionId: version.id, // ID of the version to compare against current
                                                            versionNumber: version.version
                                                        })}
                                                    >
                                                        <FileDiff className="h-3 w-3" />
                                                        Compare
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 hover:text-red-500 hover:border-red-500">
                                                                <RotateCcw className="h-3 w-3" />
                                                                Rollback
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Rollback to Version {version.version}?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This will create a new version (v{versions[0].version + 1}) with the configuration from v{version.version}.
                                                                    Current unsaved changes will be lost.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleRollback(version.version)} className="bg-red-500 hover:bg-red-600">
                                                                    Restore v{version.version}
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                            {versions?.length === 0 && (
                                <div className="text-center py-8 text-muted-foreground">
                                    No version history available.
                                </div>
                            )}
                        </div>
                    )}
                </ScrollArea>
                <VersionDiffDialog
                    open={diffDialog.open}
                    onOpenChange={(open) => setDiffDialog(prev => ({ ...prev, open }))}
                    entityType={entityType}
                    entityId={entityId}
                    versionId={diffDialog.versionId}
                    versionNumber={diffDialog.versionNumber}
                />
            </SheetContent>
        </Sheet>
    );
}

