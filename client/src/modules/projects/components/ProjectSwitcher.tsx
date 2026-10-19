import React from "react";
import { useLocation } from "wouter";
import { FolderKanban } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects, useActiveProject, useSetActiveProject } from "../hooks/use-projects";

import { Button } from "@/components/ui/button";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";

/**
 * Global Project Space switcher, sitting next to the org switcher in the header.
 *
 * Selecting a project sets SESSION scope on the server, which scoped routes and the
 * copilot then inherit. Showing it here is deliberate: the copilot used to guess
 * context from the last cycle touched, and the point of projects is to replace that
 * hidden guess with a visible, user-changeable selection (§6.4).
 */
export function ProjectSwitcher() {
    const [, setLocation] = useLocation();
    const orgContext = useOrgContextOptional();
    const selectedOrgId = orgContext?.selectedOrgId;
    const { data: listData, isLoading } = useProjects(false, selectedOrgId);
    const { data: activeData } = useActiveProject(selectedOrgId);
    const setActive = useSetActiveProject();

    const projects = listData?.projects ?? [];
    const activeId = activeData?.project?.id;
    const activeName = activeData?.project?.name ?? (projects.length > 0 ? projects[0].name : "Project");

    if (isLoading && !activeData?.project && projects.length === 0) {
        return (
            <div className="h-10 w-36 rounded-xl border border-white/10 bg-white/5 px-3 flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
                <FolderKanban className="h-3.5 w-3.5 opacity-50" />
                <span>Loading…</span>
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/projects")}
                className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-foreground/80 hover:bg-white/10 gap-1.5 px-3"
            >
                <FolderKanban className="h-3.5 w-3.5 text-primary" />
                <span>Projects</span>
            </Button>
        );
    }

    return (
        <Select
            value={activeId ? String(activeId) : undefined}
            onValueChange={(value) => {
                if (value === "__manage__") {
                    setLocation("/projects");
                    return;
                }
                setActive.mutate({ projectId: Number(value), orgId: selectedOrgId });
            }}
        >
            <SelectTrigger
                className="h-10 w-40 rounded-xl border-white/20 bg-white/20 text-xs font-bold text-foreground dark:border-white/5 dark:bg-white/5 dark:text-white"
                // axe: button-name, critical. A SelectTrigger renders a
                // button whose only content is the current value, so with
                // nothing selected it announces as "button".
                aria-label="Active project"
                data-testid="project-switcher"
            >
                <FolderKanban className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                <SelectValue placeholder="Project">
                    {activeName}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                    </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="__manage__">Manage projects…</SelectItem>
            </SelectContent>
        </Select>
    );
}

export default ProjectSwitcher;
