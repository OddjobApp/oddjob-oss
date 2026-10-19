import { useQuery } from "@tanstack/react-query";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";

/**
 * The organization's configured IANA timezone, or null when unset.
 *
 * Returns null rather than a default so callers can distinguish "not
 * configured" from "configured as UTC" — only the former should fall through to
 * the viewer's browser timezone. Consumers such as `defaultMapCenter()` already
 * treat null/undefined as "fall back", so passing this straight through is safe.
 *
 * Fails soft: a lookup error yields null and the caller falls back, because a
 * missing preference must never block rendering.
 */
export function useOrgTimezone(): string | null {
    const orgContext = useOrgContextOptional();
    const orgId = orgContext?.selectedOrgId ?? null;

    const { data } = useQuery({
        queryKey: ["/api/admin/organizations", orgId, "timezone"],
        enabled: orgId != null,
        // The zone changes about as often as an org is renamed; refetching it
        // on every mount would put a request behind every map that opens.
        staleTime: 30 * 60 * 1000,
        retry: false,
        queryFn: async () => {
            const res = await fetch(`/api/admin/organizations/${orgId}`, {
                credentials: "include",
            });
            if (!res.ok) return null;
            const body = await res.json();
            const tz = body?.organization?.timezone;
            return typeof tz === "string" && tz.trim() ? tz.trim() : null;
        },
    });

    return data ?? null;
}
