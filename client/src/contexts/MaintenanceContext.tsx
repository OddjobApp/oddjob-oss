import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";

interface MaintenanceContextType {
  isMaintenanceMode: boolean;
  setMaintenanceMode: (enabled: boolean) => void;
  isLoading: boolean;
}

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(undefined);

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Only fetch settings once the user is authenticated — no point hitting this on the login page
  const { data: settings, isLoading } = useQuery({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings', {
        credentials: 'include',
      });
      if (!res.ok) {
        return { maintenanceMode: false };
      }
      return res.json();
    },
    enabled: !!user,
    retry: false,
    staleTime: 30000,
  });

  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);

  // Update local state when settings are fetched
  useEffect(() => {
    if (settings) {
      setIsMaintenanceMode(settings.maintenanceMode || false);
    }
  }, [settings]);

  // Mutation to update maintenance mode
  const updateMaintenanceModeMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const currentSettings = settings || { maintenanceMode: false, logRetentionDays: 30, emailNotifications: true, slackNotifications: false };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...currentSettings,
          maintenanceMode: enabled,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to update maintenance mode');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setIsMaintenanceMode(data.maintenanceMode || false);
      queryClient.setQueryData(['/api/settings'], data);
      console.log('Maintenance mode updated:', data.maintenanceMode);
    },
    onError: (error) => {
      console.error('Failed to update maintenance mode:', error);
      // Revert to previous state on error
      if (settings) {
        setIsMaintenanceMode(settings.maintenanceMode || false);
      }
    },
  });

  const setMaintenanceMode = (enabled: boolean) => {
    // Optimistically update UI
    setIsMaintenanceMode(enabled);
    updateMaintenanceModeMutation.mutate(enabled, {
      onError: () => {
        // Revert on error
        if (settings) {
          setIsMaintenanceMode(settings.maintenanceMode || false);
        }
      }
    });
  };

  return (
    <MaintenanceContext.Provider value={{ isMaintenanceMode, setMaintenanceMode, isLoading }}>
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenanceMode() {
  const context = useContext(MaintenanceContext);
  if (context === undefined) {
    throw new Error('useMaintenanceMode must be used within a MaintenanceProvider');
  }
  return context;
}

