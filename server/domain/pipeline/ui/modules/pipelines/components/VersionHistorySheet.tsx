import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  History, 
  RotateCcw, 
  GitCommit, 
  User as UserIcon,
  Loader2 
} from "lucide-react";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetTrigger 
} from "@domain-ui/core/ui/components/ui/sheet";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@domain-ui/core/ui/components/ui/alert-dialog";

interface VersionHistorySheetProps {
  pipelineId: number;
}

interface Version {
  id: number;
  versionNumber: number;
  description: string;
  createdAt: string;
  user?: { username: string; email?: string };
}

export function VersionHistorySheet({ pipelineId }: VersionHistorySheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = React.useState(false);

  // Fetch History
  const { data: versions, isLoading } = useQuery<Version[]>({
    queryKey: ["pipeline-versions", pipelineId],
    queryFn: async () => {
      const res = await fetch(`/api/pipelines/${pipelineId}/versions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch versions");
      return res.json();
    },
    enabled: isOpen, // Only fetch when drawer is opened
  });

  // Rollback Mutation
  const rollbackMutation = useMutation({
    mutationFn: async (versionId: number) => {
      const res = await apiRequest("POST", `/api/pipelines/${pipelineId}/rollback`, { versionId });
      return res.json();
    },
    onSuccess: (_, versionId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-versions", pipelineId] });
      setIsOpen(false);
      toast({
        title: "Pipeline Restored",
        description: "Configuration has been reverted successfully.",
        variant: "default",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore version.",
        variant: "destructive",
      });
    }
  });

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <History className="h-4 w-4" />
          History
        </Button>
      </SheetTrigger>
      
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col gap-0">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" />
            Version History
          </SheetTitle>
          <SheetDescription>
            View and restore previous snapshots of this pipeline.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6 py-4">
          <div className="space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : versions?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No history found. Save the pipeline to create a version.
              </div>
            ) : (
              versions?.map((v) => (
                <div 
                  key={v.id} 
                  className="group relative flex flex-col gap-2 rounded-lg border p-4 hover:bg-muted dark:hover:bg-card transition-colors"
                >
                  {/* Header Row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-mono">
                        v{v.versionNumber}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(v.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>

                    {/* Restore Button (Protected by Alert Dialog) */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={rollbackMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4 text-muted-foreground hover:text-indigo-600" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Restore Version {v.versionNumber}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will overwrite the current pipeline configuration with this snapshot. 
                            Any unsaved changes will be lost.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => rollbackMutation.mutate(v.id)}
                            className="bg-indigo-600 hover:bg-indigo-700"
                          >
                            Restore
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Description */}
                  <p className="text-sm font-medium text-foreground">
                    {v.description || "Automatic snapshot"}
                  </p>

                  {/* Footer Meta */}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      <UserIcon className="h-3 w-3" />
                      {v.user?.username || "System"}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <GitCommit className="h-3 w-3" />
                      Snapshot ID: {v.id}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}


