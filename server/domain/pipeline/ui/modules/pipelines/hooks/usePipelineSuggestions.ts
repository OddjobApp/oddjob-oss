import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

export interface PipelineContext {
  id?: number;
  name?: string;
  description?: string;
  steps: Array<{
    id: number;
    jobId: number;
    jobType: string;
    outputName?: string;
    order: number;
  }>;
}

export interface PipelineSuggestion {
  nodeId?: string;
  nodeType: string;
  jobId?: number;
  confidence: number;
  reason: string;
  suggestedConfiguration?: any;
  estimatedCost?: number;
}

export interface SuggestionResponse {
  suggestions: PipelineSuggestion[];
  context: {
    pipelineStepCount: number;
    lastJobType?: string;
    commonPatterns: string[];
  };
  cost: {
    tokensUsed: number;
    estimatedCost: number;
  };
}

export interface ConfigurationSuggestion {
  field: string;
  currentValue: any;
  suggestedValue: any;
  reason: string;
  confidence: number;
}

export interface ConfigurationSuggestionResponse {
  suggestions: ConfigurationSuggestion[];
  commonPatterns: string[];
}

export interface AvailableJob {
  id: number;
  type: string;
  name: string;
  description: string;
}

export interface SuggestionOptions {
  maxSuggestions?: number;
  includeCostEstimate?: boolean;
  suggestionType?: 'next_step' | 'configuration' | 'optimization';
}

const API_BASE = '/api';

export const usePipelineSuggestions = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get suggestions for a pipeline
  const {
    mutateAsync: getSuggestions,
    isPending: isGettingSuggestions,
    error: suggestionsError
  } = useMutation({
    mutationFn: async ({
      pipelineId,
      pipeline,
      options = {}
    }: {
      pipelineId?: number;
      pipeline?: PipelineContext;
      options?: SuggestionOptions;
    }): Promise<SuggestionResponse> => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pipelineId,
          pipeline,
          options
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get pipeline suggestions');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Suggestions Generated",
        description: `Found ${data.suggestions.length} suggestions for your pipeline`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to generate suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Get configuration suggestions for a job
  const {
    mutate: getConfigurationSuggestions,
    isPending: isGettingConfigSuggestions,
    error: configSuggestionsError
  } = useMutation({
    mutationFn: async ({
      jobType,
      currentConfig,
      jobId
    }: {
      jobType: string;
      currentConfig?: any;
      jobId?: number;
    }): Promise<ConfigurationSuggestionResponse> => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions/configuration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobType,
          currentConfig,
          jobId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get configuration suggestions');
      }

      return response.json();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to get configuration suggestions.",
        variant: "destructive",
      });
    },
  });

  // Get available jobs for suggestions
  const {
    data: availableJobs,
    isLoading: isLoadingJobs,
    error: jobsError
  } = useQuery({
    queryKey: ['pipeline-suggestions-jobs'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions/jobs`);
      if (!response.ok) {
        throw new Error('Failed to fetch available jobs');
      }
      return response.json() as Promise<{
        jobs: Record<string, AvailableJob[]>;
        types: string[];
      }>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get common patterns
  const {
    data: commonPatterns,
    isLoading: isLoadingPatterns,
    error: patternsError
  } = useQuery({
    queryKey: ['pipeline-suggestions-patterns'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions/patterns`);
      if (!response.ok) {
        throw new Error('Failed to fetch common patterns');
      }
      return response.json() as Promise<{
        patterns: string[];
        lastUpdated: string;
      }>;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  // Validate a suggestion
  const {
    mutate: validateSuggestion,
    isPending: isValidatingSuggestion,
    error: validationError
  } = useMutation({
    mutationFn: async ({
      suggestion,
      pipelineContext
    }: {
      suggestion: PipelineSuggestion;
      pipelineContext: PipelineContext;
    }) => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          suggestion,
          pipelineContext
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to validate suggestion');
      }

      return response.json() as Promise<{
        isValid: boolean;
        warnings: string[];
        errors: string[];
      }>;
    },
  });

  // Apply a suggestion to the pipeline
  const applySuggestion = async (
    suggestion: PipelineSuggestion,
    onApply: (suggestion: PipelineSuggestion) => void,
    pipelineContext?: PipelineContext
  ) => {
    try {
      // Validate suggestion first if we have context
      if (pipelineContext) {
        const validation = await validateSuggestionAsync(suggestion, pipelineContext);

        if (!validation.isValid) {
          toast({
            title: "Cannot Apply Suggestion",
            description: validation.errors.join(', '),
            variant: "destructive",
          });
          return false;
        }

        if (validation.warnings.length > 0) {
          toast({
            title: "Warning",
            description: validation.warnings.join(', '),
          });
        }
      }

      // Apply the suggestion
      onApply(suggestion);

      toast({
        title: "Suggestion Applied",
        description: "The suggestion has been applied to your pipeline.",
      });

      return true;
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to apply suggestion.",
        variant: "destructive",
      });
      return false;
    }
  };

  // Helper function to validate suggestion
  const validateSuggestionAsync = async (suggestion: PipelineSuggestion, pipelineContext: PipelineContext) => {
    try {
      // Call validation API directly
      const response = await fetch(`${API_BASE}/pipelines/suggestions/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          suggestion,
          pipelineContext
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to validate suggestion');
      }

      return response.json() as Promise<{
        isValid: boolean;
        warnings: string[];
        errors: string[];
      }>;
    } catch (error) {
      return {
        isValid: false,
        warnings: [],
        errors: ['Validation failed']
      };
    }
  };

  // Get suggestion analytics
  const {
    data: analytics,
    isLoading: isLoadingAnalytics,
    error: analyticsError
  } = useQuery({
    queryKey: ['pipeline-suggestions-analytics'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/pipelines/suggestions/analytics`);
      if (!response.ok) {
        throw new Error('Failed to fetch suggestion analytics');
      }
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    // Mutation functions
    getSuggestions,
    getConfigurationSuggestions,
    validateSuggestion,
    applySuggestion,

    // Loading states
    isGettingSuggestions,
    isGettingConfigSuggestions,
    isValidatingSuggestion,

    // Error states
    suggestionsError,
    configSuggestionsError,
    validationError,

    // Query data
    availableJobs,
    commonPatterns,
    analytics,

    // Loading states for queries
    isLoadingJobs,
    isLoadingPatterns,
    isLoadingAnalytics,

    // Error states for queries
    jobsError,
    patternsError,
    analyticsError,

    // Query client for manual invalidation
    invalidateSuggestions: () => queryClient.invalidateQueries({ queryKey: ['pipeline-suggestions'] }),
  };
};

export default usePipelineSuggestions;

