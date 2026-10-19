import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { setEventStreamOrg } from "../services/event-bus";

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
  const { user, adminRole } = useAuth();
  
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

  // Role calculation - deriving from modules/auth user state and adminRole
  const isSuperAdmin = 
    user?.username === 'admin' || 
    user?.username === 'administrator' || 
    adminRole?.isSuperAdmin === true || 
    (user as any)?.adminRole?.isSuperAdmin === true;
  const isOrgAdmin = 
    adminRole?.isOrgAdmin === true || 
    (user as any)?.adminRole?.isOrgAdmin === true;
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Sync with session storage when state changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Live event subscriptions follow the org instead of keeping the one they
    // mounted under. null here means "auth still hydrating", not "no org", so
    // it is not reported: that would bounce every stream through the unscoped URL.
    if (selectedOrgId !== null) setEventStreamOrg(selectedOrgId);
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

  /**
   * Reflects the active organization back into the URL.
   *
   * The precedence is URL > sessionStorage > the user's default, but only the first of
   * those is visible. A page resolved from sessionStorage therefore looked
   * org-agnostic while every API call it made carried an org, so the SAME link meant
   * different things depending on invisible state — and nothing on screen said which
   * organization you were reading as.
   *
   * That is not theoretical. /operations/workstreams/393 reported "Pipeline not found"
   * for a user whose own default org owns pipeline 393, because sessionStorage was
   * still pinned to another org from an earlier page. Writing the org into the URL
   * makes the answer explainable, makes links reproducible for whoever opens them, and
   * costs nothing at the API layer because that precedence already prefers the URL.
   *
   * replaceState, not pushState: this is describing the page you are already on, not a
   * navigation, and it must not add a history entry the back button has to walk over.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || selectedOrgId === null) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('orgId') === String(selectedOrgId)) return;
      url.searchParams.set('orgId', String(selectedOrgId));
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (e) {
      // A URL the browser will not parse is not worth failing a render over.
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

