
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export type ViewMode = 'graph' | 'schema' | 'staging' | 'timeline' | 'matrix' | '3d' | 'flow' | 'tree' | 'pivot';
export type ViewContext = 'global' | 'run' | 'dataset';

export interface UseKnowledgeFiltersOptions {
    initialContext?: {
        type: ViewContext;
        id?: number;
    };
}

export function useKnowledgeFilters({ initialContext }: UseKnowledgeFiltersOptions = {}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // View Modes & Context
    const [viewMode, setViewMode] = useState<ViewMode>("3d");
    const [viewContext, setViewContext] = useState<ViewContext>(initialContext?.type || "global");

    // Selection State
    const [selectedRunId, setSelectedRunId] = useState<number | null>(initialContext?.type === 'run' ? initialContext.id || null : null);
    const [selectedDatasets, setSelectedDatasets] = useState<string[]>(initialContext?.type === 'dataset' && initialContext.id ? [initialContext.id.toString()] : []);

    // Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [isNLQMode, setIsNLQMode] = useState(false);
    const [sourceLabel, setSourceLabel] = useState("");
    const [relation, setRelation] = useState("");
    const [targetLabel, setTargetLabel] = useState("");
    const [targetFilter, setTargetFilter] = useState("");

    // Session State
    const [sessionName, setSessionName] = useState("");
    const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

    const activeDatasetId = useMemo(() => {
        if (viewContext === 'global' && selectedDatasets.length > 0) {
            const parsed = parseInt(selectedDatasets[0], 10);
            return isNaN(parsed) ? null : parsed;
        }
        if (viewContext === 'dataset') {
            if (selectedDatasets.length > 0) {
                const parsed = parseInt(selectedDatasets[0], 10);
                return isNaN(parsed) ? null : parsed;
            }
            if (initialContext?.id) return initialContext.id;
        }
        return null;
    }, [viewContext, selectedDatasets, initialContext]);

    // Session Management
    const saveSessionMutation = useMutation({
        mutationFn: async (name: string) => {
            const sessionState = {
                viewMode,
                viewContext,
                selectedRunId,
                selectedDatasets,
                searchQuery,
            };

            await apiRequest("POST", "/api/knowledge-graph/sessions", {
                name,
                state: sessionState,
                contextType: viewContext,
                contextId: viewContext === 'run' ? selectedRunId : (viewContext === 'dataset' ? activeDatasetId : null)
            });
        },
        onSuccess: () => {
            toast({ title: "Session Saved", description: "Your view configuration has been saved." });
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/sessions"] });
        },
        onError: (err) => {
            toast({ title: "Save Failed", description: String(err), variant: "destructive" });
        }
    });

    const loadSession = (session: any) => {
        const state = session.state;
        if (state.viewMode) setViewMode(state.viewMode);
        if (state.viewContext) setViewContext(state.viewContext);
        if (state.selectedRunId) setSelectedRunId(state.selectedRunId);
        if (state.selectedDatasets) setSelectedDatasets(state.selectedDatasets);
        if (state.searchQuery) setSearchQuery(state.searchQuery);
        setCurrentSessionId(session.id);
        toast({ title: "Session Loaded", description: "View settings restored." });
    };

    return {
        // State
        viewMode, setViewMode,
        viewContext, setViewContext,
        selectedRunId, setSelectedRunId,
        selectedDatasets, setSelectedDatasets,
        activeDatasetId,
        searchQuery, setSearchQuery,
        isNLQMode, setIsNLQMode,
        sourceLabel, setSourceLabel,
        relation, setRelation,
        targetLabel, setTargetLabel,
        targetFilter, setTargetFilter,
        sessionName, setSessionName,
        currentSessionId,

        // Actions
        saveSession: (name: string) => saveSessionMutation.mutate(name),
        loadSession,
        isSavingSession: saveSessionMutation.isPending
    };
}

