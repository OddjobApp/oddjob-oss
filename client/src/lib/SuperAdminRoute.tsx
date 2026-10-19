import { useLocation } from "wouter";
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { useEffect } from "react";
import { isSuperAdmin } from "./permissions";

interface SuperAdminRouteProps {
    path: string;
    component: React.ComponentType<any>;
}

export function SuperAdminRoute({ path, component: Component }: SuperAdminRouteProps) {
    const [, setLocation] = useLocation();
    const { user, adminRole, isLoading } = useAuth();

    useEffect(() => {
        if (!isLoading) {
            if (!user) {
                setLocation("/auth/login");
            } else if (!isSuperAdmin(user, adminRole || undefined)) {
                setLocation("/dashboard"); // Redirect unauthorized super admin routes to dashboard
            }
        }
    }, [user, adminRole, isLoading, setLocation]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    if (!user || !isSuperAdmin(user, adminRole || undefined)) {
        return null; // Will redirect via useEffect
    }

    return <Component />;
}
