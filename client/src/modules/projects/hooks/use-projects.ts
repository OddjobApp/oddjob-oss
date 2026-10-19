import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * Client-side surface for Project Spaces (docs/PROJECT_SPACES_DESIGN.md §7).
 * Every list here is an existing surface with a scope filter applied, which is what
 * keeps the UI affordable.
 */

export interface ProjectSummary {
    id: number;
    key: string;
    name: string;
    objective: string | null;
    description: string | null;
    status: "active" | "paused" | "archived";
    visibility: "org" | "private";
    ownerUserId: string | null;
    budgetLimitUsd: string | null;
    isDefault: boolean;
    createdAt: string;
    spendToDateUsd?: number;
    cycleCount?: number;
    activeCycleCount?: number;
}

export interface ProjectSpend {
    projectId: number;
    spendToDateUsd: number;
    budgetLimitUsd: number | null;
    remainingUsd: number | null;
    cycleCount: number;
    activeCycleCount: number;
}

/** Ascending capability — mirrors ROLE_RANK on the server (§8). */
export const PROJECT_ROLES = ["viewer", "operator", "editor", "owner"] as const;
export type ProjectRole = typeof PROJECT_ROLES[number];

export const ROLE_BLURB: Record<ProjectRole, string> = {
    owner: "Everything in-project, including members and archiving",
    editor: "Create and modify cycles, missions, apps and datasets",
    operator: "Run and approve executions; no structural changes",
    viewer: "Read-only",
};

export interface ProjectMember {
    id: number;
    projectId: number;
    principalType: "user" | "agent";
    principalId: string;
    role: ProjectRole;
    addedBy: string | null;
    createdAt: string;
    displayName: string;
    secondary: string | null;
    /** Comes from the project's owner field rather than a membership row — not removable. */
    implicit: boolean;
    isProjectOwner: boolean;
}

export interface MemberCandidate {
    principalId: string;
    displayName: string;
    secondary: string | null;
}

/** Does this role satisfy a requirement at or below it? */
export function roleAtLeast(role: string | null | undefined, required: ProjectRole): boolean {
    if (!role) return false;
    const rank = PROJECT_ROLES.indexOf(role as ProjectRole);
    return rank >= 0 && rank >= PROJECT_ROLES.indexOf(required);
}

export function useProjects(includeArchived = false, orgId?: number | null) {
    const queryParams = new URLSearchParams();
    if (includeArchived) queryParams.set("includeArchived", "true");
    if (orgId) queryParams.set("orgId", String(orgId));
    const qs = queryParams.toString();
    const url = `/api/projects${qs ? `?${qs}` : ""}`;

    return useQuery<{ projects: ProjectSummary[] }>({
        queryKey: ["/api/projects", orgId ?? "current", includeArchived],
        queryFn: async () => {
            const res = await apiRequest("GET", url);
            return res.json();
        }
    });
}

export function useProject(key: string | undefined) {
    return useQuery<{ project: ProjectSummary; spend: ProjectSpend; role: string | null }>({
        queryKey: [`/api/projects/${key}`],
        enabled: !!key,
    });
}

export function useProjectCycles(key: string | undefined) {
    return useQuery<{ cycles: any[] }>({
        queryKey: [`/api/projects/${key}/cycles`],
        enabled: !!key,
    });
}

export function useProjectMissions(key: string | undefined) {
    return useQuery<{ missions: any[] }>({
        queryKey: [`/api/projects/${key}/missions`],
        enabled: !!key,
    });
}

export function useProjectApps(key: string | undefined) {
    return useQuery<{ apps: any[] }>({
        queryKey: [`/api/projects/${key}/apps`],
        enabled: !!key,
    });
}

/** Crew discussion rooms belonging to this Project Space. */
export function useProjectRooms(key: string | undefined) {
    return useQuery<{ rooms: any[] }>({
        queryKey: [`/api/crew/rooms?projectKey=${key}`],
        enabled: !!key,
    });
}

export function useProjectKnowledge(key: string | undefined) {
    return useQuery<{ datasets: any[]; documents: any[] }>({
        queryKey: [`/api/projects/${key}/knowledge`],
        enabled: !!key,
    });
}

