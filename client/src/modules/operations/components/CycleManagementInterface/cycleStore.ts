/**
 * Cycle Management Store
 * 
 * Zustand store for managing cycle state across the cycle management interface
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Cycle, Blueprint, AppStatus } from './types';

interface CycleStore {
  // State
  currentCycle: Cycle | null;
  apps: Blueprint[];
  activeAppIndex: number;
  filterStatus?: AppStatus;
  sortBy?: 'name' | 'status' | 'duration';
  
  // UI State
  headerExpanded: boolean;
  navExpanded: boolean;
  detailExpanded: boolean;
  dependencyExpanded: boolean;
  
  // Settings
  autoAdvance: boolean;
  soundEnabled: boolean;
  refreshInterval: number;
  
  // Actions
  setCurrentCycle: (cycle: Cycle) => void;
  setApps: (apps: Blueprint[]) => void;
  setActiveAppIndex: (index: number) => void;
  setFilterStatus: (status?: AppStatus) => void;
  setSortBy: (sort: 'name' | 'status' | 'duration') => void;
  
  togglePanel: (panel: 'header' | 'nav' | 'detail' | 'dependency') => void;
  setAutoAdvance: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setRefreshInterval: (interval: number) => void;
  
  // Computed
  getActiveApp: () => Blueprint | undefined;
  getFilteredApps: () => Blueprint[];
  getSortedApps: () => Blueprint[];
  getCompletedApps: () => Blueprint[];
  getActiveApps: () => Blueprint[];
  getFailedApps: () => Blueprint[];
}

export const useCycleStore = create<CycleStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        currentCycle: null,
        apps: [],
        activeAppIndex: 0,
        filterStatus: undefined,
        sortBy: undefined,
        
        headerExpanded: true,
        navExpanded: true,
        detailExpanded: true,
        dependencyExpanded: false,
        
        autoAdvance: true,
        soundEnabled: false,
        refreshInterval: 5000,
        
        // Actions
        setCurrentCycle: (cycle) => set({ currentCycle: cycle }),
        setApps: (apps) => set({ apps }),
        setActiveAppIndex: (index) => set({ activeAppIndex: index }),
        setFilterStatus: (status) => set({ filterStatus: status }),
        setSortBy: (sort) => set({ sortBy: sort }),
        
        togglePanel: (panel) => set((state) => ({
          [`${panel}Expanded`]: !state[`${panel}Expanded`]
        })),
        setAutoAdvance: (enabled) => set({ autoAdvance: enabled }),
        setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
        setRefreshInterval: (interval) => set({ refreshInterval: interval }),
        
        // Computed
        getActiveApp: () => {
          const { apps, activeAppIndex } = get();
          return apps[activeAppIndex];
        },
        
        getFilteredApps: () => {
          const { apps, filterStatus } = get();
          if (!filterStatus) return apps;
          return apps.filter(app => app.status === filterStatus);
        },
        
        getSortedApps: () => {
          const { getFilteredApps, sortBy } = get();
          const apps = getFilteredApps();
          
          if (!sortBy) return apps;
          
          return [...apps].sort((a, b) => {
            switch (sortBy) {
              case 'name':
                return a.name.localeCompare(b.name);
              case 'status':
                return (a.status || '').localeCompare(b.status || '');
              case 'duration':
                return (a.executionMetadata?.duration || 0) - (b.executionMetadata?.duration || 0);
              default:
                return 0;
            }
          });
        },
        
        getCompletedApps: () => {
          const { apps } = get();
          return apps.filter(app => app.status === 'completed');
        },
        
        getActiveApps: () => {
          const { apps } = get();
          return apps.filter(app => ['active', 'running'].includes(app.status || ''));
        },
        
        getFailedApps: () => {
          const { apps } = get();
          return apps.filter(app => ['failed', 'blocked'].includes(app.status || ''));
        },
      }),
      {
        name: 'cycle-management-storage',
        partialize: (state) => ({
          autoAdvance: state.autoAdvance,
          soundEnabled: state.soundEnabled,
          refreshInterval: state.refreshInterval,
        }),
      }
    )
  )
);
