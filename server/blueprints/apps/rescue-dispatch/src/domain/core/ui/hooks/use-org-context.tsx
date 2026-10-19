import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";

interface OrgContextType {
  selectedOrgId: number | null;
  setSelectedOrgId: (orgId: number | null) => void;
  clearSelectedOrg: () => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
}

const OrgContext = createContext<OrgContextType | null>(null);

const SESSION_STORAGE_KEY = 'selectedOrganizationId';

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  
  // Initialize from session storage
  const [selectedOrgId, setSelectedOrgIdState] = useState<number | null>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      // Priority: URL param > Session storage > Default (null until user is confirmed)
      const urlParams = new URLSearchParams(window.location.search);
      const urlOrgId = urlParams.get('orgId');
      if (urlOrgId) return parseInt(urlOrgId, 10);

      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) return parseInt(stored, 10);
      
      // We return null initially if no storage/param, allowing the user's defaultOrgId
      // to be picked up once useAuth() hydrates.
      return null;
    } catch (e) {
      return null;
    }
  });

  // Sync selectedOrgId with user default if null
  useEffect(() => {
    if (user && selectedOrgId === null) {
      const userDefault = (user as any).defaultOrgId || 1;
      setSelectedOrgIdState(userDefault);
    }
  }, [user, selectedOrgId]);

  // Role calculation - deriving from modules/auth user state
  const isSuperAdmin = user?.username === 'admin' || user?.username === 'administrator' || (user as any)?.adminRole?.isSuperAdmin === true;
  const isOrgAdmin = (user as any)?.adminRole?.isOrgAdmin === true;
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Sync with session storage when state changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (selectedOrgId !== null) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, selectedOrgId.toString());
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (e) {
      console.error('Failed to update session storage:', e);
    }
  }, [selectedOrgId]);

  const setSelectedOrgId = (orgId: number | null) => {
    setSelectedOrgIdState(orgId);
  };

  const clearSelectedOrg = () => {
    setSelectedOrgIdState(null);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (e) {
        console.error('Failed to clear session storage:', e);
      }
    }
  };

  return (
    <OrgContext.Provider value={{ 
      selectedOrgId, 
      setSelectedOrgId, 
      clearSelectedOrg,
      isAdmin,
      isSuperAdmin,
      isOrgAdmin
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrgContext() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrgContext must be used within an OrgProvider');
  }
  return context;
}

/** Safe variant — returns null when called outside OrgProvider (e.g. public routes). */
export function useOrgContextOptional(): OrgContextType | null {
  return useContext(OrgContext);
}