export interface ProjectForms {
    forms: any[];
    waitingStages: Array<{ approvalId: number; formId: number; formName: string; stageTitle: string; responseId: number; approverEmail: string; waitingSince: string }>;
    recentResults: Array<{ responseId: number; formId: number; formName: string; releaseNumber: number | null; status: string | null; submittedAt: string | null }>;
    responseDatasets: Array<{ id: number; name: string; description: string | null; forms: string[] }>;
}

/** The project's Form Studio forms, the stages waiting in its cycles, recent results and response datasets. */
export function useProjectForms(key: string | undefined) {
    return useQuery<ProjectForms>({
        queryKey: [`/api/projects/${key}/forms`],
        enabled: !!key,
    });
}

/** The workflows registered to this project (one per draft workstream). */
export function useProjectWorkflows(projectId: number | undefined) {
    return useQuery<any[]>({
        queryKey: [`/api/workflows?projectId=${projectId}`],
        enabled: !!projectId,
    });
}

/** A workflow's detail: `{ workflow, releases, deployments, projectId }`. */
export function useWorkflowDetail(workflowId: number | null | undefined) {
    return useQuery<{ workflow: any; releases: any[]; deployments: any[]; projectId: number | null }>({
        queryKey: [`/api/workflows/${workflowId}`],
        enabled: !!workflowId,
    });
}

/** Recent runs of a workflow's draft workstream, newest first. */
export function useWorkflowRuns(workflowId: number | null | undefined) {
    return useQuery<any[]>({
        queryKey: [`/api/workflows/${workflowId}/runs?limit=20`],
        enabled: !!workflowId,
    });
}

/** Signal subscriptions bound to a workflow — which signals may start a run. */
export function useWorkflowSignalSubscriptions(workflowId: number | null | undefined) {
    return useQuery<any[]>({
        queryKey: [`/api/workflows/${workflowId}/signal-subscriptions`],
        enabled: !!workflowId,
    });
}

/** Recent signal deliveries for a workflow, newest first. */
export function useWorkflowSignalDeliveries(workflowId: number | null | undefined) {
    return useQuery<any[]>({
        queryKey: [`/api/workflows/${workflowId}/signal-deliveries`],
        enabled: !!workflowId,
    });
}

/** The project's Media Studio productions and the rooms they are made in. */
export function useProjectMedia(key: string | undefined) {
    return useQuery<{ productions: import("@shared/media-studio").ProjectProduction[] }>({
        queryKey: [`/api/projects/${key}/media`],
        enabled: !!key,
    });
}

export function useProjectActivity(key: string | undefined) {
    return useQuery<{ events: any[] }>({
        queryKey: [`/api/projects/${key}/activity`],
        enabled: !!key,
    });
}

export interface ProjectEvent {
    id: number;
    projectId: number;
    title: string;
    description: string | null;
    kind: "deadline" | "milestone" | "launch" | "incident" | "note";
    severity: "Low" | "Medium" | "High" | "Critical";
    startsAt: string;
    endsAt: string | null;
    /** Cron rule, or null for a one-off. Occurrences are expanded, never stored. */
    recurrence: string | null;
    recurrenceTimezone: string;
    recurrenceUntil: string | null;
    createdBy: string;
}

/**
 * The authored half of the project timeline.
 *
 * Unbounded by default: the three views want different windows (agenda looks
 * forward, the calendar pages backwards), so filtering happens client-side over
 * one fetch rather than refetching per view.
 */
export function useProjectEvents(key: string | undefined) {
    return useQuery<{ events: ProjectEvent[] }>({
        queryKey: [`/api/projects/${key}/events`],
        enabled: !!key,
    });
}

