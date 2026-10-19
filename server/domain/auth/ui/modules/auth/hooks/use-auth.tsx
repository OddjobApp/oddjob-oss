import React, { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { User, InsertUser } from "@shared/schema/auth";
import { getQueryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useErrorToast } from "@domain-ui/core/ui/hooks/use-error-toast";
import { can as checkPermission, Permission, type AdminRoleInfo } from "@/lib/permissions";

const USER_CACHE_KEY = "oddjob:user:cache";
const USER_CACHE_TS_KEY = "oddjob:user:cache:ts";

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    const ts = parseInt(sessionStorage.getItem(USER_CACHE_TS_KEY) || "0", 10);
    return raw ? { data: JSON.parse(raw), ts } : null;
  } catch {
    return null;
  }
}

function writeSessionCache(data: any) {
  try {
    sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(data));
    sessionStorage.setItem(USER_CACHE_TS_KEY, Date.now().toString());
  } catch {}
}

function clearSessionCache() {
  try {
    sessionStorage.removeItem(USER_CACHE_KEY);
    sessionStorage.removeItem(USER_CACHE_TS_KEY);
  } catch {}
}

type UserWithAdminRole = User & {
  adminRole?: AdminRoleInfo;
};

type AuthContextType = {
  user: User | null;
  adminRole: AdminRoleInfo | null;
  isLoading: boolean;
  isFetched: boolean;
  isVerified: boolean;
  error: Error | null;
  loginMutation: any;
  logoutMutation: any;
  registerMutation: any;
  can: (permission: Permission) => boolean;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children, publicEntry = false }: { children: ReactNode; publicEntry?: boolean }) {
  const { toast } = useToast();
  const { notify: notifyError } = useErrorToast();
  const queryClient = getQueryClient();
  const [, setLocation] = useLocation();

  const [isVerified, setIsVerified] = React.useState(false);
  const cached = readSessionCache();

  const { data: userData, error, isLoading, isFetched } = useQuery<UserWithAdminRole | null, Error>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      const res = await fetch("/api/user", {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearSessionCache();
          setIsVerified(true);
          return null as UserWithAdminRole | null;
        }
        throw new Error(`Failed to fetch user: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      setIsVerified(true);
      return data;
    },
    // Use sessionStorage cache as initialData to skip the loading flash on pod switches.
    // initialDataUpdatedAt tells React Query how fresh it is; staleTime determines
    // whether a background refetch is triggered.
    initialData: cached?.data ?? undefined,
    initialDataUpdatedAt: cached?.ts ?? undefined,
    retry: 2,
    retryDelay: 1000,
    staleTime: 300000, // 5 minutes — avoids refetch floods on pod switches
    // Cached identity is only a rendering optimization, never proof that the
    // server session is still alive. Verify once for every app mount so the
    // login entry cannot bounce a stale cached user back to a protected route.
    refetchOnMount: 'always',
    refetchInterval: 120000, // 2 minutes background refresh
  });

  useEffect(() => {
    if (userData && (userData as any).authenticated) {
      console.log("[Auth] Session active for:", (userData as any).username);
      writeSessionCache(userData);
    } else if (userData && (userData as any).authenticated === false) {
      const path = window.location.pathname;
      const isAuthPage = path.startsWith("/auth") || path === "/";
      const isPublicRoute = 
        path.startsWith("/a/") || 
        path.startsWith("/r/") || 
        path.startsWith("/h/") || 
        path.startsWith("/app/") || 
        path.startsWith("/hil-form/") || 
        ["/trust", "/overview", "/use-cases", "/getting-started", "/contact", "/privacy", "/terms", "/404"].includes(path.replace(/\/$/, '')) ||
        path.startsWith("/external/");

      if (!publicEntry && !isAuthPage && !isPublicRoute) {
        console.warn("[Auth] Session invalidated at", path, "- redirecting to login");
        clearSessionCache();
        const returnTo = encodeURIComponent(path + window.location.search);
        window.location.href = `/auth/login?returnTo=${returnTo}`;
      } else {
        console.log(`[Auth] Not authenticated (${isPublicRoute ? 'PublicPage' : 'AuthPage'})`);
      }
    }
  }, [userData, publicEntry]);

  const user = (userData && (userData as any).authenticated) ? (() => {
    const { adminRole, authenticated, csrfToken, message, ...userFields } = userData as any;
    return userFields as User;
  })() : null;

  const adminRole = userData?.adminRole || null;

  const loginMutation = useMutation({
    mutationFn: async (credentials: Pick<InsertUser, "username" | "password">) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (user: User) => {
      writeSessionCache({ ...user, authenticated: true });
      queryClient.setQueryData(["/api/user"], { ...user, authenticated: true });
      toast({
        title: "Welcome back",
        description: `Logged in as ${user.username}`,
      });
    },
    onError: (error: Error) => {
      notifyError(error, { title: "Login failed" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: InsertUser) => {
      const res = await apiRequest("POST", "/api/register", credentials);
      return await res.json();
    },
    onSuccess: (user: User) => {
      writeSessionCache({ ...user, authenticated: true });
      queryClient.setQueryData(["/api/user"], { ...user, authenticated: true });
      toast({
        title: "Account created",
        description: `Welcome ${user.username}`,
      });
    },
    onError: (error: Error) => {
      notifyError(error, { title: "Registration failed" });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      clearSessionCache();
      queryClient.setQueryData(["/api/user"], null);
      queryClient.clear();
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('selectedOrganizationId');
        } catch (e) {}
      }
      window.location.href = "/auth/login";
      toast({
        title: "Logged out",
        description: "See you soon!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const can = (permission: Permission) => {
    return checkPermission(userData || null, permission);
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        adminRole,
        isLoading,
        isFetched,
        isVerified,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