export function useCreateProjectEvent(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (event: {
            title: string;
            description?: string | null;
            kind?: ProjectEvent["kind"];
            severity?: ProjectEvent["severity"];
            startsAt: string;
            endsAt?: string | null;
            recurrence?: string | null;
            recurrenceTimezone?: string;
            recurrenceUntil?: string | null;
        }) => {
            const res = await apiRequest("POST", `/api/projects/${key}/events`, event);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/projects/${key}/events`] });
        },
    });
}

export function useDeleteProjectEvent(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("DELETE", `/api/projects/${key}/events/${id}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/projects/${key}/events`] });
        },
    });
}

/** The session's active project — what the copilot and scoped routes inherit. */
export function useActiveProject(orgId?: number | null) {
    const url = `/api/projects/active${orgId ? `?orgId=${orgId}` : ""}`;
    return useQuery<{ project: ProjectSummary | null }>({
        queryKey: ["/api/projects/active", orgId ?? "current"],
        queryFn: async () => {
            const res = await apiRequest("GET", url);
            return res.json();
        }
    });
}

export function useSetActiveProject() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ projectId, orgId }: { projectId: number | null; orgId?: number | null }) => {
            const url = `/api/projects/active${orgId ? `?orgId=${orgId}` : ""}`;
            const res = await apiRequest("POST", url, { projectId });
            return res.json();
        },
        onSuccess: () => {
            // Scope changed, so every project-scoped list is stale.
            queryClient.invalidateQueries({
                predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/projects"),
            });
        },
    });
}

export function useCreateProject() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            name: string;
            key?: string;
            objective?: string;
            description?: string;
            visibility?: "org" | "private";
            budgetLimitUsd?: number | null;
            organizationId?: number | null;
        }) => {
            const url = `/api/projects${input.organizationId ? `?orgId=${input.organizationId}` : ""}`;
            const res = await apiRequest("POST", url, input);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/projects"),
            });
        },
    });
}

/** Every project query shares the `/api/projects` prefix, so one predicate refreshes all. */
function invalidateProjects(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/projects"),
    });
}

export function useUpdateProject(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (patch: {
            name?: string;
            objective?: string | null;
            description?: string | null;
            visibility?: "org" | "private";
            status?: "active" | "paused";
            budgetLimitUsd?: number | null;
        }) => {
            const res = await apiRequest("PATCH", `/api/projects/${key}`, patch);
            return res.json();
        },
        onSuccess: () => invalidateProjects(queryClient),
    });
}

export function useArchiveProject(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/projects/${key}/archive`, {});
            return res.json();
        },
        onSuccess: () => invalidateProjects(queryClient),
    });
}

// ---- Members ---------------------------------------------------------------

export function useProjectMembers(key: string | undefined) {
    return useQuery<{ members: ProjectMember[]; role: ProjectRole | null }>({
        queryKey: [`/api/projects/${key}/members`],
        enabled: !!key,
    });
}

/**
 * Grantable principals. Owner-only on the server, so this stays disabled unless the
 * viewer can actually act on it — a 403 in the console is not a UI.
 */
export function useProjectMemberCandidates(key: string | undefined, enabled: boolean) {
    return useQuery<{ users: MemberCandidate[]; agents: MemberCandidate[] }>({
        queryKey: [`/api/projects/${key}/member-candidates`],
        enabled: !!key && enabled,
    });
}

export function useAddProjectMember(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (member: { principalType: "user" | "agent"; principalId: string; role: ProjectRole }) => {
            const res = await apiRequest("POST", `/api/projects/${key}/members`, member);
            return res.json();
        },
        onSuccess: () => invalidateProjects(queryClient),
    });
}

export function useRemoveProjectMember(key: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (member: { principalType: "user" | "agent"; principalId: string }) => {
            const res = await apiRequest(
                "DELETE",
                `/api/projects/${key}/members/${member.principalType}/${encodeURIComponent(member.principalId)}`,
            );
            return res.json();
        },
        onSuccess: () => invalidateProjects(queryClient),
    });
}

export function useAttachResource(projectKey: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: { resourceType: string; resourceId: number; relation?: string }) => {
            const res = await apiRequest("POST", `/api/projects/${projectKey}/resources`, input);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                predicate: (query) => String(query.queryKey[0] ?? "").startsWith(`/api/projects/${projectKey}`),
            });
        },
    });
}

/** USD with cents, matching how cycle budgets are shown elsewhere. */
export function formatUsd(value: number | string | null | undefined): string {
    const n = value === null || value === undefined ? 0 : Number(value);
    if (Number.isNaN(n)) return "$0.00";
    return `$${n.toFixed(2)}`;
}
